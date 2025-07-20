// src/routes/scheduledMaintenanceRoutes.js

const express = require('express');
const router = express.Router();
const scheduledMaintenanceController = require('../controllers/scheduledMaintenanceController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadMiddleware');
const { validateMongoId, validateResult } = require('../utils/validationUtils');
const { 
    ROLE_ENUM, 
    SCHEDULED_MAINTENANCE_STATUS_ENUM, 
    CATEGORY_ENUM,
    FREQUENCY_TYPE_ENUM 
} = require('../utils/constants/enums');
const { body, query, param } = require('express-validator');

// Public routes first (order matters for routes with overlapping patterns)

/**
 * @route GET /api/scheduled-maintenance/public/:publicToken
 * @desc Get external view of a scheduled maintenance task
 * @access Public
 */
router.get(
    '/public/:publicToken',
    [
        param('publicToken')
            .notEmpty().withMessage('Public token is required.')
            .isString().withMessage('Public token must be a string.'),
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
        param('publicToken')
            .notEmpty().withMessage('Public token is required.')
            .isString().withMessage('Public token must be a string.'),
        body('name')
            .notEmpty().withMessage('Name is required for public update.')
            .trim(),
        body('phone')
            .notEmpty().withMessage('Phone is required for public update.')
            .trim()
            .isMobilePhone('any', { strictMode: false }).withMessage('Please provide a valid phone number.'),
        body('status')
            .optional()
            .isIn(['in_progress', 'completed']).withMessage('Invalid status for public update. Must be "in_progress" or "completed".'),
        body('commentMessage')
            .optional()
            .isString().trim()
            .isLength({ max: 1000 }).withMessage('Comment message cannot exceed 1000 characters.'),
        validateResult
    ],
    scheduledMaintenanceController.publicScheduledMaintenanceUpdate
);

// Protected routes

