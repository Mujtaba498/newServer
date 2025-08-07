const User = require('../models/User');
const { generateToken } = require('../utils/jwt');
const { sendOTPEmail, sendWelcomeEmail } = require('../services/emailService');

const register = async (req, res) => {
  try {
    const { name, email, password, role = 'user' } = req.body;

    // Validate role
    if (role && !['user', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be either "user" or "admin"'
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    const user = await User.create({
      name,
      email,
      password,
      role
    });

    const token = generateToken({ id: user._id });

    await sendWelcomeEmail(email, name);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified,
          createdAt: user.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const token = generateToken({ id: user._id });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified,
          createdAt: user.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No user found with this email address'
      });
    }

    const resetOTP = user.createPasswordResetOTP();
    await user.save({ validateBeforeSave: false });

    await sendOTPEmail(user.email, user.name, resetOTP);

    res.status(200).json({
      success: true,
      message: 'Password reset OTP sent to your email'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.'
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    const user = await User.findOne({
      email,
      resetPasswordOTP: otp,
      resetPasswordExpires: { $gt: Date.now() }
    }).select('+resetPasswordOTP +resetPasswordExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    user.password = newPassword;
    user.resetPasswordOTP = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    const token = generateToken({ id: user._id });

    res.status(200).json({
      success: true,
      message: 'Password reset successful',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          isVerified: user.isVerified,
          createdAt: user.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset'
    });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified,
          createdAt: user.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching profile'
    });
  }
};

// Set Binance API credentials
const setBinanceCredentials = async (req, res) => {
  try {
    const { apiKey, secretKey } = req.body;
    
    if (!apiKey || !secretKey) {
      return res.status(400).json({
        success: false,
        message: 'Both API key and secret key are required'
      });
    }
    
    // Basic validation for Binance API key format
    if (apiKey.length < 20 || secretKey.length < 20) {
      return res.status(400).json({
        success: false,
        message: 'Invalid API key or secret key format'
      });
    }
    
    const user = await User.findById(req.user._id).select('+binanceCredentials.apiKey +binanceCredentials.secretKey');
    
    // Test the credentials with Binance API before saving
    const BinanceService = require('../services/binanceService');
    const testBinanceService = new BinanceService(apiKey, secretKey);
    
    try {
      // Test credentials by getting account info
      await testBinanceService.testCredentials(apiKey, secretKey);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Binance API credentials. Please check your API key and secret key.'
      });
    }
    
    // Encrypt and save credentials
    const encryptionSuccess = user.encryptApiCredentials(apiKey, secretKey);
    
    if (!encryptionSuccess) {
      return res.status(500).json({
        success: false,
        message: 'Failed to encrypt API credentials'
      });
    }
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Binance API credentials saved successfully',
      data: {
        isConfigured: true,
        lastUpdated: user.binanceCredentials.lastUpdated
      }
    });
  } catch (error) {
    console.error('Set Binance credentials error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while saving Binance credentials'
    });
  }
};

// Get Binance credentials status
const getBinanceCredentialsStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    res.status(200).json({
      success: true,
      data: {
        isConfigured: user.hasBinanceCredentials(),
        lastUpdated: user.binanceCredentials?.lastUpdated || null
      }
    });
  } catch (error) {
    console.error('Get Binance credentials status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching credentials status'
    });
  }
};

// Remove Binance credentials
const removeBinanceCredentials = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    user.clearBinanceCredentials();
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Binance API credentials removed successfully'
    });
  } catch (error) {
    console.error('Remove Binance credentials error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while removing Binance credentials'
    });
  }
};

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
  getProfile,
  setBinanceCredentials,
  getBinanceCredentialsStatus,
  removeBinanceCredentials
};