// models/onboarding.js
const mongoose = require('mongoose');
const { MEDIA_RELATED_TO_ENUM } = require('../utils/constants/enums'); // Import for consistency

const OnboardingSchema = new mongoose.Schema({
    landlord: { // The landlord who uploaded/owns this content
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    property: { // If content is specific to a property
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property'
    },
    unit: { // If content is specific to a unit (e.g., unit-specific appliance manuals)
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit'
    },
    tenant: { // If this content is assigned to a specific tenant (e.g., personalized welcome packet)
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    category: {
        type: String,
        enum: ['SOP', 'Training', 'Welcome Guide', 'Maintenance', 'Emergency Info', 'Other', 'Forms'], // Added 'Forms'
        default: 'SOP'
    },
    // Changed filePath and fileName to reference the Media model for centralized file management
    media: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media',
        required: [true, 'Onboarding content requires a linked media file.']
    },
    // To track if a tenant has viewed/completed this item (optional, for future features)
    isCompleted: {
        type: Boolean,
        default: false
    },
    completedBy: { // User who marked it as completed
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    completedAt: Date,
    // Who can view this onboarding content (e.g., 'all_tenants', 'specific_tenant', 'property_tenants')
    visibility: {
        type: String,
        enum: ['all_tenants', 'property_tenants', 'unit_tenants', 'specific_tenant'],
        default: 'property_tenants'
    }
}, {
    timestamps: true
});

// Pre-save hook to ensure the linked media's relatedTo/relatedId is consistent
OnboardingSchema.pre('save', async function(next) {
    if (this.isModified('media') && this.media) {
        // This assumes you'll update the Media document's relatedTo/Id when creating/updating Onboarding
        // For MVP, this might be handled at the service level rather than a schema hook for simplicity,
        // but it's good to consider for data integrity.
    }
    next();
});

// Indexes for efficient querying
OnboardingSchema.index({
    landlord: 1,
    category: 1
});
OnboardingSchema.index({
    property: 1,
    unit: 1,
    visibility: 1
});
OnboardingSchema.index({
    tenant: 1,
    isCompleted: 1
});

module.exports = mongoose.model('Onboarding', OnboardingSchema);