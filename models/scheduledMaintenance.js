// server/models/scheduledMaintenance.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { CATEGORY_ENUM, FREQUENCY_TYPE_ENUM, SCHEDULED_MAINTENANCE_STATUS_ENUM, ASSIGNED_TO_MODEL_ENUM } = require('../utils/constants/enums');

const scheduledMaintenanceSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Title is required for scheduled maintenance.'],
        trim: true,
        maxlength: [200, 'Title cannot exceed 200 characters.']
    },
    description: {
        type: String,
        required: [true, 'Description is required for scheduled maintenance.'],
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
                enum: FREQUENCY_TYPE_ENUM,
                default: null,
                lowercase: true
            },
            interval: { type: Number, default: 1, min: 1 },
            dayOfWeek: {
                type: [Number],
                validate: {
                    validator: function(v) { return v === null || (Array.isArray(v) && v.every(num => num >= 0 && num <= 6)); },
                    message: 'dayOfWeek must be an array of numbers between 0 and 6 or null.'
                },
                default: null
            },
            dayOfMonth: {
                type: [Number],
                validate: {
                    validator: function(v) { return v === null || (Array.isArray(v) && v.every(num => num >= 1 && num <= 31)); },
                    message: 'dayOfMonth must be an array of numbers between 1 and 31 or null.'
                },
                default: null
            },
            monthOfYear: {
                type: [Number],
                validate: {
                    validator: function(v) { return v === null || (Array.isArray(v) && v.every(num => num >= 1 && num <= 12)); },
                    message: 'monthOfYear must be an array of numbers between 1 and 12 or null.'
                },
                default: null
            },
            customDays: {
                type: [Number],
                validate: {
                    validator: function(v) { return Array.isArray(v) && v.every(num => num >= 0); },
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
                min: 1,
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
        enum: SCHEDULED_MAINTENANCE_STATUS_ENUM,
        default: 'active',
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
        enum: ASSIGNED_TO_MODEL_ENUM,
        default: null
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Creator is required for scheduled maintenance.']
    },
    media: [{ // Now referencing Media model directly for consistency
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media'
    }],
    comments: [{ // Now referencing Comment model directly for consistency
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
    }

}, {
    timestamps: true
});

// Pre-save hook for handling public link token generation
scheduledMaintenanceSchema.pre('save', function(next) {
    if (this.publicLinkEnabled && !this.publicLinkToken) {
        this.publicLinkToken = uuidv4();
        if (!this.publicLinkExpires) {
            this.publicLinkExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }
    }
    next();
});

// Indexes
scheduledMaintenanceSchema.index({ property: 1, unit: 1, status: 1, scheduledDate: 1 });
scheduledMaintenanceSchema.index({ assignedTo: 1, status: 1 });

module.exports = mongoose.models.ScheduledMaintenance || mongoose.model('ScheduledMaintenance', scheduledMaintenanceSchema);