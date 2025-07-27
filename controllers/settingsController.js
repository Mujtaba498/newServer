import BinanceCredentials from '../models/BinanceCredentials.js';
import BinanceKeyAudit from '../models/BinanceKeyAudit.js';
import encryptionService from '../services/encryptionService.js';
import keyValidationService from '../services/keyValidationService.js';
import { validationResult } from 'express-validator';

class SettingsController {
  // Get current keys status (without revealing actual keys)
  async getBinanceKeysStatus(req, res) {
    try {
      const userId = req.user.userId;
      
      const credentials = await BinanceCredentials.getUserCredentials(userId);
      
      if (!credentials) {
        return res.json({
          success: true,
          data: {
            has_test_keys: false,
            has_live_keys: false,
            test_keys_verified: false,
            live_keys_verified: false,
            test_keys_active: false,
            live_keys_active: false,
            default_mode: 'test'
          }
        });
      }

      res.json({
        success: true,
        data: {
          has_test_keys: !!(credentials.test_keys && credentials.test_keys.api_key),
          has_live_keys: !!(credentials.live_keys && credentials.live_keys.api_key),
          test_keys_verified: credentials.test_keys?.is_verified || false,
          live_keys_verified: credentials.live_keys?.is_verified || false,
          test_keys_active: credentials.test_keys?.is_active || false,
          live_keys_active: credentials.live_keys?.is_active || false,
          default_mode: credentials.default_mode || 'test',
          test_permissions: credentials.test_keys?.permissions || [],
          live_permissions: credentials.live_keys?.permissions || [],
          test_last_verified: credentials.test_keys?.last_verified || null,
          live_last_verified: credentials.live_keys?.last_verified || null,
          last_updated: credentials.updated_at
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get keys status'
      });
    }
  }

  // Add new binance keys
  async addBinanceKeys(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { api_key, secret_key, key_type } = req.body;
      const userId = req.user.userId;

      if (!['test', 'live'].includes(key_type)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid key type. Must be "test" or "live"'
        });
      }

      // Validate keys first
      const validation = await keyValidationService.validateBinanceKeys(
        api_key, 
        secret_key, 
        key_type === 'test'
      );

      if (!validation.success) {
        // Log failed attempt
        await BinanceKeyAudit.create({
          user_id: userId,
          action: 'added',
          key_type,
          details: { 
            success: false, 
            error: validation.error 
          },
          ip_address: req.ip,
          user_agent: req.get('User-Agent')
        });

        return res.status(400).json({
          success: false,
          message: `Invalid ${key_type} API keys: ${validation.error}`
        });
      }

      // Encrypt the keys
      const encryptedApiKey = encryptionService.encryptSimple(api_key);
      const encryptedSecret = encryptionService.encryptSimple(secret_key);

      // Find or create credentials record
      let credentials = await BinanceCredentials.getUserCredentials(userId);
      
      if (!credentials) {
        credentials = new BinanceCredentials({ user_id: userId });
      }

      // Update the specific key type
      const keyData = {
        api_key: encryptedApiKey,
        secret_key: encryptedSecret,
        is_verified: true,
        is_active: true,
        permissions: validation.permissions,
        last_verified: new Date(),
        added_at: new Date(),
        verification_error: null
      };

      if (key_type === 'test') {
        credentials.test_keys = keyData;
      } else {
        credentials.live_keys = keyData;
      }

      await credentials.save();

      // Log successful addition
      await BinanceKeyAudit.create({
        user_id: userId,
        action: 'added',
        key_type,
        details: { 
          success: true,
          permissions: validation.permissions,
          verified: true 
        },
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });

