import { createRequire } from 'module';
import WebSocket from 'ws';
import BinanceCredentials from '../models/BinanceCredentials.js';
import encryptionService from './encryptionService.js';

const require = createRequire(import.meta.url);
const binanceModule = require('binance-api-node');

// Try different ways to get the Binance function
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

class BinanceService {
  constructor() {
    this.client = null;
    this.testClient = null;
    this.isTestMode = process.env.NODE_ENV !== 'production'; // Default test mode
    this.wsConnections = new Map(); // Store WebSocket connections
    this.priceCache = new Map(); // Cache real-time prices
    this.clientCache = new Map(); // Cache user-specific clients
    this.timeOffset = 0; // Server time offset for timestamp sync
    this.lastSyncTime = 0; // Last time we synced with Binance servers
    this.initializeClients();
  }

  // Synchronize time with Binance servers
  async syncServerTime() {
    try {
      const currentTime = Date.now();
      
      // Only sync if we haven't synced in the last 5 minutes
      if (currentTime - this.lastSyncTime < 5 * 60 * 1000) {
        return;
      }

      // Get server time from Binance
      const response = await fetch('https://api.binance.com/api/v3/time');
      const data = await response.json();
      
      const serverTime = data.serverTime;
      const localTime = Date.now();
      
      // Calculate offset
      this.timeOffset = serverTime - localTime;
      this.lastSyncTime = localTime;
      
      console.log(`🕐 Time synchronized with Binance. Offset: ${this.timeOffset}ms`);
      
    } catch (error) {
      console.warn('⚠️ Failed to sync time with Binance servers:', error.message);
      // Don't throw error, just use local time
    }
  }

  // Get synchronized timestamp
  getSyncedTimestamp() {
    return Date.now() + this.timeOffset;
  }

  async initializeClients() {
    try {
      // Sync time with Binance servers first
      await this.syncServerTime();
      
      // Validate that we have both test and live keys
      const hasTestKeys = process.env.BINANCE_TEST_API_KEY && process.env.BINANCE_TEST_SECRET_KEY;
      const hasLiveKeys = process.env.BINANCE_API_KEY && process.env.BINANCE_SECRET_KEY;
      
      
      // Initialize test client
      if (process.env.BINANCE_TEST_API_KEY && process.env.BINANCE_TEST_SECRET_KEY) {
        this.testClient = Binance({
          apiKey: process.env.BINANCE_TEST_API_KEY,
          apiSecret: process.env.BINANCE_TEST_SECRET_KEY,
          getTime: () => this.getSyncedTimestamp(),
          httpBase: 'https://testnet.binance.vision',
          wsBase: 'wss://testnet.binance.vision/ws',
          recvWindow: 10000 // Increase receive window to 10 seconds
        });
      }

      // Initialize live client
      if (process.env.BINANCE_API_KEY && process.env.BINANCE_SECRET_KEY) {
        this.client = Binance({
          apiKey: process.env.BINANCE_API_KEY,
          apiSecret: process.env.BINANCE_SECRET_KEY,
          getTime: () => this.getSyncedTimestamp(),
          recvWindow: 10000 // Increase receive window to 10 seconds
        });
      }
    } catch (error) {
      // Error initializing Binance clients
    }
  }

  setTestMode(isTestMode) {
    this.isTestMode = isTestMode;
  }

  getClient() {
    const client = this.isTestMode ? this.testClient : this.client;
    
    if (!client) {
      const mode = this.isTestMode ? 'TEST' : 'LIVE';
      throw new Error(`${mode} client is not initialized. Please check your environment variables.`);
    }
    
    return client;
  }

