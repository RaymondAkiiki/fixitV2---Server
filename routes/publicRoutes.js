// src/routes/publicRoutes.js

const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController'); // Import controller
const { validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { body, param } = require('express-validator'); // For specific body/param validation

// Public routes (NO authentication required)

/**
 * @route GET /public/requests/:publicToken
 * @desc Get a request via public link
 * @access Public
 */
router.get(
    '/requests/:publicToken',
    [
        // Assuming publicToken for Request is a standard MongoDB ObjectId hex string (24 chars)
        param('publicToken').notEmpty().withMessage('Public token is required.').isString().isLength({ min: 24, max: 24 }).withMessage('Invalid public token format.'),
        validateResult
    ],
    publicController.getPublicRequest
);

/**
 * @route POST /public/requests/:publicToken/comments
 * @desc Add a comment to a request via public link
 * @access Public
 */
router.post(
    '/requests/:publicToken/comments',
    [
        // Assuming publicToken for Request is a standard MongoDB ObjectId hex string (24 chars)
        param('publicToken').notEmpty().withMessage('Public token is required.').isString().isLength({ min: 24, max: 24 }).withMessage('Invalid public token format.'),
        body('message').notEmpty().withMessage('Comment message is required.').isString().trim().isLength({ min: 1, max: 1000 }).withMessage('Comment message must be between 1 and 1000 characters.'),
        body('externalUserName').notEmpty().withMessage('Your name is required.').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Name cannot exceed 100 characters.'),
        body('externalUserEmail').notEmpty().withMessage('Your email is required.').isEmail().withMessage('Please provide a valid email address.').normalizeEmail(),
        validateResult
    ],
    publicController.addPublicCommentToRequest
);

/**
 * @route GET /public/scheduled-maintenance/:publicToken
 * @desc Get a scheduled maintenance task via public link
 * @access Public
 */
router.get(
    '/scheduled-maintenance/:publicToken',
    [
        // Assuming publicToken for ScheduledMaintenance is a UUID (36 chars)
        param('publicToken').notEmpty().withMessage('Public token is required.').isString().isLength({ min: 36, max: 36 }).withMessage('Invalid public token format (UUID expected).'),
        validateResult
    ],
    publicController.getPublicScheduledMaintenance
);

/**
 * @route POST /public/scheduled-maintenance/:publicToken/comments
 * @desc Add a comment to a scheduled maintenance task via public link
 * @access Public
 */
router.post(
    '/scheduled-maintenance/:publicToken/comments',
    [
        // Assuming publicToken for ScheduledMaintenance is a UUID (36 chars)
        param('publicToken').notEmpty().withMessage('Public token is required.').isString().isLength({ min: 36, max: 36 }).withMessage('Invalid public token format (UUID expected).'),
        body('message').notEmpty().withMessage('Comment message is required.').isString().trim().isLength({ min: 1, max: 1000 }).withMessage('Comment message must be between 1 and 1000 characters.'),
        body('externalUserName').notEmpty().withMessage('Your name is required.').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Name cannot exceed 100 characters.'),
        body('externalUserEmail').notEmpty().withMessage('Your email is required.').isEmail().withMessage('Please provide a valid email address.').normalizeEmail(),
        validateResult
    ],
    publicController.addPublicCommentToScheduledMaintenance
);

module.exports = router;
