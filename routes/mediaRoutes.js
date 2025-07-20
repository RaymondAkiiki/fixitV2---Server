// src/routes/mediaRoutes.js

const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const mediaController = require('../controllers/mediaController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { validateMongoId, validateResult } = require('../utils/validationUtils');
const { MEDIA_RELATED_TO_ENUM, ROLE_ENUM } = require('../utils/constants/enums');
const { query, body, param } = require('express-validator');

/**
 * @route GET /api/media/stats
 * @desc Get media usage statistics
 * @access Private (All authenticated users)
 */
router.get(
    '/stats',
    protect,
    mediaController.getMediaStats
);

/**
 * @route GET /api/media
 * @desc Get all media records with filtering and pagination
 * @access Private (Admin, Uploader, or user with access to related resource)
 */
router.get(
    '/',
    protect,
    [
        query('relatedTo').optional().isIn(MEDIA_RELATED_TO_ENUM)
            .withMessage(`Invalid relatedTo type. Must be one of: ${MEDIA_RELATED_TO_ENUM.join(', ')}`),
        query('relatedId').optional().isMongoId().withMessage('Related ID must be a valid MongoDB ID.'),
        query('uploadedBy').optional().isMongoId().withMessage('UploadedBy ID must be a valid MongoDB ID.'),
        query('mimeType').optional().isString().trim().withMessage('MIME type filter must be a string.'),
        query('isPublic').optional().isString().withMessage('isPublic filter must be "true" or "false".'),
        query('search').optional().isString().trim().withMessage('Search query must be a string.'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
        query('sortBy').optional().isString().trim().withMessage('Sort field must be a string.'),
        query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be either "asc" or "desc".'),
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
    validateMongoId('id'),
    [
        body('description').optional().isString().trim().isLength({ max: 1000 })
            .withMessage('Description cannot exceed 1000 characters.'),
        body('tags').optional().isArray().withMessage('Tags must be an array of strings.')
            .custom(tags => tags.every(tag => typeof tag === 'string'))
            .withMessage('Each tag must be a string.'),
        body('isPublic').optional().isBoolean().withMessage('isPublic must be a boolean.'),
        // Allow admins to update related fields
        body('relatedTo').optional().isIn(MEDIA_RELATED_TO_ENUM)
            .withMessage(`Invalid relatedTo type. Must be one of: ${MEDIA_RELATED_TO_ENUM.join(', ')}`),
        body('relatedId').optional().isMongoId().withMessage('Related ID must be a valid MongoDB ID.'),
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
    validateMongoId('id'),
    mediaController.deleteMedia
);

/**
 * @route GET /api/media/by-resource/:resourceType/:resourceId
 * @desc Get all media related to a specific resource
 * @access Private (Users with access to the resource)
 */
router.get(
    '/by-resource/:resourceType/:resourceId',
    protect,
    [
        param('resourceType').isIn(MEDIA_RELATED_TO_ENUM)
            .withMessage(`Invalid resource type. Must be one of: ${MEDIA_RELATED_TO_ENUM.join(', ')}`),
        param('resourceId').isMongoId().withMessage('Resource ID must be a valid MongoDB ID.'),
        validateResult
    ],
    asyncHandler(async (req, res) => {
        const { resourceType, resourceId } = req.params;
        const currentUser = req.user;
        const ipAddress = req.ip;

        const filters = {
            ...req.query,
            relatedTo: resourceType,
            relatedId: resourceId
        };

        const { media, total, page, limit, totalPages } = await mediaService.getAllMedia(
            currentUser, 
            filters,
            ipAddress
        );

        res.status(200).json({
            success: true,
            count: media.length,
            total,
            page,
            limit,
            totalPages,
            data: media
        });
    })
);

module.exports = router;