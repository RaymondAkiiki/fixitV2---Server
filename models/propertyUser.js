// src/models/propertyUser.js

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
        roles: {
            type: [String],
            enum: PROPERTY_USER_ROLES_ENUM,
            required: [true, 'At least one role is required for PropertyUser association.'],
            validate: {
                validator: function(roles) {
                    return roles && roles.length > 0;
                },
                message: 'At least one role must be specified'
            }
        },
        invitedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        isActive: {
            type: Boolean,
            default: true,
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
        },
        leaseInfo: {
            leaseId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Lease',
                default: null
            },
            leaseStartDate: {
                type: Date,
                default: null
            },
            leaseEndDate: {
                type: Date,
                default: null
            }
        }
    },
    { 
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

// Prevent duplicate associations
propertyUserSchema.index({ user: 1, property: 1, unit: 1 }, { unique: true });

// Indexes for fast lookup of users by property, role, or unit
propertyUserSchema.index({ property: 1, 'roles': 1, isActive: 1 });
propertyUserSchema.index({ user: 1, 'roles': 1, isActive: 1 });
propertyUserSchema.index({ unit: 1, 'roles': 1, isActive: 1 });
propertyUserSchema.index({ 'leaseInfo.leaseId': 1 });

// Virtual for lease status
propertyUserSchema.virtual('isLeaseActive').get(function() {
    if (!this.leaseInfo.leaseStartDate || !this.leaseInfo.leaseEndDate) return false;
    const now = new Date();
    return now >= this.leaseInfo.leaseStartDate && now <= this.leaseInfo.leaseEndDate;
});

// Helper methods for common queries
propertyUserSchema.statics.getLandlordsForProperty = async function(propertyId) {
    return this.find({ 
        property: propertyId, 
        roles: PROPERTY_USER_ROLES_ENUM.LANDLORD,
        isActive: true 
    }).populate('user');
};

propertyUserSchema.statics.getPropertyManagersForProperty = async function(propertyId) {
    return this.find({ 
        property: propertyId, 
        roles: PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
        isActive: true 
    }).populate('user');
};

propertyUserSchema.statics.getTenantsForUnit = async function(unitId) {
    return this.find({ 
        unit: unitId, 
        roles: PROPERTY_USER_ROLES_ENUM.TENANT,
        isActive: true 
    }).populate('user');
};

propertyUserSchema.statics.getUserRolesForProperty = async function(userId, propertyId) {
    const propertyUser = await this.findOne({
        user: userId,
        property: propertyId,
        isActive: true
    });
    
    return propertyUser ? propertyUser.roles : [];
};

propertyUserSchema.statics.hasRole = async function(userId, propertyId, role, unitId = null) {
    const query = {
        user: userId,
        property: propertyId,
        roles: role,
        isActive: true
    };
    
    if (unitId) {
        query.unit = unitId;
    }
    
    const count = await this.countDocuments(query);
    return count > 0;
};

module.exports = mongoose.models.PropertyUser || mongoose.model('PropertyUser', propertyUserSchema);