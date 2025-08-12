const crypto = require('crypto');
const axios = require('axios');
const { BINANCE_API_KEY, BINANCE_SECRET_KEY } = require('../config/env');
const webSocketManager = require('./webSocketManager');

class BinanceService {
  constructor(userApiKey = null, userSecretKey = null, userId = null) {
    this.baseURL = 'https://api.binance.com';
    this.fallbackURLs = [
      'https://api1.binance.com',
      'https://api2.binance.com',
      'https://api3.binance.com'
    ];
    this.currentUrlIndex = 0;
    this.apiKey = userApiKey || BINANCE_API_KEY || null;
    this.secretKey = userSecretKey || BINANCE_SECRET_KEY || null;
    this.userId = userId;
    this.timeOffset = 0;
    this.lastSyncTime = 0;
    this.syncInterval = 5 * 60 * 1000; // Sync every 5 minutes
    this.recvWindow = 5000; // 5 seconds receive window
    this.initialized = false;
    this.hasCredentials = !!(this.apiKey && this.secretKey);
    this.useWebSocket = true; // Enable WebSocket by default
    this.rateLimitResetTime = null; // Track when rate limit resets
    
    // Initialize WebSocket connection if user credentials are provided
    if (this.userId && this.hasCredentials) {
      this.initializeWebSocket();
    }
  }

  // Initialize WebSocket connection
  async initializeWebSocket() {
    if (this.userId && this.hasCredentials && this.useWebSocket) {
      try {
        const success = await webSocketManager.createUserConnection(this.userId, this.apiKey, this.secretKey);
        if (success) {
          console.log(`WebSocket initialized for user ${this.userId}`);
        } else {
          console.warn(`WebSocket initialization failed for user ${this.userId}, falling back to REST API`);
          this.useWebSocket = false;
        }
      } catch (error) {
        console.warn(`WebSocket initialization exception for user ${this.userId}, falling back to REST API:`, error.message);
        this.useWebSocket = false;
      }
    }
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
          continue;
        }
        
        // Handle rate limiting and temporary service errors
        const status = error.response?.status;
        if ((status === 418 || status === 429 || status === 503) && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 500; // 0.5s, 1s, 2s
          console.warn(`Transient Binance error ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        break;
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

  // Get symbol price (WebSocket first, REST fallback)
  async getSymbolPrice(symbol, maxRetries = 3) {
    // Try WebSocket data first (shared public streams)
    if (this.useWebSocket) {
      const cachedPrice = webSocketManager.getCachedPrice(symbol);
      if (cachedPrice && cachedPrice.price) {
        console.log(`Using WebSocket price for ${symbol}: ${cachedPrice.price}`);
        return cachedPrice.price;
      }
      
      // Subscribe to symbol if not already subscribed
      try {
        // userId is optional now; shared manager handles symbol-level subscription
        await webSocketManager.subscribeToSymbol(this.userId, symbol);
        
        // Wait a moment for WebSocket data to arrive
        await new Promise(resolve => setTimeout(resolve, 700));
        
        const updatedPrice = webSocketManager.getCachedPrice(symbol);
        if (updatedPrice && updatedPrice.price) {
          console.log(`Using updated WebSocket price for ${symbol}: ${updatedPrice.price}`);
          return updatedPrice.price;
        }
      } catch (wsError) {
        console.warn(`WebSocket subscription failed for ${symbol}:`, wsError.message);
      }
    }
    
    // Fallback to REST API with retry logic for rate limiting
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Try primary baseURL, then rotate through fallbacks on certain errors
        const urlsToTry = [this.baseURL, ...this.fallbackURLs];
        let lastInnerError;
        for (let u = 0; u < urlsToTry.length; u++) {
          const base = urlsToTry[(this.currentUrlIndex + u) % urlsToTry.length];
          try {
            const response = await axios.get(`${base}/api/v3/ticker/price`, {
              params: { symbol },
              timeout: 10000
            });
            // If success, update current index to this base for future calls
            this.currentUrlIndex = (this.currentUrlIndex + u) % urlsToTry.length;
            return parseFloat(response.data.price);
          } catch (innerErr) {
            lastInnerError = innerErr;
            const innerStatus = innerErr.response?.status;
            // On 418/429/503, continue to next fallback URL
            if (innerStatus === 418 || innerStatus === 429 || innerStatus === 503) {
              console.warn(`Base ${base} failed with ${innerStatus}, trying next fallback for ${symbol}...`);
              continue;
            }
            // For other errors, break and throw
            break;
          }
        }
        // If all URLs failed, throw the last error
        throw lastInnerError;
      } catch (error) {
        lastError = error;
        const statusCode = error.response?.status;
        
        // Handle rate limiting (418) and other temporary errors
        if ((statusCode === 418 || statusCode === 429 || statusCode === 503) && attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.warn(`Rate limited for ${symbol} (status ${statusCode}), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // For other errors or final retry, break and throw
        break;
      }
    }
    
