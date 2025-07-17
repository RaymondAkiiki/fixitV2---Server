// server/models/invite.js
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
    },
    role: {
        type: String,
        enum: PROPERTY_USER_ROLES_ENUM,
        required: [true, 'Role is required for an invitation.'],
        lowercase: true,
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: [function() { return !['admin_access'].includes(this.role); }, 'Property is required for this role invite.']
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        default: null,
        required: [function() { return this.role === 'tenant'; }, 'Unit is required for tenant invites.'],
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
        required: true
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

// Method to verify invite token
inviteSchema.methods.verifyToken = function(plainToken) {
    const hashedPlainToken = crypto.createHash('sha256').update(plainToken).digest('hex');
    return hashedPlainToken === this.hashedToken && this.status === 'pending' && this.expiresAt > Date.now();
};

// Indexes for common queries to improve performance
inviteSchema.index({ email: 1, status: 1 });
inviteSchema.index({ property: 1, role: 1, status: 1 });
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: 'pending' } });

module.exports = mongoose.models.Invite || mongoose.model('Invite', inviteSchema);