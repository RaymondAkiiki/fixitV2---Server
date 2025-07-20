// src/models/lease.js

const mongoose = require('mongoose');
const { LEASE_STATUS_ENUM, AUDIT_RESOURCE_TYPE_ENUM } = require('../utils/constants/enums');

const leaseAmendmentSchema = new mongoose.Schema({
    amendmentDate: { 
        type: Date, 
        default: Date.now 
    },
    description: { 
        type: String, 
        trim: true,
        required: [true, 'Amendment description is required'] 
    },
    document: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Media', 
        default: null 
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { _id: true, timestamps: true });

const LeaseSchema = new mongoose.Schema({
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: [true, 'Property is required'],
        index: true
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        required: [true, 'Unit is required'],
        index: true
    },
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Tenant is required'],
        index: true
    },
    landlord: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Landlord is required'],
        index: true
    },
    leaseStartDate: {
        type: Date,
        required: [true, 'Lease start date is required']
    },
    leaseEndDate: {
        type: Date,
        required: [true, 'Lease end date is required'],
        validate: {
            validator: function(value) {
                return value > this.leaseStartDate;
            },
            message: 'Lease end date must be after the start date'
        }
    },
    monthlyRent: {
        type: Number,
        required: [true, 'Monthly rent is required'],
        min: [0, 'Monthly rent cannot be negative']
    },
    currency: {
        type: String,
        default: 'UGX',
        required: [true, 'Currency is required'],
        trim: true,
        uppercase: true
    },
    paymentDueDate: {
        type: Number,
        required: [true, 'Payment due date is required'],
        min: [1, 'Payment due date must be between 1 and 31'],
        max: [31, 'Payment due date must be between 1 and 31']
    },
    securityDeposit: {
        type: Number,
        default: 0,
        min: [0, 'Security deposit cannot be negative']
    },
    terms: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: LEASE_STATUS_ENUM,
        default: 'active',
        lowercase: true,
        index: true
    },
    documents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media'
    }],
    renewalNoticeSent: {
        type: Boolean,
        default: false
    },
    lastRenewalNoticeDate: {
        type: Date,
        default: null
    },
    version: {
        type: Number,
        default: 1
    },
    amendments: [leaseAmendmentSchema],
    isActive: {
        type: Boolean,
        default: true,
    },
    terminatedAt: {
        type: Date,
        default: null
    },
    terminatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    terminationReason: {
        type: String,
        trim: true,
        default: null
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
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

// Virtual for lease duration in months
LeaseSchema.virtual('durationMonths').get(function() {
    if (!this.leaseStartDate || !this.leaseEndDate) return null;
    
    const startDate = new Date(this.leaseStartDate);
    const endDate = new Date(this.leaseEndDate);
    
    const diffMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 + 
                       (endDate.getMonth() - startDate.getMonth());
    
    return diffMonths;
});

// Virtual for total rent amount over the lease period
LeaseSchema.virtual('totalRentAmount').get(function() {
    const months = this.durationMonths;
    return months ? months * this.monthlyRent : null;
});

// Virtual for days remaining in lease
LeaseSchema.virtual('daysRemaining').get(function() {
    if (!this.leaseEndDate || this.status !== 'active') return 0;
    
    const today = new Date();
    const endDate = new Date(this.leaseEndDate);
    
    if (endDate <= today) return 0;
    
    const diffTime = endDate.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for lease status display
LeaseSchema.virtual('statusDisplay').get(function() {
    switch (this.status) {
        case 'active':
            return 'Active';
        case 'expired':
            return 'Expired';
        case 'terminated':
            return 'Terminated';
        case 'pending_renewal':
            return 'Pending Renewal';
        default:
            return this.status.charAt(0).toUpperCase() + this.status.slice(1);
    }
});

// Virtual for tenant property user
LeaseSchema.virtual('tenantPropertyUser').get(async function() {
    const PropertyUser = mongoose.model('PropertyUser');
    return await PropertyUser.findOne({
        user: this.tenant,
        property: this.property,
        unit: this.unit,
        roles: 'tenant',
        isActive: true
    });
});

// Virtual for landlord property user
LeaseSchema.virtual('landlordPropertyUser').get(async function() {
    const PropertyUser = mongoose.model('PropertyUser');
    return await PropertyUser.findOne({
        user: this.landlord,
        property: this.property,
        roles: 'landlord',
        isActive: true
    });
});

// Pre-save middleware to enforce business rules
LeaseSchema.pre('save', async function(next) {
    // If this is a new lease or the status is being changed to 'terminated'
    if (this.isNew || this.isModified('status')) {
        if (this.status === 'terminated' && !this.terminatedAt) {
            this.terminatedAt = new Date();
        }
    }
    
    next();
});

// Index for efficient querying
LeaseSchema.index({ property: 1, unit: 1, status: 1 });
LeaseSchema.index({ tenant: 1, status: 1 });
LeaseSchema.index({ leaseEndDate: 1, status: 1 });
LeaseSchema.index({ isActive: 1 });

module.exports = mongoose.models.Lease || mongoose.model('Lease', LeaseSchema);