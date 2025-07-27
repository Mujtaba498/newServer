import mongoose from 'mongoose';
import crypto from 'crypto';

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true
  },
  code: {
    type: String,
    required: [true, 'OTP code is required']
  },
  purpose: {
    type: String,
    enum: ['login', 'signup', 'password_reset'],
    default: 'login'
  },
  attempts: {
    type: Number,
    default: 0,
    max: 5
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000) // 10 minutes from now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for automatic document expiration
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for faster queries
otpSchema.index({ email: 1, code: 1 });
otpSchema.index({ email: 1, createdAt: -1 });

// Static method to generate OTP
otpSchema.statics.generateOTP = function() {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Static method to create new OTP
otpSchema.statics.createOTP = async function(email, purpose = 'login') {
  // Delete any existing OTPs for this email and purpose
  await this.deleteMany({ email: email.toLowerCase(), purpose });
  
  const code = this.generateOTP();
  
  const otp = new this({
    email: email.toLowerCase(),
    code,
    purpose
  });
  
  return await otp.save();
};

// Static method to verify OTP
otpSchema.statics.verifyOTP = async function(email, code, purpose = 'login') {
  const otp = await this.findOne({
    email: email.toLowerCase(),
    code,
    purpose,
    isUsed: false,
    expiresAt: { $gt: new Date() }
  });
  
  if (!otp) {
    return { success: false, message: 'Invalid or expired OTP' };
  }
  
  // Check attempt limit
  if (otp.attempts >= 5) {
    return { success: false, message: 'Too many attempts. Please request a new OTP.' };
  }
  
  // Mark as used
  otp.isUsed = true;
  await otp.save();
  
  return { success: true, message: 'OTP verified successfully' };
};

// Static method to increment attempts
otpSchema.statics.incrementAttempts = async function(email, code, purpose = 'login') {
  await this.updateOne(
    { email: email.toLowerCase(), code, purpose },
    { $inc: { attempts: 1 } }
  );
};

// Static method to clean expired OTPs
otpSchema.statics.cleanExpired = async function() {
  const result = await this.deleteMany({
    $or: [
      { expiresAt: { $lt: new Date() } },
      { isUsed: true }
    ]
  });
  return result.deletedCount;
};

// Instance method to check if OTP is valid
otpSchema.methods.isValid = function() {
  return !this.isUsed && this.expiresAt > new Date() && this.attempts < 5;
};

// Instance method to check if OTP is expired
otpSchema.methods.isExpired = function() {
  return this.expiresAt <= new Date();
};

export default mongoose.model('OTP', otpSchema); 