const User = require('../models/User');
const GridBot = require('../models/GridBot');
const Subscription = require('../models/Subscription');
const AdminStats = require('../models/AdminStats');
const GridBotService = require('./gridBotService');
const mongoose = require('mongoose');

class AdminStatsService {
  constructor() {
    this.gridBotService = new GridBotService();
    this.isCalculating = false;
    this.updateInterval = null;
  }

  // Start the background job with 15-minute intervals
  startBackgroundUpdates() {
    console.log('🔄 Starting admin stats background updates (every 15 minutes)');
    
    // Calculate immediately on startup
    this.calculateAndUpdateStats();
    
    // Set up recurring updates every 15 minutes
    this.updateInterval = setInterval(() => {
      this.calculateAndUpdateStats();
    }, 15 * 60 * 1000); // 15 minutes in milliseconds
  }

  // Stop the background job
  stopBackgroundUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('⏹️ Admin stats background updates stopped');
    }
  }

  // Main calculation method
  async calculateAndUpdateStats() {
    if (this.isCalculating) {
      console.log('⚠️ Admin stats calculation already in progress, skipping...');
      return;
    }

    try {
      this.isCalculating = true;
      const startTime = Date.now();
      
      console.log('📊 Starting admin stats calculation...');
      await AdminStats.markCalculationStarted();

      // Calculate all statistics
      const statsData = await this.calculateStats();
      
      // Add calculation metadata
      statsData.calculationDuration = Date.now() - startTime;
      
      // Save to database
      await AdminStats.updateStats(statsData);
      
      console.log(`✅ Admin stats updated successfully in ${statsData.calculationDuration}ms`);
      
    } catch (error) {
      console.error('❌ Admin stats calculation failed:', error);
      await AdminStats.markCalculationFailed(error);
    } finally {
      this.isCalculating = false;
    }
  }

  // Calculate all statistics (extracted from adminController)
  async calculateStats() {
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

    // Calculate recent activity (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [recentUsers, recentBots] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      GridBot.countDocuments({ createdAt: { $gte: sevenDaysAgo } })
    ]);

    // Calculate users without subscription
    const usersWithoutSubscription = totalUsers - totalSubscriptions;

    // Financial calculations using aggregation
    const [investmentAggregation, profitAggregation, tradesAggregation] = await Promise.all([
      this.calculateInvestmentStats(),
      this.calculateProfitStats(),
      this.calculateTradesStats()
    ]);

    const {
      totalInvestment,
      activeBotsInvestment,
      stoppedBotsInvestment,
      pausedBotsInvestment
    } = investmentAggregation;

    const {
      totalRealizedProfit,
      totalUnrealizedProfit
    } = profitAggregation;

    const { totalTrades } = tradesAggregation;
    const totalProfit = totalRealizedProfit + totalUnrealizedProfit;

    return {
      users: {
        total: totalUsers,
        admin: adminUsers,
        regular: regularUsers,
        withBinanceCredentials: usersWithBinance,
        recentlyJoined: recentUsers,
        subscriptionRate: totalUsers > 0 ? ((totalSubscriptions / totalUsers) * 100).toFixed(2) : '0',
        premiumRate: totalUsers > 0 ? ((premiumSubscriptions / totalUsers) * 100).toFixed(2) : '0'
      },
      subscriptions: {
        total: totalSubscriptions,
        active: activeSubscriptions,
        premium: premiumSubscriptions,
        free: freeSubscriptions,
        expired: expiredSubscriptions,
        cancelled: cancelledSubscriptions,
        usersWithoutSubscription: usersWithoutSubscription,
        subscriptionRate: totalUsers > 0 ? ((totalSubscriptions / totalUsers) * 100).toFixed(2) : '0',
        premiumRate: totalUsers > 0 ? ((premiumSubscriptions / totalUsers) * 100).toFixed(2) : '0'
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
        profitPercentage: totalInvestment > 0 ? ((totalProfit / totalInvestment) * 100).toFixed(2) : '0',
        realizedProfitPercentage: totalInvestment > 0 ? ((totalRealizedProfit / totalInvestment) * 100).toFixed(2) : '0',
        averageInvestmentPerBot: activeBots > 0 ? (totalInvestment / activeBots).toFixed(2) : '0',
        averageProfitPerBot: totalBots > 0 ? (totalProfit / totalBots).toFixed(2) : '0'
      }
    };
  }

  // Calculate investment statistics using aggregation
  async calculateInvestmentStats() {
    const investmentAggregation = await GridBot.aggregate([
      {
        $group: {
          _id: '$status',
          totalInvestment: { $sum: '$investment' },
          count: { $sum: 1 }
        }
      }
    ]);

    let totalInvestment = 0;
    let activeBotsInvestment = 0;
    let stoppedBotsInvestment = 0;
    let pausedBotsInvestment = 0;

    investmentAggregation.forEach(group => {
      const investment = group.totalInvestment || 0;
      totalInvestment += investment;
      
      switch (group._id) {
        case 'active':
          activeBotsInvestment = investment;
          break;
        case 'stopped':
          stoppedBotsInvestment = investment;
          break;
        case 'paused':
          pausedBotsInvestment = investment;
          break;
      }
    });

    return {
      totalInvestment,
      activeBotsInvestment,
      stoppedBotsInvestment,
      pausedBotsInvestment
    };
  }

  // Calculate profit statistics
  async calculateProfitStats() {
    // Get realized profit from aggregation
    const realizedProfitAggregation = await GridBot.aggregate([
      {
        $group: {
          _id: null,
          totalRealizedProfit: { $sum: '$realizedProfit' }
        }
      }
    ]);

    const totalRealizedProfit = realizedProfitAggregation[0]?.totalRealizedProfit || 0;

    // Calculate unrealized profit for active bots
    let totalUnrealizedProfit = 0;
    const activeBots = await GridBot.find({ status: 'active' }).select('_id symbol investment');
    
    if (activeBots.length > 0) {
      console.log(`📊 Calculating unrealized PnL for ${activeBots.length} active bots...`);
      
      // Process in batches for better performance
      const batchSize = 10;
      const batches = [];
      
      for (let i = 0; i < activeBots.length; i += batchSize) {
        batches.push(activeBots.slice(i, i + batchSize));
      }
      
      const batchResults = await Promise.all(
        batches.map(batch => this.processBotBatch(batch))
      );
      
      // Sum up all unrealized profits
      totalUnrealizedProfit = batchResults.reduce((sum, batchResult) => {
        return sum + batchResult.reduce((batchSum, bot) => batchSum + bot.unrealizedPnL, 0);
      }, 0);
    }

    return {
      totalRealizedProfit,
      totalUnrealizedProfit
    };
  }

  // Process a batch of bots for unrealized PnL calculation
  async processBotBatch(bots) {
    return Promise.all(
      bots.map(async (bot) => {
        try {
          const detailedAnalysis = await this.gridBotService.getDetailedBotAnalysis(bot._id);
          return {
            botId: bot._id,
            unrealizedPnL: detailedAnalysis?.profitLossAnalysis?.unrealizedPnL || 0
          };
        } catch (error) {
          console.warn(`⚠️ Failed detailed analysis for bot ${bot._id}, using fallback`);
          // Fallback calculation using existing order data
          return {
            botId: bot._id,
            unrealizedPnL: 0 // Fallback to 0 if detailed analysis fails
          };
        }
      })
    );
  }

  // Calculate total trades
  async calculateTradesStats() {
    const tradesAggregation = await GridBot.aggregate([
      {
        $group: {
          _id: null,
          totalTrades: { $sum: '$totalTrades' }
        }
      }
    ]);

    return {
      totalTrades: tradesAggregation[0]?.totalTrades || 0
    };
  }

  // Get latest stats from database
  async getLatestStats() {
    return await AdminStats.getLatest();
  }

  // Force immediate calculation (for manual triggers)
  async forceCalculation() {
    console.log('🔄 Force calculating admin stats...');
    await this.calculateAndUpdateStats();
  }
}

module.exports = AdminStatsService;