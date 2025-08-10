const WebSocket = require('ws');
const EventEmitter = require('events');
const crypto = require('crypto');

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
    console.log('WebSocket Manager initialized successfully');
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
      console.log('Shared Binance WebSocket connected');
      
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
      console.log('Shared Binance WebSocket disconnected');
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
    console.log(`Reconnecting shared WS in ${delay}ms (attempt ${this.sharedReconnectAttempts})`);
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
        console.log(`Cleaning up stale connection for user ${userId}`);
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
  async createUserConnection(userId, apiKey, secretKey) {
    try {
      // Close existing connection if any
      if (this.userConnections.has(userId)) {
        this.closeUserConnection(userId);
      }

      // Create listen key for user stream
      const listenKey = await this.createListenKey(apiKey, secretKey);
      
      // Create WebSocket connection
      const wsUrl = `wss://stream.binance.com:9443/ws/${listenKey}`;
      const ws = new WebSocket(wsUrl);
      
      // Store connection
      this.userConnections.set(userId, {
        ws,
        apiKey,
        secretKey,
        listenKey,
        lastPing: Date.now(),
        symbols: new Set(),
        isConnected: false
      });

      // Setup connection handlers
      this.setupConnectionHandlers(userId, ws);
      
      console.log(`WebSocket connection created for user ${userId}`);
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
      console.log(`WebSocket connected for user ${userId}`);
      connection.isConnected = true;
      // reset per-user reconnect attempts
      this.reconnectAttempts.set(userId, 0);
      
      // Subscribe to user's symbols
      this.subscribeToUserSymbols(userId);
    });

    ws.on('message', (data) => {
      connection.lastActivity = Date.now();
      
      try {
        const message = JSON.parse(data);
        this.handleWebSocketMessage(userId, message);
      } catch (error) {
        console.error(`Error parsing WebSocket message for user ${userId}:`, error.message);
      }
    });

    ws.on('close', () => {
      console.log(`WebSocket disconnected for user ${userId}`);
      connection.isConnected = false;
      this.handleReconnection(userId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error.message);
      connection.isConnected = false;
    });

    // Set up ping/pong to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        connection.lastPing = Date.now();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000); // Ping every 30 seconds
  }

  // Handle WebSocket messages
  handleWebSocketMessage(userId, message) {
    // Handle 24hr ticker data
    if (message.e === '24hrTicker') {
      // Update price data
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
      // Handle kline (candlestick) data
      const kline = message.k;
      this.updatePriceData(kline.s, {
        symbol: kline.s,
        price: parseFloat(kline.c),
        open: parseFloat(kline.o),
        high: parseFloat(kline.h),
        low: parseFloat(kline.l),
        volume: parseFloat(kline.v),
        timestamp: kline.T
      });
    } else if (message.e === 'executionReport') {
      // Handle order execution reports
      this.emit('orderUpdate', {
        userId,
        orderId: message.i,
        symbol: message.s,
        side: message.S,
        status: message.X,
        executedQty: parseFloat(message.z),
        price: parseFloat(message.p)
      });
    }
  }

  // Update price data and emit events
  updatePriceData(symbol, data) {
    this.priceStreams.set(symbol, data);
    this.emit('priceUpdate', { symbol, data });
  }

  // Subscribe to a symbol
  async subscribeToSymbol(userId, symbol) {
    const connection = this.userConnections.get(userId);
    // Add to shared tracking
    const users = this.symbolUsers.get(symbol) || new Set();
    if (userId) users.add(userId);
    this.symbolUsers.set(symbol, users);
    
    // Ensure shared connection is available
    this.ensureSharedConnection();
    
    // If already subscribed, nothing more to do
    if (this.subscribedSymbols.has(symbol)) {
      return true;
    }

    this.subscribedSymbols.add(symbol);

    if (this.sharedConnection && this.sharedConnection.readyState === WebSocket.OPEN) {
      try {
        // Subscribe to ticker and kline data
        const tickerParam = `${symbol.toLowerCase()}@ticker`;
        const klineParam = `${symbol.toLowerCase()}@kline_1m`;
        
        this.sharedConnection.send(JSON.stringify({
          method: 'SUBSCRIBE',
          params: [tickerParam, klineParam],
          id: Date.now()
        }));
        
        console.log(`Subscribed to ${symbol} ticker and kline data via shared connection`);
        return true;
      } catch (err) {
        console.warn(`Shared subscribe failed for ${symbol}: ${err.message}`);
        return false;
      }
    }
    return false;
  }
  
  // Unsubscribe from a symbol
  unsubscribeSymbol(symbol, userId = null) {
    if (userId) {
      const users = this.symbolUsers.get(symbol);
      if (users) {
        users.delete(userId);
        if (users.size === 0) this.symbolUsers.delete(symbol);
      }
    }

    if (this.symbolUsers.has(symbol)) return; // still needed
    if (!this.subscribedSymbols.has(symbol)) return;

    this.subscribedSymbols.delete(symbol);
    if (this.sharedConnection && this.sharedConnection.readyState === WebSocket.OPEN) {
      try {
        const tickerParam = `${symbol.toLowerCase()}@ticker`;
        const klineParam = `${symbol.toLowerCase()}@kline_1m`;
        
        this.sharedConnection.send(JSON.stringify({
          method: 'UNSUBSCRIBE',
          params: [tickerParam, klineParam],
          id: Date.now()
        }));
        
        console.log(`Unsubscribed from ${symbol} shared streams`);
      } catch (err) {
        console.warn(`Shared unsubscribe failed for ${symbol}: ${err.message}`);
      }
    }
  }

  // Subscribe to user's symbols (when user connection opens)
  subscribeToUserSymbols(userId) {
    const connection = this.userConnections.get(userId);
    if (!connection) return;

    // Subscribe to each symbol the user is interested in
    connection.symbols.forEach(symbol => {
      this.subscribeToSymbol(userId, symbol);
    });
  }

  // Get cached price data for a symbol
  getCachedPrice(symbol) {
    return this.priceStreams.get(symbol.toUpperCase());
  }

  // Handle reconnection for a user
  async handleReconnection(userId) {
    const attempts = this.reconnectAttempts.get(userId) || 0;

    if (attempts < this.maxReconnectAttempts) {
      this.reconnectAttempts.set(userId, attempts + 1);

      console.log(`Attempting to reconnect user ${userId} (attempt ${attempts + 1})`);

      setTimeout(async () => {
        const connection = this.userConnections.get(userId);
        if (connection) {
          await this.createUserConnection(userId, connection.apiKey, connection.secretKey);
        }
      }, this.reconnectDelay * Math.pow(2, attempts)); // Exponential backoff
    } else {
      console.error(`Max reconnection attempts reached for user ${userId}`);
      this.userConnections.delete(userId);
      this.reconnectAttempts.set(userId, 0);
    }
  }

  // duplicate closeUserConnection removed (handled earlier in class)

  // Create listen key for user data stream
  async createListenKey(apiKey, secretKey) {
    const axios = require('axios');
    
    try {
      const response = await axios.post(
        'https://api.binance.com/api/v3/userDataStream',
        null, // No data/parameters for this endpoint
        {
          headers: {
            'X-MBX-APIKEY': apiKey
          }
        }
      );
      
      return response.data.listenKey;
    } catch (error) {
      throw new Error(`Failed to create listen key: ${error.response?.data?.msg || error.message}`);
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
    console.log('Cleaning up WebSocket connections...');
    this.userConnections.forEach((connection, userId) => {
      this.closeUserConnection(userId);
    });
    this.priceStreams.clear();
    // Reset reconnection tracking structures
    this.reconnectAttempts = new Map();
    this.sharedReconnectAttempts = 0;
  }
}

// Create singleton instance
const webSocketManager = new WebSocketManager();

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