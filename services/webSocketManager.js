const WebSocket = require('ws');
const EventEmitter = require('events');
const crypto = require('crypto');

class WebSocketManager extends EventEmitter {
  constructor() {
    super();
    this.userConnections = new Map(); // userId -> WebSocket connection
    this.priceStreams = new Map(); // symbol -> price data
    this.reconnectAttempts = new Map(); // userId -> attempt count
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000; // 5 seconds
    this.initialized = false;
  }

  // Initialize the WebSocket manager
  initialize() {
    if (this.initialized) {
      return;
    }
    
    console.log('WebSocket Manager initializing...');
    this.initialized = true;
    
    // Set up periodic cleanup of stale connections
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 5 * 60 * 1000); // Every 5 minutes
    
    console.log('WebSocket Manager initialized successfully');
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
    this.reconnectAttempts.delete(userId);
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
      this.reconnectAttempts.delete(userId);
      
      // Subscribe to user's symbols
      this.subscribeToUserSymbols(userId);
    });

    ws.on('message', (data) => {
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

    // Setup ping/pong to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        connection.lastPing = Date.now();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000); // Ping every 30 seconds
  }

  // Handle incoming WebSocket messages
  handleWebSocketMessage(userId, message) {
    // Handle different message types
    if (message.e === '24hrTicker') {
      // 24hr ticker statistics
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
      // Kline/candlestick data
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
      // Order execution updates
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

  // Update price data cache
  updatePriceData(symbol, data) {
    this.priceStreams.set(symbol, data);
    this.emit('priceUpdate', { symbol, data });
  }

  // Subscribe user to symbol streams
  async subscribeToSymbol(userId, symbol) {
    const connection = this.userConnections.get(userId);
    if (!connection || !connection.isConnected) {
      return false;
    }

    try {
      // Add symbol to user's subscription list
      connection.symbols.add(symbol.toLowerCase());
      
      // Subscribe to ticker and kline streams
      const subscribeMessage = {
        method: 'SUBSCRIBE',
        params: [
          `${symbol.toLowerCase()}@ticker`,
          `${symbol.toLowerCase()}@kline_1m`
        ],
        id: Date.now()
      };
      
      connection.ws.send(JSON.stringify(subscribeMessage));
      console.log(`Subscribed user ${userId} to ${symbol}`);
      return true;
    } catch (error) {
      console.error(`Failed to subscribe user ${userId} to ${symbol}:`, error.message);
      return false;
    }
  }

  // Subscribe to all symbols for a user
  subscribeToUserSymbols(userId) {
    const connection = this.userConnections.get(userId);
    if (!connection) return;

    // Subscribe to each symbol the user is interested in
    connection.symbols.forEach(symbol => {
      this.subscribeToSymbol(userId, symbol);
    });
  }

  // Get cached price data
  getCachedPrice(symbol) {
    return this.priceStreams.get(symbol.toUpperCase());
  }

  // Handle reconnection logic
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
      this.reconnectAttempts.delete(userId);
    }
  }

  // Close user connection
  closeUserConnection(userId) {
    const connection = this.userConnections.get(userId);
    if (connection) {
      if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.close();
      }
      this.userConnections.delete(userId);
      console.log(`Closed WebSocket connection for user ${userId}`);
    }
  }

  // Create listen key for user stream
  async createListenKey(apiKey, secretKey) {
    const axios = require('axios');
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(queryString)
      .digest('hex');

    try {
      const response = await axios.post(
        'https://api.binance.com/api/v3/userDataStream',
        null,
        {
          headers: {
            'X-MBX-APIKEY': apiKey
          },
          params: {
            timestamp,
            signature
          }
        }
      );
      
      return response.data.listenKey;
    } catch (error) {
      throw new Error(`Failed to create listen key: ${error.message}`);
    }
  }

  // Check if user has active connection
  isUserConnected(userId) {
    const connection = this.userConnections.get(userId);
    return connection && connection.isConnected;
  }

  // Get connection stats
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
        isConnected: connection.isConnected,
        symbolCount: connection.symbols.size,
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
    this.reconnectAttempts.clear();
  }
}

// Singleton instance
const webSocketManager = new WebSocketManager();

// Graceful shutdown
process.on('SIGINT', () => {
  webSocketManager.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  webSocketManager.cleanup();
  process.exit(0);
});

module.exports = webSocketManager;