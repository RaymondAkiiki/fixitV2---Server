// src/routes/requestRoutes.js

const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController'); // Import controller
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Import auth middleware
const { upload, uploadToCloudinary } = require('../middleware/uploadMiddleware'); // <--- CORRECTED IMPORT

const { validateMongoId, validateRequest, validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { ROLE_ENUM, REQUEST_STATUS_ENUM, CATEGORY_ENUM, PRIORITY_ENUM, ASSIGNED_TO_MODEL_ENUM } = require('../utils/constants/enums'); // Import enums
const { body, query, param } = require('express-validator'); // For specific body/query/param validation


/**
 * @route POST /api/requests/:id/media
 * @desc Upload media file(s) for a request
 * @access Private (Tenant, PropertyManager, Landlord, Admin, Assigned Vendor/User)
 * @param {string} id - Request ID from URL params
 * @body {Array<object>} files - Array of uploaded files from multer
 *
 * This route now handles both single and multiple file uploads using `upload.any()`.
 * The `uploadToCloudinary` middleware (if used for single files) or a custom loop
 * within `requestController.uploadMedia` will handle the Cloudinary upload and Media model saving.
 */
router.post(
    '/:id/media', // Use :id consistently
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD, ROLE_ENUM.TENANT, ROLE_ENUM.VENDOR),
    validateMongoId('id'), // Validate ID in params
    upload.any(), // Use upload.any() to accept any number of files (single or multiple)
    requestController.uploadMedia // This controller will now process req.files
);
/**
 * @route POST /api/requests
 * @desc Create a new maintenance request
 * @access Private (Tenant, PropertyManager, Landlord, Admin)
 * @body {string} title, {string} description, {string} category, {string} priority,
 * {string} propertyId, {string} [unitId], {Array<File>} [files] - Multi-part form data for media
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD, ROLE_ENUM.TENANT),
    upload.array('files'), // Assuming 'files' is the field name for multiple files
    validateRequest, // Apply comprehensive validation for body
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
    // Authorization is handled within the service for granular access based on user role and property association
    [
        query('status').optional().isIn(REQUEST_STATUS_ENUM).withMessage(`Invalid status filter. Must be one of: ${REQUEST_STATUS_ENUM.join(', ')}`),
        query('category').optional().isIn(CATEGORY_ENUM).withMessage(`Invalid category filter. Must be one of: ${CATEGORY_ENUM.join(', ')}`),
        query('priority').optional().isIn(PRIORITY_ENUM).withMessage(`Invalid priority filter. Must be one of: ${PRIORITY_ENUM.join(', ')}`),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        query('search').optional().isString().trim().withMessage('Search query must be a string.'),
        query('startDate').optional().isISO8601().toDate().withMessage('Start date must be a valid date.'),
        query('endDate').optional().isISO8601().toDate().withMessage('End date must be a valid date.'),
        query('assignedToId').optional().isMongoId().withMessage('Invalid Assigned To ID format.'),
        query('assignedToType').optional().isIn(ASSIGNED_TO_MODEL_ENUM).withMessage(`Invalid Assigned To Type. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}`),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer.'),
        validateResult // Apply validation result handler for queries
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
    validateMongoId('id'), // Validate ID in params
    requestController.getRequestById
);

/**
 * @route PUT /api/requests/:id
 * @desc Update a maintenance request (status, priority, description by authorized users)
 * @access Private (Admin, PropertyManager, Landlord - with access control; Tenant for limited fields)
 */
router.put(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD, ROLE_ENUM.TENANT), // Tenant has limited update
    validateMongoId('id'), // Validate ID in params
    validateRequest, // Reuse validation for updates (optional fields handled by optional())
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
    validateMongoId('id'), // Validate ID in params
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
    validateMongoId('id'), // Validate request ID in params
    [
        body('assignedToId').notEmpty().withMessage('Assigned To ID is required').isMongoId().withMessage('Assigned To ID must be a valid MongoDB ID.'),
        body('assignedToModel').notEmpty().withMessage('Assigned To Model is required').isIn(ASSIGNED_TO_MODEL_ENUM).withMessage(`Invalid Assigned To Model. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}`),
        validateResult
    ],
    requestController.assignRequest
);
/**
 * @route POST /api/requests/:id/media
 * @desc Upload media file(s) for a request
 * @access Private (Tenant, PropertyManager, Landlord, Admin, Assigned Vendor/User)
 * @param {string} id - Request ID from URL params
 * @body {Array<File>} mediaFiles - Array of uploaded files from multipart/form-data (field name 'mediaFiles')
 */
router.post(
    '/:id/media',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD, ROLE_ENUM.TENANT, ROLE_ENUM.VENDOR),
    validateMongoId('id'),
    // REFACTORED PART: Use upload.array() to handle multiple files from a field named 'mediaFiles'
    upload.array('mediaFiles'), 
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
        body('mediaUrl').notEmpty().withMessage('Media URL is required to delete.').isURL().withMessage('Media URL must be a valid URL.'),
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
    authorizeRoles(ROLE_ENUM.TENANT), // Only tenants can submit feedback for their requests
    validateMongoId('id'),
    [
        body('rating').notEmpty().withMessage('Rating is required').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5.'),
        body('comment').optional().isString().trim().isLength({ max: 1000 }).withMessage('Comment cannot exceed 1000 characters.'),
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
        body('expiresInDays').optional().isInt({ min: 1 }).withMessage('Expires in days must be a positive integer.'),
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

// Public routes (no authentication required, but require valid publicToken)

/**
 * @route GET /api/requests/public/:publicToken
 * @desc Get external view of a request
 * @access Public
 */
router.get(
    '/public/:publicToken',
    [
        param('publicToken').notEmpty().withMessage('Public token is required.').isString().withMessage('Public token must be a string.'),
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
        param('publicToken').notEmpty().withMessage('Public token is required.').isString().withMessage('Public token must be a string.'),
        body('name').notEmpty().withMessage('Name is required for public update.').trim(),
        body('phone').notEmpty().withMessage('Phone is required for public update.').trim().isMobilePhone('any', { strictMode: false }).withMessage('Please provide a valid phone number.'),
        body('status').optional().isIn(['in_progress', 'completed']).withMessage('Invalid status for public update. Must be "in_progress" or "completed".'), // Specific allowed statuses
        body('commentMessage').optional().isString().trim().isLength({ max: 1000 }).withMessage('Comment message cannot exceed 1000 characters.'),
        validateResult
    ],
    requestController.publicRequestUpdate
);

module.exports = router;
