const mongoose = require('mongoose');

const gridBotSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true
  },
  name: {
    type: String,
    required: [true, 'Bot name is required'],
    trim: true,
    minlength: [1, 'Bot name cannot be empty'],
    maxlength: [100, 'Bot name cannot exceed 100 characters']
  },
  symbol: {
    type: String,
    required: [true, 'Trading symbol is required'],
    uppercase: true,
    validate: {
      validator: function(v) {
        return /^[A-Z]{3,10}$/.test(v); // Basic symbol validation
      },
      message: 'Invalid trading symbol format'
    }
  },
  status: {
    type: String,
    enum: {
      values: ['active', 'paused', 'stopped', 'error', 'recovering'],
      message: 'Status must be one of: active, paused, stopped, error, recovering'
    },
    default: 'paused'
  },
  config: {
    upperPrice: {
      type: Number,
      required: [true, 'Upper price is required'],
      min: [0.00000001, 'Upper price must be positive'],
      validate: {
        validator: function(v) {
          return this.config.lowerPrice ? v > this.config.lowerPrice : true;
        },
        message: 'Upper price must be greater than lower price'
      }
    },
    lowerPrice: {
      type: Number,
      required: [true, 'Lower price is required'],
      min: [0.00000001, 'Lower price must be positive']
    },
    gridLevels: {
      type: Number,
      required: [true, 'Grid levels is required'],
      min: [2, 'Minimum 2 grid levels required'],
      max: [100, 'Maximum 100 grid levels allowed'],
      validate: {
        validator: Number.isInteger,
        message: 'Grid levels must be an integer'
      }
    },
    investmentAmount: {
      type: Number,
      required: [true, 'Investment amount is required'],
      min: [0.01, 'Minimum investment amount is 0.01'],
      max: [1000000, 'Maximum investment amount is 1,000,000']
    },
    profitPerGrid: {
      type: Number,
      required: [true, 'Profit per grid is required'],
      min: [0.01, 'Minimum profit per grid is 0.01%'],
      max: [50, 'Maximum profit per grid is 50%']
    }
  },
  statistics: {
    totalProfit: {
      type: Number,
      default: 0
    },
    totalTrades: {
      type: Number,
      default: 0,
      min: 0
    },
    successfulTrades: {
      type: Number,
      default: 0,
      min: 0
    },
    failedTrades: {
      type: Number,
      default: 0,
      min: 0
    },
    totalInvestment: {
      type: Number,
      default: 0,
      min: 0
    },
    runningTime: {
      type: Number,
      default: 0,
      min: 0
    },
    startTime: {
      type: Date
    },
    lastTradeTime: {
      type: Date
    },
    averageProfit: {
      type: Number,
      default: 0
    },
    maxDrawdown: {
      type: Number,
      default: 0
    }
  },
  orders: [{
    orderId: {
      type: String,
      required: true
    },
    side: {
      type: String,
      enum: {
        values: ['BUY', 'SELL'],
        message: 'Order side must be BUY or SELL'
      },
      required: true
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    quantity: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: {
        values: ['NEW', 'FILLED', 'CANCELED', 'EXPIRED', 'REJECTED'],
        message: 'Invalid order status'
      },
      required: true
    },
    gridLevel: {
      type: Number,
      required: true
    },
    isLiquidation: {
      type: Boolean,
      default: false
    },
    executedQty: {
      type: Number,
      default: 0
    },
    executedPrice: {
      type: Number
    },
    commission: {
      type: Number,
      default: 0
    },
    commissionAsset: {
      type: String
    },
    isFilled: {
      type: Boolean,
      default: false
    },
    filledAt: {
      type: Date
    },
    hasCorrespondingSell: {
      type: Boolean,
      default: false
    },
    isRecoveryOrder: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  }],
  lastError: {
    message: String,
    timestamp: Date,
    code: String,
    details: mongoose.Schema.Types.Mixed
  },
  validationErrors: [{
    field: String,
    message: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  recoveryHistory: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    type: {
      type: String,
      enum: ['sell_order_recovery', 'status_sync', 'balance_check', 'error_recovery']
    },
    ordersPlaced: {
      type: Number,
      default: 0
    },
    orderIds: [String],
    details: mongoose.Schema.Types.Mixed
  }],
  riskManagement: {
    maxLoss: {
      type: Number,
      default: 0
    },
    stopLossEnabled: {
      type: Boolean,
      default: false
    },
    takeProfitEnabled: {
      type: Boolean,
      default: false
    },
    maxDailyTrades: {
      type: Number,
      default: 0
    }
  },
  aiAnalysis: {
    reasoning: {
      type: String,
      trim: true
    },
    generatedAt: {
      type: Date
    },
    parameters: {
      upperPrice: {
        type: Number
      },
      lowerPrice: {
        type: Number
      },
      gridLevels: {
        type: Number
      },
      profitPerGrid: {
        type: Number
      }
    },
    marketData: {
      currentPrice: {
        type: Number
      },
      priceChange24h: {
        type: Number
      },
      volume24h: {
        type: Number
      },
      volatility: {
        type: Number
      }
    }
  }
}, {
  timestamps: true
});