  // Get user-specific client or fallback to master account
  async getUserClient(userId, isTestMode = true) {
    try {
      // Get user credentials from dedicated table
      const credentials = await BinanceCredentials.getUserCredentials(userId);
      
      if (!credentials) {
        return this.getFallbackClient(isTestMode);
      }

      // Get the appropriate keys
      const keys = isTestMode ? credentials.test_keys : credentials.live_keys;
      
      if (!keys || !keys.is_active || !keys.is_verified) {
        return this.getFallbackClient(isTestMode);
      }

      // Check cache first
      const cacheKey = `${userId}_${isTestMode}`;
      if (this.clientCache.has(cacheKey)) {
        return this.clientCache.get(cacheKey);
      }

      // Decrypt keys and create client
      const decryptedApiKey = encryptionService.decryptSimple(keys.api_key);
      const decryptedSecret = encryptionService.decryptSimple(keys.secret_key);

      // Sync time before creating user client
      await this.syncServerTime();
      
      const client = Binance({
        apiKey: decryptedApiKey,
        apiSecret: decryptedSecret,
        getTime: () => this.getSyncedTimestamp(),
        recvWindow: 10000, // 10 second receive window
        ...(isTestMode && {
          httpBase: 'https://testnet.binance.vision',
          wsBase: 'wss://testnet.binance.vision/ws'
        })
      });

      // Cache the client
      this.clientCache.set(cacheKey, client);
      
      return client;

    } catch (error) {
      return this.getFallbackClient(isTestMode);
    }
  }

  // Get fallback client (master account)
  getFallbackClient(isTestMode) {
    return isTestMode ? this.testClient : this.client;
  }

  // Check if user has their own keys
  async hasUserKeys(userId, isTestMode = true) {
    try {
      const credentials = await BinanceCredentials.getUserCredentials(userId);
      if (!credentials) return false;
      
      const keys = isTestMode ? credentials.test_keys : credentials.live_keys;
      return keys && keys.is_active && keys.is_verified;
    } catch (error) {
      return false;
    }
  }

