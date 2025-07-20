// src/routes/requestRoutes.js

const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadMiddleware');
const { validateMongoId, validateResult } = require('../utils/validationUtils');
const { 
    ROLE_ENUM, 
    REQUEST_STATUS_ENUM, 
    CATEGORY_ENUM, 
    PRIORITY_ENUM, 
    ASSIGNED_TO_MODEL_ENUM 
} = require('../utils/constants/enums');
const { body, query, param } = require('express-validator');

// Public routes first (order matters for routes with overlapping patterns)

/**
 * @route GET /api/requests/public/:publicToken
 * @desc Get external view of a request
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
    requestController.getPublicRequestView
);

/**
 * @route POST /api/requests/public/:publicToken/update
 * @desc External user updates status/comments for a request
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
    requestController.publicRequestUpdate
);

// Protected routes

/**
 * @route POST /api/requests
 * @desc Create a new maintenance request
 * @access Private (Tenant, PropertyManager, Landlord, Admin)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD, ROLE_ENUM.TENANT),
    upload.array('files'), // Use 'files' field name for consistency with frontend
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
            .optional()
            .isIn(CATEGORY_ENUM).withMessage(`Invalid category. Must be one of: ${CATEGORY_ENUM.join(', ')}`),
        body('priority')
            .optional()
            .isIn(PRIORITY_ENUM).withMessage(`Invalid priority. Must be one of: ${PRIORITY_ENUM.join(', ')}`),
        body('propertyId')
            .notEmpty().withMessage('Property ID is required.')
            .isMongoId().withMessage('Property ID must be a valid MongoDB ID.'),
        body('unitId')
            .optional()
            .isMongoId().withMessage('Unit ID must be a valid MongoDB ID.'),
        validateResult
    ],
    requestController.createRequest
);

/**
 * @route GET /api/requests
 * @desc Get all requests with filtering, search, and pagination
 * @access Private (with access control)
 */
router.get(
    '/',
    protect,
    [
        query('status')
            .optional()
            .isIn(REQUEST_STATUS_ENUM).withMessage(`Invalid status filter. Must be one of: ${REQUEST_STATUS_ENUM.join(', ')}`),
        query('category')
            .optional()
            .isIn(CATEGORY_ENUM).withMessage(`Invalid category filter. Must be one of: ${CATEGORY_ENUM.join(', ')}`),
        query('priority')
            .optional()
            .isIn(PRIORITY_ENUM).withMessage(`Invalid priority filter. Must be one of: ${PRIORITY_ENUM.join(', ')}`),
        query('propertyId')
            .optional()
            .isMongoId().withMessage('Property ID filter must be a valid MongoDB ID.'),
        query('unitId')
            .optional()
            .isMongoId().withMessage('Unit ID filter must be a valid MongoDB ID.'),
        query('search')
            .optional()
            .isString().trim().withMessage('Search query must be a string.'),
        query('startDate')
            .optional()
            .isISO8601().toDate().withMessage('Start date must be a valid date.'),
        query('endDate')
            .optional()
            .isISO8601().toDate().withMessage('End date must be a valid date.'),
        query('assignedToId')
            .optional()
            .isMongoId().withMessage('Assigned To ID filter must be a valid MongoDB ID.'),
        query('assignedToType')
            .optional()
            .isIn(ASSIGNED_TO_MODEL_ENUM).withMessage(`Invalid Assigned To Type. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}`),
        query('page')
            .optional()
            .isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
        validateResult
    ],
    requestController.getAllRequests
);

/**
 * @route GET /api/requests/:id
 * @desc Get specific request details by ID
 * @access Private (with access control)
 */
router.get(
    '/:id',
    protect,
    validateMongoId('id'),
    requestController.getRequestById
);

/**
 * @route PUT /api/requests/:id
 * @desc Update a maintenance request
 * @access Private (Admin, PropertyManager, Landlord, Tenant for limited fields)
 */
