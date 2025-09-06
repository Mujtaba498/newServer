const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Encryption key for API credentials (should be in environment variables)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please enter a valid email'
    ]
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  resetPasswordOTP: {
    type: String,
    select: false
  },
  resetPasswordExpires: {
    type: Date,
    select: false
  },
  isVerified: {
    type: Boolean,
    default: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  binanceCredentials: {
    apiKey: {
      type: String,
      select: false // Don't include in queries by default
    },
    secretKey: {
      type: String,
      select: false // Don't include in queries by default
    },
    isConfigured: {
      type: Boolean,
      default: false
    },
    lastUpdated: {
      type: Date
    }
  }
}, {
  timestamps: true
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.createPasswordResetOTP = function() {
  const resetOTP = Math.floor(100000 + Math.random() * 900000).toString();
  
  this.resetPasswordOTP = resetOTP;
  this.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  
  return resetOTP;
};

// Encrypt API credentials
userSchema.methods.encryptApiCredentials = function(apiKey, secretKey) {
  try {
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    
    // Encrypt API Key
    const apiKeyIv = crypto.randomBytes(16);
    const apiKeyCipher = crypto.createCipheriv(ALGORITHM, key, apiKeyIv);
    let encryptedApiKey = apiKeyCipher.update(apiKey, 'utf8', 'hex');
    encryptedApiKey += apiKeyCipher.final('hex');
    const apiKeyAuthTag = apiKeyCipher.getAuthTag();
    
    // Encrypt Secret Key
    const secretKeyIv = crypto.randomBytes(16);
    const secretKeyCipher = crypto.createCipheriv(ALGORITHM, key, secretKeyIv);
    let encryptedSecretKey = secretKeyCipher.update(secretKey, 'utf8', 'hex');
    encryptedSecretKey += secretKeyCipher.final('hex');
    const secretKeyAuthTag = secretKeyCipher.getAuthTag();
    
    // Store encrypted credentials
    this.binanceCredentials.apiKey = `${apiKeyIv.toString('hex')}:${encryptedApiKey}:${apiKeyAuthTag.toString('hex')}`;
    this.binanceCredentials.secretKey = `${secretKeyIv.toString('hex')}:${encryptedSecretKey}:${secretKeyAuthTag.toString('hex')}`;
    this.binanceCredentials.isConfigured = true;
    this.binanceCredentials.lastUpdated = new Date();
    
    return true;
  } catch (error) {
    console.error('Error encrypting API credentials:', error);
    return false;
  }
};

// Decrypt API credentials
userSchema.methods.decryptApiCredentials = function() {
  try {
    if (!this.binanceCredentials.isConfigured || !this.binanceCredentials.apiKey || !this.binanceCredentials.secretKey) {
      return null;
    }
    
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    
    // Decrypt API Key
    const [apiKeyIv, encryptedApiKey, apiKeyAuthTag] = this.binanceCredentials.apiKey.split(':');
    const apiKeyDecipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(apiKeyIv, 'hex'));
    apiKeyDecipher.setAuthTag(Buffer.from(apiKeyAuthTag, 'hex'));
    let decryptedApiKey = apiKeyDecipher.update(encryptedApiKey, 'hex', 'utf8');
    decryptedApiKey += apiKeyDecipher.final('utf8');
    
    // Decrypt Secret Key
    const [secretKeyIv, encryptedSecretKey, secretKeyAuthTag] = this.binanceCredentials.secretKey.split(':');
    const secretKeyDecipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(secretKeyIv, 'hex'));
    secretKeyDecipher.setAuthTag(Buffer.from(secretKeyAuthTag, 'hex'));
    let decryptedSecretKey = secretKeyDecipher.update(encryptedSecretKey, 'hex', 'utf8');
    decryptedSecretKey += secretKeyDecipher.final('utf8');
    
    return {
      apiKey: decryptedApiKey,
      secretKey: decryptedSecretKey
    };
  } catch (error) {
    console.error('Error decrypting API credentials:', error);
    return null;
  }
};

// Check if user has configured Binance credentials
userSchema.methods.hasBinanceCredentials = function() {
  return this.binanceCredentials && this.binanceCredentials.isConfigured;
};

// Clear Binance credentials
userSchema.methods.clearBinanceCredentials = function() {
  this.binanceCredentials.apiKey = undefined;
  this.binanceCredentials.secretKey = undefined;
  this.binanceCredentials.isConfigured = false;
  this.binanceCredentials.lastUpdated = undefined;
};

// Get user's subscription
userSchema.methods.getSubscription = async function() {
  const Subscription = require('./Subscription');
  return await Subscription.findOne({ userId: this._id });
};

// Check if user has active premium subscription
userSchema.methods.hasPremiumSubscription = async function() {
  const subscription = await this.getSubscription();
  return subscription && subscription.planType === 'premium' && subscription.isActive();
};

// Get user's plan limits
userSchema.methods.getPlanLimits = async function() {
  const subscription = await this.getSubscription();
  if (subscription) {
    return subscription.getPlanLimits();
  }
  // Default to free plan limits
  const Subscription = require('./Subscription');
  return Subscription.getPlanLimits('free');
};

// Check if user can create more bots
userSchema.methods.canCreateBot = async function(investment) {
  const GridBot = require('./GridBot');
  const limits = await this.getPlanLimits();
  
  // Check investment limit
  if (investment > limits.maxInvestmentPerBot) {
    return {
      canCreate: false,
      reason: 'INVESTMENT_LIMIT_EXCEEDED',
      message: `Investment amount exceeds your plan limit of $${limits.maxInvestmentPerBot}`
    };
  }
  
  // Check bot count limit
  const botCount = await GridBot.countDocuments({ userId: this._id, deleted: false });
  if (botCount >= limits.maxBots) {
    return {
      canCreate: false,
      reason: 'BOT_LIMIT_EXCEEDED',
      message: `You have reached the maximum number of bots (${limits.maxBots}) for your plan`
    };
  }
  
  return {
    canCreate: true,
    remainingBots: limits.maxBots - botCount,
    limits
  };
};

module.exports = mongoose.model('User', userSchema);