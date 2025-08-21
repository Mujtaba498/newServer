const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { PORT, FRONTEND_URL, validateEnvVars } = require('./config/env');
const connectDB = require('./config/database');
const webSocketManager = require('./services/webSocketManager');
const recoveryService = require('./services/recoveryService');
const authRoutes = require('./routes/auth');
const gridBotRoutes = require('./routes/gridBot');
const adminRoutes = require('./routes/admin');
const subscriptionRoutes = require('./routes/subscription');
const paymentRoutes = require('./routes/payment');

validateEnvVars();

const app = express();

connectDB();

// Initialize WebSocket Manager
webSocketManager.initialize();
webSocketManager.initializeOrderUpdateListener();
console.log('WebSocket Manager and order update listener initialized');

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(morgan('combined'));
app.use(globalLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'GetFork Backend is running successfully!, proxy fix applied',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/grid-bots', gridBotRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/payments', paymentRoutes);

app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl
  });
});

app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => err.message);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors
    });
  }
  
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`
    });
  }
  
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
  
  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }
  
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Internal Server Error'
  });
});

// Run recovery on startup
connectDB().then(async () => {
  console.log('🔄 Running bot recovery check...');
  await recoveryService.performRecovery();
  console.log('✅ Recovery check completed');
}).catch(err => {
  console.error('❌ Failed to run recovery:', err);
});

const server = app.listen(PORT, () => {
  console.log(`🚀 GetFork Backend Server running on port ${PORT}`);
  console.log(`📊 Health check available at: http://localhost:${PORT}/health`);
  console.log(`🔐 Auth endpoints available at: http://localhost:${PORT}/api/auth`);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  server.close(() => {
    webSocketManager.cleanup();
    process.exit(1);
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  webSocketManager.cleanup();
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    webSocketManager.cleanup();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    webSocketManager.cleanup();
    process.exit(0);
  });
});

module.exports = app;
