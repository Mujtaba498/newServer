const crypto = require('crypto');
const axios = require('axios');
const { BINANCE_API_KEY, BINANCE_SECRET_KEY } = require('../config/env');

class BinanceService {
  constructor(userApiKey = null, userSecretKey = null) {
    this.baseURL = 'https://api.binance.com';
    this.apiKey = userApiKey || BINANCE_API_KEY || null;
    this.secretKey = userSecretKey || BINANCE_SECRET_KEY || null;
    this.timeOffset = 0;
    this.lastSyncTime = 0;
    this.syncInterval = 5 * 60 * 1000; // Sync every 5 minutes
    this.recvWindow = 5000; // 5 seconds receive window
    this.initialized = false;
    this.hasCredentials = !!(this.apiKey && this.secretKey);
  }

  // Initialize the service with time sync
  async initialize() {
    if (!this.initialized) {
      try {
        await this.syncServerTime();
        this.initialized = true;
        console.log('BinanceService initialized successfully');
      } catch (error) {
        console.error('Failed to initialize BinanceService:', error.message);
        throw error;
      }
    }
  }

  // Create signature for authenticated requests
  createSignature(queryString) {
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(queryString)
      .digest('hex');
  }

  // Get server time
  async getServerTime() {
    try {
      const response = await axios.get(`${this.baseURL}/api/v3/time`);
      return response.data.serverTime;
    } catch (error) {
      throw new Error(`Failed to get server time: ${error.message}`);
    }
  }

  // Synchronize time with Binance server
  async syncServerTime() {
    try {
      const localTime = Date.now();
      const serverTime = await this.getServerTime();
      this.timeOffset = serverTime - localTime;
      this.lastSyncTime = localTime;
      console.log(`Time synchronized. Offset: ${this.timeOffset}ms`);
      return this.timeOffset;
    } catch (error) {
      console.error(`Failed to sync server time: ${error.message}`);
      throw error;
    }
  }

  // Get synchronized timestamp
  async getSyncedTimestamp() {
    // Ensure service is initialized
    if (!this.initialized) {
      await this.initialize();
    }
    
    const now = Date.now();
    
    // Check if we need to sync time (first time or after sync interval)
    if (this.lastSyncTime === 0 || (now - this.lastSyncTime) > this.syncInterval) {
      try {
        await this.syncServerTime();
      } catch (error) {
        console.warn(`Time sync failed, using cached offset: ${error.message}`);
      }
    }
    
    return now + this.timeOffset;
  }

  // Check if error is timestamp related
  isTimestampError(error) {
    const message = error.response?.data?.msg || error.message || '';
    return message.includes('Timestamp for this request is outside of the recvWindow') ||
           message.includes('Invalid timestamp') ||
           message.includes('Timestamp for this request was');
  }

