const User = require('../models/User');
const GridBot = require('../models/GridBot');
const Subscription = require('../models/Subscription');
const mongoose = require('mongoose');
const gridBotService = require('../services/gridBotService');

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

    // Get detailed analysis for each bot
    const detailedBots = [];
    for (const bot of bots) {
      try {
        const detailedAnalysis = await gridBotService.getDetailedBotAnalysis(bot._id);
        
        // Extract paired order profit information
        const pairedOrderProfits = detailedAnalysis.tradeHistory.completedTrades.map(trade => ({
          tradeId: trade.tradeId,
          buyOrderId: trade.buyOrder.orderId,
          sellOrderId: trade.sellOrder.orderId,
          buyPrice: trade.buyOrder.price,
          sellPrice: trade.sellOrder.price,
          quantity: trade.buyOrder.quantity,
          profit: trade.profit,
          profitPercentage: trade.profitPercentage,
          duration: trade.duration,
          buyTimestamp: trade.buyOrder.timestamp,
          sellTimestamp: trade.sellOrder.timestamp
        }));
        
        detailedBots.push({
          basicInfo: bot,
          detailedAnalysis,
          pairedOrderProfits: pairedOrderProfits,
          totalPairedOrderProfit: pairedOrderProfits.reduce((sum, trade) => sum + trade.profit, 0),
          completedTradesCount: pairedOrderProfits.length
        });
      } catch (error) {
        console.error(`Failed to get detailed analysis for bot ${bot._id}:`, error.message);
        // Include basic bot info even if detailed analysis fails
        detailedBots.push({
          basicInfo: bot,
          detailedAnalysis: null,
          pairedOrderProfits: [],
          totalPairedOrderProfit: 0,
          completedTradesCount: 0,
          error: error.message
        });
      }
    }

    // Calculate user statistics
    const totalInvestment = bots.reduce((sum, bot) => sum + (bot.config.investmentAmount || 0), 0);
    const totalProfit = bots.reduce((sum, bot) => sum + (bot.statistics.totalProfit || 0), 0);
    const activeBots = bots.filter(bot => bot.status === 'active').length;
    const completedTrades = bots.reduce((sum, bot) => sum + (bot.statistics.totalTrades || 0), 0);
    
    // Calculate additional statistics from detailed analysis
    let totalRealizedPnL = 0;
    let totalUnrealizedPnL = 0;
    let totalCompletedTrades = 0;
    let totalOpenOrders = 0;
    
    detailedBots.forEach(botData => {
      if (botData.detailedAnalysis) {
        totalRealizedPnL += botData.detailedAnalysis.profitLossAnalysis.realizedPnL || 0;
        totalUnrealizedPnL += botData.detailedAnalysis.profitLossAnalysis.unrealizedPnL || 0;
        totalCompletedTrades += botData.detailedAnalysis.tradingActivity.completedTrades || 0;
        totalOpenOrders += botData.detailedAnalysis.currentPositions.totalOpenOrders || 0;
      }
    });

    res.status(200).json({
      success: true,
      message: 'User details with comprehensive bot analytics retrieved successfully',
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
            profitPercentage: totalInvestment > 0 ? ((totalProfit / totalInvestment) * 100).toFixed(2) : 0,
            // Enhanced statistics from detailed analysis
            totalRealizedPnL,
            totalUnrealizedPnL,
            totalPnL: totalRealizedPnL + totalUnrealizedPnL,
            totalCompletedTrades,
            totalOpenOrders,
            averageProfitPerBot: bots.length > 0 ? (totalProfit / bots.length).toFixed(6) : 0,
            averageCompletedTradesPerBot: bots.length > 0 ? (totalCompletedTrades / bots.length).toFixed(2) : 0
          }
        },
        bots: detailedBots,
        summary: {
          totalBotsAnalyzed: detailedBots.length,
          successfulAnalysis: detailedBots.filter(b => b.detailedAnalysis !== null).length,
          failedAnalysis: detailedBots.filter(b => b.detailedAnalysis === null).length,
          analysisTimestamp: new Date().toISOString()
        }
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
    const activeBotsList = allBots.filter(bot => bot.status === 'active');
    const stoppedBotsList = allBots.filter(bot => bot.status === 'stopped');
    const pausedBotsList = allBots.filter(bot => bot.status === 'paused');
    
    const totalInvestment = allBots.reduce((sum, bot) => sum + (bot.config.investmentAmount || 0), 0);
    const activeBotsInvestment = activeBotsList.reduce((sum, bot) => sum + (bot.config.investmentAmount || 0), 0);
    const stoppedBotsInvestment = stoppedBotsList.reduce((sum, bot) => sum + (bot.config.investmentAmount || 0), 0);
    const pausedBotsInvestment = pausedBotsList.reduce((sum, bot) => sum + (bot.config.investmentAmount || 0), 0);
    
    const totalProfit = allBots.reduce((sum, bot) => sum + (bot.statistics.totalProfit || 0), 0);
    const activeBots = activeBotsList.length;

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
          stoppedBots: stoppedBotsList.length,
          pausedBots: pausedBotsList.length,
          totalInvestment,
          activeBotsInvestment,
          stoppedBotsInvestment,
          pausedBotsInvestment,
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

    // Get subscription statistics
    const totalSubscriptions = await Subscription.countDocuments();
    const activeSubscriptions = await Subscription.countDocuments({ status: 'active' });
    const premiumSubscriptions = await Subscription.countDocuments({ planType: 'premium', status: 'active' });
    const freeSubscriptions = await Subscription.countDocuments({ planType: 'free', status: 'active' });
    const expiredSubscriptions = await Subscription.countDocuments({ status: 'expired' });
    const cancelledSubscriptions = await Subscription.countDocuments({ status: 'cancelled' });
    
    // Calculate users without subscriptions
    const usersWithoutSubscription = totalUsers - totalSubscriptions;

    // Get bot statistics
    const totalBots = await GridBot.countDocuments();
    const activeBots = await GridBot.countDocuments({ status: 'active' });
    const stoppedBots = await GridBot.countDocuments({ status: 'stopped' });
    const pausedBots = await GridBot.countDocuments({ status: 'paused' });

    // Get financial statistics
    const allBots = await GridBot.find();
    const activeBotsList = allBots.filter(bot => bot.status === 'active');
    const stoppedBotsList = allBots.filter(bot => bot.status === 'stopped');
    const pausedBotsList = allBots.filter(bot => bot.status === 'paused');
    
    const totalInvestment = allBots.reduce((sum, bot) => sum + (bot.config.investmentAmount || 0), 0);
    const activeBotsInvestment = activeBotsList.reduce((sum, bot) => sum + (bot.config.investmentAmount || 0), 0);
    const stoppedBotsInvestment = stoppedBotsList.reduce((sum, bot) => sum + (bot.config.investmentAmount || 0), 0);
    const pausedBotsInvestment = pausedBotsList.reduce((sum, bot) => sum + (bot.config.investmentAmount || 0), 0);
    
    // Calculate accurate profit using detailed analysis method
    let totalRealizedProfit = 0;
    let totalUnrealizedProfit = 0;
    let totalTrades = 0;
    
    for (const bot of allBots) {
      try {
        const analysis = await gridBotService.getDetailedBotAnalysis(bot._id);
        totalRealizedProfit += analysis.profitLossAnalysis.realizedPnL || 0;
        totalUnrealizedProfit += analysis.profitLossAnalysis.unrealizedPnL || 0;
        totalTrades += analysis.tradingActivity.totalTrades || 0;
      } catch (error) {
        console.error(`Failed to get detailed analysis for bot ${bot._id}:`, error.message);
        // Fallback to bot statistics if detailed analysis fails
        totalRealizedProfit += (bot.statistics.totalProfit || 0);
        totalTrades += (bot.statistics.totalTrades || 0);
      }
    }
    
    const totalProfit = totalRealizedProfit + totalUnrealizedProfit;

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
        subscriptions: {
          total: totalSubscriptions,
          active: activeSubscriptions,
          premium: premiumSubscriptions,
          free: freeSubscriptions,
          expired: expiredSubscriptions,
          cancelled: cancelledSubscriptions,
          usersWithoutSubscription: usersWithoutSubscription,
          subscriptionRate: totalUsers > 0 ? ((totalSubscriptions / totalUsers) * 100).toFixed(2) : 0,
          premiumRate: totalUsers > 0 ? ((premiumSubscriptions / totalUsers) * 100).toFixed(2) : 0
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
          activeBotsInvestment,
          stoppedBotsInvestment,
          pausedBotsInvestment,
          totalProfit,
          totalRealizedProfit,
          totalUnrealizedProfit,
          totalTrades,
          profitPercentage: totalInvestment > 0 ? ((totalProfit / totalInvestment) * 100).toFixed(2) : 0,
          realizedProfitPercentage: totalInvestment > 0 ? ((totalRealizedProfit / totalInvestment) * 100).toFixed(2) : 0,
          averageInvestmentPerBot: totalBots > 0 ? (totalInvestment / totalBots).toFixed(2) : 0,
          averageProfitPerBot: totalBots > 0 ? (totalProfit / totalBots).toFixed(2) : 0
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