    // If all retries failed, provide more specific error message
    const statusCode = lastError.response?.status;
    let errorMessage = `Failed to get price for ${symbol}`;
    
    if (statusCode === 418) {
      errorMessage += ': Rate limited by Binance (418). Please try again in a few minutes.';
    } else if (statusCode === 429) {
      errorMessage += ': Too many requests (429). Please try again later.';
    } else if (statusCode === 503) {
      errorMessage += ': Binance service temporarily unavailable (503).';
    } else {
      errorMessage += `: ${lastError.message}`;
    }
    
    throw new Error(errorMessage);
  }

  // Get symbol info (for precision, min quantity, etc.)
  async getSymbolInfo(symbol, maxRetries = 3) {
    return await this.executeWithTimestampRetry(async () => {
      let lastError;
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          // Try different base URLs if available
          const urlsToTry = [this.baseURL, ...this.fallbackURLs];
          const baseUrl = urlsToTry[attempt % urlsToTry.length];
          
          const response = await axios.get(`${baseUrl}/api/v3/exchangeInfo`, {
            timeout: 10000
          });
          
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
          lastError = error;
          const statusCode = error.response?.status;
          
          // Handle rate limiting (418) and other temporary errors
          if ((statusCode === 418 || statusCode === 429 || statusCode === 503) && attempt < maxRetries - 1) {
            const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
            console.warn(`Rate limited for symbol info ${symbol} (status ${statusCode}), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          // For other errors or final retry, break and throw
          break;
        }
      }
      
      // Provide more specific error message based on status code
      const statusCode = lastError.response?.status;
      let errorMessage = `Failed to get symbol info for ${symbol}`;
      
      if (statusCode === 418) {
        errorMessage += ': Rate limited by Binance (418). Please try again in a few minutes.';
      } else if (statusCode === 429) {
        errorMessage += ': Too many requests (429). Please try again later.';
      } else if (statusCode === 503) {
        errorMessage += ': Binance service temporarily unavailable (503).';
      } else {
        errorMessage += `: ${lastError.message}`;
      }
      
      throw new Error(errorMessage);
    });
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

  // Get 24hr ticker statistics (WebSocket first, REST fallback)
  async get24hrTicker(symbol) {
    // Try WebSocket data first
    if (this.useWebSocket && this.userId) {
      const cachedData = webSocketManager.getCachedPrice(symbol);
      if (cachedData && cachedData.priceChange !== undefined) {
        console.log(`Using WebSocket ticker data for ${symbol}`);
        return {
          symbol: cachedData.symbol,
          priceChange: cachedData.priceChange || 0,
          priceChangePercent: cachedData.priceChange || 0,
          lastPrice: cachedData.price,
          highPrice: cachedData.high || cachedData.price,
          lowPrice: cachedData.low || cachedData.price,
          volume: cachedData.volume || 0,
          openPrice: cachedData.open || cachedData.price,
          closeTime: cachedData.timestamp || Date.now()
        };
      }
      
      // Subscribe to symbol if not already subscribed
      await webSocketManager.subscribeToSymbol(this.userId, symbol);
    }
    
    // Fallback to REST API
    try {
      const response = await axios.get(`${this.baseURL}/api/v3/ticker/24hr?symbol=${symbol}`);
      return {
        symbol: response.data.symbol,
        priceChange: parseFloat(response.data.priceChange),
        priceChangePercent: parseFloat(response.data.priceChangePercent),
        weightedAvgPrice: parseFloat(response.data.weightedAvgPrice),
        prevClosePrice: parseFloat(response.data.prevClosePrice),
        lastPrice: parseFloat(response.data.lastPrice),
        lastQty: parseFloat(response.data.lastQty),
        bidPrice: parseFloat(response.data.bidPrice),
        askPrice: parseFloat(response.data.askPrice),
        openPrice: parseFloat(response.data.openPrice),
        highPrice: parseFloat(response.data.highPrice),
        lowPrice: parseFloat(response.data.lowPrice),
        volume: parseFloat(response.data.volume),
        quoteVolume: parseFloat(response.data.quoteVolume),
        openTime: response.data.openTime,
        closeTime: response.data.closeTime,
        count: response.data.count
      };
    } catch (error) {
      throw new Error(`Failed to get 24hr ticker: ${error.message}`);
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