// Input validation middleware using express-validator

const { body, param, validationResult } = require('express-validator');

// Example: Validation for creating/updating a Unit
exports.validateUnit = [
  body('unitName')
    .notEmpty().withMessage('Unit name is required')
    .isLength({ max: 100 }).withMessage('Unit name cannot exceed 100 characters'),
  body('floor')
    .optional()
    .isString().withMessage('Floor must be a string'),
  body('details')
    .optional()
    .isLength({ max: 1000 }).withMessage('Details cannot exceed 1000 characters'),
  body('property')
    .notEmpty().withMessage('Property is required')
    .isMongoId().withMessage('Property must be a valid MongoDB ID'),
  body('tenant')
    .optional()
    .isMongoId().withMessage('Tenant must be a valid MongoDB ID'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }
    next();
  }
];

// Example: Validation for creating a Vendor
exports.validateVendor = [
  body('name').notEmpty().withMessage('Vendor name is required'),
  body('phone').notEmpty().withMessage('Vendor phone is required'),
  body('email').isEmail().withMessage('Please enter a valid email address'),
  body('services').isArray({ min: 1 }).withMessage('At least one service is required'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }
    next();
  }
];

// More validators can be added for other models as needed