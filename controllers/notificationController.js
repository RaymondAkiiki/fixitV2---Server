// src/controllers/notificationController.js

const asyncHandler = require('../utils/asyncHandler');
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Get all notifications for the logged-in user
 * @route GET /api/notifications
 * @access Private
 * @query {string} [isRead] - Filter by read status ('true' or 'false')
 * @query {string} [type] - Filter by notification type
 * @query {number} [page=1] - Page number
 * @query {number} [limit=10] - Items per page
 */
const getNotifications = asyncHandler(async (req, res) => { // Renamed from getNotificationsForUser
    const userId = req.user._id;

    // Extract page and limit, ensuring they are treated as numbers.
    // Provide default values if they are not present or invalid.
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // Extract other filters
    const { readStatus, type, startDate, endDate } = req.query;
    const filters = { readStatus, type, startDate, endDate };

    // Pass the correctly parsed values to the service
    const { notifications, total, page: currentPage, limit: currentLimit } = await notificationService.getNotifications(
        userId,
        filters,
        page,
        limit
    );

    res.status(200).json({
        success: true,
        count: notifications.length, // You had count: notifications.length in your original good one too, keeping it
        total,
        page: currentPage,
        limit: currentLimit,
        data: notifications
    });
});

/**
 * @desc Get a single notification by ID
 * @route GET /api/notifications/:id
 * @access Private (Accessible if recipient or admin)
 * @param {string} id - Notification ID from URL params
 */
const getNotificationById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    const notification = await notificationService.getNotificationById(id, currentUser);

    res.status(200).json({
        success: true,
        data: notification
    });
});

/**
 * @desc Mark a specific notification as read
 * @route PATCH /api/notifications/:id/read
 * @access Private (Recipient only)
 * @param {string} id - Notification ID from URL params
 */
const markNotificationAsRead = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedNotification = await notificationService.markNotificationAsRead(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: updatedNotification.isRead ? 'Notification marked as read successfully.' : 'Notification is already marked as read.',
        data: updatedNotification
    });
});

/**
 * @desc Mark all notifications as read for the logged-in user
 * @route PATCH /api/notifications/mark-all-read
 * @access Private (Recipient only)
 */
const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const ipAddress = req.ip;

    const { modifiedCount } = await notificationService.markAllNotificationsAsRead(currentUser._id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: modifiedCount > 0 ? `${modifiedCount} notifications marked as read successfully.` : 'No unread notifications found to mark as read.'
    });
});

/**
 * @desc Delete a specific notification
 * @route DELETE /api/notifications/:id
 * @access Private (Recipient or Admin)
 * @param {string} id - Notification ID from URL params
 */
const deleteNotification = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await notificationService.deleteNotification(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Notification deleted successfully.'
    });
});


module.exports = {
    getNotifications, // Ensure only this one is exported
    getNotificationById,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
};