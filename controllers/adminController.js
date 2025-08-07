const User = require('../models/User');
const GridBot = require('../models/GridBot');
const mongoose = require('mongoose');

// Get all users with their basic information
const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', role = '' } = req.query;
    const skip = (page - 1) * limit;

    // Build search query
    let query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role && ['user', 'admin'].includes(role)) {
      query.role = role;
    }

    // Get users with pagination
    const users = await User.find(query)
      .select('-password -resetPasswordOTP -resetPasswordExpires -binanceCredentials.apiKey -binanceCredentials.secretKey')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalUsers = await User.countDocuments(query);

    // Get bot counts for each user
    const usersWithBotCounts = await Promise.all(
      users.map(async (user) => {
        const botCount = await GridBot.countDocuments({ userId: user._id });
        const activeBots = await GridBot.countDocuments({ userId: user._id, status: 'active' });
        
        return {
          ...user.toObject(),
          botStats: {
            totalBots: botCount,
            activeBots: activeBots,
            inactiveBots: botCount - activeBots
          }
        };
      })
    );

    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: {
        users: usersWithBotCounts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalUsers / limit),
          totalUsers,
          hasNext: page * limit < totalUsers,
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching users'
    });
  }
};

// Get specific user details with all their bots
const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate userId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Get user details
    const user = await User.findById(userId)
      .select('-password -resetPasswordOTP -resetPasswordExpires -binanceCredentials.apiKey -binanceCredentials.secretKey');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get all bots for this user
    const bots = await GridBot.find({ userId })
      .sort({ createdAt: -1 });

    // Calculate user statistics
    const totalInvestment = bots.reduce((sum, bot) => sum + (bot.investmentAmount || 0), 0);
    const totalProfit = bots.reduce((sum, bot) => sum + (bot.totalProfit || 0), 0);
    const activeBots = bots.filter(bot => bot.status === 'active').length;
    const completedTrades = bots.reduce((sum, bot) => sum + (bot.completedTrades || 0), 0);

    res.status(200).json({
      success: true,
      message: 'User details retrieved successfully',
      data: {
        user: {
          ...user.toObject(),
          statistics: {
            totalBots: bots.length,
            activeBots,
            stoppedBots: bots.filter(bot => bot.status === 'stopped').length,
            pausedBots: bots.filter(bot => bot.status === 'paused').length,
            totalInvestment,
            totalProfit,
            completedTrades,
            profitPercentage: totalInvestment > 0 ? ((totalProfit / totalInvestment) * 100).toFixed(2) : 0
          }
        },
        bots
      }
    });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user details'
    });
  }
};

// Get all bots across all users
const getAllBots = async (req, res) => {
  try {
    const { page = 1, limit = 20, status = '', symbol = '', userId = '' } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    let query = {};
    if (status && ['active', 'stopped', 'paused'].includes(status)) {
      query.status = status;
    }
    if (symbol) {
      query.symbol = { $regex: symbol, $options: 'i' };
    }
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      query.userId = userId;
    }

    // Get bots with user information
    const bots = await GridBot.find(query)
      .populate('userId', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalBots = await GridBot.countDocuments(query);

    // Calculate overall statistics
    const allBots = await GridBot.find(query);
    const totalInvestment = allBots.reduce((sum, bot) => sum + (bot.investmentAmount || 0), 0);
    const totalProfit = allBots.reduce((sum, bot) => sum + (bot.totalProfit || 0), 0);
    const activeBots = allBots.filter(bot => bot.status === 'active').length;

    res.status(200).json({
      success: true,
      message: 'All bots retrieved successfully',
      data: {
        bots,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalBots / limit),
          totalBots,
          hasNext: page * limit < totalBots,
          hasPrev: page > 1
        },
        statistics: {
          totalBots: allBots.length,
          activeBots,
          stoppedBots: allBots.filter(bot => bot.status === 'stopped').length,
          pausedBots: allBots.filter(bot => bot.status === 'paused').length,
          totalInvestment,
          totalProfit,
          profitPercentage: totalInvestment > 0 ? ((totalProfit / totalInvestment) * 100).toFixed(2) : 0
        }
      }
    });
  } catch (error) {
    console.error('Get all bots error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching bots'
    });
  }
};

// Get platform statistics
const getPlatformStats = async (req, res) => {
  try {
    // Get user statistics
    const totalUsers = await User.countDocuments();
    const adminUsers = await User.countDocuments({ role: 'admin' });
    const regularUsers = await User.countDocuments({ role: 'user' });
    const usersWithBinance = await User.countDocuments({ 'binanceCredentials.isConfigured': true });

    // Get bot statistics
    const totalBots = await GridBot.countDocuments();
    const activeBots = await GridBot.countDocuments({ status: 'active' });
    const stoppedBots = await GridBot.countDocuments({ status: 'stopped' });
    const pausedBots = await GridBot.countDocuments({ status: 'paused' });

    // Get financial statistics
    const allBots = await GridBot.find();
    const totalInvestment = allBots.reduce((sum, bot) => sum + (bot.investmentAmount || 0), 0);
    const totalProfit = allBots.reduce((sum, bot) => sum + (bot.totalProfit || 0), 0);
    const totalTrades = allBots.reduce((sum, bot) => sum + (bot.completedTrades || 0), 0);

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentUsers = await User.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
    const recentBots = await GridBot.countDocuments({ createdAt: { $gte: sevenDaysAgo } });

    res.status(200).json({
      success: true,
      message: 'Platform statistics retrieved successfully',
      data: {
        users: {
          total: totalUsers,
          admins: adminUsers,
          regular: regularUsers,
          withBinanceConfig: usersWithBinance,
          recentSignups: recentUsers
        },
        bots: {
          total: totalBots,
          active: activeBots,
          stopped: stoppedBots,
          paused: pausedBots,
          recentlyCreated: recentBots
        },
        financial: {
          totalInvestment,
          totalProfit,
          totalTrades,
          profitPercentage: totalInvestment > 0 ? ((totalProfit / totalInvestment) * 100).toFixed(2) : 0,
          averageInvestmentPerBot: totalBots > 0 ? (totalInvestment / totalBots).toFixed(2) : 0
        }
      }
    });
  } catch (error) {
    console.error('Get platform stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching platform statistics'
    });
  }
};

module.exports = {
  getAllUsers,
  getUserDetails,
  getAllBots,
  getPlatformStats
};