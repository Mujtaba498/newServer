const dotenv = require('dotenv');

dotenv.config();

const requiredEnvVars = [
  'PORT',
  'MONGODB_URI',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'BREVO_API_KEY',
  'SENDER_EMAIL',
  'SENDER_NAME',
  'FRONTEND_URL'
];

// Optional environment variables for global Binance operations
const optionalEnvVars = [
  'BINANCE_API_KEY',
  'BINANCE_SECRET_KEY'
];

const validateEnvVars = () => {
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('Missing required environment variables:', missingVars.join(', '));
    process.exit(1);
  }
  
  // Check optional variables and warn if missing
  const missingOptionalVars = optionalEnvVars.filter(varName => !process.env[varName]);
  if (missingOptionalVars.length > 0) {
    console.warn('Warning: Missing optional environment variables:', missingOptionalVars.join(', '));
    console.warn('Some features may be limited without these variables.');
  }
};

module.exports = {
  PORT: process.env.PORT || 5000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  SENDER_EMAIL: process.env.SENDER_EMAIL,
  SENDER_NAME: process.env.SENDER_NAME,
  FRONTEND_URL: process.env.FRONTEND_URL,
  BINANCE_API_KEY: process.env.BINANCE_API_KEY,
  BINANCE_SECRET_KEY: process.env.BINANCE_SECRET_KEY,
  PROXY_LIST: process.env.PROXY_LIST,
  validateEnvVars
};