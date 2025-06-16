// backend/controllers/propertyController.js

const asyncHandler = require('express-async-handler');
const { validationResult } = require('express-validator');
const Property = require('../models/property'); // Corrected import: lowercase file name
const User = require('../models/user');       // Corrected import
const Unit = require('../models/unit');       // Corrected import
const PropertyUser = require('../models/propertyUser'); // Corrected import
const { createNotification } = require('./notificationController'); // Import internal notification helper

// Helper for validation errors
const handleValidationErrors = (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }
    return null;
};

/**
 * @desc    Create a new property
 * @route   POST /api/properties
 * @access  Private (Landlord, PropertyManager, Admin)
 */
exports.createProperty = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return; // Assuming validation middleware is used in route
    const { name, address, details } = req.body; // address will be an object { street, city, state, country }

    if (!address || !address.city || !address.country) {
        res.status(400);
        throw new Error('Property address (city and country) is required.');
    }

    // Role-based authorization for creator (handled by route middleware)
    // Only Landlords, PMs, and Admins can create properties.
    if (!['landlord', 'propertymanager', 'admin'].includes(req.user.role)) {
        res.status(403);
        throw new Error('You are not authorized to create properties.');
    }

    const property = new Property({
        name,
        address,
        details,
        createdBy: req.user._id,
    });

    const createdProperty = await property.save();

    // After creating property, link the creator to it via PropertyUser model
    // The creator becomes a 'landlord' if they are a landlord, or 'propertymanager' if they are a PM.
    let roleForCreator = req.user.role;
    if (roleForCreator === 'admin') { // Admins might not be the primary landlord/PM, but are linked
        roleForCreator = 'propertymanager'; // Default admin to PM role on property for management access
    }

    await PropertyUser.create({
        user: req.user._id,
        property: createdProperty._id,
        roles: [roleForCreator], // Assign initial role on this property
        invitedBy: req.user._id, // Self-invited
        isActive: true,
    });

    // Notify relevant parties if needed (e.g., admin if new property is created)
    // createNotification(adminId, `New property ${createdProperty.name} created by ${req.user.email}`, 'property_added', `/properties/${createdProperty._id}`);

    res.status(201).json(createdProperty);
});


/**
 * @desc    List properties (filtered by user role/association)
 * @route   GET /api/properties
 * @access  Private
 * @notes   Admin: all properties. Landlord/PM: properties they own/manage. Tenant: properties they tenant.
 */
exports.listProperties = asyncHandler(async (req, res) => {
    let query = {};
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        // Admin sees all properties, no additional filter needed
    } else {
        // For other roles, find properties associated with the current user via PropertyUser model
        const associatedPropertyUsers = await PropertyUser.find({ user: userId });

        if (associatedPropertyUsers.length === 0) {
            return res.status(200).json([]); // User has no associated properties
        }

        const propertyIds = associatedPropertyUsers.map(pu => pu.property);
        query._id = { $in: propertyIds };
    }

    // You can add more query parameters like search by name, city, etc.
    const { search, city, country } = req.query;
    if (search) {
        query.name = { $regex: search, $options: 'i' };
    }
    if (city) {
        query['address.city'] = { $regex: city, $options: 'i' };
    }
    if (country) {
        query['address.country'] = { $regex: country, $options: 'i' };
    }

    // Populate units for each property
    const properties = await Property.find(query).populate('units', 'unitName');
    res.status(200).json(properties);
});

/**
 * @desc    Get specific property details (including units)
 * @route   GET /api/properties/:id
 * @access  Private (with access control)
 */
exports.getPropertyDetails = asyncHandler(async (req, res) => {
    const propertyId = req.params.id;

    const property = await Property.findById(propertyId)
        .populate('units') // Populate units details
        .populate('createdBy', 'name email'); // Populate who created the property

    if (!property) {
        res.status(404);
        throw new Error('Property not found.');
    }

    // Authorization: Admin can view any property.
    // Others must be associated with the property via PropertyUser.
    if (req.user.role !== 'admin') {
        const isAssociated = await PropertyUser.exists({
            user: req.user._id,
            property: propertyId,
            isActive: true
        });

        if (!isAssociated) {
            res.status(403);
            throw new Error('Not authorized to view this property.');
        }
    }

    // Optionally, fetch and include details about associated Landlords, PMs, Tenants via PropertyUser
    const associatedUsers = await PropertyUser.find({ property: propertyId, isActive: true })
        .populate('user', 'name email role'); // Populate user details

    const landlords = associatedUsers.filter(au => au.roles.includes('landlord')).map(au => au.user);
    const propertyManagers = associatedUsers.filter(au => au.roles.includes('propertymanager')).map(au => au.user);
    const tenants = associatedUsers.filter(au => au.roles.includes('tenant')).map(au => ({ user: au.user, unit: au.unit })); // Include unit for tenants

    res.status(200).json({
        ...property.toObject(),
        landlords,
        propertyManagers,
        tenants,
    });
});

