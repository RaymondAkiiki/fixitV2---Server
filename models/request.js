// backend/models/Request.js

const mongoose = require('mongoose');
const crypto = require('crypto'); // For generating public token

const requestSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: [true, 'Request title is required.'],
        trim: true
    },
    description: { 
        type: String, 
        maxlength: [1000, 'Description cannot exceed 1000 characters.'],
        default: null 
    },
    category: { // Category of the maintenance issue
        type: String, 
        enum: ['plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'landscaping', 'other', 'security', 'pest_control', 'cleaning', 'scheduled'], // Consistent lowercase, expanded
        required: [true, 'Category is required.'],
        lowercase: true
    },
    priority: { 
        type: String, 
        enum: ['low', 'medium', 'high', 'urgent'], // Consistent lowercase
        default: 'low', 
        lowercase: true
    },
    media: [{ // Array of URLs to media files (photos, videos) stored in cloud storage
        type: String // Changed from `Media` ObjectId reference to direct URL string
    }],
    status: { // Current status of the request
        type: String, 
        enum: ['new', 'assigned', 'in_progress', 'completed', 'verified', 'reopened', 'archived'], // Expanded statuses, consistent lowercase
        default: 'new', 
        index: true,
        lowercase: true
    },
    property: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Property', 
        required: [true, 'Property is required for the request.'], 
        index: true 
    },
    unit: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Unit', 
        required: null,
        index: true 
    },
    createdBy: { // The user (Tenant, PM, or Landlord) who submitted the request
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: [true, 'Creator is required for the request.']
    },
    // Polymorphic assignment: can be assigned to a User (PM/Landlord/Admin) or a Vendor
    assignedTo: { 
        type: mongoose.Schema.Types.ObjectId, 
        refPath: 'assignedToModel', 
        default: null 
    }, 
    assignedToModel: { // Stores the model name ('User' or 'Vendor') for `assignedTo`
        type: String, 
        enum: ['User', 'Vendor'], 
        default: null 
    },
    assignedBy: { // The user (PM/Landlord) who assigned the request
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        default: null 
    },
    resolvedAt: { 
        type: Date, 
        default: null 
    },
    comments: [ // Embedded array of comments for the request
        {
            sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
            message: { type: String, required: true, maxlength: [1000, 'Comment message cannot exceed 1000 characters.'] },
            timestamp: { type: Date, default: Date.now }
        }
    ],
    verifiedBy: { // User (PM/Landlord) who verified the completion of the request
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        default: null 
    },
    // Renamed `approvedBy` to `verifiedBy` for clarity based on "Verified" status.
    // Removed `tenantRef` as `createdBy` should directly reference the reporter.
    // If a PM submits on behalf of a tenant, `createdBy` is the PM, and a specific "on_behalf_of_tenant" field might be needed,
    // but typically the actual tenant submits or their user ID is passed through.

    feedback: { // Tenant's feedback after request completion
        rating: { type: Number, min: 1, max: 5 },
        comment: { type: String, maxlength: [1000, 'Feedback comment cannot exceed 1000 characters.'] },
        submittedAt: { type: Date }
    },

    // Public link for external vendors
    publicToken: { 
        type: String, 
        unique: true, 
        sparse: true 
    }, // Unique token for public access
    publicLinkEnabled: { 
        type: Boolean, 
        default: false 
    },
    publicLinkExpiresAt: { 
        type: Date, 
        default: null 
    },

}, { 
    timestamps: true 
});

/**
 * Instance method to enable a public link for the request.
 * Generates a public token if one doesn't exist.
 * @param {Date} [expiryDate=null] - Optional expiry date for the public link.
 * @returns {string} The public token.
 */
requestSchema.methods.enablePublicLink = async function(expiryDate = null) {
    if (!this.publicToken) {
        this.publicToken = crypto.randomBytes(24).toString('hex'); // Generate cryptographically secure token
    }
    this.publicLinkEnabled = true;
    if (expiryDate) {
        this.publicLinkExpiresAt = expiryDate;
    } else {
        // Default expiry (e.g., 7 days if no specific expiry is given)
        this.publicLinkExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); 
    }
    await this.save();
    return this.publicToken;
};

// Indexes for common queries
requestSchema.index({ property: 1, unit: 1, status: 1 });
requestSchema.index({ createdBy: 1, status: 1 }); // For filtering requests by reporter
requestSchema.index({ assignedTo: 1, status: 1 }); // For filtering requests by assignee
requestSchema.index({ publicToken: 1 }); // For quick public link lookups

module.exports = mongoose.models.Request || mongoose.model('Request', requestSchema);
