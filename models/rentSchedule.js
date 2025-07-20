// src/models/rentSchedule.js

const mongoose = require('mongoose');
const { RENT_BILLING_PERIOD_ENUM } = require('../utils/constants/enums');

const RentScheduleSchema = new mongoose.Schema({
    lease: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lease',
        required: [true, 'Lease is required for rent schedule'],
        index: true
    },
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Tenant is required for rent schedule'],
        index: true
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: [true, 'Property is required for rent schedule'],
        index: true
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        required: [true, 'Unit is required for rent schedule'],
        index: true
    },
    amount: {
        type: Number,
        required: [true, 'Rent amount is required'],
        min: [0, 'Rent amount cannot be negative']
    },
    currency: {
        type: String,
        default: 'UGX',
        required: [true, 'Currency is required'],
        trim: true,
        uppercase: true
    },
    dueDateDay: {
        type: Number,
        required: [true, 'Due date day is required'],
        min: [1, 'Due date day must be at least 1'],
        max: [31, 'Due date day cannot exceed 31']
    },
    billingPeriod: {
        type: String,
        enum: {
            values: RENT_BILLING_PERIOD_ENUM,
            message: '"{VALUE}" is not a valid billing period'
        },
        required: [true, 'Billing period is required'],
        lowercase: true
    },
    effectiveStartDate: {
        type: Date,
        required: [true, 'Effective start date is required'],
        index: true
    },
    effectiveEndDate: {
        type: Date,
        default: null,
        index: true,
        sparse: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    autoGenerateRent: {
        type: Boolean,
        default: true
    },
    lastGeneratedDate: {
        type: Date,
        default: null
    },
    notes: {
        type: String,
        trim: true,
        maxlength: [1000, 'Notes cannot exceed 1000 characters'],
        default: null
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Creator is required for rent schedule']
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Compound index to ensure a unique rent schedule per lease for a given period
// This ensures that for a specific lease, there isn't overlapping active schedules
RentScheduleSchema.index(
    { lease: 1, effectiveStartDate: 1, effectiveEndDate: 1 }, 
    { unique: true, partialFilterExpression: { isActive: true } }
);

// Additional indexes for common queries
RentScheduleSchema.index({ tenant: 1, isActive: 1 });
RentScheduleSchema.index({ property: 1, isActive: 1 });
RentScheduleSchema.index({ unit: 1, isActive: 1 });
RentScheduleSchema.index({ dueDateDay: 1 });
RentScheduleSchema.index({ 'billingPeriod': 1, isActive: 1 });

/**
 * Calculate the next due date based on current date and dueDateDay
 * @param {Date} [baseDate=new Date()] - Optional base date to calculate from
 * @returns {Date} Next due date
 */
RentScheduleSchema.methods.calculateNextDueDate = function(baseDate = new Date()) {
    const today = new Date(baseDate);
    const dueDateDay = this.dueDateDay;
    
    // Get current month's due date
    const currentMonthDue = new Date(today.getFullYear(), today.getMonth(), dueDateDay);
    
    // If today is before or equal to current month's due date, return current month's due date
    if (today <= currentMonthDue) {
        return currentMonthDue;
    }
    
    // Otherwise, return next month's due date
    return new Date(today.getFullYear(), today.getMonth() + 1, dueDateDay);
};

/**
 * Get the billing period in YYYY-MM format for a given date
 * @param {Date} [date=new Date()] - Date to get billing period for
 * @returns {string} Billing period in YYYY-MM format
 */
RentScheduleSchema.methods.getBillingPeriodForDate = function(date = new Date()) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${year}-${month}`;
};

/**
 * Check if schedule is applicable for a given date
 * @param {Date} [date=new Date()] - Date to check
 * @returns {boolean} True if schedule is applicable for the date
 */
RentScheduleSchema.methods.isApplicableForDate = function(date = new Date()) {
    if (!this.isActive) return false;
    
    const checkDate = new Date(date);
    const startDate = new Date(this.effectiveStartDate);
    
    // Check if date is after start date
    if (checkDate < startDate) return false;
    
    // Check if date is before end date (if specified)
    if (this.effectiveEndDate && checkDate > new Date(this.effectiveEndDate)) {
        return false;
    }
    
    return true;
};

module.exports = mongoose.models.RentSchedule || mongoose.model('RentSchedule', RentScheduleSchema);