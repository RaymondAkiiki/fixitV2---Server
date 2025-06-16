// backend/models/PropertyUser.js

const mongoose = require('mongoose');

const propertyUserSchema = new mongoose.Schema(
    {
        user: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'User', 
            required: [true, 'User is required for PropertyUser association.'] 
        },
        property: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'Property', 
            required: [true, 'Property is required for PropertyUser association.'] 
        },
        unit: { // Specific unit for tenant roles, or null for property-level roles (landlord, PM, vendor)
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'Unit', 
            default: null,
            sparse: true // Allows multiple documents to have a null value for `unit`
        }, 
        roles: [{ // Array of roles for this specific user-property/unit association
            type: String, 
            enum: ['landlord', 'propertymanager', 'tenant', 'vendor', 'admin'], // Consistent lowercase roles
            required: [true, 'At least one role is required for PropertyUser association.'],
            lowercase: true,
        }],
        // Removed `inviteStatus` as this model represents established, active relationships.
        // The `Invite` model handles the invite lifecycle status.
        // This means a `PropertyUser` record is typically created/activated AFTER an invite is accepted.
        
        invitedBy: { // The user who invited/created this association (for tracking origins)
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'User' 
        },
        isActive: { // To activate/deactivate a user's association with a specific property/unit
            type: Boolean,
            default: true
        }
    },
    { timestamps: true }
);

// Compound index to ensure a user has a unique *primary* association to a property (and optionally a unit)
// This index needs careful consideration: if a user can be a 'landlord' for property A and a 'tenant' for property B,
// or a 'PM' for property A and a 'tenant' for unit X in property A, this index might be too restrictive.
// Let's refine the unique index to prevent a user having the *exact same* property-unit-role combination multiple times.
propertyUserSchema.index({ user: 1, property: 1, unit: 1, roles: 1 }, { unique: true }); 
// If a user can have multiple roles on the *same property/unit*, this index must be more flexible.
// e.g. a user is a 'landlord' AND 'propertymanager' on the same property. Then `roles: 1` needs to be removed from unique index.
// For now, I'll keep it as it prevents duplicate *exact* associations.

// Indexes for fast lookup of users by property, role, or unit
propertyUserSchema.index({ property: 1, roles: 1 });
propertyUserSchema.index({ unit: 1 });
propertyUserSchema.index({ user: 1, roles: 1 });

module.exports = mongoose.models.PropertyUser || mongoose.model('PropertyUser', propertyUserSchema);