// **INDEXES for better query performance**
gridBotSchema.index({ userId: 1, status: 1 });
gridBotSchema.index({ symbol: 1 });
gridBotSchema.index({ 'userId': 1, 'name': 1 }, { unique: true }); // Prevent duplicate bot names per user
gridBotSchema.index({ createdAt: -1 });
gridBotSchema.index({ 'orders.orderId': 1 });

// **PRE-SAVE MIDDLEWARE for additional validation**
gridBotSchema.pre('save', function(next) {
  // Ensure upper price > lower price
  if (this.config.upperPrice <= this.config.lowerPrice) {
    const error = new Error('Upper price must be greater than lower price');
    error.name = 'ValidationError';
    return next(error);
  }
  
  // Calculate and validate price range
  const priceRange = this.config.upperPrice - this.config.lowerPrice;
  const minPriceStep = priceRange / this.config.gridLevels;
  
  if (minPriceStep <= 0) {
    const error = new Error('Price range too small for the number of grid levels');
    error.name = 'ValidationError';
    return next(error);
  }
  
  // Update statistics calculations
  if (this.statistics.totalTrades > 0) {
    this.statistics.averageProfit = this.statistics.totalProfit / this.statistics.totalTrades;
  }
  
  // Update running time if bot is active
  if (this.status === 'active' && this.statistics.startTime) {
    this.statistics.runningTime = Date.now() - this.statistics.startTime.getTime();
  }
  
  next();
});

// **VIRTUAL FIELDS**
gridBotSchema.virtual('profitability').get(function() {
  if (this.statistics.totalInvestment > 0) {
    return (this.statistics.totalProfit / this.statistics.totalInvestment) * 100;
  }
  return 0;
});

gridBotSchema.virtual('successRate').get(function() {
  if (this.statistics.totalTrades > 0) {
    return (this.statistics.successfulTrades / this.statistics.totalTrades) * 100;
  }
  return 0;
});

gridBotSchema.virtual('activeOrdersCount').get(function() {
  return this.orders.filter(order => order.status === 'NEW').length;
});

// **INSTANCE METHODS**
gridBotSchema.methods.addValidationError = function(field, message) {
  this.validationErrors.push({
    field,
    message,
    timestamp: new Date()
  });
  
  // Keep only last 10 validation errors
  if (this.validationErrors.length > 10) {
    this.validationErrors = this.validationErrors.slice(-10);
  }
};

gridBotSchema.methods.setError = function(message, code = 'UNKNOWN', details = null) {
  this.lastError = {
    message,
    code,
    details,
    timestamp: new Date()
  };
  
  if (this.status !== 'stopped') {
    this.status = 'error';
  }
};

gridBotSchema.methods.clearError = function() {
  this.lastError = undefined;
  if (this.status === 'error') {
    this.status = 'paused';
  }
};

gridBotSchema.methods.updateOrderStatus = function(orderId, newStatus, executedQty = null, executedPrice = null, commission = 0) {
  const order = this.orders.find(o => o.orderId.toString() === orderId.toString());
  if (order) {
    order.status = newStatus;
    order.updatedAt = new Date();
    
    if (executedQty !== null) order.executedQty = executedQty;
    if (executedPrice !== null) order.executedPrice = executedPrice;
    if (commission > 0) order.commission = commission;
    
    return true;
  }
  return false;
};

// **STATIC METHODS**
gridBotSchema.statics.findActiveByUser = function(userId) {
  return this.find({ userId, status: 'active' });
};

gridBotSchema.statics.findByUserAndSymbol = function(userId, symbol) {
  return this.find({ userId, symbol: symbol.toUpperCase() });
};

gridBotSchema.statics.getPerformanceStats = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        totalBots: { $sum: 1 },
        activeBots: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        totalProfit: { $sum: '$statistics.totalProfit' },
        totalTrades: { $sum: '$statistics.totalTrades' },
        totalInvestment: { $sum: '$statistics.totalInvestment' }
      }
    }
  ]);
};

// **ENSURE VIRTUAL FIELDS ARE INCLUDED IN JSON**
gridBotSchema.set('toJSON', { virtuals: true });
gridBotSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('GridBot', gridBotSchema);