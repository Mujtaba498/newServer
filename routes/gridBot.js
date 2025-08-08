const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  createGridBot,
  getUserGridBots,
  getGridBot,
  startGridBot,
  stopGridBot,
  pauseGridBot,
  deleteGridBot,
  getGridBotPerformance,
  getDetailedGridBotAnalysis,
  getMarketData,
  getAccountBalance,
  getAllSymbols
} = require('../controllers/gridBotController');
const {
  createGridBotValidation,
  gridBotIdValidation
} = require('../middleware/gridBotValidation');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Rate limiting for grid bot operations
const gridBotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many grid bot requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for trading operations
const tradingLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // Limit each IP to 100 trading operations per 5 minutes
  message: {
    success: false,
    message: 'Too many trading operations, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for market data
const marketDataLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 market data requests per minute
  message: {
    success: false,
    message: 'Too many market data requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// All routes require authentication
router.use(protect);

// Market data and account routes (must be before /:botId routes)
router.get('/symbols', marketDataLimiter, getAllSymbols);
router.get('/market/:symbol', marketDataLimiter, getMarketData);
router.get('/account/balance', marketDataLimiter, getAccountBalance);

// Grid bot management routes
router.post('/create', gridBotLimiter, createGridBotValidation, createGridBot);
router.post('/', gridBotLimiter, createGridBotValidation, createGridBot); // Keep backward compatibility
router.get('/', gridBotLimiter, getUserGridBots);
router.get('/:botId', gridBotLimiter, gridBotIdValidation, getGridBot);
router.delete('/:botId', gridBotLimiter, gridBotIdValidation, deleteGridBot);

// Grid bot control routes (trading operations)
router.post('/:botId/start', tradingLimiter, gridBotIdValidation, startGridBot);
router.post('/:botId/stop', tradingLimiter, gridBotIdValidation, stopGridBot);
router.post('/:botId/pause', tradingLimiter, gridBotIdValidation, pauseGridBot);

// Performance and analytics routes
router.get('/:botId/performance', gridBotLimiter, gridBotIdValidation, getGridBotPerformance);
router.get('/:botId/analysis', gridBotLimiter, gridBotIdValidation, getDetailedGridBotAnalysis);

// Recovery endpoint
const recoveryService = require('../services/recoveryService');
const GridBot = require('../models/GridBot');

router.post('/:botId/recover', gridBotLimiter, gridBotIdValidation, async (req, res) => {
  try {
    const bot = await GridBot.findById(req.params.botId);
    if (!bot) {
      return res.status(404).json({
        success: false,
        message: 'Bot not found'
      });
    }

    if (bot.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to recover this bot'
      });
    }

    await recoveryService.recoverBot(bot);
    
    res.json({
      success: true,
      message: 'Bot recovery completed successfully',
      bot: {
        id: bot._id,
        status: bot.status,
        recoveryHistory: bot.recoveryHistory
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Recovery failed: ${error.message}`
    });
  }
});

module.exports = router;