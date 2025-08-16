const WebSocket = require('ws');
const EventEmitter = require('events');
const crypto = require('crypto');
const axios = require('axios');

class WebSocketManager extends EventEmitter {
  constructor() {
    super();
    // NEW: Single shared WebSocket for all symbols
    this.sharedConnection = null;
    this.connectionStatus = 'disconnected'; // disconnected, connecting, connected
    this.reconnectAttempts = new Map();
    // Shared connection reconnect counter
    this.sharedReconnectAttempts = 0;
    
    // Symbol subscription management
    this.subscribedSymbols = new Set(); // symbols we're subscribed to
    this.symbolUsers = new Map(); // symbol -> Set of userIds interested
    this.priceStreams = new Map(); // symbol -> latest price data
    
    // Legacy user connections (keep for backward compatibility)
    this.userConnections = new Map(); // userId -> WebSocket connection
    this.userReconnectAttempts = new Map(); // userId -> attempt count
    
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000; // 5 seconds
    this.pingInterval = null;
    this.initialized = false;
  }

  // Initialize the WebSocket manager
  initialize() {
    if (this.initialized) {
      return;
    }
    
    console.log('WebSocket Manager initializing...');
    this.initialized = true;
    
    // Set up periodic cleanup of stale connections (legacy user connections)
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 5 * 60 * 1000); // Every 5 minutes
    
