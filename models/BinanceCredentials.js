import mongoose from 'mongoose';

const binanceCredentialsSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true, // One record per user
    index: true
  },
  live_keys: {
    api_key: {
      type: String,
      required: false // User might not add live keys initially
    },
    secret_key: {
      type: String,
      required: false
    },
    is_active: {
      type: Boolean,
      default: false
    },
    is_verified: {
      type: Boolean,
      default: false
    },
    permissions: [{
      type: String // ['SPOT', 'FUTURES', etc.]
    }],
    last_verified: Date,
    added_at: Date,
    verification_error: String
  },
  test_keys: {
    api_key: {
      type: String,
      required: false
    },
    secret_key: {
      type: String,
      required: false
    },
    is_active: {
      type: Boolean,
      default: false
    },
    is_verified: {
      type: Boolean,
      default: false
    },
    permissions: [{
      type: String
    }],
    last_verified: Date,
    added_at: Date,
    verification_error: String
  },
  default_mode: {
    type: String,
    enum: ['test', 'live'],
    default: 'test'
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

// Pre-save middleware to update timestamps
binanceCredentialsSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

// Static method to get user credentials
binanceCredentialsSchema.statics.getUserCredentials = function(userId) {
  return this.findOne({ user_id: userId });
};

// Instance method to get active keys
binanceCredentialsSchema.methods.getActiveKeys = function(mode = 'test') {
  const keys = mode === 'test' ? this.test_keys : this.live_keys;
  return keys && keys.is_active && keys.is_verified ? keys : null;
};

// Instance method to check if user has valid keys
binanceCredentialsSchema.methods.hasValidKeys = function(mode = 'test') {
  const keys = mode === 'test' ? this.test_keys : this.live_keys;
  return !!(keys && keys.api_key && keys.secret_key && keys.is_verified && keys.is_active);
};

export default mongoose.model('BinanceCredentials', binanceCredentialsSchema); 