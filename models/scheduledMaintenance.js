// src/models/scheduledMaintenance.js

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { 
    CATEGORY_ENUM, 
    FREQUENCY_TYPE_ENUM, 
    SCHEDULED_MAINTENANCE_STATUS_ENUM, 
    ASSIGNED_TO_MODEL_ENUM 
} = require('../utils/constants/enums');

const scheduledMaintenanceSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Title is required for scheduled maintenance.'],
        trim: true,
        minlength: [3, 'Title must be at least 3 characters long.'],
        maxlength: [200, 'Title cannot exceed 200 characters.']
    },
    description: {
        type: String,
        required: [true, 'Description is required for scheduled maintenance.'],
        minlength: [10, 'Description must be at least 10 characters long.'],
        maxlength: [2000, 'Description cannot exceed 2000 characters.']
    },
    category: {
        type: String,
        enum: {
            values: CATEGORY_ENUM,
            message: '"{VALUE}" is not a supported category.'
        },
        required: [true, 'Category is required.'],
        lowercase: true
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: [true, 'Property is required for scheduled maintenance.'],
        index: true
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        default: null,
        sparse: true
    },
    scheduledDate: {
        type: Date,
        required: [true, 'Scheduled date is required.']
    },
    recurring: {
        type: Boolean,
        default: false
    },
    frequency: {
        type: new mongoose.Schema({
            type: {
                type: String,
                enum: {
                    values: FREQUENCY_TYPE_ENUM,
                    message: '"{VALUE}" is not a supported frequency type.'
                },
                default: null,
                lowercase: true
            },
            interval: { 
                type: Number, 
                default: 1, 
                min: [1, 'Interval must be at least 1.']
            },
            dayOfWeek: {
                type: [Number],
                validate: {
                    validator: function(v) { 
                        return v === null || (Array.isArray(v) && v.every(num => num >= 0 && num <= 6)); 
                    },
                    message: 'dayOfWeek must be an array of numbers between 0 and 6 or null.'
                },
                default: null
            },
            dayOfMonth: {
                type: [Number],
                validate: {
                    validator: function(v) { 
                        return v === null || (Array.isArray(v) && v.every(num => num >= 1 && num <= 31)); 
                    },
                    message: 'dayOfMonth must be an array of numbers between 1 and 31 or null.'
                },
                default: null
            },
            monthOfYear: {
                type: [Number],
                validate: {
                    validator: function(v) { 
                        return v === null || (Array.isArray(v) && v.every(num => num >= 1 && num <= 12)); 
                    },
                    message: 'monthOfYear must be an array of numbers between 1 and 12 or null.'
                },
                default: null
            },
            customDays: {
                type: [Number],
                validate: {
                    validator: function(v) { 
                        return Array.isArray(v) && v.every(num => num >= 0); 
                    },
                    message: 'customDays must be an array of non-negative numbers.'
                },
                default: []
            },
            endDate: {
                type: Date,
                default: null
            },
            occurrences: {
                type: Number,
                min: [1, 'Occurrences must be at least 1.'],
                default: null
            }
        }, { _id: false })
    },
    lastGeneratedRequest: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Request',
        default: null
    },
    nextDueDate: {
        type: Date,
        default: null,
        index: true
    },
    status: {
        type: String,
        enum: {
            values: SCHEDULED_MAINTENANCE_STATUS_ENUM,
            message: '"{VALUE}" is not a supported status.'
        },
        default: 'scheduled',
        index: true,
        lowercase: true
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
            message: '"{VALUE}" is not a supported assignee model.'
        },
        default: null
    },
    // Reference to PropertyUser instead of direct User reference
    createdByPropertyUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PropertyUser',
        required: [true, 'Creator PropertyUser is required for scheduled maintenance.']
    },
    media: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media'
    }],
    comments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comment'
    }],
    publicLinkToken: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },
    publicLinkExpires: {
        type: Date,
        default: null
    },
    publicLinkEnabled: {
        type: Boolean,
        default: false
    },
    lastExecutedAt: {
        type: Date,
        default: null
    },
    nextExecutionAttempt: {
        type: Date,
        default: null
    },
    statusHistory: [{
        status: {
            type: String,
            enum: {
                values: SCHEDULED_MAINTENANCE_STATUS_ENUM,
                message: '"{VALUE}" is not a supported status for history.'
            },
            required: true
        },
        changedAt: {
            type: Date,
            default: Date.now
        },
        changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        notes: String
    }],
    // Track requests generated from this scheduled maintenance
    generatedRequests: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Request'
    }]
}, {
    timestamps: true,
    toJSON: { virtuals: true }, // Enable virtuals when converting to JSON
    toObject: { virtuals: true } // Enable virtuals when converting to object
});

