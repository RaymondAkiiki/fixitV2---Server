// src/models/request.js

const mongoose = require('mongoose');
const crypto = require('crypto');
const { 
    CATEGORY_ENUM, 
    PRIORITY_ENUM, 
    REQUEST_STATUS_ENUM, 
    ASSIGNED_TO_MODEL_ENUM 
} = require('../utils/constants/enums');

const feedbackSchema = new mongoose.Schema({
    rating: {
        type: Number,
        min: 1,
        max: 5,
        required: [true, 'Rating is required']
    },
    comment: {
        type: String,
        trim: true,
        maxlength: [1000, 'Comment cannot exceed 1000 characters']
    },
    submittedAt: {
        type: Date,
        default: Date.now
    },
    submittedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Submitter is required']
    }
}, { _id: false });

const statusHistorySchema = new mongoose.Schema({
    status: {
        type: String,
        enum: REQUEST_STATUS_ENUM,
        required: [true, 'Status is required']
    },
    changedAt: {
        type: Date,
        default: Date.now
    },
    changedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    notes: {
        type: String,
        trim: true,
        maxlength: [500, 'Notes cannot exceed 500 characters']
    }
}, { _id: false });

const requestSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Request title is required'],
        trim: true,
        maxlength: [200, 'Title cannot exceed 200 characters']
    },
    description: {
        type: String,
        required: [true, 'Description is required for the request'],
        trim: true,
        maxlength: [2000, 'Description cannot exceed 2000 characters']
    },
    category: {
        type: String,
        enum: {
            values: CATEGORY_ENUM,
            message: '"{VALUE}" is not a supported category'
        },
        required: [true, 'Category is required'],
        lowercase: true,
        index: true
    },
    priority: {
        type: String,
        enum: {
            values: PRIORITY_ENUM,
            message: '"{VALUE}" is not a supported priority'
        },
        default: 'low',
        lowercase: true,
        index: true
    },
    media: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media'
    }],
    status: {
        type: String,
        enum: {
            values: REQUEST_STATUS_ENUM,
            message: '"{VALUE}" is not a valid status'
        },
        default: 'new',
        index: true,
        lowercase: true
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: [true, 'Property is required for the request'],
        index: true
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        default: null,
        index: true,
        sparse: true
    },
    createdByPropertyUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PropertyUser',
        required: [true, 'Creator PropertyUser is required for the request']
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'assignedToModel',
        default: null
    },
    assignedToModel: {
        type: String,
        enum: {
            values: ASSIGNED_TO_MODEL_ENUM,
            message: '"{VALUE}" is not a valid assignee type'
        },
        default: null
    },
    assignedByPropertyUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PropertyUser',
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
        enum: {
            values: ASSIGNED_TO_MODEL_ENUM,
            message: '"{VALUE}" is not a valid completedBy type'
        },
        default: null
    },
    feedback: {
        type: feedbackSchema,
        default: null
    },
    comments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comment'
    }],
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
    statusHistory: [statusHistorySchema],
    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual field for createdBy User - to maintain compatibility
requestSchema.virtual('createdBy').get(async function() {
    if (!this.populated('createdByPropertyUser')) {
        await this.populate({
            path: 'createdByPropertyUser',
            populate: {
                path: 'user',
                select: 'firstName lastName email role'
            }
        });
    }
    return this.createdByPropertyUser?.user || null;
});

// Virtual field for assignedBy User - to maintain compatibility
requestSchema.virtual('assignedBy').get(async function() {
    if (!this.populated('assignedByPropertyUser')) {
        await this.populate({
            path: 'assignedByPropertyUser',
            populate: {
                path: 'user',
                select: 'firstName lastName email role'
            }
        });
    }
    return this.assignedByPropertyUser?.user || null;
});

/**
 * Method to update status and record in history
 * @param {string} newStatus - New status
 * @param {string} userId - ID of user making the change
 * @param {string} [notes=''] - Optional notes
 * @returns {Promise<Object>} Old and new status
 */
requestSchema.methods.updateStatus = async function(newStatus, userId, notes = '') {
    const oldStatus = this.status;
    
    // Validate status
    if (!REQUEST_STATUS_ENUM.includes(newStatus)) {
        throw new Error(`Invalid status: ${newStatus}. Allowed values: ${REQUEST_STATUS_ENUM.join(', ')}`);
    }
    
    this.status = newStatus;
    
    // Add to status history
    this.statusHistory.push({
        status: newStatus,
        changedAt: new Date(),
        changedBy: userId,
        notes: notes
    });
    
    // Set timestamps for specific status changes
    if (newStatus === 'completed' && !this.resolvedAt) {
        this.resolvedAt = new Date();
    } else if (newStatus === 'reopened') {
        this.resolvedAt = null;
    }
    
    await this.save();
    return { oldStatus, newStatus };
};

/**
 * Method to enable public link
 * @param {number} [expiresInDays=7] - Days until expiration
 * @returns {Promise<string>} The public token
 */
requestSchema.methods.enablePublicLink = async function(expiresInDays = 7) {
    if (!this.publicToken) {
        this.publicToken = crypto.randomBytes(24).toString('hex');
    }
    
    this.publicLinkEnabled = true;
    this.publicLinkExpiresAt = new Date(Date.now() + (expiresInDays * 24 * 60 * 60 * 1000));
    
    await this.save();
    return this.publicToken;
};

/**
 * Method to disable public link
 * @returns {Promise<void>}
 */
requestSchema.methods.disablePublicLink = async function() {
    this.publicLinkEnabled = false;
    await this.save();
};

// Indexes for common queries
requestSchema.index({ property: 1, unit: 1, status: 1, isActive: 1 });
requestSchema.index({ createdByPropertyUser: 1, status: 1, isActive: 1 });
requestSchema.index({ assignedTo: 1, assignedToModel: 1, status: 1, isActive: 1 });
requestSchema.index({ createdAt: -1 });
requestSchema.index({ publicToken: 1, publicLinkEnabled: 1, publicLinkExpiresAt: 1 });

module.exports = mongoose.models.Request || mongoose.model('Request', requestSchema);