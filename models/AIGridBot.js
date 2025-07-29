import mongoose from 'mongoose';

const aiGridBotSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true
  },
  symbol: {
    type: String,
    required: [true, 'Trading symbol is required'],
    uppercase: true,
    trim: true,
    match: [/^[A-Z]+$/, 'Symbol must contain only uppercase letters']
  },
  investment_amount: {
    type: Number,
    required: [true, 'Investment amount is required'],
    min: [10, 'Minimum investment is $10'],
    max: [100000, 'Maximum investment is $100,000']
  },
  status: {
    type: String,
    enum: ['active', 'stopped', 'error', 'initializing'],
    default: 'initializing'
  },
  test_mode: {
    type: Boolean,
    default: true,
    required: true
  },
  grid_params: {
    upper_price: {
      type: Number,
      required: true
    },
    lower_price: {
      type: Number,
      required: true
    },
    grid_count: {
      type: Number,
      required: true,
      min: 10,
      max: 50
    },
    grid_spacing: {
      type: Number,
      required: true
    },
    order_size: {
      type: Number,
      required: true
    },
    current_price: {
      type: Number,
      required: true
    },
    atr_value: {
      type: Number,
      required: true
    }
  },
  performance: {
    total_profit: {
      type: Number,
      default: 0
    },
    total_trades: {
      type: Number,
      default: 0
    },
    win_rate: {
      type: Number,
      default: 0
    },
    pnl_percentage: {
      type: Number,
      default: 0
    },
    max_drawdown: {
      type: Number,
      default: 0
    }
  },
  risk_params: {
    stop_loss_price: {
      type: Number,
      required: true
    },
    take_profit_percentage: {
      type: Number,
      default: 20
    },
    max_drawdown_percentage: {
      type: Number,
      default: 25
    }
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
  stopped_at: {
    type: Date
  },
  stop_reason: {
    type: String,
    enum: ['USER_STOPPED', 'STOP_LOSS_TRIGGERED', 'ERROR', 'TAKE_PROFIT_REACHED'],
    default: 'USER_STOPPED'
  }
}, {
  timestamps: true
});

// Index for efficient queries
aiGridBotSchema.index({ user_id: 1, status: 1 });
aiGridBotSchema.index({ symbol: 1, status: 1 });
aiGridBotSchema.index({ created_at: -1 });

// Update the updated_at field before saving
aiGridBotSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

// Instance method to stop the bot
aiGridBotSchema.methods.stopBot = function() {
  this.status = 'stopped';
  this.stopped_at = new Date();
  return this.save();
};

// Instance method to update performance
aiGridBotSchema.methods.updatePerformance = function(performanceData) {
  this.performance = { ...this.performance, ...performanceData };
  return this.save();
};

// Static method to find active bots by user
aiGridBotSchema.statics.findActiveByUser = function(userId) {
  return this.find({ user_id: userId, status: 'active' });
};

// Static method to find by symbol
aiGridBotSchema.statics.findBySymbol = function(symbol) {
  return this.find({ symbol: symbol.toUpperCase(), status: 'active' });
};

// Virtual for bot summary
aiGridBotSchema.virtual('summary').get(function() {
  return {
    id: this._id,
    symbol: this.symbol,
    investment_amount: this.investment_amount,
    status: this.status,
    stop_reason: this.stop_reason,
    total_profit: this.performance.total_profit,
    pnl_percentage: this.performance.pnl_percentage,
    total_trades: this.performance.total_trades,
    stop_loss_price: this.risk_params.stop_loss_price,
    created_at: this.created_at,
    updated_at: this.updated_at,
    stopped_at: this.stopped_at
  };
});

// Transform JSON output
aiGridBotSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('AIGridBot', aiGridBotSchema);