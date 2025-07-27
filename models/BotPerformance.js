import mongoose from 'mongoose';

const botPerformanceSchema = new mongoose.Schema({
  bot_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AIGridBot',
    required: [true, 'Bot ID is required'],
    unique: true,
    index: true
  },
  symbol: {
    type: String,
    required: true,
    uppercase: true
  },
  total_profit: {
    type: Number,
    default: 0
  },
  total_trades: {
    type: Number,
    default: 0
  },
  successful_trades: {
    type: Number,
    default: 0
  },
  failed_trades: {
    type: Number,
    default: 0
  },
  win_rate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  pnl_percentage: {
    type: Number,
    default: 0
  },
  max_profit: {
    type: Number,
    default: 0
  },
  max_loss: {
    type: Number,
    default: 0
  },
  max_drawdown: {
    type: Number,
    default: 0
  },
  total_volume: {
    type: Number,
    default: 0
  },
  total_commission: {
    type: Number,
    default: 0
  },
  avg_trade_profit: {
    type: Number,
    default: 0
  },
  best_trade: {
    type: Number,
    default: 0
  },
  worst_trade: {
    type: Number,
    default: 0
  },
  profit_factor: {
    type: Number,
    default: 0
  },
  sharpe_ratio: {
    type: Number,
    default: 0
  },
  daily_performance: [{
    date: {
      type: Date,
      required: true
    },
    profit: {
      type: Number,
      default: 0
    },
    trades: {
      type: Number,
      default: 0
    },
    volume: {
      type: Number,
      default: 0
    }
  }],
  grid_performance: [{
    level: {
      type: Number,
      required: true
    },
    buy_fills: {
      type: Number,
      default: 0
    },
    sell_fills: {
      type: Number,
      default: 0
    },
    total_profit: {
      type: Number,
      default: 0
    }
  }],
  last_updated: {
    type: Date,
    default: Date.now
  },
  created_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
botPerformanceSchema.index({ bot_id: 1 });
botPerformanceSchema.index({ symbol: 1 });
botPerformanceSchema.index({ last_updated: -1 });
botPerformanceSchema.index({ 'daily_performance.date': -1 });

// Update last_updated before saving
botPerformanceSchema.pre('save', function(next) {
  this.last_updated = Date.now();
  next();
});

// Instance method to update performance metrics
botPerformanceSchema.methods.updateMetrics = function(tradeData) {
  this.total_trades += 1;
  this.total_profit += tradeData.profit || 0;
  this.total_volume += tradeData.volume || 0;
  this.total_commission += tradeData.commission || 0;
  
  if (tradeData.profit > 0) {
    this.successful_trades += 1;
    this.max_profit = Math.max(this.max_profit, tradeData.profit);
    this.best_trade = Math.max(this.best_trade, tradeData.profit);
  } else if (tradeData.profit < 0) {
    this.failed_trades += 1;
    this.max_loss = Math.min(this.max_loss, tradeData.profit);
    this.worst_trade = Math.min(this.worst_trade, tradeData.profit);
  }
  
  // Calculate win rate
  this.win_rate = this.total_trades > 0 ? 
    (this.successful_trades / this.total_trades) * 100 : 0;
  
  // Calculate average trade profit
  this.avg_trade_profit = this.total_trades > 0 ? 
    this.total_profit / this.total_trades : 0;
  
  // Update daily performance
  this.updateDailyPerformance(tradeData);
  
  return this.save();
};

// Instance method to update daily performance
botPerformanceSchema.methods.updateDailyPerformance = function(tradeData) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let dailyRecord = this.daily_performance.find(d => 
    d.date.getTime() === today.getTime()
  );
  
  if (!dailyRecord) {
    dailyRecord = {
      date: today,
      profit: 0,
      trades: 0,
      volume: 0
    };
    this.daily_performance.push(dailyRecord);
  }
  
  dailyRecord.profit += tradeData.profit || 0;
  dailyRecord.trades += 1;
  dailyRecord.volume += tradeData.volume || 0;
  
  // Keep only last 30 days
  if (this.daily_performance.length > 30) {
    this.daily_performance.sort((a, b) => b.date - a.date);
    this.daily_performance = this.daily_performance.slice(0, 30);
  }
};

// Instance method to calculate PnL percentage
botPerformanceSchema.methods.calculatePnLPercentage = function(investmentAmount) {
  this.pnl_percentage = investmentAmount > 0 ? 
    (this.total_profit / investmentAmount) * 100 : 0;
  return this.pnl_percentage;
};

// Instance method to calculate profit factor
botPerformanceSchema.methods.calculateProfitFactor = function() {
  const grossProfit = this.daily_performance.reduce((sum, day) => 
    sum + Math.max(0, day.profit), 0);
  const grossLoss = Math.abs(this.daily_performance.reduce((sum, day) => 
    sum + Math.min(0, day.profit), 0));
  
  this.profit_factor = grossLoss > 0 ? grossProfit / grossLoss : 0;
  return this.profit_factor;
};

// Instance method to update grid performance
botPerformanceSchema.methods.updateGridPerformance = function(gridLevel, side, profit) {
  let gridRecord = this.grid_performance.find(g => g.level === gridLevel);
  
  if (!gridRecord) {
    gridRecord = {
      level: gridLevel,
      buy_fills: 0,
      sell_fills: 0,
      total_profit: 0
    };
    this.grid_performance.push(gridRecord);
  }
  
  if (side === 'BUY') {
    gridRecord.buy_fills += 1;
  } else if (side === 'SELL') {
    gridRecord.sell_fills += 1;
  }
  
  gridRecord.total_profit += profit || 0;
  
  // Sort grid performance by level
  this.grid_performance.sort((a, b) => a.level - b.level);
};

// Static method to get performance by bot
botPerformanceSchema.statics.getByBot = function(botId) {
  return this.findOne({ bot_id: botId });
};

// Static method to create or update performance
botPerformanceSchema.statics.createOrUpdate = async function(botId, symbol, performanceData) {
  return await this.findOneAndUpdate(
    { bot_id: botId },
    { 
      symbol: symbol,
      ...performanceData,
      last_updated: new Date()
    },
    { 
      upsert: true, 
      new: true,
      runValidators: true
    }
  );
};

// Virtual for performance summary
botPerformanceSchema.virtual('summary').get(function() {
  return {
    bot_id: this.bot_id,
    symbol: this.symbol,
    total_profit: this.total_profit,
    total_trades: this.total_trades,
    win_rate: this.win_rate,
    pnl_percentage: this.pnl_percentage,
    max_drawdown: this.max_drawdown,
    profit_factor: this.profit_factor,
    avg_trade_profit: this.avg_trade_profit,
    best_trade: this.best_trade,
    worst_trade: this.worst_trade,
    last_updated: this.last_updated
  };
});

// Transform JSON output
botPerformanceSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('BotPerformance', botPerformanceSchema);