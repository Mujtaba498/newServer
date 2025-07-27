import { body, validationResult } from 'express-validator';

// Email validation
const validateEmail = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage('Email must be less than 100 characters')
];

// Name validation
const validateName = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Name must be between 1 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces')
];

// OTP validation
const validateOTP = [
  body('code')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be exactly 6 digits')
    .isNumeric()
    .withMessage('OTP must contain only numbers')
];

// Purpose validation
const validatePurpose = [
  body('purpose')
    .optional()
    .isIn(['login', 'signup', 'password_reset'])
    .withMessage('Invalid purpose. Must be login, signup, or password_reset')
];

// Binance API key validation
const validateBinanceKeys = [
  body('api_key')
    .isString()
    .notEmpty()
    .withMessage('API key is required')
    .isLength({ min: 10, max: 200 })
    .withMessage('API key must be between 10 and 200 characters'),
  body('secret_key')
    .isString()
    .notEmpty()
    .withMessage('Secret key is required')
    .isLength({ min: 10, max: 200 })
    .withMessage('Secret key must be between 10 and 200 characters'),
  body('key_type')
    .isString()
    .isIn(['test', 'live'])
    .withMessage('Key type must be either "test" or "live"')
];

// Key type validation
const validateKeyType = [
  body('key_type')
    .optional()
    .isString()
    .isIn(['test', 'live'])
    .withMessage('Key type must be either "test" or "live"')
];

// Combined validations for different endpoints
const validateSendOTP = [
  ...validateEmail,
  ...validateName
];

const validateVerifyOTP = [
  ...validateEmail,
  ...validateOTP,
  ...validateName
];

const validateUpdateProfile = [
  ...validateName
];

// Rate limiting validation
const validateRateLimit = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

export {
  validateSendOTP,
  validateVerifyOTP,
  validateUpdateProfile,
  validateRateLimit,
  validateEmail,
  validateName,
  validateOTP,
  validatePurpose,
  validateBinanceKeys,
  validateKeyType
}; 