/**
 * @desc    Update property details
 * @route   PUT /api/properties/:id
 * @access  Private (Landlord, PropertyManager - with ownership/management)
 */
exports.updateProperty = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return;
    const propertyId = req.params.id;
    const updateData = req.body;

    const property = await Property.findById(propertyId);
    if (!property) {
        res.status(404);
        throw new Error('Property not found.');
    }

    // Authorization: Only Admin, or Landlord/PM associated with this property can update
    let isAuthorized = false;
    if (req.user.role === 'admin') {
        isAuthorized = true;
    } else {
        const associatedRoles = await PropertyUser.find({
            user: req.user._id,
            property: propertyId,
            isActive: true,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (associatedRoles.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to update this property.');
    }

    // Apply updates to the property document
    Object.assign(property, updateData);
    const updatedProperty = await property.save();

    res.status(200).json(updatedProperty);
});

/**
 * @desc    Delete property
 * @route   DELETE /api/properties/:id
 * @access  Private (Admin, Landlord - who owns it, with caution)
 * @notes   Very destructive. Requires careful handling of dependent data.
 */
exports.deleteProperty = asyncHandler(async (req, res) => {
    const propertyId = req.params.id;

    const property = await Property.findById(propertyId);
    if (!property) {
        res.status(404);
        throw new Error('Property not found.');
    }

    // Authorization: Only Admin can delete. Landlord could delete their own property, but consider the impact.
    let isAuthorized = false;
    if (req.user.role === 'admin') {
        isAuthorized = true;
    } else if (req.user.role === 'landlord') {
        // Check if the current user is a landlord for this property (via PropertyUser)
        const isLandlordOfProperty = await PropertyUser.exists({
            user: req.user._id,
            property: propertyId,
            roles: 'landlord',
            isActive: true
        });
        if (isLandlordOfProperty) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to delete this property.');
    }

    // Check for existing units, requests, scheduled maintenance first
    const hasUnits = await Unit.countDocuments({ property: propertyId });
    const hasRequests = await Request.countDocuments({ property: propertyId });
    const hasScheduledMaintenance = await ScheduledMaintenance.countDocuments({ property: propertyId });

    if (hasUnits > 0 || hasRequests > 0 || hasScheduledMaintenance > 0) {
        res.status(400);
        throw new Error('Cannot delete property with associated units, requests, or scheduled maintenance. Please delete them first.');
    }

    await property.deleteOne(); // Use deleteOne() on the document instance

    // --- Cleanup related data ---
    // 1. Delete all PropertyUser associations for this property
    await PropertyUser.deleteMany({ property: propertyId });
    // 2. Delete all units belonging to this property (though checked above, good to have cascade logic if check was removed)
    await Unit.deleteMany({ property: propertyId });
    // 3. Delete all requests belonging to this property
    await Request.deleteMany({ property: propertyId });
    // 4. Delete all scheduled maintenance belonging to this property
    await ScheduledMaintenance.deleteMany({ property: propertyId });
    // 5. Delete all comments associated with this property (contextType: 'property')
    await Comment.deleteMany({ contextId: propertyId, contextType: 'property' });
    // 6. Delete all notifications related to this property
    await Notification.deleteMany({ 'relatedResource.item': propertyId, 'relatedResource.kind': 'Property' });


    res.status(200).json({ message: 'Property deleted successfully.' });
});

// Removed `requestToJoin` and `approveTenant` from here.
// These functionalities should be covered by the `Invite` model and `inviteController`
// for controlled user onboarding and association with properties/units.
// Direct tenant approval or joining should leverage the invitation system.
