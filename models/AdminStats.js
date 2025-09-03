const mongoose = require('mongoose');

const adminStatsSchema = new mongoose.Schema({
  // User statistics
  users: {
    total: { type: Number, default: 0 },
    admin: { type: Number, default: 0 },
    regular: { type: Number, default: 0 },
    withBinanceCredentials: { type: Number, default: 0 },
    recentlyJoined: { type: Number, default: 0 },
    subscriptionRate: { type: String, default: '0' },
    premiumRate: { type: String, default: '0' }
  },
  
  // Subscription statistics
  subscriptions: {
    total: { type: Number, default: 0 },
    active: { type: Number, default: 0 },
    premium: { type: Number, default: 0 },
    free: { type: Number, default: 0 },
    expired: { type: Number, default: 0 },
    cancelled: { type: Number, default: 0 },
    usersWithoutSubscription: { type: Number, default: 0 },
    subscriptionRate: { type: String, default: '0' },
    premiumRate: { type: String, default: '0' }
  },
  
  // Bot statistics
  bots: {
    total: { type: Number, default: 0 },
    active: { type: Number, default: 0 },
    stopped: { type: Number, default: 0 },
    paused: { type: Number, default: 0 },
    recentlyCreated: { type: Number, default: 0 }
  },
  
  // Financial statistics
  financial: {
    totalInvestment: { type: Number, default: 0 },
    activeBotsInvestment: { type: Number, default: 0 },
    stoppedBotsInvestment: { type: Number, default: 0 },
    pausedBotsInvestment: { type: Number, default: 0 },
    totalProfit: { type: Number, default: 0 },
    totalRealizedProfit: { type: Number, default: 0 },
    totalUnrealizedProfit: { type: Number, default: 0 },
    totalTrades: { type: Number, default: 0 },
    profitPercentage: { type: String, default: '0' },
    realizedProfitPercentage: { type: String, default: '0' },
    averageInvestmentPerBot: { type: String, default: '0' },
    averageProfitPerBot: { type: String, default: '0' }
  },
  
  // Metadata
  lastUpdated: { type: Date, default: Date.now },
  calculationDuration: { type: Number, default: 0 }, // in milliseconds
  isCalculating: { type: Boolean, default: false },
  calculationError: { type: String, default: null }
}, {
  timestamps: true,
  collection: 'admin_stats'
});

// Index for efficient querying
adminStatsSchema.index({ lastUpdated: -1 });

// Static method to get latest stats
adminStatsSchema.statics.getLatest = function() {
  return this.findOne().sort({ lastUpdated: -1 });
};

// Static method to create or update stats
adminStatsSchema.statics.updateStats = function(statsData) {
  return this.findOneAndUpdate(
    {},
    {
      ...statsData,
      lastUpdated: new Date(),
      isCalculating: false,
      calculationError: null
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
};

// Static method to mark calculation as started
adminStatsSchema.statics.markCalculationStarted = function() {
  return this.findOneAndUpdate(
    {},
    {
      isCalculating: true,
      calculationError: null
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
};

// Static method to mark calculation as failed
adminStatsSchema.statics.markCalculationFailed = function(error) {
  return this.findOneAndUpdate(
    {},
    {
      isCalculating: false,
      calculationError: error.message || 'Unknown error'
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
};

module.exports = mongoose.model('AdminStats', adminStatsSchema);