// src/controllers/notificationController.js

const asyncHandler = require('../utils/asyncHandler');
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { NOTIFICATION_TYPE_ENUM } = require('../utils/constants/enums');

/**
 * @desc Get all notifications for the logged-in user
 * @route GET /api/notifications
 * @access Private
 */
const getNotifications = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    
    // Extract filters
    const { readStatus, type, startDate, endDate } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    // Validate type if provided
    if (type && !NOTIFICATION_TYPE_ENUM.includes(type)) {
        throw new AppError(`Invalid notification type: ${type}`, 400);
    }
    
    const filters = { readStatus, type, startDate, endDate };
    
    // Get notifications
    const { 
        notifications, 
        total, 
        unreadCount, 
        page: currentPage, 
        limit: currentLimit,
        totalPages 
    } = await notificationService.getNotifications(
        userId,
        filters,
        page,
        limit
    );
    
    res.status(200).json({
        success: true,
        count: notifications.length,
        total,
        unreadCount,
        page: currentPage,
        limit: currentLimit,
        totalPages,
        data: notifications
    });
});

/**
 * @desc Get a single notification by ID
 * @route GET /api/notifications/:id
 * @access Private (Accessible if recipient or admin)
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
 */
const markNotificationAsRead = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;
    
    const updatedNotification = await notificationService.markNotificationAsRead(id, currentUser, ipAddress);
    
    res.status(200).json({
        success: true,
        message: 'Notification marked as read successfully.',
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
    
    const { modifiedCount } = await notificationService.markAllNotificationsAsRead(
        currentUser._id, 
        currentUser, 
        ipAddress
    );
    
    res.status(200).json({
        success: true,
        message: modifiedCount > 0 
            ? `${modifiedCount} notifications marked as read successfully.` 
            : 'No unread notifications found to mark as read.',
        modifiedCount
    });
});

/**
 * @desc Delete a specific notification
 * @route DELETE /api/notifications/:id
 * @access Private (Recipient or Admin)
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

/**
 * @desc Get user notification preferences
 * @route GET /api/notifications/preferences
 * @access Private
 */
const getNotificationPreferences = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    
    const preferences = await notificationService.getUserNotificationPreferences(userId);
    
    res.status(200).json({
        success: true,
        data: preferences
    });
});

/**
 * @desc Update user notification preferences
 * @route PUT /api/notifications/preferences
 * @access Private
 */
const updateNotificationPreferences = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { channels, emailSettings, smsSettings } = req.body;
    
    // Validate channels if provided
    if (channels) {
        const validChannels = ['in_app', 'email', 'sms'];
        const invalidChannels = channels.filter(c => !validChannels.includes(c));
        
        if (invalidChannels.length > 0) {
            throw new AppError(`Invalid notification channels: ${invalidChannels.join(', ')}`, 400);
        }
    }
    
    const updatedPreferences = await notificationService.updateNotificationPreferences(
        userId,
        { channels, emailSettings, smsSettings }
    );
    
    res.status(200).json({
        success: true,
        message: 'Notification preferences updated successfully.',
        data: updatedPreferences
    });
});

/**
 * @desc Get unread notification count for the logged-in user
 * @route GET /api/notifications/count
 * @access Private
 */
const getUnreadNotificationCount = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    
    const { unreadCount } = await notificationService.getNotifications(
        userId,
        { readStatus: 'unread' },
        1,
        1
    );
    
    res.status(200).json({
        success: true,
        count: unreadCount
    });
});

module.exports = {
    getNotifications,
    getNotificationById,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    getNotificationPreferences,
    updateNotificationPreferences,
    getUnreadNotificationCount
};