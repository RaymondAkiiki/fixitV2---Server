// server/models/rent.js
const mongoose = require('mongoose');
const { PAYMENT_STATUS_ENUM } = require('../utils/constants/enums');

const RentSchema = new mongoose.Schema({
    lease: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lease',
        required: true
    },
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: true
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        required: true
    },
    billingPeriod: {
        type: String,
        // Removed `required: true` and added enum validation, it should derive from RentSchedule/Lease
        // This might be redundant if the Rent document is generated from a RentSchedule
    },
    amountDue: {
        type: Number,
        required: true,
        min: 0
    },
    dueDate: {
        type: Date,
        required: true
    },
    amountPaid: {
        type: Number,
        default: 0,
        min: 0
    },
    paymentDate: Date,
    status: {
        type: String,
        enum: PAYMENT_STATUS_ENUM,
        default: 'due'
    },
    paymentMethod: {
        type: String,
        trim: true
    },
    transactionId: {
        type: String,
        trim: true
    },
    paymentProof: { // Now referencing Media model directly for consistency
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media',
        default: null
    },
    notes: {
        type: String,
        trim: true
    },
    reminderSent: {
        type: Boolean,
        default: false
    },
    lastReminderDate: Date,
}, {
    timestamps: true
});

// Indexes for efficient querying
RentSchema.index({ lease: 1 });
RentSchema.index({ tenant: 1 });
RentSchema.index({ property: 1 });
RentSchema.index({ unit: 1 });
RentSchema.index({ dueDate: 1, status: 1 });

module.exports = mongoose.models.Rent || mongoose.model('Rent', RentSchema);