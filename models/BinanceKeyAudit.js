import mongoose from 'mongoose';

const binanceKeyAuditSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    enum: ['added', 'updated', 'removed'], // Only essential user actions
    required: true
  },
  key_type: {
    type: String,
    enum: ['test', 'live'],
    required: true
  },
  details: {
    type: Object,
    default: {}
  },
  ip_address: String,
  user_agent: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
binanceKeyAuditSchema.index({ user_id: 1, timestamp: -1 });
binanceKeyAuditSchema.index({ user_id: 1, action: 1 });

// Static method to get user activity
binanceKeyAuditSchema.statics.getUserActivity = function(userId, limit = 10, offset = 0) {
  return this.find({ user_id: userId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .skip(offset)
    .select('action key_type details timestamp');
};

export default mongoose.model('BinanceKeyAudit', binanceKeyAuditSchema); 