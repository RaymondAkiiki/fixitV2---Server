// backend/controllers/unitController.js

const asyncHandler = require('express-async-handler');
const { validationResult } = require('express-validator');
const Unit = require('../models/unit'); // Corrected import
const Property = require('../models/property'); // Corrected import
const User = require('../models/user');       // Corrected import
const PropertyUser = require('../models/propertyUser'); // New import
const { createNotification } = require('./notificationController'); // Internal notification helper

// Helper for validation errors
const handleValidationErrors = (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }
    return null;
};

/**
 * @desc    Create a new unit within a property
 * @route   POST /api/properties/:propertyId/units
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.createUnit = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return;
    const { propertyId } = req.params; // Get propertyId from URL params
    const { unitName, floor, details, numBedrooms, numBathrooms, squareFootage, rentAmount } = req.body;

    // First, check if the property exists
    const property = await Property.findById(propertyId);
    if (!property) {
        res.status(404);
        throw new Error('Property not found.');
    }

    // Authorization: User can create a unit if they are:
    // 1. Admin
    // 2. A Landlord/PM associated with this property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: propertyId,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to create units for this property.');
    }

    // Create the unit
    const unit = new Unit({
        property: propertyId,
        unitName,
        floor,
        details,
        numBedrooms,
        numBathrooms,
        squareFootage,
        rentAmount,
        status: 'vacant', // Default status for new unit
    });

    const createdUnit = await unit.save();

    // Add unit to the property's units array
    property.units.push(createdUnit._id);
    await property.save();

    res.status(201).json(createdUnit);
});

/**
 * @desc    List units for a specific property
 * @route   GET /api/properties/:propertyId/units
 * @access  Private (with access control)
 * @notes   Admin: all units. Landlord/PM: units in their managed/owned properties.
 * Tenant: only their specific unit within that property.
 */
exports.listUnits = asyncHandler(async (req, res) => {
    const { propertyId } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    // Authorization: User can list units if they are:
    // 1. Admin
    // 2. A Landlord/PM associated with this property
    // 3. A Tenant associated with a unit in this property
    let isAuthorized = false;
    let query = { property: propertyId }; // Base query for units in this property

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: propertyId,
            isActive: true
        });

        if (userAssociations.some(assoc => ['landlord', 'propertymanager'].includes(assoc.roles[0]))) {
            isAuthorized = true; // Landlord/PM can view all units in their property
        } else if (userRole === 'tenant') {
            // Tenant can only view their own unit(s) within this property
            const tenantUnits = userAssociations.filter(assoc => assoc.roles.includes('tenant') && assoc.unit);
            if (tenantUnits.length > 0) {
                query._id = { $in: tenantUnits.map(assoc => assoc.unit) }; // Filter to only tenant's units
                isAuthorized = true;
            }
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to list units for this property.');
    }

    const units = await Unit.find(query).populate('tenants', 'name email');
    res.status(200).json(units);
});

/**
 * @desc    Get specific unit details
 * @route   GET /api/properties/:propertyId/units/:unitId
 * @access  Private (with access control)
 */
exports.getUnitDetails = asyncHandler(async (req, res) => {
    const { propertyId, unitId } = req.params;

    const unit = await Unit.findOne({ _id: unitId, property: propertyId })
        .populate('property', 'name address')
        .populate('tenants', 'name email');

    if (!unit) {
        res.status(404);
        throw new Error('Unit not found in the specified property.');
    }

    // Authorization: Similar to listUnits
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: propertyId,
            isActive: true
        });

        if (userAssociations.some(assoc => ['landlord', 'propertymanager'].includes(assoc.roles[0]))) {
            isAuthorized = true; // Landlord/PM can view
        } else if (userRole === 'tenant' && unit.tenants.some(tenant => tenant.equals(userId))) {
            isAuthorized = true; // Tenant can view their own unit
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to view this unit.');
    }

    res.status(200).json(unit);
});

/**
 * @desc    Update unit details
 * @route   PUT /api/properties/:propertyId/units/:unitId
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.updateUnit = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return;
    const { propertyId, unitId } = req.params;
    const updateData = req.body;

    const unit = await Unit.findOne({ _id: unitId, property: propertyId });
    if (!unit) {
        res.status(404);
        throw new Error('Unit not found in the specified property.');
    }

    // Authorization: Admin, or Landlord/PM associated with the property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: propertyId,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to update this unit.');
    }

    Object.assign(unit, updateData); // Apply updates
    const updatedUnit = await unit.save();

    res.status(200).json(updatedUnit);
});

/**
 * @desc    Delete unit
 * @route   DELETE /api/properties/:propertyId/units/:unitId
 * @access  Private (PropertyManager, Landlord, Admin)
 * @notes   Requires careful handling of dependent data.
 */
exports.deleteUnit = asyncHandler(async (req, res) => {
    const { propertyId, unitId } = req.params;

    const unit = await Unit.findOne({ _id: unitId, property: propertyId });
    if (!unit) {
        res.status(404);
        throw new Error('Unit not found in the specified property.');
    }

    // Authorization: Admin, or Landlord/PM associated with the property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: propertyId,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to delete this unit.');
    }

    // Check for existing requests or scheduled maintenance for this unit
    const hasRequests = await Request.countDocuments({ unit: unitId });
    const hasScheduledMaintenance = await ScheduledMaintenance.countDocuments({ unit: unitId });

    if (hasRequests > 0 || hasScheduledMaintenance > 0) {
        res.status(400);
        throw new Error('Cannot delete unit with associated requests or scheduled maintenance. Please resolve or delete them first.');
    }

    await unit.deleteOne(); // Use deleteOne() on the document instance

    // --- Cleanup related data ---
    // 1. Remove unit from parent property's units array
    await Property.findByIdAndUpdate(propertyId, { $pull: { units: unitId } });
    // 2. Remove all PropertyUser associations for this unit
    await PropertyUser.deleteMany({ unit: unitId });
    // 3. Delete comments associated with this unit
    await Comment.deleteMany({ contextId: unitId, contextType: 'unit' });
    // 4. Delete notifications related to this unit
    await Notification.deleteMany({ 'relatedResource.item': unitId, 'relatedResource.kind': 'Unit' });

    res.status(200).json({ message: 'Unit deleted successfully.' });
});

