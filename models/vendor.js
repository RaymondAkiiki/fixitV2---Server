// backend/models/Vendor.js

const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: [true, 'Vendor name is required.'], 
        trim: true 
    },
    phone: { 
        type: String, 
        required: [true, 'Vendor phone number is required.'], 
        trim: true 
    },
    email: { 
        type: String, 
        required: [true, 'Vendor email is required.'], 
        trim: true, 
        unique: true, 
        lowercase: true 
    },
    address: { 
        type: String, 
        trim: true 
    },
    description: { 
        type: String, 
        maxlength: [1000, 'Description cannot exceed 1000 characters.'], 
        default: null 
    },
    services: { // Array of services the vendor provides (e.g., ['Plumbing', 'Electrical'])
        type: [String], 
        required: [true, 'At least one service is required for the vendor.'],
        enum: ['Plumbing', 'Electrical', 'HVAC', 'Appliance', 'Structural', 'Landscaping', 'Other', 'Cleaning', 'Security', 'Pest Control'] // Expanded services, match request categories
    },
    // Removed `properties` array here. If a vendor is "assigned" to a property
    // on a long-term basis, this might be handled via a `PropertyUser` entry
    // with role 'vendor', or by just assigning them to specific requests.
    // If a vendor strictly works for *specific* properties, this could be reconsidered,
    // but typically vendors are assigned per request.
    
    addedBy: { // PM or Landlord who added them
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: [true, 'AddedBy user is required.'] // Ensures accountability for who added the vendor
    },
}, { 
    timestamps: true // Adds createdAt and updatedAt fields
});

// Index for faster email lookups
vendorSchema.index({ email: 1 });
// Index for common service queries
vendorSchema.index({ services: 1 });

module.exports = mongoose.models.Vendor || mongoose.model('Vendor', vendorSchema);