  // Get account balance with automatic time sync retry
  async getAccountBalance() {
    try {
      const client = this.getClient();
      if (!client) throw new Error('Binance client not initialized');

      // Try first with current time sync
      try {
        const accountInfo = await client.accountInfo();
        return {
          success: true,
          balances: accountInfo.balances.filter(balance => 
            parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0
          )
        };
      } catch (timeError) {
        // If it's a timestamp error, resync and retry once
        if (timeError.message.includes('Timestamp') || timeError.message.includes('recvWindow')) {
          console.log('🔄 Timestamp error detected, resyncing time and retrying...');
          this.lastSyncTime = 0; // Force resync
          await this.syncServerTime();
          
          const accountInfo = await client.accountInfo();
          return {
            success: true,
            balances: accountInfo.balances.filter(balance => 
              parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0
            )
          };
        }
        throw timeError; // Re-throw if not a timestamp error
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get symbol information
  async getSymbolInfo(symbol) {
    try {
      const client = this.getClient();
      if (!client) throw new Error('Binance client not initialized');

      const exchangeInfo = await client.exchangeInfo();
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol.toUpperCase());
      
      if (!symbolInfo) {
        throw new Error(`Symbol ${symbol} not found`);
      }

      return {
        success: true,
        symbol: symbolInfo.symbol,
        status: symbolInfo.status,
        baseAsset: symbolInfo.baseAsset,
        quoteAsset: symbolInfo.quoteAsset,
        minPrice: this.getFilterValue(symbolInfo.filters, 'PRICE_FILTER', 'minPrice'),
        maxPrice: this.getFilterValue(symbolInfo.filters, 'PRICE_FILTER', 'maxPrice'),
        tickSize: this.getFilterValue(symbolInfo.filters, 'PRICE_FILTER', 'tickSize'),
        minQty: this.getFilterValue(symbolInfo.filters, 'LOT_SIZE', 'minQty'),
        maxQty: this.getFilterValue(symbolInfo.filters, 'LOT_SIZE', 'maxQty'),
        stepSize: this.getFilterValue(symbolInfo.filters, 'LOT_SIZE', 'stepSize'),
        minNotional: this.getFilterValue(symbolInfo.filters, 'MIN_NOTIONAL', 'minNotional')
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get current price
  async getCurrentPrice(symbol) {
    try {
      const client = this.getClient();
      if (!client) throw new Error('Binance client not initialized');

      const ticker = await client.prices({ symbol: symbol.toUpperCase() });
      const price = parseFloat(ticker[symbol.toUpperCase()]);
      
      // Cache the price
      this.priceCache.set(symbol.toUpperCase(), {
        price: price,
        timestamp: Date.now()
      });

      return {
        success: true,
        symbol: symbol.toUpperCase(),
        price: price,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get historical kline data
  async getKlines(symbol, interval = '1h', limit = 200) {
    try {
      const client = this.getClient();
      if (!client) throw new Error('Binance client not initialized');

      const klines = await client.candles({
        symbol: symbol.toUpperCase(),
        interval: interval,
        limit: limit
      });

      return {
        success: true,
        data: klines.map(kline => ({
          openTime: kline.openTime,
          open: parseFloat(kline.open),
          high: parseFloat(kline.high),
          low: parseFloat(kline.low),
          close: parseFloat(kline.close),
          volume: parseFloat(kline.volume),
          closeTime: kline.closeTime
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Place a limit order with timestamp retry
  async placeLimitOrder(userId, symbol, side, quantity, price, isTestMode = true, options = {}) {
    try {
      const client = await this.getUserClient(userId, isTestMode);
      if (!client) throw new Error('Binance client not initialized');

      const orderParams = {
        symbol: symbol.toUpperCase(),
        side: side.toUpperCase(),
        type: 'LIMIT',
        timeInForce: 'GTC',
        quantity: quantity.toString(),
        price: price.toString(),
        ...options
      };

      // Try placing order with current time sync
      try {
        const order = await client.order(orderParams);
        
        return {
          success: true,
          order: {
            orderId: order.orderId,
            clientOrderId: order.clientOrderId,
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            quantity: parseFloat(order.origQty),
            price: parseFloat(order.price),
            status: order.status,
            transactTime: order.transactTime
          }
        };
      } catch (timeError) {
        // If it's a timestamp error, resync and retry once
        if (timeError.message.includes('Timestamp') || timeError.message.includes('recvWindow')) {
          console.log('🔄 Order timestamp error, resyncing time and retrying...');
          this.lastSyncTime = 0; // Force resync
          await this.syncServerTime();
          
          // Clear client cache to force new client with updated time
          const cacheKey = `${userId}_${isTestMode}`;
          this.clientCache.delete(cacheKey);
          
          // Get fresh client and retry
          const freshClient = await this.getUserClient(userId, isTestMode);
          const order = await freshClient.order(orderParams);
          
          return {
            success: true,
            order: {
              orderId: order.orderId,
              clientOrderId: order.clientOrderId,
              symbol: order.symbol,
              side: order.side,
              type: order.type,
              quantity: parseFloat(order.origQty),
              price: parseFloat(order.price),
              status: order.status,
              transactTime: order.transactTime
            }
          };
        }
        throw timeError; // Re-throw if not a timestamp error
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Cancel an order
  async cancelOrder(userId, orderParams, isTestMode = true) {
    try {
      const client = await this.getUserClient(userId, isTestMode);
      if (!client) throw new Error('Binance client not initialized');

      const result = await client.cancelOrder({
        symbol: orderParams.symbol.toUpperCase(),
        orderId: orderParams.orderId
      });

      return {
        success: true,
        result: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get order status
  async getOrderStatus(userId, symbol, orderId, isTestMode = true) {
    try {
      const client = await this.getUserClient(userId, isTestMode);
      if (!client) throw new Error('Binance client not initialized');

      const order = await client.getOrder({
        symbol: symbol.toUpperCase(),
        orderId: orderId
      });

      return {
        success: true,
        order: {
          orderId: order.orderId,
          clientOrderId: order.clientOrderId,
          symbol: order.symbol,
          side: order.side,
          type: order.type,
          quantity: parseFloat(order.origQty),
          price: parseFloat(order.price),
          executedQty: parseFloat(order.executedQty),
          status: order.status,
          time: order.time,
          updateTime: order.updateTime
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get all open orders
  async getOpenOrders(symbol = null) {
    try {
      const client = this.getClient();
      if (!client) throw new Error('Binance client not initialized');

      const params = symbol ? { symbol: symbol.toUpperCase() } : {};
      const orders = await client.openOrders(params);

      return {
        success: true,
        orders: orders.map(order => ({
          orderId: order.orderId,
          clientOrderId: order.clientOrderId,
          symbol: order.symbol,
          side: order.side,
          type: order.type,
          quantity: parseFloat(order.origQty),
          price: parseFloat(order.price),
          executedQty: parseFloat(order.executedQty),
          status: order.status,
          time: order.time,
          updateTime: order.updateTime
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Start WebSocket price stream with robust error handling
  async startPriceStream(symbol, callback, userId = null, isTestMode = true) {
    try {
      // Use user-specific client if userId provided, otherwise fallback to master
      let client;
      let usingFallback = false;
      
      if (userId) {
        try {
          client = await this.getUserClient(userId, isTestMode);
        } catch (error) {
          client = this.getFallbackClient(isTestMode);
          usingFallback = true;
        }
      } else {
        client = this.getClient();
      }
      
      if (!client) throw new Error('Binance client not initialized');

      // Create user-specific stream key to avoid conflicts
      const streamKey = userId ? `${symbol.toUpperCase()}_${userId}` : symbol.toUpperCase();
      
      // Close existing stream if any
      if (this.wsConnections.has(streamKey)) {
        try {
          this.wsConnections.get(streamKey)();
        } catch (closeError) {
          // Error closing existing connection
        }
        this.wsConnections.delete(streamKey);
      }

      // Add timeout and retry logic
      let clean;
      let connectionAttempts = 0;
      const maxAttempts = 3;
      
      const establishConnection = () => {
        connectionAttempts++;
        
        try {
          clean = client.ws.ticker(streamKey, (ticker) => {
            const priceData = {
              symbol: ticker.symbol,
              price: parseFloat(ticker.curDayClose),
              priceChange: parseFloat(ticker.priceChange),
              priceChangePercent: parseFloat(ticker.priceChangePercent),
              volume: parseFloat(ticker.volume),
              timestamp: Date.now()
            };

            // Update cache
            this.priceCache.set(streamKey, priceData);
            
            // Execute callback
            if (callback) {
              try {
                callback(priceData);
              } catch (callbackError) {
                // Error in callback
              }
            }
          }, (error) => {
            // Handle specific error types
            if (error.message && error.message.includes('WebSocket was closed')) {
              // Remove from connections map
              this.wsConnections.delete(streamKey);
              
              // Retry connection if we haven't exceeded max attempts
              if (connectionAttempts < maxAttempts) {
                setTimeout(() => {
                  establishConnection();
                }, 5000);
              } else {
                // Start REST API fallback polling
                this.startRestApiFallback(streamKey, callback);
              }
            }
          });
          
          // Store the cleanup function
          this.wsConnections.set(streamKey, clean);
          
        } catch (connectionError) {
          if (connectionAttempts < maxAttempts) {
            setTimeout(() => {
              establishConnection();
            }, 3000);
          } else {
            this.startRestApiFallback(streamKey, callback);
          }
        }
      };
      
      // Start the connection process
      establishConnection();
      
      return {
        success: true,
        streamKey: streamKey,
        cleanup: clean
      };
    } catch (error) {
      // Fallback to REST API polling
      this.startRestApiFallback(symbol.toUpperCase(), callback);
      
      return {
        success: false,
        error: error.message,
        fallback: 'REST_API'
      };
    }
  }

  // REST API fallback when WebSocket fails
  startRestApiFallback(symbol, callback) {
    const streamKey = symbol.toUpperCase();
    
    // Clear any existing interval
    if (this.wsConnections.has(streamKey)) {
      clearInterval(this.wsConnections.get(streamKey));
    }
    
    // Poll REST API every 5 seconds
    const interval = setInterval(async () => {
      try {
        const price = await this.getCurrentPriceREST(symbol);
        if (price) {
          const priceData = {
            symbol: symbol,
            price: price,
            priceChange: 0,
            priceChangePercent: 0,
            volume: 0,
            timestamp: Date.now()
          };
          
          // Update cache
          this.priceCache.set(streamKey, priceData);
          
          // Execute callback
          if (callback) {
            try {
              callback(priceData);
            } catch (callbackError) {
              // Error in REST fallback callback
            }
          }
        }
      } catch (error) {
        // REST API fallback error
      }
    }, 5000);
    
    // Store the interval ID for cleanup
    this.wsConnections.set(streamKey, () => {
      clearInterval(interval);
    });
  }

  // Stop WebSocket price stream
  stopPriceStream(symbol, userId = null) {
    const streamKey = userId ? `${symbol.toUpperCase()}_${userId}` : symbol.toUpperCase();
    if (this.wsConnections.has(streamKey)) {
      this.wsConnections.get(streamKey)();
      this.wsConnections.delete(streamKey);
      return true;
    }
    return false;
  }

  // Start user data stream for real-time account updates (orders, balance, etc.)
  async startUserDataStream(userId, callback, isTestMode = true) {
    try {
      // Get user-specific client - user data streams REQUIRE user's own keys
      let client;
      try {
        client = await this.getUserClient(userId, isTestMode);
      } catch (error) {
        return {
          success: false,
          error: 'User API keys required for real-time account updates. Please add your Binance API keys in settings.'
        };
      }
      
      if (!client) throw new Error('User client not initialized');

      const streamKey = `USER_DATA_${userId}`;
      
      // Close existing stream if any
      if (this.wsConnections.has(streamKey)) {
        try {
          this.wsConnections.get(streamKey)();
        } catch (closeError) {
          // Error closing existing user data stream
        }
        this.wsConnections.delete(streamKey);
      }

      // Start user data stream
      const clean = client.ws.user((msg) => {
        // Call the callback with the processed data
        callback(msg);
      });

      this.wsConnections.set(streamKey, clean);
      
      return {
        success: true,
        cleanup: clean
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Stop user data stream
  stopUserDataStream(userId) {
    const streamKey = `USER_DATA_${userId}`;
    if (this.wsConnections.has(streamKey)) {
      this.wsConnections.get(streamKey)();
      this.wsConnections.delete(streamKey);
      return true;
    }
    return false;
  }

  // Get cached price
  getCachedPrice(symbol) {
    const cached = this.priceCache.get(symbol.toUpperCase());
    if (cached && (Date.now() - cached.timestamp) < 10000) { // 10 seconds cache
      return cached.price;
    }
    return null;
  }

  // Get current price via REST API (fallback)
  async getCurrentPriceREST(symbol) {
    try {
      const client = this.getClient();
      if (!client) throw new Error('Binance client not initialized');

      const ticker = await client.prices({ symbol: symbol.toUpperCase() });
      const price = parseFloat(ticker[symbol.toUpperCase()]);
      
      // Update cache with REST API data
      const priceData = {
        symbol: symbol.toUpperCase(),
        price: price,
        priceChange: 0,
        priceChangePercent: 0,
        volume: 0,
        timestamp: Date.now()
      };
      
      this.priceCache.set(symbol.toUpperCase(), priceData);
      return price;
    } catch (error) {
      return null;
    }
  }

  // Utility function to get filter values
  getFilterValue(filters, filterType, key) {
    const filter = filters.find(f => f.filterType === filterType);
    return filter ? parseFloat(filter[key]) : 0;
  }

  // Format price according to symbol precision
  formatPrice(price, tickSize) {
    const precision = tickSize.toString().split('.')[1]?.length || 0;
    return parseFloat(price.toFixed(precision));
  }

  // Format quantity according to symbol precision
  formatQuantity(quantity, stepSize) {
    const precision = stepSize.toString().split('.')[1]?.length || 0;
    return parseFloat(quantity.toFixed(precision));
  }

  // Validate order parameters
  validateOrderParams(symbolInfo, side, quantity, price) {
    const errors = [];

    // Check price limits
    if (price < symbolInfo.minPrice || price > symbolInfo.maxPrice) {
      errors.push(`Price ${price} is outside allowed range [${symbolInfo.minPrice}, ${symbolInfo.maxPrice}]`);
    }

    // Check quantity limits
    if (quantity < symbolInfo.minQty || quantity > symbolInfo.maxQty) {
      errors.push(`Quantity ${quantity} is outside allowed range [${symbolInfo.minQty}, ${symbolInfo.maxQty}]`);
    }

    // Check minimum notional
    const notional = quantity * price;
    if (notional < symbolInfo.minNotional) {
      errors.push(`Order notional ${notional} is below minimum ${symbolInfo.minNotional}`);
    }

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }

  // Clean up all WebSocket connections
  cleanup() {
    for (const [symbol, cleanup] of this.wsConnections) {
      cleanup();
    }
    this.wsConnections.clear();
    this.priceCache.clear();
  }

  // Gracefully close all WebSocket connections
  closeAllConnections() {
    for (const [symbol, cleanup] of this.wsConnections) {
      try {
        cleanup();
      } catch (error) {
        // Error closing connection
      }
    }
    
    this.wsConnections.clear();
  }

  // Cancel all open orders for a user on a specific symbol
  async cancelAllOpenOrders(userId, symbol, isTestMode = true) {
    try {
      const client = await this.getUserClient(userId, isTestMode);
      if (!client) throw new Error('Binance client not initialized');

      // Get all open orders for the symbol
      const openOrders = await client.openOrders({
        symbol: symbol.toUpperCase()
      });

      const results = [];
      let cancelledCount = 0;

      // Cancel each open order
      for (const order of openOrders) {
        try {
          const result = await client.cancelOrder({
            symbol: order.symbol,
            orderId: order.orderId
          });
          
          results.push({
            success: true,
            orderId: order.orderId,
            clientOrderId: order.clientOrderId,
            result: result
          });
          cancelledCount++;
        } catch (error) {
          results.push({
            success: false,
            orderId: order.orderId,
            clientOrderId: order.clientOrderId,
            error: error.message
          });
        }
      }

      return {
        success: true,
        total_orders: openOrders.length,
        cancelled_orders: cancelledCount,
        results: results
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        total_orders: 0,
        cancelled_orders: 0
      };
    }
  }

  // Cancel all open orders for a user across all symbols
  async cancelAllUserOrders(userId, isTestMode = true) {
    try {
      const client = await this.getUserClient(userId, isTestMode);
      if (!client) throw new Error('Binance client not initialized');

      // Get all open orders for all symbols
      const allOpenOrders = await client.openOrders();

      const results = [];
      let cancelledCount = 0;

      // Cancel each open order
      for (const order of allOpenOrders) {
        try {
          const result = await client.cancelOrder({
            symbol: order.symbol,
            orderId: order.orderId
          });
          
          results.push({
            success: true,
            symbol: order.symbol,
            orderId: order.orderId,
            clientOrderId: order.clientOrderId,
            result: result
          });
          cancelledCount++;
        } catch (error) {
          results.push({
            success: false,
            symbol: order.symbol,
            orderId: order.orderId,
            clientOrderId: order.clientOrderId,
            error: error.message
          });
        }
      }

      return {
        success: true,
        total_orders: allOpenOrders.length,
        cancelled_orders: cancelledCount,
        results: results
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        total_orders: 0,
        cancelled_orders: 0
      };
    }
  }
}

export default new BinanceService();