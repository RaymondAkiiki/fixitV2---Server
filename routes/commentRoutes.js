// src/routes/commentRoutes.js

const express = require('express');
const router = express.Router();
const commentController = require('../controllers/commentController');
const { protect } = require('../middleware/authMiddleware');
const { validateMongoId, validateResult } = require('../utils/validationUtils');
const { AUDIT_RESOURCE_TYPE_ENUM } = require('../utils/constants/enums');
const { body, query, param } = require('express-validator');

// Private routes (require authentication)

/**
 * @route POST /api/comments
 * @desc Add a comment to a specific resource context
 * @access Private (Authenticated users with context-specific authorization)
 */
router.post(
    '/',
    protect,
    [
        body('contextType').notEmpty().withMessage('Context type is required.')
            .isIn(AUDIT_RESOURCE_TYPE_ENUM.filter(type => type !== 'Comment'))
            .withMessage(`Invalid context type. Must be one of: ${AUDIT_RESOURCE_TYPE_ENUM.filter(type => type !== 'Comment').join(', ')}`),
        body('contextId').notEmpty().withMessage('Context ID is required.')
            .isMongoId().withMessage('Invalid Context ID format.'),
        body('message').notEmpty().withMessage('Comment message is required.')
            .isString().trim().isLength({ min: 1, max: 2000 })
            .withMessage('Comment message must be between 1 and 2000 characters.'),
        body('isExternal').optional().isBoolean().withMessage('isExternal must be a boolean.'),
        body('externalUserName').optional().isString().trim().isLength({ max: 100 })
            .withMessage('External user name cannot exceed 100 characters.'),
        body('externalUserEmail').optional().isEmail().withMessage('Please provide a valid external user email address.')
            .normalizeEmail(),
        body('isInternalNote').optional().isBoolean().withMessage('isInternalNote must be a boolean.'),
        body('media').optional().isArray().withMessage('Media must be an array of IDs.')
            .custom(mediaIds => !mediaIds.length || mediaIds.every(id => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)))
            .withMessage('Media array must contain valid MongoDB IDs.'),
        validateResult
    ],
    commentController.addComment
);

/**
 * @route GET /api/comments
 * @desc List comments for a specific resource context
 * @access Private (Authenticated users with context-specific authorization)
 */
router.get(
    '/',
    protect,
    [
        query('contextType').notEmpty().withMessage('Context type is required.')
            .isIn(AUDIT_RESOURCE_TYPE_ENUM.filter(type => type !== 'Comment'))
            .withMessage(`Invalid context type. Must be one of: ${AUDIT_RESOURCE_TYPE_ENUM.filter(type => type !== 'Comment').join(', ')}`),
        query('contextId').notEmpty().withMessage('Context ID is required.')
            .isMongoId().withMessage('Invalid Context ID format.'),
        query('includeInternal').optional().isBoolean().withMessage('includeInternal must be a boolean.'),
        query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000.'),
        query('sort').optional().isIn(['createdAt', 'updatedAt']).withMessage('Sort must be one of: createdAt, updatedAt.'),
        query('order').optional().isIn(['asc', 'desc']).withMessage('Order must be one of: asc, desc.'),
        validateResult
    ],
    commentController.listComments
);

/**
 * @route PUT /api/comments/:id
 * @desc Update a specific comment
 * @access Private (Only the sender of the comment or Admin)
 */
router.put(
    '/:id',
    protect,
    validateMongoId('id'),
    [
        body('message').optional().isString().trim().isLength({ min: 1, max: 2000 })
            .withMessage('Comment message must be between 1 and 2000 characters.'),
        body('isInternalNote').optional().isBoolean().withMessage('isInternalNote must be a boolean.'),
        body('media').optional().isArray().withMessage('Media must be an array of IDs.')
            .custom(mediaIds => !mediaIds.length || mediaIds.every(id => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)))
            .withMessage('Media array must contain valid MongoDB IDs.'),
        validateResult
    ],
    commentController.updateComment
);

/**
 * @route DELETE /api/comments/:id
 * @desc Delete a specific comment
 * @access Private (Only the sender of the comment or Admin)
 */
router.delete(
    '/:id',
    protect,
    validateMongoId('id'),
    commentController.deleteComment
);

/**
 * @route GET /api/comments/mentions/count
 * @desc Get unread mention count for current user
 * @access Private
 */
router.get(
    '/mentions/count',
    protect,
    commentController.getUnreadMentionCount
);

/**
 * @route POST /api/comments/mentions/mark-read
 * @desc Mark mentions as read for current user in a specific context
 * @access Private
 */
router.post(
    '/mentions/mark-read',
    protect,
    [
        body('contextType').notEmpty().withMessage('Context type is required.')
            .isIn(AUDIT_RESOURCE_TYPE_ENUM.filter(type => type !== 'Comment'))
            .withMessage(`Invalid context type. Must be one of: ${AUDIT_RESOURCE_TYPE_ENUM.filter(type => type !== 'Comment').join(', ')}`),
        body('contextId').notEmpty().withMessage('Context ID is required.')
            .isMongoId().withMessage('Invalid Context ID format.'),
        validateResult
    ],
    commentController.markMentionsAsRead
);

module.exports = router;