// Virtual to get creator User directly
scheduledMaintenanceSchema.virtual('createdBy').get(function() {
    if (this.populated('createdByPropertyUser') && 
        this.createdByPropertyUser && 
        this.createdByPropertyUser.user) {
        return this.createdByPropertyUser.user;
    }
    return null;
});

// Virtual to get formatted status for display
scheduledMaintenanceSchema.virtual('statusFormatted').get(function() {
    const status = this.status;
    if (!status) return 'Unknown';
    
    return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
});

// Virtual to get formatted frequency for display
scheduledMaintenanceSchema.virtual('frequencyFormatted').get(function() {
    if (!this.recurring) return 'One-time';
    if (!this.frequency || !this.frequency.type) return 'Unknown';
    
    const interval = this.frequency.interval || 1;
    
    switch(this.frequency.type.toLowerCase()) {
        case 'daily':
            return interval === 1 ? 'Daily' : `Every ${interval} days`;
        case 'weekly':
            return interval === 1 ? 'Weekly' : `Every ${interval} weeks`;
        case 'bi_weekly':
            return 'Bi-weekly';
        case 'monthly':
            return interval === 1 ? 'Monthly' : `Every ${interval} months`;
        case 'quarterly':
            return 'Quarterly';
        case 'yearly':
            return interval === 1 ? 'Yearly' : `Every ${interval} years`;
        case 'custom_days':
            if (Array.isArray(this.frequency.customDays) && this.frequency.customDays.length > 0) {
                return `Custom (${this.frequency.customDays.join(', ')} days)`;
            }
            return 'Custom schedule';
        default:
            return 'Custom';
    }
});

// Pre-save hook for handling public link token generation and status history
scheduledMaintenanceSchema.pre('save', function(next) {
    // Handle public link token
    if (this.publicLinkEnabled && !this.publicLinkToken) {
        this.publicLinkToken = uuidv4();
        if (!this.publicLinkExpires) {
            this.publicLinkExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }
    }
    
    // Handle initial status history
    if (this.isNew && !this.statusHistory?.length) {
        this.statusHistory = [{
            status: this.status || 'scheduled',
            changedAt: new Date(),
            notes: 'Task created'
        }];
    }
    
    // Ensure default values for recurring tasks
    if (this.recurring && (!this.frequency || !this.frequency.type)) {
        this.frequency = {
            type: 'monthly',
            interval: 1
        };
    }
    
    // If not recurring, clear frequency
    if (this.recurring === false) {
        this.frequency = {};
    }
    
    // Set nextDueDate for new tasks if not set
    if (this.isNew && !this.nextDueDate && this.scheduledDate) {
        this.nextDueDate = this.scheduledDate;
    }
    
    // Set nextExecutionAttempt for new tasks if not set
    if (this.isNew && !this.nextExecutionAttempt && this.scheduledDate) {
        this.nextExecutionAttempt = this.scheduledDate;
    }
    
    next();
});

