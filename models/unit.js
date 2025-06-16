// backend/models/Unit.js

const mongoose = require('mongoose');

const unitSchema = new mongoose.Schema({
    unitName: { // e.g., "A101", "Apt 203"
        type: String, 
        required: [true, 'Unit name is required.'],
        trim: true
    }, 
    floor: { 
        type: String,
        trim: true
    },
    details: { // e.g., "2 bed, 2 bath", "Corner unit with balcony"
        type: String, 
        maxlength: [1000, 'Details cannot exceed 1000 characters.'],
        default: null 
    },
    property: { // The property this unit belongs to
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Property', 
        index: true, 
        required: [true, 'Unit must belong to a property.'] 
    },
    tenants: [{ // Array of current tenants residing in this unit (for multiple tenants/roommates)
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    }], 
    // Removed single `tenant` field as `tenants` array is more flexible for roommates.

    // Optional: Add other unit-specific details
    numBedrooms: { type: Number, min: 0 },
    numBathrooms: { type: Number, min: 0 },
    squareFootage: { type: Number, min: 0 },
    rentAmount: { type: Number, min: 0 },
    status: { type: String, enum: ['occupied', 'vacant', 'under_maintenance', 'unavailable'], default: 'vacant', lowercase: true }

}, { 
    timestamps: true 
});

// Ensure unitName is unique within a specific property
unitSchema.index({ property: 1, unitName: 1 }, { unique: true });

// Index for efficient lookup of units by tenants
unitSchema.index({ tenants: 1 });

module.exports = mongoose.models.Unit || mongoose.model('Unit', unitSchema);
