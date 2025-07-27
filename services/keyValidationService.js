import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const binanceModule = require('binance-api-node');

// Get the Binance function
let Binance;
if (typeof binanceModule === 'function') {
  Binance = binanceModule;
} else if (typeof binanceModule.default === 'function') {
  Binance = binanceModule.default;
} else if (binanceModule.Binance && typeof binanceModule.Binance === 'function') {
  Binance = binanceModule.Binance;
} else {
  Binance = null;
}

class KeyValidationService {
  constructor() {
    this.requiredPermissions = ['SPOT']; // Minimum required permissions
    this.optionalPermissions = ['FUTURES', 'MARGIN']; // Nice to have
  }

  async validateBinanceKeys(apiKey, secretKey, isTestMode = true) {
    try {
      if (!apiKey || !secretKey) {
        return {
          success: false,
          error: 'API key and secret key are required'
        };
      }

      // Create temporary client for validation
      const client = this.createTempClient(apiKey, secretKey, isTestMode);
      
      // Test the connection and get account info
      const accountInfo = await this.testAccountAccess(client);
      if (!accountInfo.success) {
        return accountInfo;
      }

      // Check API key permissions
      const permissions = await this.checkKeyPermissions(client);
      if (!permissions.success) {
        return permissions;
      }

      // Validate required permissions
      const hasRequiredPermissions = this.validateRequiredPermissions(permissions.permissions);
      if (!hasRequiredPermissions.success) {
        return hasRequiredPermissions;
      }

      return {
        success: true,
        permissions: permissions.permissions,
        accountType: accountInfo.accountType,
        canTrade: accountInfo.canTrade,
        balances: accountInfo.balances
      };

    } catch (error) {
      return {
        success: false,
        error: this.parseError(error)
      };
    }
  }

  createTempClient(apiKey, secretKey, isTestMode) {
    const config = {
      apiKey: apiKey,
      apiSecret: secretKey,
      getTime: () => Date.now()
    };

    if (isTestMode) {
      config.httpBase = 'https://testnet.binance.vision';
      config.wsBase = 'wss://testnet.binance.vision/ws';
    }

    return Binance(config);
  }

  async testAccountAccess(client) {
    try {
      const accountInfo = await client.accountInfo();
      
      return {
        success: true,
        accountType: accountInfo.accountType,
        canTrade: accountInfo.canTrade,
        balances: accountInfo.balances ? accountInfo.balances.slice(0, 5) : [] // Limit for response size
      };
    } catch (error) {
      return {
        success: false,
        error: 'Failed to access account. Please check your API keys and permissions.'
      };
    }
  }

  async checkKeyPermissions(client) {
    try {
      // Try to get account info to check permissions
      const accountInfo = await client.accountInfo();
      
      // Extract permissions from account info
      const permissions = [];
      
      // Check if account can trade (SPOT permission)
      if (accountInfo.canTrade) {
        permissions.push('SPOT');
      }
      
      // Check for other permissions by trying specific endpoints
      try {
        // Try to get margin account info (if available)
        await client.marginAccountInfo();
        permissions.push('MARGIN');
      } catch (error) {
        // Margin not available, that's okay
      }

      try {
        // Try to get futures account info (if available)
        await client.futuresAccountInfo();
        permissions.push('FUTURES');
      } catch (error) {
        // Futures not available, that's okay
      }

      return {
        success: true,
        permissions: permissions
      };
    } catch (error) {
      return {
        success: false,
        error: 'Failed to check API key permissions'
      };
    }
  }

  validateRequiredPermissions(permissions) {
    const hasRequired = this.requiredPermissions.every(perm => 
      permissions.includes(perm)
    );

    if (!hasRequired) {
      return {
        success: false,
        error: `API key must have the following permissions: ${this.requiredPermissions.join(', ')}`
      };
    }

    return { success: true };
  }

  async testConnection(apiKey, secretKey, isTestMode = true) {
    try {
      const client = this.createTempClient(apiKey, secretKey, isTestMode);
      
      // Test basic connectivity
      const serverTime = await client.time();
      const accountInfo = await client.accountInfo();
      
      // Test balance retrieval
      const balances = accountInfo.balances.filter(b => 
        parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
      );

      return {
        success: true,
        serverTime: serverTime,
        accountType: accountInfo.accountType,
        canTrade: accountInfo.canTrade,
        balanceCheck: balances.length > 0,
        permissions: accountInfo.permissions || ['SPOT']
      };
    } catch (error) {
      return {
        success: false,
        error: this.parseError(error)
      };
    }
  }

  parseError(error) {
    if (error.code) {
      switch (error.code) {
        case -1022:
          return 'Invalid API key format';
        case -2014:
          return 'Invalid API key or secret';
        case -2015:
          return 'Invalid API key, IP, or permissions';
        case -1021:
          return 'Timestamp for this request is outside the recvWindow';
        default:
          return `Binance API error: ${error.msg || error.message}`;
      }
    }
    
    if (error.message) {
      if (error.message.includes('ENOTFOUND')) {
        return 'Network connection failed. Please check your internet connection.';
      }
      if (error.message.includes('timeout')) {
        return 'Connection timeout. Please try again.';
      }
      return error.message;
    }
    
    return 'Unknown error occurred while validating API keys';
  }
}

export default new KeyValidationService(); 