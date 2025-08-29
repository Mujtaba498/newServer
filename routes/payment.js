const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  handleCryptomusWebhook,
  getPaymentCurrencies,
  resendWebhook
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Rate limiting for webhook (more permissive)
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Allow many webhook calls
  message: {
    success: false,
    message: 'Too many webhook requests'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for payment operations
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs
  message: {
    success: false,
    message: 'Too many payment requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Webhook endpoint (no authentication required)
router.post('/webhook', webhookLimiter, handleCryptomusWebhook);

// Protected routes (require authentication)
router.use(protect);

// Payment utility routes
router.get('/currencies', paymentLimiter, getPaymentCurrencies);
router.post('/resend/:paymentId', paymentLimiter, resendWebhook);

module.exports = router;