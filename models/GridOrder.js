import mongoose from 'mongoose';

const gridOrderSchema = new mongoose.Schema({
  bot_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AIGridBot',
    required: [true, 'Bot ID is required'],
    index: true
  },
  binance_order_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  client_order_id: {
    type: String,
    required: true,
    index: true
  },
  symbol: {
    type: String,
    required: true,
    uppercase: true
  },
  price: {
    type: Number,
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  side: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: true
  },
  type: {
    type: String,
    enum: ['LIMIT', 'MARKET'],
    default: 'LIMIT'
  },
  status: {
    type: String,
    enum: ['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'PENDING_CANCEL', 'REJECTED', 'EXPIRED'],
    default: 'NEW'
  },
  grid_level: {
    type: Number,
    required: true
  },
  filled_quantity: {
    type: Number,
    default: 0
  },
  filled_price: {
    type: Number,
    default: 0
  },
  commission: {
    type: Number,
    default: 0
  },
  commission_asset: {
    type: String,
    default: ''
  },
  profit_loss: {
    type: Number,
    default: 0
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
  filled_at: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
gridOrderSchema.index({ bot_id: 1, status: 1 });
gridOrderSchema.index({ symbol: 1, status: 1 });
gridOrderSchema.index({ side: 1, status: 1 });
gridOrderSchema.index({ grid_level: 1 });
gridOrderSchema.index({ created_at: -1 });

// Update the updated_at field before saving
gridOrderSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

// Instance method to mark order as filled
gridOrderSchema.methods.markFilled = function(fillData) {
  this.status = 'FILLED';
  this.filled_quantity = fillData.quantity || this.quantity;
  this.filled_price = fillData.price || this.price;
  this.commission = fillData.commission || 0;
  this.commission_asset = fillData.commissionAsset || '';
  this.filled_at = new Date();
  return this.save();
};

// Instance method to calculate profit/loss
gridOrderSchema.methods.calculatePnL = function(currentPrice) {
  if (this.status === 'FILLED') {
    const pnl = this.side === 'BUY' 
      ? (currentPrice - this.filled_price) * this.filled_quantity
      : (this.filled_price - currentPrice) * this.filled_quantity;
    return pnl - this.commission;
  }
  return 0;
};

// Static method to find orders by bot
gridOrderSchema.statics.findByBot = function(botId) {
  return this.find({ bot_id: botId }).sort({ created_at: -1 });
};

// Static method to find active orders by bot
gridOrderSchema.statics.findActiveByBot = function(botId) {
  return this.find({ 
    bot_id: botId, 
    status: { $in: ['NEW', 'PARTIALLY_FILLED'] } 
  }).sort({ grid_level: 1 });
};

// Static method to find filled orders by bot
gridOrderSchema.statics.findFilledByBot = function(botId) {
  return this.find({ 
    bot_id: botId, 
    status: 'FILLED' 
  }).sort({ filled_at: -1 });
};

// Static method to get bot performance stats
gridOrderSchema.statics.getBotStats = async function(botId) {
  const stats = await this.aggregate([
    { $match: { bot_id: botId, status: 'FILLED' } },
    {
      $group: {
        _id: null,
        total_trades: { $sum: 1 },
        total_volume: { $sum: { $multiply: ['$filled_quantity', '$filled_price'] } },
        total_commission: { $sum: '$commission' },
        buy_trades: {
          $sum: { $cond: [{ $eq: ['$side', 'BUY'] }, 1, 0] }
        },
        sell_trades: {
          $sum: { $cond: [{ $eq: ['$side', 'SELL'] }, 1, 0] }
        },
        avg_buy_price: {
          $avg: { $cond: [{ $eq: ['$side', 'BUY'] }, '$filled_price', null] }
        },
        avg_sell_price: {
          $avg: { $cond: [{ $eq: ['$side', 'SELL'] }, '$filled_price', null] }
        }
      }
    }
  ]);
  
  return stats.length > 0 ? stats[0] : null;
};

// Virtual for order summary
gridOrderSchema.virtual('summary').get(function() {
  return {
    id: this._id,
    binance_order_id: this.binance_order_id,
    symbol: this.symbol,
    side: this.side,
    price: this.price,
    quantity: this.quantity,
    status: this.status,
    grid_level: this.grid_level,
    filled_quantity: this.filled_quantity,
    filled_price: this.filled_price,
    profit_loss: this.profit_loss,
    created_at: this.created_at,
    filled_at: this.filled_at
  };
});

// Transform JSON output
gridOrderSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model('GridOrder', gridOrderSchema);