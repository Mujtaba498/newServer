const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true
  },
  // Cryptomus payment details
  cryptomusOrderId: {
    type: String,
    required: true,
    unique: true
  },
  cryptomusUuid: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    default: 'USD'
  },
  paymentCurrency: {
    type: String,
    required: false // Will be set when user selects crypto
  },
  paymentAmount: {
    type: Number,
    required: false // Crypto amount
  },
  status: {
    type: String,
    enum: [
      'pending',
      'processing', 
      'paid',
      'failed',
      'cancelled',
      'expired',
      'refunded'
    ],
    default: 'pending',
    required: true
  },
  planType: {
    type: String,
    enum: ['premium'],
    required: true
  },
  planDuration: {
    type: Number,
    default: 30, // days
    required: true
  },
  // Payment URLs
  paymentUrl: {
    type: String,
    required: false
  },
  // Webhook data
  webhookData: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  // Transaction details
  transactionHash: {
    type: String,
    required: false
  },
  network: {
    type: String,
    required: false
  },
  // Timestamps
  paidAt: {
    type: Date,
    required: false
  },
  expiresAt: {
    type: Date,
    required: true,
    default: function() {
      return new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    }
  },
  // Error handling
  errorMessage: {
    type: String,
    required: false
  },
  retryCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Instance methods
paymentSchema.methods.isPaid = function() {
  return this.status === 'paid';
};

paymentSchema.methods.isExpired = function() {
  return this.expiresAt <= new Date();
};

paymentSchema.methods.canRetry = function() {
  return this.retryCount < 3 && ['failed', 'cancelled'].includes(this.status);
};

paymentSchema.methods.markAsPaid = function(webhookData = null) {
  this.status = 'paid';
  this.paidAt = new Date();
  if (webhookData) {
    this.webhookData = webhookData;
    if (webhookData.txid) {
      this.transactionHash = webhookData.txid;
    }
    if (webhookData.network) {
      this.network = webhookData.network;
    }
  }
  return this.save();
};

paymentSchema.methods.markAsFailed = function(errorMessage = null) {
  this.status = 'failed';
  this.retryCount += 1;
  if (errorMessage) {
    this.errorMessage = errorMessage;
  }
  return this.save();
};

// Static methods
paymentSchema.statics.findByOrderId = function(orderId) {
  return this.findOne({ cryptomusOrderId: orderId });
};

paymentSchema.statics.findPendingPayments = function() {
  return this.find({
    status: { $in: ['pending', 'processing'] },
    expiresAt: { $gt: new Date() }
  });
};

paymentSchema.statics.findExpiredPayments = function() {
  return this.find({
    status: { $in: ['pending', 'processing'] },
    expiresAt: { $lte: new Date() }
  });
};

// Pre-save middleware
paymentSchema.pre('save', function(next) {
  // Auto-expire payments
  if (['pending', 'processing'].includes(this.status) && this.isExpired()) {
    this.status = 'expired';
  }
  next();
});

// Indexes for efficient queries
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ cryptomusOrderId: 1 }, { unique: true });
paymentSchema.index({ cryptomusUuid: 1 });
paymentSchema.index({ status: 1, expiresAt: 1 });
paymentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);