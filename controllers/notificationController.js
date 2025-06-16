// backend/controllers/notificationController.js

const asyncHandler = require('express-async-handler');
const Notification = require("../models/notification"); // Corrected import: lowercase file name
const User = require('../models/user'); // For sender/recipient info
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Property = require('../models/property');
const Unit = require('../models/unit');

/**
 * @desc    Get all notifications for the logged-in user
 * @route   GET /api/notifications
 * @access  Private
 */
exports.getAllNotifications = asyncHandler(async (req, res) => {
    // Notifications are always user-specific
    const notifications = await Notification.find({ recipient: req.user._id })
        .sort({ createdAt: -1 })
        .populate('sender', 'name email') // Populate sender info if available
        .populate({
            path: 'relatedResource.item', // Populate the actual related resource
            select: 'title name unitName propertyName' // Select relevant fields from different models
        });

    res.status(200).json(notifications);
});

/**
 * @desc    Mark a specific notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
exports.markAsRead = asyncHandler(async (req, res) => {
    const notificationId = req.params.id;

    // Find and update the notification, ensuring it belongs to the current user
    const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, recipient: req.user._id },
        { isRead: true },
        { new: true }
    );

    if (!notification) {
        res.status(404);
        throw new Error("Notification not found or not authorized to mark as read.");
    }

    res.status(200).json({ message: "Notification marked as read.", notification });
});

/**
 * @desc    Mark all notifications as read for the logged-in user
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
exports.markAllAsRead = asyncHandler(async (req, res) => {
    // Update all notifications for the current user to isRead: true
    await Notification.updateMany(
        { recipient: req.user._id, isRead: false },
        { $set: { isRead: true } }
    );

    res.status(200).json({ message: "All notifications marked as read." });
});

/**
 * @desc    Create a new notification (Internal server-side helper)
 * @param   {string} recipientId - ID of the user to receive the notification.
 * @param   {string} message - The notification message.
 * @param   {string} type - The type of notification (e.g., 'new_request', 'status_update').
 * @param   {string} [link=''] - Optional deep link related to the notification.
 * @param   {object} [relatedResource=null] - Optional object { kind: 'ModelName', item: 'resourceId' }.
 * @param   {string} [senderId=null] - Optional ID of the user who triggered the notification.
 * @returns {Promise<Notification>} The created notification document.
 */
exports.createNotification = async (recipientId, message, type, link = '', relatedResource = null, senderId = null) => {
    try {
        const notification = new Notification({
            recipient: recipientId,
            sender: senderId,
            message,
            link,
            type: type.toLowerCase(), // Ensure type is lowercase
            relatedResource,
        });
        await notification.save();
        return notification;
    } catch (error) {
        console.error("Error creating notification:", error);
        // Do not throw here as this is an internal function, handle gracefully.
    }
};