      res.json({
        success: true,
        message: `${key_type} keys added and verified successfully`,
        data: {
          key_type,
          verified: true,
          active: true,
          permissions: validation.permissions
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to add Binance keys'
      });
    }
  }

  // Update existing binance keys
  async updateBinanceKeys(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { keyType } = req.params;
      const { api_key, secret_key } = req.body;
      const userId = req.user.userId;

      if (!['test', 'live'].includes(keyType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid key type'
        });
      }

      const credentials = await BinanceCredentials.getUserCredentials(userId);
      
      if (!credentials) {
        return res.status(404).json({
          success: false,
          message: 'No credentials found. Please add keys first.'
        });
      }

      // Validate new keys
      const validation = await keyValidationService.validateBinanceKeys(
        api_key, 
        secret_key, 
        keyType === 'test'
      );

      if (!validation.success) {
        return res.status(400).json({
          success: false,
          message: `Invalid ${keyType} API keys: ${validation.error}`
        });
      }

      // Encrypt the new keys
      const encryptedApiKey = encryptionService.encryptSimple(api_key);
      const encryptedSecret = encryptionService.encryptSimple(secret_key);

      // Update the specific key type
      const keyData = {
        api_key: encryptedApiKey,
        secret_key: encryptedSecret,
        is_verified: true,
        is_active: true,
        permissions: validation.permissions,
        last_verified: new Date(),
        added_at: credentials[`${keyType}_keys`]?.added_at || new Date(),
        verification_error: null
      };

      if (keyType === 'test') {
        credentials.test_keys = keyData;
      } else {
        credentials.live_keys = keyData;
      }

      await credentials.save();

      // Log the update
      await BinanceKeyAudit.create({
        user_id: userId,
        action: 'updated',
        key_type: keyType,
        details: { 
          success: true,
          permissions: validation.permissions,
          updated_at: new Date()
        },
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });

      res.json({
        success: true,
        message: `${keyType} keys updated successfully`,
        data: {
          key_type: keyType,
          verified: true,
          active: true,
          permissions: validation.permissions
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update keys'
      });
    }
  }

  // Remove binance keys
  async removeBinanceKeys(req, res) {
    try {
      const { keyType } = req.params;
      const userId = req.user.userId;

      if (!['test', 'live'].includes(keyType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid key type'
        });
      }

      const credentials = await BinanceCredentials.getUserCredentials(userId);
      
      if (!credentials) {
        return res.status(404).json({
          success: false,
          message: 'No credentials found'
        });
      }

      // Check if keys exist
      const keys = keyType === 'test' ? credentials.test_keys : credentials.live_keys;
      if (!keys || !keys.api_key) {
        return res.status(404).json({
          success: false,
          message: `No ${keyType} keys found`
        });
      }

      // Remove the specific key type
      if (keyType === 'test') {
        credentials.test_keys = undefined;
      } else {
        credentials.live_keys = undefined;
      }

      await credentials.save();

      // Log removal
      await BinanceKeyAudit.create({
        user_id: userId,
        action: 'removed',
        key_type: keyType,
        details: {
          removed_at: new Date()
        },
        ip_address: req.ip,
        user_agent: req.get('User-Agent')
      });

      res.json({
        success: true,
        message: `${keyType} keys removed successfully`
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to remove keys'
      });
    }
  }

  // Test connection with existing keys
  async testBinanceConnection(req, res) {
    try {
      const { key_type } = req.body;
      const userId = req.user.userId;

      if (!['test', 'live'].includes(key_type)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid key type'
        });
      }

      const credentials = await BinanceCredentials.getUserCredentials(userId);
      
      if (!credentials) {
        return res.status(404).json({
          success: false,
          message: 'No credentials found'
        });
      }

      const keys = key_type === 'test' ? credentials.test_keys : credentials.live_keys;
      
      if (!keys || !keys.api_key) {
        return res.status(404).json({
          success: false,
          message: `No ${key_type} keys found`
        });
      }

      // Decrypt and test
      const decryptedApiKey = encryptionService.decryptSimple(keys.api_key);
      const decryptedSecret = encryptionService.decryptSimple(keys.secret_key);

      const testResult = await keyValidationService.testConnection(
        decryptedApiKey,
        decryptedSecret,
        key_type === 'test'
      );

      if (testResult.success) {
        // Update verification status
        keys.is_verified = true;
        keys.last_verified = new Date();
        keys.verification_error = null;
        await credentials.save();
      } else {
        // Update error status
        keys.verification_error = testResult.error;
        await credentials.save();
      }

      res.json({
        success: testResult.success,
        message: testResult.success ? 
          `${key_type} connection successful` : 
          `${key_type} connection failed: ${testResult.error}`,
        data: testResult.success ? {
          account_type: testResult.accountType,
          permissions: testResult.permissions,
          balance_check: testResult.balanceCheck,
          server_time: testResult.serverTime
        } : null
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to test connection'
      });
    }
  }

  // Get user's key activity history (for frontend dashboard)
  async getKeyActivity(req, res) {
    try {
      const userId = req.user.userId;
      const { limit = 10, offset = 0 } = req.query;

      const activities = await BinanceKeyAudit.getUserActivity(
        userId, 
        parseInt(limit), 
        parseInt(offset)
      );

      const totalCount = await BinanceKeyAudit.countDocuments({ user_id: userId });

      res.json({
        success: true,
        data: {
          activities: activities.map(activity => ({
            action: activity.action,
            key_type: activity.key_type,
            timestamp: activity.timestamp,
            details: activity.details
          })),
          pagination: {
            total: totalCount,
            limit: parseInt(limit),
            offset: parseInt(offset),
            has_more: totalCount > parseInt(offset) + parseInt(limit)
          }
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get key activity'
      });
    }
  }

  // Toggle key activation status
  async toggleBinanceKeys(req, res) {
    try {
      const { keyType } = req.params;
      const userId = req.user.userId;

      if (!['test', 'live'].includes(keyType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid key type'
        });
      }

      const credentials = await BinanceCredentials.getUserCredentials(userId);
      
      if (!credentials) {
        return res.status(404).json({
          success: false,
          message: 'No credentials found'
        });
      }

      const keys = keyType === 'test' ? credentials.test_keys : credentials.live_keys;
      
      if (!keys || !keys.api_key) {
        return res.status(404).json({
          success: false,
          message: `No ${keyType} keys found`
        });
      }

      // Toggle active status
      keys.is_active = !keys.is_active;
      await credentials.save();

      res.json({
        success: true,
        message: `${keyType} keys ${keys.is_active ? 'activated' : 'deactivated'} successfully`,
        data: {
          key_type: keyType,
          is_active: keys.is_active
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to toggle keys'
      });
    }
  }

  // Update trading preferences
  async updateTradingPreferences(req, res) {
    try {
      const { default_mode } = req.body;
      const userId = req.user.userId;

      if (!['test', 'live'].includes(default_mode)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid default mode. Must be "test" or "live"'
        });
      }

      let credentials = await BinanceCredentials.getUserCredentials(userId);
      
      if (!credentials) {
        credentials = new BinanceCredentials({ user_id: userId });
      }

      credentials.default_mode = default_mode;
      await credentials.save();

      res.json({
        success: true,
        message: 'Trading preferences updated successfully',
        data: {
          default_mode: default_mode
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update preferences'
      });
    }
  }

  // Get trading preferences
  async getTradingPreferences(req, res) {
    try {
      const userId = req.user.userId;
      
      const credentials = await BinanceCredentials.getUserCredentials(userId);
      
      res.json({
        success: true,
        data: {
          default_mode: credentials?.default_mode || 'test'
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get preferences'
      });
    }
  }
}

export default new SettingsController(); 