import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import connectDB from './config/database.js';
import authRoutes from './routes/auth.js';
import aiGridRoutes from './routes/aiGrid.js';
import settingsRoutes from './routes/settings.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import OTP from './models/OTP.js';
import gridBotEngine from './services/gridBotEngine.js';

const app = express();
// Configure trust proxy securely
if (process.env.BEHIND_PROXY === 'true') {
  // Only trust specific proxy IPs from environment
  const trustedProxies = process.env.TRUSTED_PROXIES 
    ? process.env.TRUSTED_PROXIES.split(',').map(ip => ip.trim())
    : ['127.0.0.1', '::1'];
  
  app.set('trust proxy', trustedProxies);
} else {
  // Don't trust any proxies - use direct connection IP
  app.set('trust proxy', false);
}
// Global error handling for unhandled promise rejections and WebSocket errors
process.on('unhandledRejection', (reason, promise) => {
  // Don't exit the process, just handle the error
});

process.on('uncaughtException', (error) => {
  // Don't exit the process for WebSocket errors
  if (error.message && error.message.includes('WebSocket')) {
    return;
  }
  // For other critical errors, you might want to exit
  // process.exit(1);
});

// Handle specific WebSocket errors
process.on('error', (error) => {
  if (error.message && error.message.includes('WebSocket')) {
    // Handle WebSocket errors silently
  } else {
    // Handle other process errors silently
  }
});

// Connect to MongoDB
connectDB();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3005',
  credentials: true,
  optionsSuccessStatus: 200
}));

// Rate limiting
app.use(generalLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Hello, My name is Zubair dev ops',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Time sync endpoint for debugging
app.get('/api/sync-time', async (req, res) => {
  try {
    const { default: binanceService } = await import('./services/binanceService.js');
    await binanceService.syncServerTime();
    
    res.status(200).json({
      success: true,
      message: 'Time synchronized with Binance servers',
      local_time: new Date().toISOString(),
      offset_ms: binanceService.timeOffset,
      synced_time: new Date(binanceService.getSyncedTimestamp()).toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to sync time',
      error: error.message
    });
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/ai-grid', aiGridRoutes);
app.use('/api/settings', settingsRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Crypto Backend API',
    version: '1.0.0',
    documentation: '/api/docs',
    health: '/health'
  });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API Documentation',
    version: '1.0.0',
    baseURL: `${req.protocol}://${req.get('host')}`,
    endpoints: {
      authentication: {
        sendOTP: {
          method: 'POST',
          path: '/api/auth/send-otp',
          description: 'Send OTP for login or signup',
          body: {
            email: 'string (required)',
            name: 'string (optional, required for signup)',
            purpose: 'string (optional: login|signup, default: login)'
          }
        },
        verifyOTP: {
          method: 'POST',
          path: '/api/auth/verify-otp',
          description: 'Verify OTP and complete authentication',
          body: {
            email: 'string (required)',
            code: 'string (required, 6 digits)',
            name: 'string (optional, required for signup)',
            purpose: 'string (optional: login|signup, default: login)'
          }
        },
        getProfile: {
          method: 'GET',
          path: '/api/auth/profile',
          description: 'Get user profile (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          }
        },
        updateProfile: {
          method: 'PUT',
          path: '/api/auth/profile',
          description: 'Update user profile (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          },
          body: {
            name: 'string (optional)'
          }
        },
        logout: {
          method: 'POST',
          path: '/api/auth/logout',
          description: 'Logout user (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          }
        },
        getAuthStatus: {
          method: 'GET',
          path: '/api/auth/status',
          description: 'Get authentication status (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          }
        }
      },
      aiGrid: {
        createBot: {
          method: 'POST',
          path: '/api/ai-grid/create',
          description: 'Create new AI Grid Bot (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          },
          body: {
            symbol: 'string (required, e.g., "BTCUSDT")',
            investment_amount: 'number (required, min: 10, max: 100000)',
            test: 'boolean (optional, default: true) - Use test mode (testnet) if true, live trading if false'
          }
        },
        getBots: {
          method: 'GET',
          path: '/api/ai-grid/bots',
          description: 'Get all user bots (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          },
          query: {
            status: 'string (optional: active|stopped)',
            symbol: 'string (optional)',
            limit: 'number (optional, default: 10)',
            offset: 'number (optional, default: 0)'
          }
        },
        getBotDetails: {
          method: 'GET',
          path: '/api/ai-grid/bots/:botId',
          description: 'Get specific bot details (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          }
        },
        stopBot: {
          method: 'PUT',
          path: '/api/ai-grid/bots/:botId/stop',
          description: 'Stop a running bot (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          }
        },
        getBotPerformance: {
          method: 'GET',
          path: '/api/ai-grid/bots/:botId/performance',
          description: 'Get bot performance metrics (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          }
        },
        getBalance: {
          method: 'GET',
          path: '/api/ai-grid/balance',
          description: 'Get Binance account balance (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          }
        },
        getTradingStats: {
          method: 'GET',
          path: '/api/ai-grid/stats',
          description: 'Get trading statistics (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          }
        },
        previewParameters: {
          method: 'POST',
          path: '/api/ai-grid/preview',
          description: 'Preview AI parameters without creating bot (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          },
          body: {
            symbol: 'string (required)',
            investment_amount: 'number (required)'
          }
        },
        getSymbols: {
          method: 'GET',
          path: '/api/ai-grid/symbols',
          description: 'Get available trading symbols (public)'
        },
        getMarketData: {
          method: 'GET',
          path: '/api/ai-grid/market/:symbol',
          description: 'Get market data for symbol (public)',
          query: {
            interval: 'string (optional, default: "1h")',
            limit: 'number (optional, default: 100)'
          }
        },
        getEngineStatus: {
          method: 'GET',
          path: '/api/ai-grid/engine/status',
          description: 'Get grid bot engine status (protected)',
          headers: {
            Authorization: 'Bearer <token>'
          }
        }
      },
      utility: {
        health: {
          method: 'GET',
          path: '/health',
          description: 'Health check endpoint'
        }
      }
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use((err, req, res, next) => {

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Default error
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Cleanup function for expired OTPs (runs every hour)
const cleanupExpiredOTPs = async () => {
  try {
    const count = await OTP.cleanExpired();
  } catch (error) {
    // Handle cleanup errors silently
  }
};

// Run cleanup every hour
setInterval(cleanupExpiredOTPs, 60 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await gridBotEngine.stop();
    // Also close all WebSocket connections
    const { default: binanceService } = await import('./services/binanceService.js');
    binanceService.closeAllConnections();
  } catch (error) {
    // Handle shutdown errors silently
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
    await gridBotEngine.stop();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📚 API Documentation: http://localhost:${PORT}/api/docs`);
  console.log(`💚 Health Check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Start the grid bot engine
  try {
    await gridBotEngine.start();
    console.log('🤖 Grid Bot Engine started successfully');
  } catch (error) {
    // Handle grid bot engine startup errors silently
  }
  
  // Set up periodic time synchronization with Binance (every 5 minutes)
  const { default: binanceService } = await import('./services/binanceService.js');
  setInterval(async () => {
    try {
      await binanceService.syncServerTime();
    } catch (error) {
      // Handle sync errors silently
    }
  }, 5 * 60 * 1000); // 5 minutes
});

export default app; 
