import User from '../models/User.js';
import OTP from '../models/OTP.js';
import emailService from '../services/emailService.js';
import { generateToken } from '../config/jwt.js';
import { validationResult } from 'express-validator';

class AuthController {
  // Send OTP for unified signup/login
  async sendOTP(req, res) {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { email, name } = req.body;

      // Check if user exists
      const existingUser = await User.findByEmail(email);
      
      // Determine purpose automatically
      const purpose = existingUser ? 'login' : 'signup';
      
      // Generate and save OTP
      const otp = await OTP.createOTP(email, purpose);
      
      // Send OTP email
      const userName = name || existingUser?.name || 'User';
      await emailService.sendOTP(email, otp.code, userName);

      res.status(200).json({
        success: true,
        message: `OTP sent successfully to ${email}`,
        data: {
          email,
          expiresAt: otp.expiresAt,
          purpose,
          isNewUser: !existingUser
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again.'
      });
    }
  }

  // Verify OTP and complete authentication
  async verifyOTP(req, res) {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { email, code, name } = req.body;

      // Check if user exists to determine purpose
      const existingUser = await User.findByEmail(email);
      const purpose = existingUser ? 'login' : 'signup';

      // Verify OTP
      const verification = await OTP.verifyOTP(email, code, purpose);
      
      if (!verification.success) {
        // Increment attempts for invalid OTP
        await OTP.incrementAttempts(email, code, purpose);
        
        return res.status(400).json({
          success: false,
          message: verification.message
        });
      }

      let user;
      let isNewUser = false;

      if (purpose === 'signup') {
        // Create new user
        user = new User({
          email,
          name: name || null,
          isVerified: true
        });
        await user.save();
        isNewUser = true;

        // Send welcome email (non-blocking)
        emailService.sendWelcomeEmail(email, name).catch(err => {
          // Welcome email failed - continue silently
        });
      } else {
        // Login existing user
        user = existingUser;
        
        // Update name if provided during login
        if (name && name !== user.name) {
          user.name = name;
          await user.save();
        }

        // Update last login
        await user.updateLastLogin();
      }

      // Generate JWT token
      const token = generateToken({
        userId: user._id,
        email: user.email
      });

      res.status(200).json({
        success: true,
        message: isNewUser ? 'Account created successfully' : 'Login successful',
        data: {
          token,
          user: user.profile,
          isNewUser
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Authentication failed. Please try again.'
      });
    }
  }

  // Get user profile
  async getProfile(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.status(200).json({
        success: true,
        data: {
          user: user.profile
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch profile'
      });
    }
  }

  // Update user profile
  async updateProfile(req, res) {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { name } = req.body;
      
      const user = await User.findById(req.user.userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update user fields
      if (name !== undefined) user.name = name;
      
      await user.save();

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: user.profile
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update profile'
      });
    }
  }

  // Logout (optional - mainly for token blacklisting if implemented)
  async logout(req, res) {
    try {
      // In a stateless JWT system, logout is typically handled client-side
      // by removing the token. However, you could implement token blacklisting here.
      
      res.status(200).json({
        success: true,
        message: 'Logged out successfully'
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Logout failed'
      });
    }
  }

  // Get authentication status
  async getAuthStatus(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token'
        });
      }

      res.status(200).json({
        success: true,
        data: {
          isAuthenticated: true,
          user: user.profile
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to check authentication status'
      });
    }
  }
}

export default new AuthController(); 