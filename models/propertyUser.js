// server/models/propertyUser.js
const mongoose = require('mongoose');
const { PROPERTY_USER_ROLES_ENUM } = require('../utils/constants/enums');

const propertyUserSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'User is required for PropertyUser association.'],
            index: true
        },
        property: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Property',
            required: [true, 'Property is required for PropertyUser association.'],
            index: true
        },
        unit: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Unit',
            default: null,
            sparse: true,
            index: true
        },
        roles: [{
            type: String,
            enum: PROPERTY_USER_ROLES_ENUM,
            required: [true, 'At least one role is required for PropertyUser association.'],
            lowercase: true,
        }],
        invitedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        isActive: {
            type: Boolean,
            default: true
        },
        startDate: {
            type: Date,
            default: Date.now
        },
        endDate: {
            type: Date,
            default: null
        },
        permissions: {
            type: [String],
            default: []
        }
    },
    { timestamps: true }
);

// Compound index to ensure uniqueness for a given user, property, unit, and *a specific role*
// Keeping this as is per the previous discussion, recognizing it prevents exact duplicates.
// If a user can have multiple roles on the *same property/unit* via a *single* PropertyUser entry,
// this index needs to be 'user: 1, property: 1, unit: 1'. For now, it implies separate entries for distinct roles.
propertyUserSchema.index({ user: 1, property: 1, unit: 1, roles: 1 }, { unique: true });

// Indexes for fast lookup of users by property, role, or unit
propertyUserSchema.index({ property: 1, roles: 1 });
propertyUserSchema.index({ user: 1, roles: 1 });
propertyUserSchema.index({ isActive: 1 });

module.exports = mongoose.models.PropertyUser || mongoose.model('PropertyUser', propertyUserSchema);