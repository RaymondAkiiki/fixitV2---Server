// src/routes/notificationRoutes.js

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController'); // Import controller
const { protect } = require('../middleware/authMiddleware'); // Import auth middleware
const { validateMongoId, validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { NOTIFICATION_TYPE_ENUM } = require('../utils/constants/enums'); // Import enums
const { query, param } = require('express-validator'); // For specific query/param validation

// Private routes (require authentication)

/**
 * @route GET /api/notifications
 * @desc Get all notifications for the logged-in user
 * @access Private
 */
router.get(
    '/',
    protect,
    // Authorization handled in service (user can only fetch their own)
    [
        query('isRead').optional().isBoolean().withMessage('isRead must be a boolean (true/false).'),
        query('type').optional().isIn(NOTIFICATION_TYPE_ENUM).withMessage(`Invalid notification type. Must be one of: ${NOTIFICATION_TYPE_ENUM.join(', ')}`),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer.'),
        validateResult
    ],
    notificationController.getNotifications
);

/**
 * @route GET /api/notifications/:id
 * @desc Get a single notification by ID
 * @access Private (Accessible if recipient or admin)
 */
router.get(
    '/:id',
    protect,
    validateMongoId('id'),
    notificationController.getNotificationById
);

/**
 * @route PATCH /api/notifications/:id/read
 * @desc Mark a specific notification as read
 * @access Private (Recipient only)
 */
router.patch(
    '/:id/read',
    protect,
    validateMongoId('id'),
    notificationController.markNotificationAsRead
);

/**
 * @route PATCH /api/notifications/mark-all-read
 * @desc Mark all notifications as read for the logged-in user
 * @access Private (Recipient only)
 */
router.patch(
    '/mark-all-read',
    protect,
    notificationController.markAllNotificationsAsRead
);

/**
 * @route DELETE /api/notifications/:id
 * @desc Delete a specific notification
 * @access Private (Recipient or Admin)
 */
router.delete(
    '/:id',
    protect,
    validateMongoId('id'),
    notificationController.deleteNotification
);

module.exports = router;
