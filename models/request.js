// server/models/request.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const { CATEGORY_ENUM, PRIORITY_ENUM, REQUEST_STATUS_ENUM, ASSIGNED_TO_MODEL_ENUM } = require('../utils/constants/enums');
const feedbackSubSchema = require('./schemas/FeedbackSubSchema');

const requestSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Request title is required.'],
        trim: true,
        maxlength: [200, 'Title cannot exceed 200 characters.']
    },
    description: {
        type: String,
        required: [true, 'Description is required for the request.'],
        maxlength: [2000, 'Description cannot exceed 2000 characters.'],
        default: null
    },
    category: {
        type: String,
        enum: {
            values: CATEGORY_ENUM,
            message: '"{VALUE}" is not a supported category.'
        },
        required: [true, 'Category is required.'],
        lowercase: true,
        index: true
    },
    priority: {
        type: String,
        enum: PRIORITY_ENUM,
        default: 'low',
        lowercase: true,
        index: true
    },
    media: [{ // Now referencing Media model directly for consistency
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media'
    }],
    status: {
        type: String,
        enum: REQUEST_STATUS_ENUM,
        default: 'new',
        index: true,
        lowercase: true
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: [true, 'Property is required for the request.'],
        index: true
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        default: null,
        index: true,
        sparse: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Creator is required for the request.']
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'assignedToModel',
        default: null
    },
    assignedToModel: {
        type: String,
        enum: ASSIGNED_TO_MODEL_ENUM,
        default: null
    },
    assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    assignedAt: {
        type: Date,
        default: null
    },
    resolvedAt: {
        type: Date,
        default: null
    },
    completedBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'completedByModel',
        default: null
    },
    completedByModel: {
        type: String,
        enum: ASSIGNED_TO_MODEL_ENUM, // Reusing ASSIGNED_TO_MODEL_ENUM for consistency
        default: null
    },
    feedback: feedbackSubSchema,
    generatedFromScheduledMaintenance: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ScheduledMaintenance',
        default: null
    },
    publicToken: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },
    publicLinkEnabled: {
        type: Boolean,
        default: false
    },
    publicLinkExpiresAt: {
        type: Date,
        default: null
    },

}, {
    timestamps: true
});

/**
 * Instance method to enable a public link for the request.
 * Generates a public token if one doesn't exist.
 * @param {Date} [expiryDate=null] - Optional expiry date for the public link.
 * @returns {string} The public token.
 */
requestSchema.methods.enablePublicLink = async function(expiryDate = null) {
    if (!this.publicToken) {
        this.publicToken = crypto.randomBytes(24).toString('hex');
    }
    this.publicLinkEnabled = true;
    if (expiryDate) {
        this.publicLinkExpiresAt = expiryDate;
    } else {
        this.publicLinkExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    await this.save();
    return this.publicToken;
};

// Indexes for common queries
requestSchema.index({ property: 1, unit: 1, status: 1 });
requestSchema.index({ createdBy: 1, status: 1 });
requestSchema.index({ assignedTo: 1, status: 1 });
requestSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Request || mongoose.model('Request', requestSchema);