// Method to calculate next due date based on frequency
scheduledMaintenanceSchema.methods.calculateNextDueDate = function() {
    if (!this.recurring || !this.frequency || !this.frequency.type) {
        return null;
    }
    
    const baseDate = this.nextDueDate || this.scheduledDate;
    let nextDate = new Date(baseDate);
    
    // Calculate next date based on frequency type
    switch (this.frequency.type.toLowerCase()) {
        case 'daily':
            nextDate.setDate(nextDate.getDate() + (this.frequency.interval || 1));
            break;
        case 'weekly':
            nextDate.setDate(nextDate.getDate() + 7 * (this.frequency.interval || 1));
            break;
        case 'bi_weekly':
            nextDate.setDate(nextDate.getDate() + 14 * (this.frequency.interval || 1));
            break;
        case 'monthly':
            nextDate.setMonth(nextDate.getMonth() + (this.frequency.interval || 1));
            break;
        case 'quarterly':
            nextDate.setMonth(nextDate.getMonth() + 3 * (this.frequency.interval || 1));
            break;
        case 'yearly':
            nextDate.setFullYear(nextDate.getFullYear() + (this.frequency.interval || 1));
            break;
        case 'custom_days':
            if (Array.isArray(this.frequency.customDays) && this.frequency.customDays.length > 0) {
                nextDate.setDate(nextDate.getDate() + this.frequency.customDays[0]);
            }
            break;
    }
    
    // Check if we've reached the end date or max occurrences
    if (this.frequency.endDate && nextDate > new Date(this.frequency.endDate)) {
        return null; // No more occurrences
    }
    
    return nextDate;
};

// Method to update status and record in history
scheduledMaintenanceSchema.methods.updateStatus = async function(newStatus, userId, notes = '') {
    const oldStatus = this.status;
    this.status = newStatus;
    
    // Add to status history
    if (!this.statusHistory) {
        this.statusHistory = [];
    }
    
    this.statusHistory.push({
        status: newStatus,
        changedAt: new Date(),
        changedBy: userId,
        notes: notes
    });
    
    // Handle completed status
    if (newStatus === 'completed' && !this.lastExecutedAt) {
        this.lastExecutedAt = new Date();
        
        // If recurring, calculate next due date
        if (this.recurring) {
            const nextDueDate = this.calculateNextDueDate();
            if (nextDueDate) {
                this.nextDueDate = nextDueDate;
                this.nextExecutionAttempt = nextDueDate;
                this.status = 'scheduled'; // Reset for next occurrence
                
                // Add scheduled status to history
                this.statusHistory.push({
                    status: 'scheduled',
                    changedAt: new Date(),
                    changedBy: userId,
                    notes: `Automatically scheduled next occurrence for ${nextDueDate.toLocaleDateString()}`
                });
            }
        }
    }
    
    await this.save();
    return { oldStatus, newStatus };
};

// Add a method to add a comment to the task
scheduledMaintenanceSchema.methods.addComment = async function(commentId) {
    if (!this.comments) {
        this.comments = [];
    }
    this.comments.push(commentId);
    return this.save();
};

// Add a method to add a request reference
scheduledMaintenanceSchema.methods.addGeneratedRequest = async function(requestId) {
    if (!this.generatedRequests) {
        this.generatedRequests = [];
    }
    this.generatedRequests.push(requestId);
    this.lastGeneratedRequest = requestId;
    return this.save();
};

// Method to handle media management
scheduledMaintenanceSchema.methods.addMedia = async function(mediaId) {
    if (!this.media) {
        this.media = [];
    }
    this.media.push(mediaId);
    return this.save();
};

scheduledMaintenanceSchema.methods.removeMedia = async function(mediaId) {
    if (!this.media || this.media.length === 0) {
        return this;
    }
    this.media = this.media.filter(id => !id.equals(mediaId));
    return this.save();
};

// Method to get active requests generated from this task
scheduledMaintenanceSchema.methods.getActiveRequests = async function() {
    return Request.find({
        generatedFromScheduledMaintenance: this._id,
        status: { $nin: ['completed', 'verified', 'archived'] }
    });
};

// Indexes for efficient queries
scheduledMaintenanceSchema.index({ property: 1, unit: 1, status: 1, scheduledDate: 1 });
scheduledMaintenanceSchema.index({ assignedTo: 1, assignedToModel: 1, status: 1 });
scheduledMaintenanceSchema.index({ createdByPropertyUser: 1 });
scheduledMaintenanceSchema.index({ nextDueDate: 1, status: 1, recurring: 1 }); // For finding due tasks
scheduledMaintenanceSchema.index({ publicLinkToken: 1, publicLinkEnabled: 1, publicLinkExpires: 1 }); // For public access

module.exports = mongoose.models.ScheduledMaintenance || mongoose.model('ScheduledMaintenance', scheduledMaintenanceSchema);