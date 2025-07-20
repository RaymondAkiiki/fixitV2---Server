// src/models/invite.js

const mongoose = require('mongoose');
const crypto = require('crypto');
const { INVITE_STATUS_ENUM, PROPERTY_USER_ROLES_ENUM } = require('../utils/constants/enums');

const inviteSchema = new mongoose.Schema({
    email: {
        type: String,
        required: [true, 'Email is required for an invitation.'],
        trim: true,
        lowercase: true,
        match: [
            /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
            'Please enter a valid email.',
        ],
        index: true
    },
    roles: {
        type: [String],
        enum: PROPERTY_USER_ROLES_ENUM,
        required: [true, 'At least one role is required for an invitation.'],
        validate: {
            validator: function(roles) {
                return roles && roles.length > 0;
            },
            message: 'At least one role must be specified'
        }
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: [function() { 
            return !this.roles.some(role => ['admin_access'].includes(role)); 
        }, 'Property is required for this role invite.']
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        default: null,
        required: [function() { 
            return this.roles.includes('tenant'); 
        }, 'Unit is required for tenant invites.'],
        sparse: true
    },
    token: { // The unique invitation token (unhashed) sent to the user
        type: String,
        required: true,
        unique: true,
        index: true
    },
    hashedToken: {
        type: String,
        required: true,
        select: false
    },
    generatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: INVITE_STATUS_ENUM,
        default: 'pending',
        lowercase: true,
        index: true
    },
    expiresAt: {
        type: Date,
        required: true,
    },
    acceptedAt: {
        type: Date,
        default: null
    },
    acceptedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    revokedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    revokedAt: {
        type: Date,
        default: null
    },
    declineReason: {
        type: String,
        default: null
    },
    attemptCount: {
        type: Number,
        default: 0
    },
    lastAttemptAt: {
        type: Date,
        default: null
    },
    resendCount: {
        type: Number,
        default: 0
    },
    lastResendAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Pre-save hook to hash the token before saving
inviteSchema.pre('save', async function(next) {
    if (this.isNew || this.isModified('token')) {
        this.hashedToken = crypto.createHash('sha256').update(this.token).digest('hex');
    }
    next();
});

// Pre-save hook to verify invite data integrity
inviteSchema.pre('save', async function(next) {
    // If invite has tenant role, unit must be provided
    if (this.roles.includes('tenant') && !this.unit) {
        next(new Error('Unit is required for tenant invites'));
    }

    // If admin_access role, property is optional
    if (this.roles.includes('admin_access') && !this.property) {
        this.property = null; // Explicitly set to null
    }

    // Ensure status changes are properly tracked
    if (this.isModified('status')) {
        if (this.status === 'accepted' && !this.acceptedAt) {
            this.acceptedAt = new Date();
        } else if (this.status === 'cancelled' && !this.revokedAt) {
            this.revokedAt = new Date();
        }
    }

    next();
});

// Method to verify invite token
inviteSchema.methods.verifyToken = function(plainToken) {
    const hashedPlainToken = crypto.createHash('sha256').update(plainToken).digest('hex');
    return hashedPlainToken === this.hashedToken && this.status === 'pending' && this.expiresAt > Date.now();
};

// Virtual to check if invite is expired
inviteSchema.virtual('isExpired').get(function() {
    return this.expiresAt < new Date();
});

// Method to check if the invite can be resent
inviteSchema.methods.canResend = function() {
    // Limit resends to 5 times and only for pending invites
    if (this.status !== 'pending' || this.resendCount >= 5) {
        return false;
    }
    
    // Allow resend once per day
    if (this.lastResendAt) {
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        return this.lastResendAt < oneDayAgo;
    }
    
    return true;
};

// Method to track login attempts
inviteSchema.methods.trackAttempt = function() {
    this.attemptCount += 1;
    this.lastAttemptAt = new Date();
    return this.save();
};

// Indexes for common queries to improve performance
inviteSchema.index({ email: 1, status: 1 });
inviteSchema.index({ property: 1, status: 1 });
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: 'pending' } });
inviteSchema.index({ roles: 1, status: 1 });

module.exports = mongoose.models.Invite || mongoose.model('Invite', inviteSchema);