    // Initialize shared connection lazily on first subscribe
    // console.log('WebSocket Manager initialized successfully');
  }

  // Create or ensure shared connection
  ensureSharedConnection() {
    if (this.connectionStatus === 'connected') return true;
    if (this.connectionStatus === 'connecting') return false;
    
    this.connectionStatus = 'connecting';
    const wsUrl = 'wss://stream.binance.com:9443/ws';
    const ws = new WebSocket(wsUrl);
    this.sharedConnection = ws;
    
    ws.on('open', () => {
      this.connectionStatus = 'connected';
      this.sharedReconnectAttempts = 0;
      // console.log('Shared Binance WebSocket connected');
      
      // Resubscribe to existing symbols
      if (this.subscribedSymbols.size > 0) {
        const params = Array.from(this.subscribedSymbols).map(s => `${s.toLowerCase()}@ticker`);
        ws.send(JSON.stringify({ method: 'SUBSCRIBE', params, id: Date.now() }));
        // Also subscribe to 1m klines for richer data
        const klineParams = Array.from(this.subscribedSymbols).map(s => `${s.toLowerCase()}@kline_1m`);
        ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: klineParams, id: Date.now() + 1 }));
      }
      
      // Start ping to keep alive
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 30000);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleSharedMessage(message);
      } catch (err) {
        console.error('Error parsing shared WS message:', err.message);
      }
    });
    
    ws.on('close', () => {
      // console.log('Shared Binance WebSocket disconnected');
      this.connectionStatus = 'disconnected';
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      this.scheduleSharedReconnect();
    });
    
    ws.on('error', (err) => {
      console.error('Shared Binance WebSocket error:', err.message);
    });
    
    return false; // connection in progress
  }

  scheduleSharedReconnect() {
    if (this.connectionStatus === 'connected') return;
    if (this.sharedReconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max shared WS reconnect attempts reached');
      return;
    }
    const delay = this.reconnectDelay * Math.pow(2, this.sharedReconnectAttempts);
    this.sharedReconnectAttempts += 1;
    // console.log(`Reconnecting shared WS in ${delay}ms (attempt ${this.sharedReconnectAttempts})`);
    setTimeout(() => this.ensureSharedConnection(), delay);
  }

  handleSharedMessage(message) {
    if (message.e === '24hrTicker') {
      this.updatePriceData(message.s, {
        symbol: message.s,
        price: parseFloat(message.c),
        priceChange: parseFloat(message.P),
        volume: parseFloat(message.v),
        high: parseFloat(message.h),
        low: parseFloat(message.l),
        timestamp: message.E
      });
    } else if (message.e === 'kline') {
      const k = message.k;
      this.updatePriceData(k.s, {
        symbol: k.s,
        price: parseFloat(k.c),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        volume: parseFloat(k.v),
        timestamp: k.T
      });
    }
  }

  // Clean up stale connections
  cleanupStaleConnections() {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes
    
    for (const [userId, connection] of this.userConnections.entries()) {
      if (now - connection.lastActivity > staleThreshold) {
        // console.log(`Cleaning up stale connection for user ${userId}`);
        this.closeUserConnection(userId);
      }
    }
  }

  // Close user connection
  closeUserConnection(userId) {
    const connection = this.userConnections.get(userId);
    if (connection && connection.ws) {
      connection.ws.close();
    }
    this.userConnections.delete(userId);
    this.reconnectAttempts.set(userId, 0);
  }

  // Create WebSocket connection for a user
  async createUserConnection(userId, apiKey, secretKey, proxy = null) {
    try {
      // Close existing connection if any
      if (this.userConnections.has(userId)) {
        this.closeUserConnection(userId);
      }

      // Create listen key for user stream
      const listenKey = await this.createListenKey(apiKey, secretKey, proxy);
      
      // Create WebSocket connection
      const wsUrl = `wss://stream.binance.com:9443/ws/${listenKey}`;
      const wsOptions = proxy ? { agent: proxy.httpsAgent } : {};
      const ws = new WebSocket(wsUrl, wsOptions);
      
      // Store connection
      this.userConnections.set(userId, {
        ws,
        apiKey,
        secretKey,
        listenKey,
        lastPing: Date.now(),
        lastActivity: Date.now(),
        symbols: new Set(),
        isConnected: false,
        proxy
      });

      // Setup connection handlers
      this.setupConnectionHandlers(userId, ws);
      
      // console.log(`WebSocket connection created for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`Failed to create WebSocket connection for user ${userId}:`, error.message);
      return false;
    }
  }

  // Setup WebSocket event handlers
  setupConnectionHandlers(userId, ws) {
    const connection = this.userConnections.get(userId);
    
    ws.on('open', () => {
      // console.log(`WebSocket connected for user ${userId}`);
      connection.isConnected = true;
      // reset per-user reconnect attempts
      this.reconnectAttempts.set(userId, 0);
      
      // Subscribe to user's symbols
      this.subscribeToUserSymbols(userId);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        connection.lastActivity = Date.now();
        this.handleWebSocketMessage(userId, message);
      } catch (error) {
        console.error(`Error parsing WebSocket message for user ${userId}:`, error.message);
      }
    });

    ws.on('close', () => {
      // console.log(`WebSocket disconnected for user ${userId}`);
      connection.isConnected = false;
      
      // Auto-reconnect logic (optional)
      const attempts = this.reconnectAttempts.get(userId) || 0;
      if (attempts < this.maxReconnectAttempts) {
        this.reconnectAttempts.set(userId, attempts + 1);
        setTimeout(() => {
          this.handleReconnection(userId);
        }, this.reconnectDelay);
      }
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error.message);
      connection.isConnected = false;
    });

    // Set up ping-pong for connection health
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        connection.lastPing = Date.now();
      }
    }, 30000);
  }

  // Handle incoming WebSocket messages
  handleWebSocketMessage(userId, message) {
    // Handle order updates and account updates
    if (message.e === 'executionReport') {
      // Order execution report
      this.emit('orderUpdate', {
        userId,
        symbol: message.s,
        orderId: message.i,
        clientOrderId: message.c,
        side: message.S,
        orderType: message.o,
        quantity: message.q,
        price: message.p,
        executedQty: message.z,
        status: message.X,
        timestamp: message.T,
        // **NEW: Include commission data for fee tracking**
        commission: parseFloat(message.n || 0),
        commissionAsset: message.N,
        // **NEW: Include executed price for accurate recovery calculations**
        executedPrice: parseFloat(message.L || message.p || 0) // L = last executed price, fallback to order price
      });
    } else if (message.e === 'outboundAccountPosition') {
      // Account balance update
      this.emit('balanceUpdate', {
        userId,
        eventTime: message.E,
        balances: message.B
      });
    }
  }

  // Update price data from shared connection
  updatePriceData(symbol, data) {
    this.priceStreams.set(symbol, data);
  }

  // Subscribe to symbol for a user (enhanced to use shared connection)
  async subscribeToSymbol(userId, symbol) {
    // Ensure shared connection is available
    if (!this.ensureSharedConnection()) {
      // console.log(`Shared connection not ready, will retry for ${symbol}`);
      return false;
    }

    // Add symbol to user's interest
    const connection = this.userConnections.get(userId);
    if (connection) {
      connection.symbols.add(symbol);
    }

    // Subscribe via shared connection if not already subscribed
    if (!this.subscribedSymbols.has(symbol)) {
      this.subscribedSymbols.add(symbol);
      
      if (this.sharedConnection && this.sharedConnection.readyState === WebSocket.OPEN) {
        try {
          // Subscribe to ticker and kline streams
          this.sharedConnection.send(JSON.stringify({
            method: 'SUBSCRIBE',
            params: [`${symbol.toLowerCase()}@ticker`, `${symbol.toLowerCase()}@kline_1m`],
            id: Date.now()
          }));
          // console.log(`Subscribed to ${symbol} ticker and kline data via shared connection`);
        } catch (err) {
          console.warn(`Shared subscribe failed for ${symbol}: ${err.message}`);
        }
      }
    }
  }
  
  // Unsubscribe from symbol
  unsubscribeSymbol(symbol, userId = null) {
    if (userId) {
      // Remove from specific user's interests
      const connection = this.userConnections.get(userId);
      if (connection) {
        connection.symbols.delete(symbol);
      }
      
      // Check if any other user is still interested
      let stillNeeded = false;
      for (const [, conn] of this.userConnections) {
        if (conn.symbols.has(symbol)) {
          stillNeeded = true;
          break;
        }
      }
      
      if (!stillNeeded) {
        // Unsubscribe from shared connection
        this.subscribedSymbols.delete(symbol);
        this.priceStreams.delete(symbol);
        
        if (this.sharedConnection && this.sharedConnection.readyState === WebSocket.OPEN) {
          this.sharedConnection.send(JSON.stringify({
            method: 'UNSUBSCRIBE',
            params: [`${symbol.toLowerCase()}@ticker`, `${symbol.toLowerCase()}@kline_1m`],
            id: Date.now()
          }));
          // console.log(`Unsubscribed from ${symbol} shared streams`);
        }
      }
    }
  }

  // Subscribe to all symbols for a user
  subscribeToUserSymbols(userId) {
    const connection = this.userConnections.get(userId);
    if (connection && connection.symbols.size > 0) {
      connection.symbols.forEach(symbol => {
        this.subscribeToSymbol(userId, symbol);
      });
    }
  }

  // Get cached price data
  getCachedPrice(symbol) {
    return this.priceStreams.get(symbol);
  }

  // Handle reconnection for a specific user
  async handleReconnection(userId) {
    const connection = this.userConnections.get(userId);
    if (!connection) return false;

    try {
      // console.log(`Attempting to reconnect user ${userId}`);
      
      // Create new connection
      const success = await this.createUserConnection(
        userId,
        connection.apiKey,
        connection.secretKey,
        connection.proxy
      );
      
      if (success) {
        // console.log(`Successfully reconnected user ${userId}`);
        return true;
      }
    } catch (error) {
      console.error(`Reconnection failed for user ${userId}:`, error.message);
    }
    
    return false;
  }

  // Create listen key for user data stream
  async createListenKey(apiKey, secretKey, proxy = null) {
    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
      
      // Create axios instance with proxy support if provided
      const axiosConfig = {
        headers: {
          'X-MBX-APIKEY': apiKey
        },
        timeout: 10000
      };
      
      if (proxy) {
        axiosConfig.httpAgent = proxy.httpAgent;
        axiosConfig.httpsAgent = proxy.httpsAgent;
        axiosConfig.proxy = false; // Disable axios proxy in favor of agent
      }
      
      const axiosInstance = axios.create(axiosConfig);
      
      const response = await axiosInstance.post(
        'https://api.binance.com/api/v3/userDataStream',
        null,
        {
          params: {
            timestamp,
            signature
          }
        }
      );
      
      return response.data.listenKey;
    } catch (error) {
      const status = error.response?.status;
      if (status) {
        console.error(`Failed to create listen key (status ${status}):`, error.response?.data?.msg || error.message);
      } else {
        console.error('Failed to create listen key:', error.message);
      }
      try {
        // Inform proxy manager if available to handle cooldowns/rotation
        const proxyManager = require('./proxyManager');
        // We don't have userId here directly, so mark a generic event to trigger cooldown on current assignment if any
        proxyManager.reportEvent('global', { type: 'rest-error', status: status || 'error' });
      } catch (_) {}
      throw error;
    }
  }

  // Check if user is connected
  isUserConnected(userId) {
    const connection = this.userConnections.get(userId);
    return connection && connection.isConnected;
  }

  // Get connection statistics
  getConnectionStats() {
    const stats = {
      totalConnections: this.userConnections.size,
      activeConnections: 0,
      totalSymbols: this.priceStreams.size,
      users: []
    };

    this.userConnections.forEach((connection, userId) => {
      if (connection.isConnected) {
        stats.activeConnections++;
      }
      
      stats.users.push({
        userId,
        connected: connection.isConnected,
        symbols: Array.from(connection.symbols),
        lastPing: connection.lastPing
      });
    });

    return stats;
  }

  // Cleanup all connections
  cleanup() {
    // console.log('Cleaning up WebSocket connections...');
    this.userConnections.forEach((connection, userId) => {
      this.closeUserConnection(userId);
    });
    this.priceStreams.clear();
    // Reset reconnection tracking structures
    this.reconnectAttempts = new Map();
    this.sharedReconnectAttempts = 0;
    
    // Close shared connection
    if (this.sharedConnection) {
      this.sharedConnection.close();
      this.sharedConnection = null;
    }
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Initialize order update listener for immediate opposite order placement
  initializeOrderUpdateListener() {
    this.on('orderUpdate', async (data) => {
      const { userId, symbol, orderId, side, executedQty, status, price, executedPrice, commission, commissionAsset } = data;
      
      if (status === 'FILLED') {
        console.log(`🔔 WebSocket FILLED order detected: ${side} ${executedQty} ${symbol} @ ${price} (ID: ${orderId})`);
        
        // Import gridBotService here to avoid circular dependency
        const GridBotService = require('./gridBotService');
        const gridBotService = new GridBotService();
        
        try {
          await gridBotService.handleWebSocketFilledOrder(
            userId, 
            symbol, 
            orderId, 
            side, 
            executedQty, 
            price, 
            executedPrice, 
            commission, 
            commissionAsset
          );
        } catch (error) {
          console.error(`Error handling filled order ${orderId}:`, error.message);
        }
      }
    });
    
    console.log('🎧 WebSocket orderUpdate listener initialized for immediate opposite order placement');
  }
}

// Create singleton instance
const webSocketManager = new WebSocketManager();

// Initialize the WebSocket manager
webSocketManager.initialize();

// Graceful shutdown handlers
process.on('SIGINT', () => {
  webSocketManager.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  webSocketManager.cleanup();
  process.exit(0);
});

module.exports = webSocketManager;