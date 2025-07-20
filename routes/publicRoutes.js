// src/routes/publicRoutes.js

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const publicController = require('../controllers/publicController');
const { validateResult } = require('../utils/validationUtils');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');

// CSRF protection for POST requests
const csrfProtection = csrf({ cookie: true });

// Apply specific rate limiting to public viewing endpoints
const viewRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply stricter rate limiting to comment submission endpoints
const commentRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // limit each IP to 20 comment submissions per hour
  message: {
    success: false,
    message: 'Too many comment submissions from this IP, please try again after an hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation for public tokens
const requestTokenValidation = [
  check('publicToken')
    .notEmpty().withMessage('Public token is required')
    .isString().withMessage('Public token must be a string')
    .isLength({ min: 24, max: 24 }).withMessage('Invalid public token format'),
  validateResult
];

const maintenanceTokenValidation = [
  check('publicToken')
    .notEmpty().withMessage('Public token is required')
    .isString().withMessage('Public token must be a string')
    .isLength({ min: 36, max: 36 }).withMessage('Invalid public token format (UUID expected)'),
  validateResult
];

// Validation for comment submissions
const commentValidation = [
  check('message')
    .notEmpty().withMessage('Comment message is required')
    .isString().withMessage('Comment message must be text')
    .trim()
    .isLength({ min: 1, max: 2000 }).withMessage('Comment must be between 1 and 2000 characters'),
  
  check('externalUserName')
    .notEmpty().withMessage('Your name is required')
    .isString().withMessage('Name must be text')
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Name cannot exceed 100 characters')
    .escape(), // Prevent XSS
  
  check('externalUserEmail')
    .optional()
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  
  validateResult
];

// Public routes for requests
router.get(
  '/requests/:publicToken',
  viewRateLimiter,
  requestTokenValidation,
  publicController.getPublicRequest
);

router.post(
  '/requests/:publicToken/comments',
  commentRateLimiter,
  csrfProtection,
  [
    ...requestTokenValidation,
    ...commentValidation
  ],
  publicController.addPublicCommentToRequest
);

// Public routes for scheduled maintenance
router.get(
  '/scheduled-maintenances/:publicToken',
  viewRateLimiter,
  maintenanceTokenValidation,
  publicController.getPublicScheduledMaintenance
);

router.post(
  '/scheduled-maintenances/:publicToken/comments',
  commentRateLimiter,
  csrfProtection,
  [
    ...maintenanceTokenValidation,
    ...commentValidation
  ],
  publicController.addPublicCommentToScheduledMaintenance
);

module.exports = router;