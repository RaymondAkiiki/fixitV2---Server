// src/models/property.js

const mongoose = require('mongoose');
const addressSchema = require('./schemas/AddressSchema');
const { PROPERTY_TYPE_ENUM } = require('../utils/constants/enums');

const propertySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Property name is required.'],
        trim: true,
        unique: true,
        maxlength: [150, 'Property name cannot exceed 150 characters.']
    },
    address: {
        type: addressSchema,
        required: [true, 'Property address is required.'],
    },
    propertyType: {
        type: String,
        enum: PROPERTY_TYPE_ENUM,
        default: 'residential',
        lowercase: true,
        index: true
    },
    yearBuilt: {
        type: Number,
        min: [1000, 'Year built must be a valid year.'],
        max: [new Date().getFullYear(), 'Year built cannot be in the future.'],
        default: null
    },
    numberOfUnits: {
        type: Number,
        min: 0,
        default: 0
    },
    units: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit'
    }],
    details: {
        type: String,
        maxlength: [2000, 'Details cannot exceed 2000 characters.'],
        default: null
    },
    amenities: {
        type: [String],
        default: []
    },
    createdByPropertyUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PropertyUser',
        required: false,
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    annualOperatingBudget: {
        type: Number,
        min: 0,
        default: 0
    },
    notes: {
        type: String,
        maxlength: [2000, 'Notes cannot exceed 2000 characters.'],
        default: null
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            default: [0, 0]
        }
    },
    images: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media'
    }]
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for full address
propertySchema.virtual('fullAddress').get(function() {
    const addr = this.address || {};
    const parts = [
        addr.street,
        addr.city,
        addr.state,
        addr.zipCode,
        addr.country
    ].filter(Boolean);
    
    return parts.join(', ');
});

// Virtual to get the creator User
propertySchema.virtual('createdBy').get(async function() {
    if (!this.populated('createdByPropertyUser')) {
        await this.populate({
            path: 'createdByPropertyUser',
            populate: {
                path: 'user',
                select: 'firstName lastName email'
            }
        });
    }
    
    return this.createdByPropertyUser?.user || null;
});

// Virtual to get property managers
propertySchema.virtual('propertyManagers').get(async function() {
    const PropertyUser = mongoose.model('PropertyUser');
    const propertyManagers = await PropertyUser.find({
        property: this._id,
        roles: 'propertymanager',
        isActive: true
    }).populate('user', 'firstName lastName email phone avatar');
    
    return propertyManagers.map(pm => pm.user);
});

// Virtual to get landlords
propertySchema.virtual('landlords').get(async function() {
    const PropertyUser = mongoose.model('PropertyUser');
    const landlords = await PropertyUser.find({
        property: this._id,
        roles: 'landlord',
        isActive: true
    }).populate('user', 'firstName lastName email phone avatar');
    
    return landlords.map(l => l.user);
});

// Virtual to get active tenant count
propertySchema.virtual('tenantCount').get(async function() {
    const PropertyUser = mongoose.model('PropertyUser');
    return await PropertyUser.countDocuments({
        property: this._id,
        roles: 'tenant',
        isActive: true
    });
});

// Virtual to get vacancy rate
propertySchema.virtual('vacancyRate').get(async function() {
    const Unit = mongoose.model('Unit');
    
    if (!this.units || this.units.length === 0) {
        return 0;
    }
    
    const vacantCount = await Unit.countDocuments({
        _id: { $in: this.units },
        status: 'vacant',
        isActive: true
    });
    
    return this.units.length > 0 ? (vacantCount / this.units.length) * 100 : 0;
});

// Indexes
propertySchema.index({ 'address.city': 1 });
propertySchema.index({ 'address.country': 1 });
propertySchema.index({ createdByPropertyUser: 1 });
propertySchema.index({ location: '2dsphere' }); // Spatial index for geolocation queries

module.exports = mongoose.models.Property || mongoose.model('Property', propertySchema);