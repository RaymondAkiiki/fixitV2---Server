// src/models/onboarding.js

const mongoose = require('mongoose');
const { ONBOARDING_CATEGORY_ENUM, ONBOARDING_VISIBILITY_ENUM } = require('../utils/constants/enums');

const OnboardingSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true,
        maxlength: [200, 'Title cannot exceed 200 characters']
    },
    description: {
        type: String,
        trim: true,
        maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    category: {
        type: String,
        enum: {
            values: ONBOARDING_CATEGORY_ENUM,
            message: '"{VALUE}" is not a valid category'
        },
        required: [true, 'Category is required'],
        lowercase: true
    },
    visibility: {
        type: String,
        enum: {
            values: ONBOARDING_VISIBILITY_ENUM,
            message: '"{VALUE}" is not a valid visibility setting'
        },
        required: [true, 'Visibility is required'],
        default: 'property_tenants',
        lowercase: true
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        index: true
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        index: true
    },
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    media: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media',
        required: [true, 'Media file is required']
    },
    isCompleted: {
        type: Boolean,
        default: false,
        index: true
    },
    completedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    completedAt: {
        type: Date,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Creator is required']
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Pre-save hook to ensure consistency between property and unit
OnboardingSchema.pre('save', async function(next) {
    // If unit is specified, ensure its property matches the specified property
    if (this.unit && this.property) {
        const Unit = mongoose.model('Unit');
        const unit = await Unit.findById(this.unit);
        
        if (unit && !unit.property.equals(this.property)) {
            this.invalidate('unit', 'Unit must belong to the specified property');
            return next(new Error('Unit must belong to the specified property'));
        }
    }
    
    // If tenant is specified, ensure they are associated with the property/unit
    if (this.tenant && (this.property || this.unit)) {
        const PropertyUser = mongoose.model('PropertyUser');
        
        // If property is specified, ensure tenant is associated with it
        if (this.property) {
            const propertyUserExists = await PropertyUser.exists({
                user: this.tenant,
                property: this.property,
                roles: { $in: ['tenant'] },
                isActive: true
            });
            
            if (!propertyUserExists) {
                this.invalidate('tenant', 'Tenant must be associated with the specified property');
                return next(new Error('Tenant must be associated with the specified property'));
            }
        }
        
        // If unit is specified, ensure tenant is associated with it
        if (this.unit) {
            const unitUserExists = await PropertyUser.exists({
                user: this.tenant,
                unit: this.unit,
                roles: { $in: ['tenant'] },
                isActive: true
            });
            
            if (!unitUserExists) {
                this.invalidate('tenant', 'Tenant must be associated with the specified unit');
                return next(new Error('Tenant must be associated with the specified unit'));
            }
        }
    }
    
    // Validate visibility settings against required fields
    if (this.visibility === 'property_tenants' && !this.property) {
        this.invalidate('property', 'Property is required for "property_tenants" visibility');
        return next(new Error('Property is required for "property_tenants" visibility'));
    }
    
    if (this.visibility === 'unit_tenants' && (!this.property || !this.unit)) {
        this.invalidate('unit', 'Property and unit are required for "unit_tenants" visibility');
        return next(new Error('Property and unit are required for "unit_tenants" visibility'));
    }
    
    if (this.visibility === 'specific_tenant' && !this.tenant) {
        this.invalidate('tenant', 'Tenant is required for "specific_tenant" visibility');
        return next(new Error('Tenant is required for "specific_tenant" visibility'));
    }
    
    next();
});

// Method to check if document is accessible by a user
OnboardingSchema.methods.isAccessibleBy = async function(userId, userRole) {
    // Admins can access all documents
    if (userRole === 'admin') return true;
    
    // Document creators can access their documents
    if (this.createdBy && this.createdBy.toString() === userId.toString()) return true;
    
    // Landlords can access documents for their properties
    if (userRole === 'landlord' && this.property) {
        const Property = mongoose.model('Property');
        const propertyExists = await Property.exists({
            _id: this.property,
            createdBy: userId
        });
        
        if (propertyExists) return true;
    }
    
    // Property managers can access documents for properties they manage
    if (userRole === 'property_manager' && this.property) {
        const PropertyUser = mongoose.model('PropertyUser');
        const managerExists = await PropertyUser.exists({
            user: userId,
            property: this.property,
            roles: { $in: ['property_manager', 'admin_access'] },
            isActive: true
        });
        
        if (managerExists) return true;
    }
    
    // Tenants can access based on visibility
    if (userRole === 'tenant') {
        const PropertyUser = mongoose.model('PropertyUser');
        
        // All tenants can access 'all_tenants' documents
        if (this.visibility === 'all_tenants') return true;
        
        // Specific tenant can access documents targeted at them
        if (this.visibility === 'specific_tenant' && this.tenant && this.tenant.toString() === userId.toString()) {
            return true;
        }
        
        // Property tenants can access property-level documents
        if (this.visibility === 'property_tenants' && this.property) {
            const tenantForProperty = await PropertyUser.exists({
                user: userId,
                property: this.property,
                roles: { $in: ['tenant'] },
                isActive: true
            });
            
            if (tenantForProperty) return true;
        }
        
        // Unit tenants can access unit-level documents
        if (this.visibility === 'unit_tenants' && this.unit) {
            const tenantForUnit = await PropertyUser.exists({
                user: userId,
                unit: this.unit,
                roles: { $in: ['tenant'] },
                isActive: true
            });
            
            if (tenantForUnit) return true;
        }
    }
    
    return false;
};

// Compound indexes for efficient querying
OnboardingSchema.index({ property: 1, visibility: 1, isActive: 1 });
OnboardingSchema.index({ unit: 1, visibility: 1, isActive: 1 });
OnboardingSchema.index({ tenant: 1, visibility: 1, isActive: 1 });
OnboardingSchema.index({ category: 1, isActive: 1 });
OnboardingSchema.index({ createdBy: 1, isActive: 1 });

module.exports = mongoose.models.Onboarding || mongoose.model('Onboarding', OnboardingSchema);