// backend/models/Property.js

const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: [true, 'Property name is required.'],
        trim: true
    },
    address: { // Subdocument for address details
        street: { type: String, trim: true },
        state: { type: String, trim: true },
        city: { type: String, required: [true, 'City is required for property address.'], trim: true },
        country: { type: String, required: [true, 'Country is required for property address.'], trim: true }
    },
    // --- Relationship Fields (Managed via PropertyUser model) ---
    // Removed `landlord` (single ref), `propertyManager` (single ref), and `tenants` (array of all tenants).
    // These relationships are now defined and queried through the `PropertyUser` collection.
    // This design is more flexible for multiple landlords, PMs, and tenants per property/unit.
    // For example, to get all landlords of a property, you would query `PropertyUser` for `property: this._id, roles: 'landlord'`.
    
    units: [{ // Direct reference to units belonging to this property
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Unit' 
    }],
    details: { // e.g., number of floors, amenities, property type
        type: String, 
        maxlength: [1000, 'Details cannot exceed 1000 characters.'],
        default: null 
    }, 
    
    // The user who initially created this property record
    createdBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: [true, 'Creator is required for the property.'] 
    },

    isActive: { // Can deactivate a property
        type: Boolean,
        default: true
    }

}, { 
    timestamps: true // Adds createdAt and updatedAt fields
});

// Indexes for common queries
propertySchema.index({ name: 1 });
propertySchema.index({ 'address.city': 1 }); // Index on city for geographical queries
propertySchema.index({ createdBy: 1 }); // Index for finding properties created by a user

module.exports = mongoose.models.Property || mongoose.model('Property', propertySchema);
