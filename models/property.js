// server/models/property.js
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
    address: { // Subdocument for address details
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
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Creator is required for the property.']
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
    mainContactUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

}, {
    timestamps: true
});

// Indexes for common queries
propertySchema.index({ 'address.city': 1 });
propertySchema.index({ 'address.country': 1 });
propertySchema.index({ createdBy: 1 });

module.exports = mongoose.models.Property || mongoose.model('Property', propertySchema);