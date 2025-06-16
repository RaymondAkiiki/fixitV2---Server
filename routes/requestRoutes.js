// backend/routes/requestRoutes.js

const express = require('express');
const { body, query, param } = require('express-validator');
const router = express.Router();
const requestController = require('../controllers/requestController'); // Corrected import
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Corrected import
const { uploadCloudinary } = require('../utils/fileUpload'); // For media uploads

// --- Validation Schemas ---

const createRequestValidation = [
    body('title').notEmpty().withMessage('Title is required.'),
    body('description').optional().isString().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters.'),
    body('category').notEmpty().withMessage('Category is required.').isIn(['plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'landscaping', 'other', 'security', 'pest_control', 'cleaning', 'scheduled']) // Lowercase
        .withMessage('Invalid category.'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']) // Lowercase
        .withMessage('Invalid priority.'),
    body('propertyId').isMongoId().withMessage('Property ID is required.'),
    body('unitId').isMongoId().withMessage('Unit ID is required.'),
];

const updateRequestValidation = [
    param('id').isMongoId().withMessage('Invalid request ID.'),
    body('title').optional().notEmpty().withMessage('Title cannot be empty.'),
    body('description').optional().isString().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters.'),
    body('category').optional().isIn(['plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'landscaping', 'other', 'security', 'pest_control', 'cleaning', 'scheduled'])
        .withMessage('Invalid category.'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'urgent'])
        .withMessage('Invalid priority.'),
    // Status update is handled by separate endpoint or specific logic in controller update function
    body('status').optional().isIn(['new', 'assigned', 'in_progress', 'completed', 'verified', 'reopened', 'archived']) // Lowercase
        .withMessage('Invalid status for direct update. Use specific status routes for transitions.'),
];

const assignRequestValidation = [
    param('id').isMongoId().withMessage('Request ID required.'), // Renamed from requestId to id
    body('assignedToId').isMongoId().withMessage('Assigned To ID required.'),
    body('assignedToModel').isIn(['User', 'Vendor']).withMessage('Assigned To Type must be "User" or "Vendor".'),
];

const feedbackValidation = [
    param('id').isMongoId().withMessage('Request ID required.'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating 1-5 required.'),
    body('comment').optional().isString().isLength({ max: 1000 }).withMessage('Comment cannot exceed 1000 characters.'),
];

const mediaUploadValidation = [
    param('id').isMongoId().withMessage('Request ID required.'),
];

const mediaDeleteValidation = [
    param('id').isMongoId().withMessage('Request ID required.'),
    body('mediaUrl').notEmpty().withMessage('Media URL is required to delete.').isURL().withMessage('Invalid media URL.'),
];

const publicTokenParamValidation = [
    param('publicToken').isString().isLength({ min: 24, max: 24 }).withMessage('Invalid public token length.'), // Adjust length if needed
];

const publicUpdateValidation = [
    param('publicToken').isString().isLength({ min: 24, max: 24 }).withMessage('Invalid public token length.'),
    body('name').notEmpty().withMessage('Name is required.'),
    body('phone').notEmpty().withMessage('Phone is required.'),
    body('status').optional().isIn(['in_progress', 'completed']).withMessage('Invalid status for public update.'),
    body('commentMessage').optional().isString().isLength({ max: 1000 }).withMessage('Comment message cannot exceed 1000 characters.'),
];

const enablePublicLinkValidation = [
    param('id').isMongoId().withMessage('Request ID required.'),
    body('expiresInDays').optional().isInt({ min: 1 }).withMessage('Expiry in days must be a positive integer.'),
];

// --- ROUTES ---

// POST /api/requests - Create a new request (supports file upload & all roles)
router.post(
    '/',
    protect,
    authorizeRoles('tenant', 'propertymanager', 'landlord', 'admin'), // Added admin
    uploadCloudinary ? uploadCloudinary.array('mediaFiles', 5) : (req, res, next) => next(), // handles up to 5 files, skip if not present
    createRequestValidation,
    requestController.createRequest
);

// GET /api/requests - Get all requests (filtered by user role and query parameters)
router.get('/', protect, requestController.getAllRequests);

// GET /api/requests/:id - Get specific request details
router.get('/:id', protect, param('id').isMongoId().withMessage('Invalid request ID.'), requestController.getRequestDetails);

// PUT /api/requests/:id - Update request (status, priority, description by authorized users)
// Note: This route now handles general updates. Specific status changes have dedicated routes for clarity/auditing.
router.put(
    '/:id',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager', 'tenant'), // Tenant limited update
    updateRequestValidation,
    requestController.updateRequest
);

// POST /api/requests/:id/assign - Assign a request to user or vendor
router.post(
    '/:id/assign', // Changed from :requestId to :id for consistency
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    assignRequestValidation,
    requestController.assignRequest
);

// POST /api/requests/:id/media - Upload media file(s) for a request
router.post(
    '/:id/media',
    protect,
    authorizeRoles('tenant', 'property_manager', 'landlord', 'admin', 'vendor'), // Vendor can upload media if assigned
    mediaUploadValidation,
    uploadCloudinary ? uploadCloudinary.array('mediaFiles', 5) : (req, res, next) => next(),
    requestController.uploadMedia
);

// DELETE /api/requests/:id/media - Delete a media file from a request
router.delete(
    '/:id/media',
    protect,
    authorizeRoles('admin', 'property_manager', 'landlord', 'tenant', 'vendor'), // Tenant/Vendor who created/assigned
    mediaDeleteValidation,
    requestController.deleteMedia
);

// POST /api/requests/:id/feedback - Submit feedback on a completed request
router.post(
    '/:id/feedback',
    protect,
    authorizeRoles('tenant'), // Only tenant can submit feedback
    feedbackValidation,
    requestController.submitFeedback
);

// POST /api/requests/:id/enable-public-link - Enable public link for a request
router.post(
    '/:id/enable-public-link',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    enablePublicLinkValidation,
    requestController.enablePublicLink
);

// POST /api/requests/:id/disable-public-link - Disable public link for a request
router.post(
    '/:id/disable-public-link',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    param('id').isMongoId().withMessage('Invalid request ID.'),
    requestController.disablePublicLink
);

// PUT /api/requests/:id/verify - Verify a completed request
router.put(
    '/:id/verify',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    param('id').isMongoId().withMessage('Invalid request ID.'),
    requestController.verifyRequest
);

// PUT /api/requests/:id/reopen - Reopen a request
router.put(
    '/:id/reopen',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    param('id').isMongoId().withMessage('Invalid request ID.'),
    requestController.reopenRequest
);

// PUT /api/requests/:id/archive - Archive a request
router.put(
    '/:id/archive',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    param('id').isMongoId().withMessage('Invalid request ID.'),
    requestController.archiveRequest
);


// --- Public Routes for External Access (no protect middleware) ---

// GET /api/requests/public/:publicToken - External vendor view of a request
router.get('/public/:publicToken', publicTokenParamValidation, requestController.getPublicRequestView);

// POST /api/requests/public/:publicToken/update - External vendor updates status/comments (limited)
router.post('/public/:publicToken/update', publicUpdateValidation, requestController.publicRequestUpdate);


// Removed: /comment, /status (handled by general comments controller and PUT /:id), /dashboard, /mine (consolidated into GET /)
module.exports = router;