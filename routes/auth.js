import express from 'express';
const router = express.Router();
import authController from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';
import { 
  validateSendOTP, 
  validateVerifyOTP, 
  validateUpdateProfile 
} from '../middleware/validation.js';
import { 
  otpLimiter, 
  verifyOtpLimiter, 
  authLimiter 
} from '../middleware/rateLimiter.js';

// Public routes
router.post('/send-otp', otpLimiter, validateSendOTP, authController.sendOTP);
router.post('/verify-otp', verifyOtpLimiter, validateVerifyOTP, authController.verifyOTP);

// Protected routes
router.get('/profile', authLimiter, authenticateToken, authController.getProfile);
router.put('/profile', authLimiter, authenticateToken, validateUpdateProfile, authController.updateProfile);
router.post('/logout', authLimiter, authenticateToken, authController.logout);
router.get('/status', authLimiter, authenticateToken, authController.getAuthStatus);

export default router; 