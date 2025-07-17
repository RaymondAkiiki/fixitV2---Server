// src/routes/messageRoutes.js

const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController'); // Import controller
const { protect } = require('../middleware/authMiddleware'); // Import auth middleware
const { validateMongoId, validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { MESSAGE_CATEGORY_ENUM } = require('../utils/constants/enums'); // Import enums
const { body, query, param } = require('express-validator'); // For specific body/query/param validation

// Private routes (require authentication)

/**
 * @route POST /api/messages
 * @desc Send a new message
 * @access Private
 */
router.post(
    '/',
    protect,
    // Authorization handled in service
    [
        body('recipientId').notEmpty().withMessage('Recipient ID is required.').isMongoId().withMessage('Invalid Recipient ID format.'),
        body('content').notEmpty().withMessage('Message content is required.').isString().trim().isLength({ min: 1, max: 2000 }).withMessage('Message content must be between 1 and 2000 characters.'),
        body('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        body('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        body('category').optional().isIn(MESSAGE_CATEGORY_ENUM).withMessage(`Invalid message category. Must be one of: ${MESSAGE_CATEGORY_ENUM.join(', ')}`),
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
    // Authorization handled in service
    [
        query('type').optional().isIn(['inbox', 'sent']).withMessage('Message type must be "inbox" or "sent".'),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        query('otherUserId').optional().isMongoId().withMessage('Invalid Other User ID format.'),
        validateResult
    ],
    messageController.getMessages
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
