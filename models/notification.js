// backend/models/Notification.js

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    recipient: { // The user who will receive the notification
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: [true, 'Recipient is required for notification.'] 
    },
    sender: { // The user who triggered the notification (can be null for system notifications)
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        default: null
    }, 
    message: { 
        type: String, 
        required: [true, 'Notification message is required.'], 
        maxlength: [1000, 'Notification message cannot exceed 1000 characters.'] 
    },
    link: { // Optional deep link within the app related to the notification
        type: String, 
        default: null 
    },
    isRead: { // Whether the recipient has read the notification
        type: Boolean, 
        default: false 
    },
    type: { // Category of the notification (e.g., new request, status update)
        type: String, 
        enum: ['new_request', 'status_update', 'new_comment', 'assignment', 'reminder_due', 'reminder_overdue', 'invite_received', 'task_completed', 'task_verified', 'property_added', 'unit_added'], // Consistent lowercase, expanded types
        required: [true, 'Notification type is required.'],
        lowercase: true
    },
    // Polymorphic reference to the resource the notification is about
    relatedResource: {
        kind: { // Stores the model name of the related resource
            type: String, 
            enum: ['Request', 'ScheduledMaintenance', 'Property', 'Unit', 'User', 'Vendor'], // Added more related kinds
            required: true
        }, 
        item: { // The ObjectId of the related resource
            type: mongoose.Schema.Types.ObjectId, 
            refPath: 'relatedResource.kind',
            required: true
        }
    },
}, { 
    timestamps: true 
});

// Indexes for efficient notification retrieval
notificationSchema.index({ recipient: 1, isRead: 1 }); // For querying unread notifications for a user
notificationSchema.index({ type: 1 }); // For filtering notifications by type
notificationSchema.index({ 'relatedResource.kind': 1, 'relatedResource.item': 1 }); // For finding notifications related to a specific item

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
