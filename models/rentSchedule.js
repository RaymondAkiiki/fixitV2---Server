// src/models/rentSchedule.js

const mongoose = require('mongoose');
const { RENT_BILLING_PERIOD_ENUM } = require('../utils/constants/enums');

const RentScheduleSchema = new mongoose.Schema({
    // Reference to the Lease this schedule belongs to
    lease: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lease',
        required: [true, 'Lease is required for rent schedule.'],
        index: true
    },
    // Reference to the Tenant responsible for this rent
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Tenant is required for rent schedule.'],
        index: true
    },
    // Reference to the Property
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: [true, 'Property is required for rent schedule.'],
        index: true
    },
    // Reference to the Unit
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        required: [true, 'Unit is required for rent schedule.'],
        index: true
    },
    // The amount of rent due for each period
    amount: {
        type: Number,
        required: [true, 'Rent amount is required.'],
        min: [0, 'Rent amount cannot be negative.']
    },
    // Currency for the rent amount (e.g., UGX, USD)
    currency: {
        type: String,
        default: 'UGX',
        required: [true, 'Currency is required.'],
        trim: true
    },
    // The day of the month rent is due (1-31)
    dueDateDay: {
        type: Number,
        required: [true, 'Due date day is required.'],
        min: [1, 'Due date day must be at least 1.'],
        max: [31, 'Due date day cannot exceed 31.']
    },
    // How often the rent is billed (e.g., 'monthly', 'quarterly')
    billingPeriod: {
        type: String,
        enum: {
            values: RENT_BILLING_PERIOD_ENUM,
            message: '"{VALUE}" is not a valid billing period.'
        },
        required: [true, 'Billing period is required.'],
        lowercase: true
    },
    // Date from which this rent schedule is effective
    effectiveStartDate: {
        type: Date,
        required: [true, 'Effective start date is required.'],
        index: true
    },
    // Date until which this rent schedule is effective (can be null for indefinite)
    effectiveEndDate: {
        type: Date,
        default: null,
        index: true,
        sparse: true // Allows null values but indexes non-null values
    },
    // A flag to indicate if this schedule is currently active
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    // Notes related to the rent schedule
    notes: {
        type: String,
        trim: true,
        maxlength: [1000, 'Notes cannot exceed 1000 characters.'],
        default: null
    },
    // User who created this rent schedule
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Creator is required for rent schedule.']
    },

}, {
    timestamps: true // Adds createdAt and updatedAt fields
});

// Compound index to ensure a unique rent schedule per lease for a given period
// This ensures that for a specific lease, there isn't overlapping active schedules
RentScheduleSchema.index({ lease: 1, effectiveStartDate: 1, effectiveEndDate: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

// Indexes for common queries
RentScheduleSchema.index({ tenant: 1, isActive: 1 });
RentScheduleSchema.index({ property: 1, isActive: 1 });
RentScheduleSchema.index({ unit: 1, isActive: 1 });
RentScheduleSchema.index({ dueDateDay: 1 });

module.exports = mongoose.models.RentSchedule || mongoose.model('RentSchedule', RentScheduleSchema);