/**
 * @route POST /api/scheduled-maintenance
 * @desc Create a new scheduled maintenance task
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    upload.array('files'), // Use 'files' field name for consistency
    [
        body('title')
            .notEmpty().withMessage('Title is required.')
            .trim()
            .isLength({ min: 3, max: 200 }).withMessage('Title must be between 3 and 200 characters.'),
        body('description')
            .notEmpty().withMessage('Description is required.')
            .trim()
            .isLength({ min: 10, max: 2000 }).withMessage('Description must be between 10 and 2000 characters.'),
        body('category')
            .notEmpty().withMessage('Category is required.')
            .isIn(CATEGORY_ENUM).withMessage(`Invalid category. Must be one of: ${CATEGORY_ENUM.join(', ')}`),
        body('property')
            .notEmpty().withMessage('Property ID is required.')
            .isMongoId().withMessage('Property ID must be a valid MongoDB ID.'),
        body('unit')
            .optional()
            .isMongoId().withMessage('Unit ID must be a valid MongoDB ID.'),
        body('scheduledDate')
            .notEmpty().withMessage('Scheduled date is required.')
            .isISO8601().toDate().withMessage('Scheduled date must be a valid date.'),
        body('recurring')
            .optional()
            .isBoolean().withMessage('Recurring must be a boolean value.'),
        body('frequency.type')
            .optional()
            .isIn(FREQUENCY_TYPE_ENUM).withMessage(`Invalid frequency type. Must be one of: ${FREQUENCY_TYPE_ENUM.join(', ')}`),
        body('frequency.interval')
            .optional()
            .isInt({ min: 1 }).withMessage('Frequency interval must be a positive integer.'),
        body('assignedToId')
            .optional()
            .isMongoId().withMessage('Assigned To ID must be a valid MongoDB ID.'),
        body('assignedToModel')
            .optional()
            .isIn(['User', 'Vendor']).withMessage('Assigned To Model must be either "User" or "Vendor".'),
        validateResult
    ],
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
    [
        query('status')
            .optional()
            .isIn(SCHEDULED_MAINTENANCE_STATUS_ENUM).withMessage(`Invalid status filter. Must be one of: ${SCHEDULED_MAINTENANCE_STATUS_ENUM.join(', ')}`),
        query('recurring')
            .optional()
            .isBoolean().withMessage('Recurring filter must be a boolean (true/false).'),
        query('propertyId')
            .optional()
            .isMongoId().withMessage('Property ID filter must be a valid MongoDB ID.'),
        query('unitId')
            .optional()
            .isMongoId().withMessage('Unit ID filter must be a valid MongoDB ID.'),
        query('category')
            .optional()
            .isIn(CATEGORY_ENUM).withMessage(`Invalid category filter. Must be one of: ${CATEGORY_ENUM.join(', ')}`),
        query('search')
            .optional()
            .isString().trim().withMessage('Search query must be a string.'),
        query('startDate')
            .optional()
            .isISO8601().toDate().withMessage('Start date must be a valid date.'),
        query('endDate')
            .optional()
            .isISO8601().toDate().withMessage('End date must be a valid date.'),
        query('page')
            .optional()
            .isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
        validateResult
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
    validateMongoId('id'),
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
    validateMongoId('id'),
    upload.array('files'), // For any new media files
    [
        body('title')
            .optional()
            .trim()
            .isLength({ min: 3, max: 200 }).withMessage('Title must be between 3 and 200 characters.'),
        body('description')
            .optional()
            .trim()
            .isLength({ min: 10, max: 2000 }).withMessage('Description must be between 10 and 2000 characters.'),
        body('category')
            .optional()
            .isIn(CATEGORY_ENUM).withMessage(`Invalid category. Must be one of: ${CATEGORY_ENUM.join(', ')}`),
        body('scheduledDate')
            .optional()
            .isISO8601().toDate().withMessage('Scheduled date must be a valid date.'),
        body('recurring')
            .optional()
            .isBoolean().withMessage('Recurring must be a boolean value.'),
        body('status')
            .optional()
            .isIn(SCHEDULED_MAINTENANCE_STATUS_ENUM).withMessage(`Invalid status. Must be one of: ${SCHEDULED_MAINTENANCE_STATUS_ENUM.join(', ')}`),
        body('statusNotes')
            .optional()
            .isString().trim()
            .isLength({ max: 500 }).withMessage('Status notes cannot exceed 500 characters.'),
        body('assignedToId')
            .optional()
            .isMongoId().withMessage('Assigned To ID must be a valid MongoDB ID.'),
        body('assignedToModel')
            .optional()
            .isIn(['User', 'Vendor']).withMessage('Assigned To Model must be either "User" or "Vendor".'),
        validateResult
    ],
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
    validateMongoId('id'),
    scheduledMaintenanceController.deleteScheduledMaintenance
);

/**
 * @route POST /api/scheduled-maintenance/:id/media
 * @desc Upload media file(s) for a scheduled maintenance task
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/:id/media',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    upload.array('mediaFiles'), // Using 'mediaFiles' to match frontend naming
    scheduledMaintenanceController.uploadMedia
);

/**
 * @route DELETE /api/scheduled-maintenance/:id/media
 * @desc Delete a media file from a scheduled maintenance task
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.delete(
    '/:id/media',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    [
        body('mediaUrl')
            .notEmpty().withMessage('Media URL is required to delete.')
            .isURL().withMessage('Media URL must be a valid URL.'),
        validateResult
    ],
    scheduledMaintenanceController.deleteMedia
);

/**
 * @route POST /api/scheduled-maintenance/:id/comments
 * @desc Add a comment to a scheduled maintenance task
 * @access Private (with access control)
 */
router.post(
    '/:id/comments',
    protect,
    validateMongoId('id'),
    [
        body('message')
            .notEmpty().withMessage('Comment message is required.')
            .trim()
            .isLength({ max: 1000 }).withMessage('Comment message cannot exceed 1000 characters.'),
        body('isInternalNote')
            .optional()
            .isBoolean().withMessage('isInternalNote must be a boolean value.'),
        validateResult
    ],
    scheduledMaintenanceController.addComment
);

/**
 * @route POST /api/scheduled-maintenance/:id/create-request
 * @desc Create a maintenance request from a scheduled maintenance task
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/:id/create-request',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    scheduledMaintenanceController.createRequest
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
        body('expiresInDays')
            .optional()
            .isInt({ min: 1, max: 90 }).withMessage('Expires in days must be between 1 and 90.'),
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

/**
 * @route PUT /api/scheduled-maintenance/:id/pause
 * @desc Pause a scheduled maintenance task
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.put(
    '/:id/pause',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    scheduledMaintenanceController.pauseScheduledMaintenance
);

/**
 * @route PUT /api/scheduled-maintenance/:id/resume
 * @desc Resume a paused scheduled maintenance task
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.put(
    '/:id/resume',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    scheduledMaintenanceController.resumeScheduledMaintenance
);

module.exports = router;