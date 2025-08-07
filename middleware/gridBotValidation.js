const { body, param, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
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

const createGridBotValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Bot name must be between 1 and 50 characters'),
  body('symbol')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Symbol must be between 3 and 20 characters')
    .matches(/^[A-Za-z0-9]+$/)
    .withMessage('Symbol must contain only letters and numbers'),
  body('investmentAmount')
    .isFloat({ min: 1 })
    .withMessage('Investment amount must be at least 1'),
  body('useAI')
    .optional()
    .isBoolean()
    .withMessage('useAI must be a boolean value'),
  // Make grid parameters optional when useAI is true
  body('upperPrice')
    .if((value, { req }) => !req.body.useAI)
    .isFloat({ min: 0.00000001 })
    .withMessage('Upper price must be a positive number'),
  body('lowerPrice')
    .if((value, { req }) => !req.body.useAI)
    .isFloat({ min: 0.00000001 })
    .withMessage('Lower price must be a positive number'),
  body('gridLevels')
    .if((value, { req }) => !req.body.useAI)
    .isInt({ min: 2, max: 100 })
    .withMessage('Grid levels must be between 2 and 100'),
  body('profitPerGrid')
    .if((value, { req }) => !req.body.useAI)
    .isFloat({ min: 0.1, max: 50 })
    .withMessage('Profit per grid must be between 0.1% and 50%'),
  // Custom validation to ensure upper price > lower price (only when not using AI)
  body('upperPrice').custom((value, { req }) => {
    if (!req.body.useAI && parseFloat(value) <= parseFloat(req.body.lowerPrice)) {
      throw new Error('Upper price must be greater than lower price');
    }
    return true;
  }),
  // Custom validation for reasonable price range (only when not using AI)
  body('upperPrice').custom((value, { req }) => {
    if (req.body.useAI) return true; // Skip validation when using AI
    
    const upperPrice = parseFloat(value);
    const lowerPrice = parseFloat(req.body.lowerPrice);
    const priceRange = ((upperPrice - lowerPrice) / lowerPrice) * 100;
    
    if (priceRange < 1) {
      throw new Error('Price range should be at least 1% for effective grid trading');
    }
    
    if (priceRange > 1000) {
      throw new Error('Price range is too large (max 1000%)');
    }
    
    return true;
  }),
  // Custom validation for grid density (only when not using AI)
  body('gridLevels').custom((value, { req }) => {
    if (req.body.useAI) return true; // Skip validation when using AI
    
    const gridLevels = parseInt(value);
    const upperPrice = parseFloat(req.body.upperPrice);
    const lowerPrice = parseFloat(req.body.lowerPrice);
    const priceStep = (upperPrice - lowerPrice) / (gridLevels - 1);
    const stepPercentage = (priceStep / lowerPrice) * 100;
    
    if (stepPercentage < 0.1) {
      throw new Error('Grid levels are too dense. Minimum step should be 0.1%');
    }
    
    return true;
  }),
  handleValidationErrors
];

const gridBotIdValidation = [
  param('botId')
    .isMongoId()
    .withMessage('Invalid bot ID format'),
  handleValidationErrors
];

const symbolValidation = [
  param('symbol')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Symbol must be between 3 and 20 characters')
    .matches(/^[A-Za-z0-9]+$/)
    .withMessage('Symbol must contain only letters and numbers'),
  handleValidationErrors
];

const updateGridBotValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Bot name must be between 1 and 50 characters'),
  body('profitPerGrid')
    .optional()
    .isFloat({ min: 0.1, max: 50 })
    .withMessage('Profit per grid must be between 0.1% and 50%'),
  handleValidationErrors
];

module.exports = {
  createGridBotValidation,
  gridBotIdValidation,
  symbolValidation,
  updateGridBotValidation
};