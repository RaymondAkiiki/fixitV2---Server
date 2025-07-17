// server/models/notification.js
const mongoose = require('mongoose');
const { NOTIFICATION_TYPE_ENUM, AUDIT_RESOURCE_TYPE_ENUM } = require('../utils/constants/enums');

const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Recipient is required for notification.'],
        index: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    message: {
        type: String,
        required: [true, 'Notification message is required.'],
        maxlength: [1000, 'Notification message cannot exceed 1000 characters.']
    },
    link: {
        type: String,
        default: null
    },
    isRead: {
        type: Boolean,
        default: false,
        index: true
    },
    type: {
        type: String,
        enum: {
            values: NOTIFICATION_TYPE_ENUM,
            message: '"{VALUE}" is not a valid notification type.'
        },
        required: [true, 'Notification type is required.'],
        lowercase: true,
        index: true
    },
    relatedResource: {
        kind: {
            type: String,
            enum: AUDIT_RESOURCE_TYPE_ENUM, // Reusing Audit Resource Types for consistency
            required: true
        },
        item: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'relatedResource.kind',
            required: true
        }
    },
    scheduledAt: {
        type: Date,
        default: Date.now
    },
    sentAt: Date,
    contextData: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

// Indexes for efficient notification retrieval
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ 'relatedResource.kind': 1, 'relatedResource.item': 1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);