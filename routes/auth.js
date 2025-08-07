const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  register,
  login,
  forgotPassword,
  resetPassword,
  getProfile,
  setBinanceCredentials,
  getBinanceCredentialsStatus,
  removeBinanceCredentials
} = require('../controllers/authController');
const {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  resetPasswordValidation
} = require('../middleware/validation');
const { protect } = require('../middleware/auth');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: {
    success: false,
    message: 'Too many password reset attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', authLimiter, registerValidation, register);
router.post('/login', authLimiter, loginValidation, login);
router.post('/forgot-password', passwordResetLimiter, forgotPasswordValidation, forgotPassword);
router.post('/reset-password', passwordResetLimiter, resetPasswordValidation, resetPassword);
router.get('/profile', protect, getProfile);

// Binance credentials management
router.post('/binance-credentials', protect, setBinanceCredentials);
router.get('/binance-credentials/status', protect, getBinanceCredentialsStatus);
router.delete('/binance-credentials', protect, removeBinanceCredentials);

module.exports = router;