// src/routes/scheduledMaintenanceRoutes.js

const express = require('express');
const router = express.Router();
const scheduledMaintenanceController = require('../controllers/scheduledMaintenanceController'); // Import controller
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Import auth middleware
const { validateMongoId, validateScheduledMaintenance, validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { ROLE_ENUM, SCHEDULED_MAINTENANCE_STATUS_ENUM, CATEGORY_ENUM } = require('../utils/constants/enums'); // Import enums
const { body, query, param } = require('express-validator'); // For specific body/query/param validation

// Private routes (require authentication)

/**
 * @route POST /api/scheduled-maintenance
 * @desc Create a new scheduled maintenance task
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateScheduledMaintenance, // Apply comprehensive validation for body
    scheduledMaintenanceController.createScheduledMaintenance
);

/**
 * @route GET /api/scheduled-maintenance
 * @desc Get all scheduled maintenance tasks with filtering, search, and pagination
 * @access Private (with access control)
 */
router.get(
    '/',
    protect,
    // Authorization is handled within the service for granular access based on user role and property association
    [
        query('status').optional().isIn(SCHEDULED_MAINTENANCE_STATUS_ENUM).withMessage(`Invalid status filter. Must be one of: ${SCHEDULED_MAINTENANCE_STATUS_ENUM.join(', ')}`),
        query('recurring').optional().isBoolean().withMessage('Recurring filter must be a boolean (true/false).'),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        query('category').optional().isIn(CATEGORY_ENUM).withMessage(`Invalid category filter. Must be one of: ${CATEGORY_ENUM.join(', ')}`),
        query('search').optional().isString().trim().withMessage('Search query must be a string.'),
        query('startDate').optional().isISO8601().toDate().withMessage('Start date must be a valid date.'),
        query('endDate').optional().isISO8601().toDate().withMessage('End date must be a valid date.'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer.'),
        validateResult // Apply validation result handler for queries
    ],
    scheduledMaintenanceController.getAllScheduledMaintenance
);

/**
 * @route GET /api/scheduled-maintenance/:id
 * @desc Get a single scheduled maintenance task by ID
 * @access Private (with access control)
 */
router.get(
    '/:id',
    protect,
    validateMongoId('id'), // Validate ID in params
    scheduledMaintenanceController.getScheduledMaintenanceById
);

/**
 * @route PUT /api/scheduled-maintenance/:id
 * @desc Update a scheduled maintenance task
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.put(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'), // Validate ID in params
    validateScheduledMaintenance, // Reuse validation for updates (optional fields handled by optional())
    scheduledMaintenanceController.updateScheduledMaintenance
);

/**
 * @route DELETE /api/scheduled-maintenance/:id
 * @desc Delete a scheduled maintenance task
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.delete(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'), // Validate ID in params
    scheduledMaintenanceController.deleteScheduledMaintenance
);

/**
 * @route POST /api/scheduled-maintenance/:id/enable-public-link
 * @desc Enable public link for a scheduled maintenance task
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/:id/enable-public-link',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    [
        body('expiresInDays').optional().isInt({ min: 1 }).withMessage('Expires in days must be a positive integer.'),
        validateResult
    ],
    scheduledMaintenanceController.enableScheduledMaintenancePublicLink
);

/**
 * @route POST /api/scheduled-maintenance/:id/disable-public-link
 * @desc Disable public link for a scheduled maintenance task
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/:id/disable-public-link',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    scheduledMaintenanceController.disableScheduledMaintenancePublicLink
);

// Public routes (no authentication required, but require valid publicToken)

/**
 * @route GET /api/scheduled-maintenance/public/:publicToken
 * @desc Get external view of a scheduled maintenance task
 * @access Public
 */
router.get(
    '/public/:publicToken',
    [
        param('publicToken').notEmpty().withMessage('Public token is required.').isString().withMessage('Public token must be a string.'),
        validateResult
    ],
    scheduledMaintenanceController.getPublicScheduledMaintenanceView
);

/**
 * @route POST /api/scheduled-maintenance/public/:publicToken/update
 * @desc External user updates status/comments for a scheduled maintenance task
 * @access Public (limited functionality)
 */
router.post(
    '/public/:publicToken/update',
    [
        param('publicToken').notEmpty().withMessage('Public token is required.').isString().withMessage('Public token must be a string.'),
        body('name').notEmpty().withMessage('Name is required for public update.').trim(),
        body('phone').notEmpty().withMessage('Phone is required for public update.').trim().isMobilePhone('any', { strictMode: false }).withMessage('Please provide a valid phone number.'),
        body('status').optional().isIn(['in_progress', 'completed']).withMessage('Invalid status for public update. Must be "in_progress" or "completed".'), // Specific allowed statuses
        body('commentMessage').optional().isString().trim().isLength({ max: 1000 }).withMessage('Comment message cannot exceed 1000 characters.'),
        validateResult
    ],
    scheduledMaintenanceController.publicScheduledMaintenanceUpdate
);

module.exports = router;
