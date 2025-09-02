const User = require('../models/User');
const GridBot = require('../models/GridBot');
const Subscription = require('../models/Subscription');
const mongoose = require('mongoose');
const GridBotService = require('../services/gridBotService');

// Create service instance
const gridBotService = new GridBotService();

// Simple in-memory cache for admin stats (5 minute TTL)
let adminStatsCache = {
  data: null,
  timestamp: 0,
  ttl: 5 * 60 * 1000 // 5 minutes
};

const getCachedAdminStats = () => {
  const now = Date.now();
  if (adminStatsCache.data && (now - adminStatsCache.timestamp) < adminStatsCache.ttl) {
    console.log('📊 Returning cached admin stats');
    return adminStatsCache.data;
  }
  return null;
};

const setCachedAdminStats = (data) => {
  adminStatsCache.data = data;
  adminStatsCache.timestamp = Date.now();
  console.log('📊 Admin stats cached for 5 minutes');
};

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

    // Get bot counts and subscription status for each user
    const usersWithBotCounts = await Promise.all(
      users.map(async (user) => {
        const botCount = await GridBot.countDocuments({ userId: user._id });
        const activeBots = await GridBot.countDocuments({ userId: user._id, status: 'active' });

        // Get subscription status
        const subscription = await Subscription.findOne({ userId: user._id });
        let subscriptionStatus = {
          planType: 'free',
          status: 'active',
          isActive: false,
          endDate: null
        };

        if (subscription) {
          const isActive = subscription.status === 'active' && new Date() < new Date(subscription.endDate);
          subscriptionStatus = {
            planType: subscription.planType,
            status: subscription.status,
            isActive: isActive,
            endDate: subscription.endDate,
            startDate: subscription.startDate
          };
        }

        return {
          ...user.toObject(),
          botStats: {
            totalBots: botCount,
            activeBots: activeBots,
            inactiveBots: botCount - activeBots
          },
          subscriptionStatus: subscriptionStatus
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
    // Check cache first
    const cachedStats = getCachedAdminStats();
    if (cachedStats) {
      return res.json({
        success: true,
        message: 'Platform statistics retrieved successfully',
        data: cachedStats
      });
    }

    console.log('📊 Starting optimized admin stats calculation...');
    const startTime = Date.now();

    // Parallel execution of basic counts for better performance
    const [
      totalUsers,
      adminUsers,
      regularUsers,
      usersWithBinance,
      totalSubscriptions,
      activeSubscriptions,
      premiumSubscriptions,
      freeSubscriptions,
      expiredSubscriptions,
      cancelledSubscriptions,
      totalBots,
      activeBots,
      stoppedBots,
      pausedBots
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ 'binanceCredentials.isConfigured': true }),
      Subscription.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      Subscription.countDocuments({ planType: 'premium', status: 'active' }),
      Subscription.countDocuments({ planType: 'free', status: 'active' }),
      Subscription.countDocuments({ status: 'expired' }),
      Subscription.countDocuments({ status: 'cancelled' }),
      GridBot.countDocuments(),
      GridBot.countDocuments({ status: 'active' }),
      GridBot.countDocuments({ status: 'stopped' }),
      GridBot.countDocuments({ status: 'paused' })
    ]);

    // Calculate users without subscriptions
    const usersWithoutSubscription = totalUsers - totalSubscriptions;

    // Use MongoDB aggregation for financial statistics - much faster than individual processing
    const financialStats = await GridBot.aggregate([
      {
        $group: {
          _id: '$status',
          totalInvestment: { $sum: '$config.investmentAmount' },
          totalRealizedProfit: { $sum: '$statistics.totalProfit' },
          totalTrades: { $sum: '$statistics.totalTrades' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Process aggregation results
    let totalInvestment = 0;
    let stoppedBotsInvestment = 0;
    let pausedBotsInvestment = 0;
    let totalRealizedProfit = 0;
    let totalTrades = 0;
    let activeBotsInvestment = 0;

    financialStats.forEach(stat => {
      totalRealizedProfit += stat.totalRealizedProfit || 0;
      totalTrades += stat.totalTrades || 0;
      
      if (stat._id === 'active') {
        totalInvestment = stat.totalInvestment || 0;
      } else if (stat._id === 'stopped') {
        stoppedBotsInvestment = stat.totalInvestment || 0;
      } else if (stat._id === 'paused') {
        pausedBotsInvestment = stat.totalInvestment || 0;
      }
    });

    // For unrealized PnL, only process active bots (much faster)
    let totalUnrealizedProfit = 0;
    
    if (activeBots > 0) {
      console.log(`📊 Processing ${activeBots} active bots for unrealized PnL...`);
      
      // Get only active bots with minimal data needed
      const activeBotsList = await GridBot.find(
        { status: 'active' },
        { _id: 1, symbol: 1, orders: 1, statistics: 1 }
      ).lean(); // Use lean() for better performance

      // Process active bots in parallel batches for better performance
      const batchSize = 5; // Process 5 bots at a time
      const batches = [];
      
      for (let i = 0; i < activeBotsList.length; i += batchSize) {
        batches.push(activeBotsList.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        const batchPromises = batch.map(async (bot) => {
          try {
            // Try detailed analysis first
            const analysis = await gridBotService.getDetailedBotAnalysis(bot._id);
            const unrealizedPnL = analysis.profitLossAnalysis.unrealizedPnL || 0;
            
            // Calculate current holdings value for active investment
            let botActiveInvestment = 0;
            if (analysis.currentPositions && analysis.currentPositions.holdings) {
              for (const holding of analysis.currentPositions.holdings) {
                botActiveInvestment += holding.quantity * holding.avgPrice;
              }
            }
            
            return { unrealizedPnL, activeInvestment: botActiveInvestment };
          } catch (error) {
            console.warn(`⚠️ Detailed analysis failed for bot ${bot._id}, using fallback`);
            
            // Fast fallback calculation using existing order data
            const filledBuyOrders = bot.orders?.filter(order =>
              order.side === 'BUY' && order.status === 'FILLED' && !order.isLiquidation
            ) || [];
            
            const filledSellOrders = bot.orders?.filter(order =>
              order.side === 'SELL' && order.status === 'FILLED' && !order.isLiquidation
            ) || [];

            let totalBought = 0;
            let totalBoughtValue = 0;
            let totalSold = 0;

            filledBuyOrders.forEach(order => {
              const price = order.executedPrice || order.price;
              const qty = order.executedQty || order.quantity;
              totalBought += qty;
              totalBoughtValue += price * qty;
            });

            filledSellOrders.forEach(order => {
              totalSold += order.executedQty || order.quantity;
            });

            const netHoldings = totalBought - totalSold;
            const avgBuyPrice = totalBought > 0 ? totalBoughtValue / totalBought : 0;
            const activeInvestment = netHoldings > 0 ? netHoldings * avgBuyPrice : 0;
            
            return { unrealizedPnL: 0, activeInvestment }; // Fallback doesn't calculate unrealized PnL
          }
        });

        const batchResults = await Promise.all(batchPromises);
        
        batchResults.forEach(result => {
          totalUnrealizedProfit += result.unrealizedPnL;
          activeBotsInvestment += result.activeInvestment;
        });
      }
    }

    const totalProfit = totalRealizedProfit + totalUnrealizedProfit;
    const executionTime = Date.now() - startTime;
    
    console.log(`📊 Optimized stats calculation completed in ${executionTime}ms`);
    console.log(`📊 Results: Investment=${totalInvestment}, Active Investment=${activeBotsInvestment}, Realized=${totalRealizedProfit}, Unrealized=${totalUnrealizedProfit}`);

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentUsers = await User.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
    const recentBots = await GridBot.countDocuments({ createdAt: { $gte: sevenDaysAgo } });

    console.log(`⚡ Admin stats calculated in ${Date.now() - startTime}ms`);
    console.log('📊 Final Results:', {
      totalBots, activeBots, totalRealizedProfit, totalUnrealizedProfit, totalTrades
    });

    const responseData = {
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
        totalInvestment, // Configured investment amount for active bots
        activeBotsInvestment, // Current value of holdings in active bots (should be <= totalInvestment)
        stoppedBotsInvestment,
        pausedBotsInvestment,
        totalProfit, // Includes profit from both active and stopped bots
        totalRealizedProfit, // Profit from completed trades (all bots)
        totalUnrealizedProfit, // Unrealized profit from active bots only
        totalTrades,
        profitPercentage: totalInvestment > 0 ? ((totalProfit / totalInvestment) * 100).toFixed(2) : 0,
        realizedProfitPercentage: totalInvestment > 0 ? ((totalRealizedProfit / totalInvestment) * 100).toFixed(2) : 0,
        averageInvestmentPerBot: activeBots > 0 ? (totalInvestment / activeBots).toFixed(2) : 0,
        averageProfitPerBot: totalBots > 0 ? (totalProfit / totalBots).toFixed(2) : 0
      }
    };

    // Cache the results
    setCachedAdminStats(responseData);

    res.status(200).json({
      success: true,
      message: 'Platform statistics retrieved successfully',
      data: responseData
    });
  } catch (error) {
    console.error('Get platform stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching platform statistics'
    });
  }
};

// Upgrade user to premium manually (admin only)
const upgradeUserToPremium = async (req, res) => {
  try {
    const { userId } = req.params;
    const { duration = 30 } = req.body; // Default 30 days

    // Validate userId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user already has any subscription (active or expired)
    const existingSubscription = await Subscription.findOne({ userId: userId });

    if (existingSubscription) {
      // Update existing subscription
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + (duration * 24 * 60 * 60 * 1000));

      // If subscription is still active and not expired, extend from current end date
      if (existingSubscription.status === 'active' && new Date(existingSubscription.endDate) > new Date()) {
        const currentEndDate = new Date(existingSubscription.endDate);
        existingSubscription.endDate = new Date(currentEndDate.getTime() + (duration * 24 * 60 * 60 * 1000));
      } else {
        // If subscription is expired or inactive, start fresh
        existingSubscription.startDate = startDate;
        existingSubscription.endDate = endDate;
        existingSubscription.status = 'active';
        existingSubscription.planType = 'premium';
        // Ensure paymentId is set for premium subscriptions
        if (!existingSubscription.paymentId) {
          existingSubscription.paymentId = `admin_upgrade_${Date.now()}_${userId}`;
        }
      }

      await existingSubscription.save();

      return res.status(200).json({
        success: true,
        message: existingSubscription.status === 'active' && new Date(existingSubscription.endDate) > new Date()
          ? `Premium subscription extended by ${duration} days`
          : `Premium subscription activated for ${duration} days`,
        data: {
          subscription: existingSubscription
        }
      });
    } else {
      // Create new premium subscription
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + (duration * 24 * 60 * 60 * 1000));

      const newSubscription = new Subscription({
        userId: userId,
        planType: 'premium',
        status: 'active',
        startDate: startDate,
        endDate: endDate,
        paymentId: `admin_upgrade_${Date.now()}_${userId}` // Unique ID for admin upgrades
      });

      await newSubscription.save();

      return res.status(201).json({
        success: true,
        message: `User upgraded to premium for ${duration} days`,
        data: {
          subscription: newSubscription,
          user: {
            id: user._id,
            name: user.name,
            email: user.email
          }
        }
      });
    }
  } catch (error) {
    console.error('Error upgrading user to premium:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

module.exports = {
  getAllUsers,
  getUserDetails,
  getAllBots,
  getPlatformStats,
  upgradeUserToPremium
};