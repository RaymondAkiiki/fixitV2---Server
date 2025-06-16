// backend/models/Invite.js

const mongoose = require('mongoose');

const inviteSchema = new mongoose.Schema({
    email: { // Email of the person being invited
        type: String, 
        required: [true, 'Email is required for an invitation.'],
        trim: true,
        lowercase: true, // Store emails in lowercase
    },
    role: { // Role the invited user will have
        type: String, 
        enum: ['tenant', 'landlord', 'propertymanager', 'vendor'], // Ensure consistency with lowercase roles
        required: [true, 'Role is required for an invitation.'],
        lowercase: true,
    },
    property: { // For tenant/PM/landlord invites to a specific property
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Property' 
    }, 
    unit: { // For tenant invites to a specific unit
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Unit', 
        default: null 
    }, 
    token: { // The unique invitation token
        type: String, 
        required: true, 
        unique: true 
    },    
    generatedBy: { // The user who generated this invite
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    status: { // Current status of the invitation
        type: String, 
        enum: ['Pending', 'Accepted', 'Expired', 'Revoked'], 
        default: 'Pending' 
    },
    expiresAt: { // When the invitation token expires
        type: Date, 
        required: true 
    },
    acceptedBy: { // The user who accepted this invitation (link to User model)
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    }, 
    // Removed 'accepted' boolean as 'status' enum covers this.
}, { 
    timestamps: true 
});

// Indexes for common queries to improve performance
inviteSchema.index({ email: 1 });
inviteSchema.index({ property: 1 });
inviteSchema.index({ status: 1 });
inviteSchema.index({ token: 1 }); // Index on token for quick lookups

module.exports = mongoose.model('Invite', inviteSchema);
