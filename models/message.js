// src/models/message.js

const mongoose = require('mongoose');
const { MESSAGE_CATEGORY_ENUM } = require('../utils/constants/enums');

const MessageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        default: null
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        default: null
    },
    content: {
        type: String,
        required: [true, 'Message content is required'],
        trim: true,
        maxlength: [5000, 'Message cannot exceed 5000 characters']
    },
    isRead: {
        type: Boolean,
        default: false,
        index: true
    },
    readAt: {
        type: Date,
        default: null
    },
    parentMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        default: null
    },
    category: {
        type: String,
        enum: MESSAGE_CATEGORY_ENUM,
        default: 'general',
        index: true
    },
    attachments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media'
    }],
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date,
        default: null
    },
    deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for formatted date
MessageSchema.virtual('formattedDate').get(function() {
    return this.createdAt ? this.createdAt.toLocaleString() : '';
});

// Compound indexes for efficient message retrieval
MessageSchema.index({ sender: 1, recipient: 1 });
MessageSchema.index({ sender: 1, recipient: 1, property: 1 });
MessageSchema.index({ property: 1, unit: 1 });
MessageSchema.index({ parentMessage: 1 });
MessageSchema.index({ category: 1, isRead: 1 });
MessageSchema.index({ isDeleted: 1 });

module.exports = mongoose.models.Message || mongoose.model('Message', MessageSchema);