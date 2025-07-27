import express from 'express';
const router = express.Router();
import aiGridController from '../controllers/aiGridController.js';
import { authenticateToken } from '../middleware/auth.js';
import { body } from 'express-validator';
import { 
  authLimiter, 
  generalLimiter 
} from '../middleware/rateLimiter.js';

// Validation middleware
const validateCreateBot = [
  body('symbol')
    .isString()
    .isLength({ min: 3, max: 20 })
    .withMessage('Symbol must be between 3 and 20 characters')
    .matches(/^[A-Z]+$/)
    .withMessage('Symbol must contain only uppercase letters'),
  body('investment_amount')
    .isNumeric()
    .isFloat({ min: 10, max: 100000 })
    .withMessage('Investment amount must be between 10 and 100000'),
  body('test')
    .optional()
    .isBoolean()
    .withMessage('Test parameter must be a boolean'),
];

const validatePreviewParameters = [
  body('symbol')
    .isString()
    .isLength({ min: 3, max: 20 })
    .withMessage('Symbol must be between 3 and 20 characters')
    .matches(/^[A-Z]+$/)
    .withMessage('Symbol must contain only uppercase letters'),
  body('investment_amount')
    .isNumeric()
    .isFloat({ min: 10, max: 100000 })
    .withMessage('Investment amount must be between 10 and 100000'),
  body('test')
    .optional()
    .isBoolean()
    .withMessage('Test parameter must be a boolean'),
];

// Public routes (with general rate limiting)
router.get('/symbols', generalLimiter, aiGridController.getSymbols);
router.get('/market/:symbol', generalLimiter, aiGridController.getMarketData);

// Protected routes (require authentication)
router.use(authenticateToken);

// Bot management routes
router.post('/create', authLimiter, validateCreateBot, aiGridController.createBot);
router.get('/bots', authLimiter, aiGridController.getBots);
router.get('/bots/:botId', authLimiter, aiGridController.getBotDetails);
router.put('/bots/:botId/stop', authLimiter, aiGridController.stopBot);
router.put('/bots/:botId/reset', authLimiter, aiGridController.resetBot);
router.get('/bots/:botId/performance', authLimiter, aiGridController.getBotPerformance);
router.get('/bots/:botId/trading-history', authLimiter, aiGridController.getTradingHistory);
router.get('/bots/:botId/diagnostics', authLimiter, aiGridController.getBotDiagnostics);
router.get('/bots/:botId/realtime-stats', generalLimiter, aiGridController.getBotRealTimeStats);

// Account and data routes
router.get('/balance', authLimiter, aiGridController.getBalance);
router.get('/stats', authLimiter, aiGridController.getTradingStats);
router.get('/overall-stats', authLimiter, aiGridController.getOverallStats);

// AI parameter preview
router.post('/preview', authLimiter, validatePreviewParameters, aiGridController.previewParameters);

// Engine status (admin/monitoring)
router.get('/engine/status', authLimiter, aiGridController.getEngineStatus);

// Stop all user bots and cancel all open orders
router.post('/stop-all-bots', authLimiter, aiGridController.stopAllBots);

export default router;