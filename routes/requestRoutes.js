const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const requestController = require('../controllers/requestController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { uploadCloudinary } = require('../utils/fileUpload');

// --- Validation Schemas ---
const createRequestValidation = [
    body('title').notEmpty().withMessage('Title is required.'),
    body('description').optional().isString().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters.'),
    body('category').notEmpty().withMessage('Category is required.').isIn([
        'plumbing', 'electrical', 'hvac', 'appliance', 'structural',
        'landscaping', 'other', 'security', 'pest_control', 'cleaning', 'scheduled'
    ]).withMessage('Invalid category.'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']).withMessage('Invalid priority.'),
    body('propertyId').isMongoId().withMessage('Property ID is required.'),
    body('unitId').isMongoId().withMessage('Unit ID is required.'),
];

const updateRequestValidation = [
    param('id').isMongoId().withMessage('Invalid request ID.'),
    body('title').optional().notEmpty().withMessage('Title cannot be empty.'),
    body('description').optional().isString().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters.'),
    body('category').optional().isIn([
        'plumbing', 'electrical', 'hvac', 'appliance', 'structural',
        'landscaping', 'other', 'security', 'pest_control', 'cleaning', 'scheduled'
    ]).withMessage('Invalid category.'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']).withMessage('Invalid priority.'),
    body('status').optional().isIn([
        'new', 'assigned', 'in_progress', 'completed', 'verified', 'reopened', 'archived'
    ]).withMessage('Invalid status for direct update. Use specific status routes for transitions.'),
];

const assignRequestValidation = [
    param('id').isMongoId().withMessage('Request ID required.'),
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
    param('publicToken').isString().isLength({ min: 24, max: 24 }).withMessage('Invalid public token length.'),
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

// --- FILE UPLOAD ROUTES (MULTER/MULTIPART) ---
// These must be mounted BEFORE express.json() in server.js

// Create a new request with optional file upload
router.post(
    '/',
    protect,
    authorizeRoles('tenant', 'propertymanager', 'landlord', 'admin'),
    uploadCloudinary ? uploadCloudinary.array('mediaFiles', 5) : (req, res, next) => next(),
    createRequestValidation,
    requestController.createRequest
);

// Upload media files for an existing request
router.post(
    '/:id/media',
    protect,
    authorizeRoles('tenant', 'propertymanager', 'landlord', 'admin', 'vendor'),
    mediaUploadValidation,
    uploadCloudinary ? uploadCloudinary.array('mediaFiles', 5) : (req, res, next) => next(),
    requestController.uploadMedia
);

// --- JSON ROUTES (after express.json()) ---

// Get all requests (filtered by user role and query parameters)
router.get('/', protect, requestController.getAllRequests);

// Get specific request details
router.get('/:id', protect, param('id').isMongoId().withMessage('Invalid request ID.'), requestController.getRequestDetails);

// Update request (status, priority, description by authorized users)
router.put(
    '/:id',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager', 'tenant'),
    updateRequestValidation,
    requestController.updateRequest
);

// Assign a request to user or vendor
router.post(
    '/:id/assign',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    assignRequestValidation,
    requestController.assignRequest
);

// Delete a media file from a request
router.delete(
    '/:id/media',
    protect,
    authorizeRoles('admin', 'propertymanager', 'landlord', 'tenant', 'vendor'),
    mediaDeleteValidation,
    requestController.deleteMedia
);

// Submit feedback on a completed request
router.post(
    '/:id/feedback',
    protect,
    authorizeRoles('tenant'),
    feedbackValidation,
    requestController.submitFeedback
);

// Enable public link for a request
router.post(
    '/:id/enable-public-link',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    enablePublicLinkValidation,
    requestController.enablePublicLink
);

// Disable public link for a request
router.post(
    '/:id/disable-public-link',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    param('id').isMongoId().withMessage('Invalid request ID.'),
    requestController.disablePublicLink
);

// Verify a completed request
router.put(
    '/:id/verify',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    param('id').isMongoId().withMessage('Invalid request ID.'),
    requestController.verifyRequest
);

// Reopen a request
router.put(
    '/:id/reopen',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    param('id').isMongoId().withMessage('Invalid request ID.'),
    requestController.reopenRequest
);

// Archive a request
router.put(
    '/:id/archive',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    param('id').isMongoId().withMessage('Invalid request ID.'),
    requestController.archiveRequest
);

// --- Public Routes for External Access (no protect middleware) ---

// External vendor view of a request
router.get('/public/:publicToken', publicTokenParamValidation, requestController.getPublicRequestView);

// External vendor updates status/comments (limited)
router.post('/public/:publicToken/update', publicUpdateValidation, requestController.publicRequestUpdate);

module.exports = router;