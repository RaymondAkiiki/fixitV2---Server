// src/routes/messageRoutes.js

const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');
const { validateMongoId, validateResult } = require('../utils/validationUtils');
const { MESSAGE_CATEGORY_ENUM } = require('../utils/constants/enums');
const { body, query, param } = require('express-validator');

// Private routes (require authentication)

/**
 * @route POST /api/messages
 * @desc Send a new message
 * @access Private
 */
router.post(
    '/',
    protect,
    [
        body('recipientId').notEmpty().withMessage('Recipient ID is required.')
            .isMongoId().withMessage('Invalid Recipient ID format.'),
        body('content').notEmpty().withMessage('Message content is required.')
            .isString().trim()
            .isLength({ min: 1, max: 5000 }).withMessage('Message content must be between 1 and 5000 characters.'),
        body('propertyId').optional({ nullable: true })
            .isMongoId().withMessage('Invalid Property ID format.'),
        body('unitId').optional({ nullable: true })
            .isMongoId().withMessage('Invalid Unit ID format.'),
        body('category').optional()
            .isIn(MESSAGE_CATEGORY_ENUM).withMessage(`Invalid message category. Must be one of: ${MESSAGE_CATEGORY_ENUM.join(', ')}`),
        body('attachments').optional().isArray().withMessage('Attachments must be an array.')
            .custom(attachments => !attachments.length || attachments.every(id => /^[0-9a-fA-F]{24}$/.test(id)))
            .withMessage('Each attachment must be a valid MongoDB ID.'),
        body('parentMessage').optional({ nullable: true })
            .isMongoId().withMessage('Invalid Parent Message ID format.'),
        validateResult
    ],
    messageController.sendMessage
);

/**
 * @route GET /api/messages
 * @desc Get messages for the logged-in user (inbox or sent)
 * @access Private
 */
router.get(
    '/',
    protect,
    [
        query('type').optional()
            .isIn(['inbox', 'sent']).withMessage('Message type must be "inbox" or "sent".'),
        query('propertyId').optional()
            .isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional()
            .isMongoId().withMessage('Invalid Unit ID format.'),
        query('otherUserId').optional()
            .isMongoId().withMessage('Invalid Other User ID format.'),
        query('category').optional()
            .isIn(MESSAGE_CATEGORY_ENUM).withMessage(`Invalid message category. Must be one of: ${MESSAGE_CATEGORY_ENUM.join(', ')}`),
        query('unreadOnly').optional()
            .isBoolean().withMessage('unreadOnly must be a boolean.'),
        query('page').optional()
            .isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional()
            .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
        validateResult
    ],
    messageController.getMessages
);

/**
 * @route GET /api/messages/unread/count
 * @desc Get unread message count
 * @access Private
 */
router.get(
    '/unread/count',
    protect,
    [
        query('propertyId').optional()
            .isMongoId().withMessage('Invalid Property ID format.'),
        query('category').optional()
            .isIn(MESSAGE_CATEGORY_ENUM).withMessage(`Invalid message category. Must be one of: ${MESSAGE_CATEGORY_ENUM.join(', ')}`),
        validateResult
    ],
    messageController.getUnreadMessageCount
);

/**
 * @route POST /api/messages/mark-conversation-read
 * @desc Mark all messages in a conversation as read
 * @access Private
 */
router.post(
    '/mark-conversation-read',
    protect,
    [
        body('otherUserId').notEmpty().withMessage('Other User ID is required.')
            .isMongoId().withMessage('Invalid Other User ID format.'),
        body('propertyId').optional()
            .isMongoId().withMessage('Invalid Property ID format.'),
        validateResult
    ],
    messageController.markConversationAsRead
);

/**
 * @route GET /api/messages/:id
 * @desc Get a single message by ID
 * @access Private (Accessible if sender, recipient, or admin)
 */
router.get(
    '/:id',
    protect,
    validateMongoId('id'),
    messageController.getMessageById
);

/**
 * @route PATCH /api/messages/:id/read
 * @desc Mark a message as read
 * @access Private (Recipient only)
 */
router.patch(
    '/:id/read',
    protect,
    validateMongoId('id'),
    messageController.markMessageAsRead
);

/**
 * @route DELETE /api/messages/:id
 * @desc Delete a message
 * @access Private (Sender, Recipient, or Admin)
 */
router.delete(
    '/:id',
    protect,
    validateMongoId('id'),
    messageController.deleteMessage
);

module.exports = router;