/**
 * @desc    Assign a tenant to a unit (adds/updates PropertyUser association)
 * @route   POST /api/properties/:propertyId/units/:unitId/assign-tenant
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.assignTenantToUnit = asyncHandler(async (req, res) => {
    const { propertyId, unitId } = req.params;
    const { tenantId } = req.body; // ID of the User to assign as tenant

    if (!tenantId) {
        res.status(400);
        throw new Error('Tenant ID is required for assignment.');
    }

    const property = await Property.findById(propertyId);
    const unit = await Unit.findById(unitId);
    const tenantUser = await User.findById(tenantId);

    if (!property || !unit || !tenantUser) {
        res.status(404);
        throw new Error('Property, unit, or tenant user not found.');
    }

    // Ensure unit belongs to the property
    if (unit.property.toString() !== propertyId) {
        res.status(400);
        throw new Error('Unit does not belong to the specified property.');
    }

    // Ensure the assigned user is actually a 'tenant' role
    if (tenantUser.role !== 'tenant') {
        res.status(400);
        throw new Error('Assigned user must have the role of "tenant".');
    }

    // Authorization: Admin, or Landlord/PM associated with the property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: propertyId,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to assign tenants to this unit.');
    }

    // Check if the tenant is already assigned to this unit
    if (unit.tenants.includes(tenantId)) {
        res.status(400);
        throw new Error('Tenant is already assigned to this unit.');
    }

    // Check if the tenant is already assigned to another unit within this property
    // (Optional logic, depending on if a tenant can be in multiple units within one property)
    const existingTenancyInProperty = await PropertyUser.findOne({
        user: tenantId,
        property: propertyId,
        roles: 'tenant',
        isActive: true,
        unit: { $ne: null } // Find if they are tenant of any unit in this property
    });

    if (existingTenancyInProperty) {
        // Option 1: Reassign (pull from old unit, push to new)
        await Unit.findByIdAndUpdate(existingTenancyInProperty.unit, { $pull: { tenants: tenantId } });
        // Update the existing PropertyUser entry for this tenant's unit
        existingTenancyInProperty.unit = unitId;
        await existingTenancyInProperty.save();
    } else {
        // Option 2: Create a new PropertyUser entry if none exists for this tenant-property combination
        await PropertyUser.create({
            user: tenantId,
            property: propertyId,
            unit: unitId,
            roles: ['tenant'],
            invitedBy: req.user._id, // Record who assigned them
            isActive: true,
        });
    }

    // Add tenant to the Unit's tenants array
    unit.tenants.push(tenantId);
    await unit.save();

    // Send notification to the tenant
    await createNotification(
        tenantId,
        `You have been assigned to unit ${unit.unitName} in ${property.name}.`,
        'unit_assigned',
        `${FRONTEND_URL}/properties/${propertyId}/units/${unitId}`,
        { kind: 'Unit', item: unitId },
        req.user._id
    );

    res.status(200).json({ message: 'Tenant assigned to unit successfully.', unit });
});

/**
 * @desc    Remove a tenant from a unit (updates PropertyUser association)
 * @route   DELETE /api/properties/:propertyId/units/:unitId/remove-tenant/:tenantId
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.removeTenantFromUnit = asyncHandler(async (req, res) => {
    const { propertyId, unitId, tenantId } = req.params;

    const property = await Property.findById(propertyId);
    const unit = await Unit.findById(unitId);
    const tenantUser = await User.findById(tenantId);

    if (!property || !unit || !tenantUser) {
        res.status(404);
        throw new Error('Property, unit, or tenant user not found.');
    }

    // Ensure unit belongs to the property
    if (unit.property.toString() !== propertyId) {
        res.status(400);
        throw new Error('Unit does not belong to the specified property.');
    }

    // Authorization: Admin, or Landlord/PM associated with the property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: propertyId,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to remove tenants from this unit.');
    }

    // Check if the tenant is actually assigned to this unit
    if (!unit.tenants.includes(tenantId)) {
        res.status(400);
        throw new Error('Tenant is not assigned to this unit.');
    }

    // Remove tenant from the Unit's tenants array
    unit.tenants.pull(tenantId);
    await unit.save();

    // Deactivate or remove the specific PropertyUser association for this unit
    await PropertyUser.findOneAndUpdate(
        { user: tenantId, property: propertyId, unit: unitId, roles: 'tenant' },
        { $set: { isActive: false, unit: null } } // Mark inactive, or remove unit reference
        // Or, if a tenant can only be in one unit at a time, completely delete it:
        // await PropertyUser.findOneAndDelete({ user: tenantId, property: propertyId, unit: unitId, roles: 'tenant' });
    );

    // Send notification to the tenant
    await createNotification(
        tenantId,
        `You have been removed from unit ${unit.unitName} in ${property.name}.`,
        'unit_removed',
        null, // No specific link might be needed if they are removed
        { kind: 'Unit', item: unitId },
        req.user._id
    );

    res.status(200).json({ message: 'Tenant removed from unit successfully.', unit });
});
