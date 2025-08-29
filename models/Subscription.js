const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  planType: {
    type: String,
    enum: ['free', 'premium'],
    default: 'free',
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled'],
    default: 'active',
    required: true
  },
  startDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  endDate: {
    type: Date,
    required: function() {
      return this.planType === 'premium';
    }
  },
  paymentId: {
    type: String,
    required: function() {
      return this.planType === 'premium';
    }
  },
  autoRenew: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Static method to get plan limits
subscriptionSchema.statics.getPlanLimits = function(planType) {
  const limits = {
    free: {
      maxBots: 1,
      maxInvestmentPerBot: 100,
      price: 0
    },
    premium: {
      maxBots: 3,
      maxInvestmentPerBot: 1000, // Keep for backward compatibility
      maxTotalInvestment: 1000, // New total investment limit
      price: 1
    }
  };
  
  return limits[planType] || limits.free;
};

// Instance method to check if subscription is active
subscriptionSchema.methods.isActive = function() {
  if (this.planType === 'free') {
    return this.status === 'active';
  }
  
  if (this.planType === 'premium') {
    return this.status === 'active' && this.endDate > new Date();
  }
  
  return false;
};

// Instance method to get current plan limits
subscriptionSchema.methods.getPlanLimits = function() {
  return this.constructor.getPlanLimits(this.planType);
};

// Instance method to check if subscription is expired
subscriptionSchema.methods.isExpired = function() {
  if (this.planType === 'free') {
    return false;
  }
  
  return this.endDate <= new Date();
};

// Pre-save middleware to handle subscription expiration
subscriptionSchema.pre('save', function(next) {
  if (this.planType === 'premium' && this.isExpired()) {
    this.status = 'expired';
  }
  next();
});

// Index for efficient queries
subscriptionSchema.index({ userId: 1 });
subscriptionSchema.index({ planType: 1, status: 1 });
subscriptionSchema.index({ endDate: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);