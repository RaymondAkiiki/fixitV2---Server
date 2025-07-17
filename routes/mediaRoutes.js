// src/routes/mediaRoutes.js

const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/mediaController'); // Import controller
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Import auth middleware
const { validateMongoId, validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { MEDIA_RELATED_TO_ENUM } = require('../utils/constants/enums'); // Import enums
const { query, body, param } = require('express-validator'); // For specific query/body/param validation

// Private routes (require authentication)

/**
 * @route GET /api/media
 * @desc Get all media records
 * @access Private (Admin, Uploader, or user with access to related resource)
 */
router.get(
    '/',
    protect,
    // Authorization handled in service
    [
        query('relatedTo').optional().isIn(MEDIA_RELATED_TO_ENUM).withMessage(`Invalid relatedTo type. Must be one of: ${MEDIA_RELATED_TO_ENUM.join(', ')}`),
        query('relatedId').optional().isMongoId().withMessage('Related ID must be a valid MongoDB ID.'),
        query('uploadedBy').optional().isMongoId().withMessage('UploadedBy ID must be a valid MongoDB ID.'),
        query('mimeType').optional().isString().trim().withMessage('MIME type filter must be a string.'),
        query('isPublic').optional().isBoolean().withMessage('isPublic filter must be a boolean.'),
        query('search').optional().isString().trim().withMessage('Search query must be a string.'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer.'),
        validateResult
    ],
    mediaController.getAllMedia
);

/**
 * @route GET /api/media/:id
 * @desc Get a single media record by ID
 * @access Private (Admin, Uploader, or user with access to related resource)
 */
router.get(
    '/:id',
    protect,
    validateMongoId('id'),
    mediaController.getMediaById
);

/**
 * @route PUT /api/media/:id
 * @desc Update a media record's metadata
 * @access Private (Admin, Uploader)
 */
router.put(
    '/:id',
    protect,
    // Authorization handled in service (uploader or admin)
    validateMongoId('id'),
    [
        body('description').optional().isString().trim().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters.'),
        body('tags').optional().isArray().withMessage('Tags must be an array of strings.')
            .custom(tags => tags.every(tag => typeof tag === 'string')).withMessage('Each tag must be a string.'),
        body('isPublic').optional().isBoolean().withMessage('isPublic must be a boolean.'),
        validateResult
    ],
    mediaController.updateMedia
);

/**
 * @route DELETE /api/media/:id
 * @desc Delete a media record and its file from storage
 * @access Private (Admin, Uploader)
 */
router.delete(
    '/:id',
    protect,
    // Authorization handled in service (uploader or admin)
    validateMongoId('id'),
    mediaController.deleteMedia
);

module.exports = router;
