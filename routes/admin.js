const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  getAllUsers,
  getUserDetails,
  getAllBots,
  getPlatformStats,
  upgradeUserToPremium
} = require('../controllers/adminController');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminAuth');

const router = express.Router();

// Rate limiting for admin operations
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many admin requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply authentication and admin authorization to all routes
router.use(protect);
router.use(adminOnly);

// Admin routes
router.get('/users', adminLimiter, getAllUsers);
router.get('/users/:userId', adminLimiter, getUserDetails);
router.post('/users/:userId/upgrade-premium', adminLimiter, upgradeUserToPremium);
router.get('/bots', adminLimiter, getAllBots);
router.get('/stats', adminLimiter, getPlatformStats);

module.exports = router;