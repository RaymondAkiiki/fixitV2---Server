// server/models/message.js
const mongoose = require('mongoose');
const { MESSAGE_CATEGORY_ENUM } = require('../utils/constants/enums');

const MessageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: false
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        required: false
    },
    content: {
        type: String,
        required: true,
        trim: true
    },
    isRead: {
        type: Boolean,
        default: false
    },
    parentMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        default: null
    },
    category: {
        type: String,
        enum: MESSAGE_CATEGORY_ENUM,
        default: 'general'
    }
}, {
    timestamps: true
});

// Indexes for efficient message retrieval
MessageSchema.index({ sender: 1, recipient: 1, property: 1 });
MessageSchema.index({ isRead: 1 });
MessageSchema.index({ property: 1, unit: 1 });

module.exports = mongoose.models.Message || mongoose.model('Message', MessageSchema);