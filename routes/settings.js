import express from 'express';
const router = express.Router();
import settingsController from '../controllers/settingsController.js';
import { authenticateToken } from '../middleware/auth.js';
import { 
  validateBinanceKeys, 
  validateKeyType 
} from '../middleware/validation.js';
import { authLimiter } from '../middleware/rateLimiter.js';

// All routes require authentication
router.use(authenticateToken);

// Binance Keys Management
router.get('/binance-keys', authLimiter, settingsController.getBinanceKeysStatus);
router.post('/binance-keys', authLimiter, validateBinanceKeys, settingsController.addBinanceKeys);
router.put('/binance-keys/:keyType', authLimiter, validateBinanceKeys, settingsController.updateBinanceKeys);
router.delete('/binance-keys/:keyType', authLimiter, settingsController.removeBinanceKeys);
router.post('/binance-keys/:keyType/toggle', authLimiter, settingsController.toggleBinanceKeys);
router.post('/binance-keys/test-connection', authLimiter, validateKeyType, settingsController.testBinanceConnection);

// Key Activity History (for frontend dashboard)
router.get('/binance-keys/activity', authLimiter, settingsController.getKeyActivity);

// Trading Preferences
router.get('/trading-preferences', authLimiter, settingsController.getTradingPreferences);
router.put('/trading-preferences', authLimiter, settingsController.updateTradingPreferences);

export default router; 