  // Execute request with timestamp retry logic
  async executeWithTimestampRetry(requestFunction, maxRetries = 2) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await requestFunction();
      } catch (error) {
        lastError = error;
        
        // If it's a timestamp error and we have retries left, force time sync and retry
        if (this.isTimestampError(error) && attempt < maxRetries) {
          console.warn(`Timestamp error detected (attempt ${attempt + 1}/${maxRetries + 1}). Forcing time sync...`);
          try {
            await this.syncServerTime();
            console.log('Time sync completed, retrying request...');
          } catch (syncError) {
            console.error(`Time sync failed: ${syncError.message}`);
          }
        } else {
          break;
        }
      }
    }
    
    throw lastError;
  }

  // Get account information
  async getAccountInfo() {
    if (!this.hasCredentials) {
      throw new Error('API credentials are required for this operation');
    }
    
    return await this.executeWithTimestampRetry(async () => {
      try {
        const timestamp = await this.getSyncedTimestamp();
        const queryString = `timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
        const signature = this.createSignature(queryString);

        const response = await axios.get(`${this.baseURL}/api/v3/account`, {
          headers: {
            'X-MBX-APIKEY': this.apiKey
          },
          params: {
            timestamp,
            recvWindow: this.recvWindow,
            signature
          }
        });

        return response.data;
      } catch (error) {
        throw new Error(`Failed to get account info: ${error.response?.data?.msg || error.message}`);
      }
    });
  }

  // Get symbol price
  async getSymbolPrice(symbol) {
    try {
      const response = await axios.get(`${this.baseURL}/api/v3/ticker/price`, {
        params: { symbol }
      });
      return parseFloat(response.data.price);
    } catch (error) {
      throw new Error(`Failed to get price for ${symbol}: ${error.message}`);
    }
  }

  // Get symbol info (for precision, min quantity, etc.)
  async getSymbolInfo(symbol) {
    try {
      const response = await axios.get(`${this.baseURL}/api/v3/exchangeInfo`);
      const symbolInfo = response.data.symbols.find(s => s.symbol === symbol);
      
      if (!symbolInfo) {
        throw new Error(`Symbol ${symbol} not found`);
      }

      return {
        symbol: symbolInfo.symbol,
        status: symbolInfo.status,
        baseAsset: symbolInfo.baseAsset,
        quoteAsset: symbolInfo.quoteAsset,
        pricePrecision: symbolInfo.quotePrecision,
        quantityPrecision: symbolInfo.baseAssetPrecision,
        minQty: parseFloat(symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE')?.minQty || 0),
        maxQty: parseFloat(symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE')?.maxQty || 0),
        stepSize: parseFloat(symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE')?.stepSize || 0),
        minPrice: parseFloat(symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER')?.minPrice || 0),
        maxPrice: parseFloat(symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER')?.maxPrice || 0),
        tickSize: parseFloat(symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize || 0),
        minNotional: parseFloat(symbolInfo.filters.find(f => f.filterType === 'MIN_NOTIONAL')?.minNotional || 0)
      };
    } catch (error) {
      throw new Error(`Failed to get symbol info: ${error.message}`);
    }
  }

  // Place a limit order
  async placeLimitOrder(symbol, side, quantity, price) {
    if (!this.hasCredentials) {
      throw new Error('API credentials are required for this operation');
    }
    
    return await this.executeWithTimestampRetry(async () => {
      try {
        const timestamp = await this.getSyncedTimestamp();
        const params = {
          symbol,
          side,
          type: 'LIMIT',
          timeInForce: 'GTC',
          quantity: quantity.toString(),
          price: price.toString(),
          timestamp,
          recvWindow: this.recvWindow
        };

        const queryString = Object.keys(params)
          .map(key => `${key}=${params[key]}`)
          .join('&');
        
        const signature = this.createSignature(queryString);

        const response = await axios.post(`${this.baseURL}/api/v3/order`, null, {
          headers: {
            'X-MBX-APIKEY': this.apiKey
          },
          params: {
            ...params,
            signature
          }
        });

        return response.data;
      } catch (error) {
        throw new Error(`Failed to place order: ${error.response?.data?.msg || error.message}`);
      }
    });
  }

  // Place a market order
  async placeMarketOrder(symbol, side, quantity) {
    if (!this.hasCredentials) {
      throw new Error('API credentials are required for this operation');
    }
    
    return await this.executeWithTimestampRetry(async () => {
      try {
        const timestamp = await this.getSyncedTimestamp();
      const params = {
          symbol,
          side,
          type: 'MARKET',
          quantity: quantity.toString(),
          timestamp,
          recvWindow: this.recvWindow
        };

      const queryString = Object.keys(params)
        .map(key => `${key}=${params[key]}`)
        .join('&');
      
      const signature = this.createSignature(queryString);

      const response = await axios.post(`${this.baseURL}/api/v3/order`, null, {
        headers: {
          'X-MBX-APIKEY': this.apiKey
        },
        params: {
          ...params,
          signature
        }
      });

        return response.data;
      } catch (error) {
        throw new Error(`Failed to place market order: ${error.response?.data?.msg || error.message}`);
      }
    });
  }

  // Cancel an order
  async cancelOrder(symbol, orderId) {
    if (!this.hasCredentials) {
      throw new Error('API credentials are required for this operation');
    }
    
    return await this.executeWithTimestampRetry(async () => {
      try {
        const timestamp = await this.getSyncedTimestamp();
        const params = {
          symbol,
          orderId,
          timestamp,
          recvWindow: this.recvWindow
        };

        const queryString = Object.keys(params)
          .map(key => `${key}=${params[key]}`)
          .join('&');
        
        const signature = this.createSignature(queryString);

        const response = await axios.delete(`${this.baseURL}/api/v3/order`, {
          headers: {
            'X-MBX-APIKEY': this.apiKey
          },
          params: {
            ...params,
            signature
          }
        });

        return response.data;
      } catch (error) {
        throw new Error(`Failed to cancel order: ${error.response?.data?.msg || error.message}`);
      }
    });
  }

  // Get order status
  async getOrderStatus(symbol, orderId) {
    if (!this.hasCredentials) {
      throw new Error('API credentials are required for this operation');
    }
    
    return await this.executeWithTimestampRetry(async () => {
      try {
        const timestamp = await this.getSyncedTimestamp();
        const params = {
          symbol,
          orderId,
          timestamp,
          recvWindow: this.recvWindow
        };

        const queryString = Object.keys(params)
          .map(key => `${key}=${params[key]}`)
          .join('&');
        
        const signature = this.createSignature(queryString);

        const response = await axios.get(`${this.baseURL}/api/v3/order`, {
          headers: {
            'X-MBX-APIKEY': this.apiKey
          },
          params: {
            ...params,
            signature
          }
        });

        return response.data;
      } catch (error) {
        throw new Error(`Failed to get order status: ${error.response?.data?.msg || error.message}`);
      }
    });
  }

  // Get open orders
  async getOpenOrders(symbol) {
    if (!this.hasCredentials) {
      throw new Error('API credentials are required for this operation');
    }
    
    return await this.executeWithTimestampRetry(async () => {
      try {
        const timestamp = await this.getSyncedTimestamp();
        const params = {
          symbol,
          timestamp,
          recvWindow: this.recvWindow
        };

        const queryString = Object.keys(params)
          .map(key => `${key}=${params[key]}`)
          .join('&');
        
        const signature = this.createSignature(queryString);

        const response = await axios.get(`${this.baseURL}/api/v3/openOrders`, {
          headers: {
            'X-MBX-APIKEY': this.apiKey
          },
          params: {
            ...params,
            signature
          }
        });

        return response.data;
      } catch (error) {
        throw new Error(`Failed to get open orders: ${error.response?.data?.msg || error.message}`);
      }
    });
  }

  // Get asset balance
  async getAssetBalance(asset) {
    if (!this.hasCredentials) {
      throw new Error('API credentials are required for this operation');
    }
    
    try {
      const accountInfo = await this.getAccountInfo();
      const balance = accountInfo.balances.find(b => b.asset === asset);
      
      return {
        asset,
        free: parseFloat(balance?.free || 0),
        locked: parseFloat(balance?.locked || 0),
        total: parseFloat(balance?.free || 0) + parseFloat(balance?.locked || 0)
      };
    } catch (error) {
      throw new Error(`Failed to get balance for ${asset}: ${error.message}`);
    }
  }

  // Get all available trading symbols
  async getAllSymbols() {
    try {
      const response = await axios.get(`${this.baseURL}/api/v3/exchangeInfo`);
      const symbols = response.data.symbols
        .filter(symbol => symbol.status === 'TRADING') // Only active trading pairs
        .map(symbol => ({
          symbol: symbol.symbol,
          baseAsset: symbol.baseAsset,
          quoteAsset: symbol.quoteAsset,
          status: symbol.status,
          pricePrecision: symbol.quotePrecision,
          quantityPrecision: symbol.baseAssetPrecision,
          minQty: parseFloat(symbol.filters.find(f => f.filterType === 'LOT_SIZE')?.minQty || 0),
          minNotional: parseFloat(symbol.filters.find(f => f.filterType === 'MIN_NOTIONAL')?.minNotional || 0),
          tickSize: parseFloat(symbol.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize || 0)
        }));
      
      return symbols;
    } catch (error) {
      throw new Error(`Failed to get all symbols: ${error.message}`);
    }
  }

  // Test API credentials by making a simple authenticated request
  async testCredentials(apiKey, secretKey) {
    try {
      // Create a temporary instance with the provided credentials
      const tempService = new BinanceService(apiKey, secretKey);
      await tempService.initialize();
      
      // Try to get account info to validate credentials
      await tempService.getAccountInfo();
      
      return true;
    } catch (error) {
      console.error('Credential test failed:', error.message);
      throw new Error('Invalid API credentials');
    }
  }
}

module.exports = BinanceService;