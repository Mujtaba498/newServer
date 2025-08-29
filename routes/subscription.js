const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  getSubscriptionStatus,
  getSubscriptionPlans,
  createPremiumSubscription,
  getPaymentStatus,
  getPaymentHistory,
  cancelSubscription
} = require('../controllers/subscriptionController');
const { protect } = require('../middleware/auth');
const { checkSubscription, attachSubscriptionInfo } = require('../middleware/subscriptionAuth');

const router = express.Router();

// Rate limiting for subscription operations
const subscriptionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs
  message: {
    success: false,
    message: 'Too many subscription requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for payment operations
const paymentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Limit each IP to 10 payment requests per 5 minutes
  message: {
    success: false,
    message: 'Too many payment requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply authentication and subscription middleware to all routes
router.use(protect);
router.use(checkSubscription);
router.use(attachSubscriptionInfo);

// Subscription management routes
router.get('/status', subscriptionLimiter, getSubscriptionStatus);
router.get('/plans', subscriptionLimiter, getSubscriptionPlans);
router.post('/upgrade', paymentLimiter, createPremiumSubscription);
router.post('/cancel', subscriptionLimiter, cancelSubscription);

// Payment management routes
router.get('/payments', subscriptionLimiter, getPaymentHistory);
router.get('/payments/:paymentId', subscriptionLimiter, getPaymentStatus);

module.exports = router;