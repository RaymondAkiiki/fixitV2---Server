// src/routes/notificationRoutes.js

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { validateMongoId, validateResult } = require('../utils/validationUtils');
const { NOTIFICATION_TYPE_ENUM, ROLE_ENUM } = require('../utils/constants/enums');
const { query, param, body } = require('express-validator');

/**
 * @route GET /api/notifications
 * @desc Get all notifications for the logged-in user
 * @access Private
 */
router.get(
    '/',
    protect,
    [
        query('readStatus').optional().isIn(['read', 'unread']).withMessage('readStatus must be "read" or "unread".'),
        query('type').optional().isIn(NOTIFICATION_TYPE_ENUM).withMessage(`Invalid notification type. Must be one of: ${NOTIFICATION_TYPE_ENUM.join(', ')}`),
        query('startDate').optional().isISO8601().withMessage('startDate must be a valid ISO 8601 date.'),
        query('endDate').optional().isISO8601().withMessage('endDate must be a valid ISO 8601 date.'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer.'),
        validateResult
    ],
    notificationController.getNotifications
);

/**
 * @route GET /api/notifications/count
 * @desc Get unread notification count for the logged-in user
 * @access Private
 */
router.get(
    '/count',
    protect,
    notificationController.getUnreadNotificationCount
);

/**
 * @route GET /api/notifications/preferences
 * @desc Get user notification preferences
 * @access Private
 */
router.get(
    '/preferences',
    protect,
    notificationController.getNotificationPreferences
);

/**
 * @route PUT /api/notifications/preferences
 * @desc Update user notification preferences
 * @access Private
 */
router.put(
    '/preferences',
    protect,
    [
        body('channels').optional().isArray().withMessage('Channels must be an array.'),
        body('channels.*').optional().isString().withMessage('Each channel must be a string.'),
        body('emailSettings').optional().isObject().withMessage('Email settings must be an object.'),
        body('smsSettings').optional().isObject().withMessage('SMS settings must be an object.'),
        validateResult
    ],
    notificationController.updateNotificationPreferences
);

/**
 * @route PATCH /api/notifications/mark-all-read
 * @desc Mark all notifications as read for the logged-in user
 * @access Private
 */
router.patch(
    '/mark-all-read',
    protect,
    notificationController.markAllNotificationsAsRead
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