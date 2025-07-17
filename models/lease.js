// server/models/lease.js
const mongoose = require('mongoose');
const { LEASE_STATUS_ENUM } = require('../utils/constants/enums');

const LeaseSchema = new mongoose.Schema({
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
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    landlord: { // This landlord field might be redundant if landlord is determined via PropertyUser
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    leaseStartDate: {
        type: Date,
        required: true
    },
    leaseEndDate: {
        type: Date,
        required: true
    },
    monthlyRent: {
        type: Number,
        required: true,
        min: 0
    },
    currency: {
        type: String,
        default: 'UGX',
        required: true
    },
    paymentDueDate: {
        type: Number,
        required: true,
        min: 1,
        max: 31
    },
    securityDeposit: {
        type: Number,
        default: 0
    },
    terms: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: LEASE_STATUS_ENUM,
        default: 'active'
    },
    documents: [{ // Now referencing Media model directly for consistency
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media'
    }],
    renewalNoticeSent: {
        type: Boolean,
        default: false
    },
    lastRenewalNoticeDate: Date,
    version: {
        type: Number,
        default: 1
    },
    amendments: [{
        amendmentDate: { type: Date, default: Date.now },
        description: { type: String, trim: true },
        document: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', default: null } // Now referencing Media
    }]
}, {
    timestamps: true
});

// Indexes for efficient querying
LeaseSchema.index({ tenant: 1 });
LeaseSchema.index({ property: 1 });
LeaseSchema.index({ unit: 1 });
LeaseSchema.index({ leaseEndDate: 1 });

module.exports = mongoose.models.Lease || mongoose.model('Lease', LeaseSchema);