router.put(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD, ROLE_ENUM.TENANT),
    validateMongoId('id'),
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
        body('priority')
            .optional()
            .isIn(PRIORITY_ENUM).withMessage(`Invalid priority. Must be one of: ${PRIORITY_ENUM.join(', ')}`),
        body('status')
            .optional()
            .isIn(REQUEST_STATUS_ENUM).withMessage(`Invalid status. Must be one of: ${REQUEST_STATUS_ENUM.join(', ')}`),
        body('statusNotes')
            .optional()
            .isString().trim()
            .isLength({ max: 500 }).withMessage('Status notes cannot exceed 500 characters.'),
        validateResult
    ],
    requestController.updateRequest
);

/**
 * @route DELETE /api/requests/:id
 * @desc Delete a maintenance request
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.delete(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    requestController.deleteRequest
);

/**
 * @route POST /api/requests/:id/assign
 * @desc Assign request to vendor or internal staff
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/:id/assign',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    [
        body('assignedToId')
            .notEmpty().withMessage('Assigned To ID is required.')
            .isMongoId().withMessage('Assigned To ID must be a valid MongoDB ID.'),
        body('assignedToModel')
            .notEmpty().withMessage('Assigned To Model is required.')
            .isIn(ASSIGNED_TO_MODEL_ENUM).withMessage(`Invalid Assigned To Model. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}`),
        validateResult
    ],
    requestController.assignRequest
);

/**
 * @route POST /api/requests/:id/media
 * @desc Upload media file(s) for a request
 * @access Private (Tenant, PropertyManager, Landlord, Admin, Assigned Vendor/User)
 */
router.post(
    '/:id/media',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD, ROLE_ENUM.TENANT, ROLE_ENUM.VENDOR),
    validateMongoId('id'),
    upload.array('mediaFiles'), // Using 'mediaFiles' to match frontend naming
    requestController.uploadMedia
);

/**
 * @route DELETE /api/requests/:id/media
 * @desc Delete a media file from a request
 * @access Private (Admin, PropertyManager, Landlord, Creator, Assigned Vendor/User)
 */
router.delete(
    '/:id/media',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD, ROLE_ENUM.TENANT, ROLE_ENUM.VENDOR),
    validateMongoId('id'),
    [
        body('mediaUrl')
            .notEmpty().withMessage('Media URL is required to delete.')
            .isURL().withMessage('Media URL must be a valid URL.'),
        validateResult
    ],
    requestController.deleteMedia
);

/**
 * @route POST /api/requests/:id/feedback
 * @desc Submit feedback for a completed request (Tenant only)
 * @access Private (Tenant)
 */
router.post(
    '/:id/feedback',
    protect,
    authorizeRoles(ROLE_ENUM.TENANT),
    validateMongoId('id'),
    [
        body('rating')
            .notEmpty().withMessage('Rating is required.')
            .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5.'),
        body('comment')
            .optional()
            .isString().trim()
            .isLength({ max: 1000 }).withMessage('Comment cannot exceed 1000 characters.'),
        validateResult
    ],
    requestController.submitFeedback
);

/**
 * @route POST /api/requests/:id/enable-public-link
 * @desc Enable public link for a request
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
    requestController.enablePublicLink
);

/**
 * @route POST /api/requests/:id/disable-public-link
 * @desc Disable public link for a request
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/:id/disable-public-link',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    requestController.disablePublicLink
);

/**
 * @route PUT /api/requests/:id/verify
 * @desc Verify a completed request (PM/Landlord/Admin)
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.put(
    '/:id/verify',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    requestController.verifyRequest
);

/**
 * @route PUT /api/requests/:id/reopen
 * @desc Reopen a request (PM/Landlord/Admin)
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.put(
    '/:id/reopen',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    requestController.reopenRequest
);

/**
 * @route PUT /api/requests/:id/archive
 * @desc Archive a request (PM/Landlord/Admin)
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.put(
    '/:id/archive',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    requestController.archiveRequest
);

module.exports = router;