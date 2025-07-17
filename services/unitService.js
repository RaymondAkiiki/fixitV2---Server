// src/services/unitService.js

const Unit = require('../models/unit');
const Property = require('../models/property');
const User = require('../models/user'); // For tenant assignment
const PropertyUser = require('../models/propertyUser');
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Notification = require('../models/notification');
const Comment = require('../models/comment'); // For comments related to units
const { createAuditLog } = require('./auditService');
const { createInAppNotification } = require('./notificationService'); // For notifications
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    UNIT_STATUS_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM
} = require('../utils/constants/enums');

/**
 * Helper to check if a user has management permission for a given property.
 * Used for authorizing actions like creating/updating units.
 * @param {object} user - The authenticated user object (from req.user).
 * @param {string} propertyId - The ID of the property to check access for.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkPropertyManagementPermission = async (user, propertyId) => {
    if (user.role === ROLE_ENUM.ADMIN) {
        return true; // Admin has global access
    }

    // Check if user is a landlord or property manager for the given property
    const hasAccess = await PropertyUser.exists({
        user: user._id,
        property: propertyId,
        isActive: true,
        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
    });
    return hasAccess;
};

/**
 * Creates a new unit within a property.
 * @param {string} propertyId - The ID of the property to add the unit to.
 * @param {object} unitData - Data for the new unit.
 * @param {object} currentUser - The user creating the unit (from req.user).
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Unit>} The created unit document.
 * @throws {AppError} If property not found, user not authorized, or validation fails.
 */
const createUnit = async (propertyId, unitData, currentUser, ipAddress) => {
    const property = await Property.findById(propertyId);
    if (!property) {
        throw new AppError('Property not found.', 404);
    }

    // Authorization check
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
    if (!isAuthorized) {
        throw new AppError('Not authorized to create units for this property.', 403);
    }

    // Create the unit
    const newUnit = new Unit({
        property: propertyId,
        unitName: unitData.unitName,
        floor: unitData.floor,
        details: unitData.details,
        numBedrooms: unitData.numBedrooms,
        numBathrooms: unitData.numBathrooms,
        squareFootage: unitData.squareFootage,
        rentAmount: unitData.rentAmount,
        depositAmount: unitData.depositAmount,
        status: unitData.status || UNIT_STATUS_ENUM.find(s => s === 'vacant'), // Default status
        utilityResponsibility: unitData.utilityResponsibility,
        notes: unitData.notes,
        lastInspected: unitData.lastInspected,
        unitImages: unitData.unitImages // Assuming this is an array of URLs or media IDs
    });

    const createdUnit = await newUnit.save();

    // Add unit to the property's units array
    property.units.push(createdUnit._id);
    await property.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
        resourceId: createdUnit._id,
        newValue: createdUnit.toObject(),
        ipAddress: ipAddress,
        description: `Unit ${createdUnit.unitName} created in property ${property.name} by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`UnitService: Unit ${createdUnit.unitName} created in property ${property.name} by ${currentUser.email}.`);
    return createdUnit;
};

/**
 * Lists units for a specific property based on user's access.
 * @param {string} propertyId - The ID of the property.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Query filters (e.g., status, numBedrooms, search).
 * @param {number} page - Page number.
 * @param {number} limit - Items per page.
 * @returns {Promise<object>} Object containing units array, total count, page, and limit.
 * @throws {AppError} If property not found or user not authorized.
 */
const getUnitsForProperty = async (propertyId, currentUser, filters, page = 1, limit = 10) => {
    const property = await Property.findById(propertyId);
    if (!property) {
        throw new AppError('Property not found.', 404);
    }

    let query = { property: propertyId }; // Base query for units in this property
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Authorization:
    // Admin: all units.
    // Landlord/PM: all units in their managed/owned properties.
    // Tenant: only their specific unit(s) within that property.
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin has full access
    } else {
        const userAssociations = await PropertyUser.find({
            user: currentUser._id,
            property: propertyId,
            isActive: true
        });

        if (userAssociations.some(assoc => [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS].includes(assoc.roles[0]))) {
            // Landlord/PM can view all units in their property
        } else if (currentUser.role === ROLE_ENUM.TENANT) {
            // Tenant can only view their own unit(s) within this property
            const tenantUnits = userAssociations.filter(assoc => assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && assoc.unit);
            if (tenantUnits.length > 0) {
                query._id = { $in: tenantUnits.map(assoc => assoc.unit) }; // Filter to only tenant's units
            } else {
                // Tenant has no unit association for this property
                throw new AppError('Access denied: You are not associated with any unit in this property.', 403);
            }
        } else {
            // Other roles (Vendor) are not authorized to list units
            throw new AppError('Access denied: You do not have permission to list units for this property.', 403);
        }
    }

    // Apply filters
    if (filters.status) {
        if (!UNIT_STATUS_ENUM.includes(filters.status.toLowerCase())) {
            throw new AppError(`Invalid unit status filter: ${filters.status}`, 400);
        }
        query.status = filters.status.toLowerCase();
    }
    if (filters.numBedrooms) {
        query.numBedrooms = parseInt(filters.numBedrooms);
    }
    if (filters.search) {
        query.$or = [
            { unitName: { $regex: filters.search, $options: 'i' } },
            { floor: { $regex: filters.search, $options: 'i' } },
            { details: { $regex: filters.search, $options: 'i' } },
        ];
    }

    const units = await Unit.find(query)
        .populate('tenants', 'firstName lastName email') // Populate current tenants
        .sort({ unitName: 1 })
        .limit(parseInt(limit))
        .skip(skip);

    const totalUnits = await Unit.countDocuments(query);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ_ALL,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
        ipAddress: currentUser.ip, // Assuming user object might have ip, or pass from req
        description: `User ${currentUser.email} fetched list of units for property ${property.name}.`,
        status: 'success',
        metadata: { propertyId, filters }
    });

    return {
        units,
        total: totalUnits,
        page: parseInt(page),
        limit: parseInt(limit)
    };
};

/**
 * Gets specific unit details.
 * @param {string} propertyId - The ID of the property the unit belongs to.
 * @param {string} unitId - The ID of the unit to fetch.
 * @param {object} currentUser - The authenticated user.
 * @returns {Promise<Unit>} The unit document.
 * @throws {AppError} If unit not found or user not authorized.
 */
const getUnitById = async (propertyId, unitId, currentUser) => {
    const unit = await Unit.findOne({ _id: unitId, property: propertyId })
        .populate('property', 'name address')
        .populate('tenants', 'firstName lastName email');

    if (!unit) {
        throw new AppError('Unit not found in the specified property.', 404);
    }

    // Authorization: Similar to listUnits
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin has full access
    } else {
        const userAssociations = await PropertyUser.find({
            user: currentUser._id,
            property: propertyId,
            isActive: true
        });

        if (userAssociations.some(assoc => [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS].includes(assoc.roles[0]))) {
            // Landlord/PM can view
        } else if (currentUser.role === ROLE_ENUM.TENANT && unit.tenants.some(tenant => tenant._id.equals(currentUser._id))) {
            // Tenant can view their own unit
        } else {
            throw new AppError('Not authorized to view this unit.', 403);
        }
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
        resourceId: unit._id,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched details for unit ${unit.unitName} in property ${unit.property.name}.`,
        status: 'success'
    });

    return unit;
};

/**
 * Updates unit details.
 * @param {string} propertyId - The ID of the property the unit belongs to.
 * @param {string} unitId - The ID of the unit to update.
 * @param {object} updateData - Data to update the unit with.
 * @param {object} currentUser - The user performing the update.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Unit>} The updated unit document.
 * @throws {AppError} If unit not found, user not authorized, or validation fails.
 */
const updateUnit = async (propertyId, unitId, updateData, currentUser, ipAddress) => {
    const unit = await Unit.findOne({ _id: unitId, property: propertyId });
    if (!unit) {
        throw new AppError('Unit not found in the specified property.', 404);
    }

    // Authorization: Admin, or Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
    if (!isAuthorized) {
        throw new AppError('Not authorized to update this unit.', 403);
    }

    const oldUnit = unit.toObject(); // Capture old state for audit log

    // Apply updates
    Object.keys(updateData).forEach(key => {
        if (updateData[key] !== undefined) {
            if (key === 'status') {
                if (!UNIT_STATUS_ENUM.includes(updateData[key].toLowerCase())) {
                    throw new AppError(`Invalid unit status: ${updateData[key]}. Allowed: ${UNIT_STATUS_ENUM.join(', ')}`, 400);
                }
                unit[key] = updateData[key].toLowerCase();
            } else if (key === 'utilityResponsibility') {
                // Assuming UTILITY_RESPONSIBILITY_ENUM exists and is imported
                // if (!UTILITY_RESPONSIBILITY_ENUM.includes(updateData[key].toLowerCase())) {
                //     throw new AppError(`Invalid utility responsibility: ${updateData[key]}. Allowed: ${UTILITY_RESPONSIBILITY_ENUM.join(', ')}`, 400);
                // }
                unit[key] = updateData[key].toLowerCase();
            }
            else {
                unit[key] = updateData[key];
            }
        }
    });

    const updatedUnit = await unit.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
        resourceId: updatedUnit._id,
        oldValue: oldUnit,
        newValue: updatedUnit.toObject(),
        ipAddress: ipAddress,
        description: `Unit ${updatedUnit.unitName} in property ${propertyId} updated by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`UnitService: Unit ${updatedUnit.unitName} updated by ${currentUser.email}.`);
    return updatedUnit;
};

/**
 * Deletes a unit and cleans up related references.
 * @param {string} propertyId - The ID of the property the unit belongs to.
 * @param {string} unitId - The ID of the unit to delete.
 * @param {object} currentUser - The user performing the deletion.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If unit not found, user not authorized, or dependent data exists.
 */
const deleteUnit = async (propertyId, unitId, currentUser, ipAddress) => {
    const unitToDelete = await Unit.findOne({ _id: unitId, property: propertyId });
    if (!unitToDelete) {
        throw new AppError('Unit not found in the specified property.', 404);
    }

    // Authorization: Admin, or Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
    if (!isAuthorized) {
        throw new AppError('Not authorized to delete this unit.', 403);
    }

    // Check for existing requests or scheduled maintenance for this unit
    const hasRequests = await Request.countDocuments({ unit: unitId });
    const hasScheduledMaintenance = await ScheduledMaintenance.countDocuments({ unit: unitId });
    const hasActiveLeases = await Lease.countDocuments({ unit: unitId, status: { $in: ['active', 'pending_renewal'] } }); // Assuming Lease model and relevant statuses

    if (hasRequests > 0 || hasScheduledMaintenance > 0 || hasActiveLeases > 0) {
        throw new AppError('Cannot delete unit with associated requests, scheduled maintenance, or active leases. Please resolve or delete them first.', 400);
    }

    const oldUnit = unitToDelete.toObject(); // Capture for audit log

    // --- Cleanup related data ---
    // 1. Remove unit from parent property's units array
    await Property.findByIdAndUpdate(propertyId, { $pull: { units: unitId } });
    logger.info(`UnitService: Removed unit ${unitToDelete.unitName} from property ${propertyId}'s units array.`);

    // 2. Remove all PropertyUser associations for this unit
    await PropertyUser.deleteMany({ unit: unitId });
    logger.info(`UnitService: Deleted PropertyUser associations for unit ${unitToDelete.unitName}.`);

    // 3. Delete comments associated with this unit
    await Comment.deleteMany({ contextId: unitId, contextType: AUDIT_RESOURCE_TYPE_ENUM.Unit });
    logger.info(`UnitService: Deleted comments for unit ${unitToDelete.unitName}.`);

    // 4. Delete notifications related to this unit
    await Notification.deleteMany({ 'relatedResource.item': unitId, 'relatedResource.kind': AUDIT_RESOURCE_TYPE_ENUM.Unit });
    logger.info(`UnitService: Deleted notifications for unit ${unitToDelete.unitName}.`);

    // 5. Finally, delete the unit document
    await unitToDelete.deleteOne();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
        resourceId: unitId,
        oldValue: oldUnit,
        newValue: null,
        ipAddress: ipAddress,
        description: `Unit ${oldUnit.unitName} in property ${propertyId} deleted by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`UnitService: Unit ${oldUnit.unitName} deleted by ${currentUser.email}.`);
};

/**
 * Assigns a tenant to a unit (adds/updates PropertyUser association).
 * @param {string} propertyId - The ID of the property.
 * @param {string} unitId - The ID of the unit.
 * @param {string} tenantId - The ID of the User to assign as tenant.
 * @param {object} currentUser - The user performing the assignment.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Unit>} The updated unit document.
 * @throws {AppError} If entities not found, user not authorized, or tenant already assigned.
 */
const assignTenantToUnit = async (propertyId, unitId, tenantId, currentUser, ipAddress) => {
    const property = await Property.findById(propertyId);
    const unit = await Unit.findById(unitId);
    const tenantUser = await User.findById(tenantId);

    if (!property || !unit || !tenantUser) {
        throw new AppError('Property, unit, or tenant user not found.', 404);
    }

    // Ensure unit belongs to the property
    if (unit.property.toString() !== propertyId) {
        throw new AppError('Unit does not belong to the specified property.', 400);
    }

    // Ensure the assigned user is actually a 'tenant' role
    if (tenantUser.role !== ROLE_ENUM.TENANT) {
        throw new AppError('Assigned user must have the role of "tenant".', 400);
    }

    // Authorization: Admin, or Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
    if (!isAuthorized) {
        throw new AppError('Not authorized to assign tenants to this unit.', 403);
    }

    // Check if the tenant is already assigned to this unit
    if (unit.tenants.includes(tenantId)) {
        throw new AppError('Tenant is already assigned to this unit.', 400);
    }

    // Check for and update existing tenancy in the same property (if tenant can only be in one unit per property)
    const existingTenancyInProperty = await PropertyUser.findOne({
        user: tenantId,
        property: propertyId,
        roles: PROPERTY_USER_ROLES_ENUM.TENANT,
        isActive: true,
        unit: { $ne: null } // Find if they are tenant of any unit in this property
    });

    if (existingTenancyInProperty) {
        // Reassign: pull from old unit, push to new
        await Unit.findByIdAndUpdate(existingTenancyInProperty.unit, { $pull: { tenants: tenantId } });
        logger.info(`UnitService: Reassigning tenant ${tenantUser.email} from unit ${existingTenancyInProperty.unit} to ${unit.unitName}.`);
        // Update the existing PropertyUser entry for this tenant's unit
        existingTenancyInProperty.unit = unitId;
        await existingTenancyInProperty.save();
    } else {
        // Create a new PropertyUser entry if none exists for this tenant-property combination
        await PropertyUser.create({
            user: tenantId,
            property: propertyId,
            unit: unitId,
            roles: [PROPERTY_USER_ROLES_ENUM.TENANT],
            invitedBy: currentUser._id, // Record who assigned them
            isActive: true,
            startDate: new Date()
        });
        logger.info(`UnitService: Created new PropertyUser association for tenant ${tenantUser.email} to unit ${unit.unitName}.`);
    }

    // Add tenant to the Unit's tenants array
    unit.tenants.push(tenantId);
    const updatedUnit = await unit.save();

    // Send notification to the tenant
    await createInAppNotification(
        tenantId,
        NOTIFICATION_TYPE_ENUM.find(t => t === 'unit_assigned'),
        `You have been assigned to unit ${unit.unitName} in ${property.name}.`,
        { kind: AUDIT_RESOURCE_TYPE_ENUM.Unit, item: unitId },
        `${process.env.FRONTEND_URL}/properties/${propertyId}/units/${unitId}`,
        { unitName: unit.unitName, propertyName: property.name },
        currentUser._id
    );

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.ASSIGN_TENANT,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
        resourceId: unitId,
        newValue: { tenantId, unitId, propertyId },
        ipAddress: ipAddress,
        description: `Tenant ${tenantUser.email} assigned to unit ${unit.unitName} by ${currentUser.email}.`,
        status: 'success'
    });

    return updatedUnit;
};

/**
 * Removes a tenant from a unit (updates PropertyUser association).
 * @param {string} propertyId - The ID of the property.
 * @param {string} unitId - The ID of the unit.
 * @param {string} tenantId - The ID of the User to remove.
 * @param {object} currentUser - The user performing the removal.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Unit>} The updated unit document.
 * @throws {AppError} If entities not found, user not authorized, or tenant not assigned.
 */
const removeTenantFromUnit = async (propertyId, unitId, tenantId, currentUser, ipAddress) => {
    const property = await Property.findById(propertyId);
    const unit = await Unit.findById(unitId);
    const tenantUser = await User.findById(tenantId);

    if (!property || !unit || !tenantUser) {
        throw new AppError('Property, unit, or tenant user not found.', 404);
    }

    // Ensure unit belongs to the property
    if (unit.property.toString() !== propertyId) {
        throw new AppError('Unit does not belong to the specified property.', 400);
    }

    // Authorization: Admin, or Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
    if (!isAuthorized) {
        throw new AppError('Not authorized to remove tenants from this unit.', 403);
    }

    // Check if the tenant is actually assigned to this unit
    if (!unit.tenants.includes(tenantId)) {
        throw new AppError('Tenant is not assigned to this unit.', 400);
    }

    // Remove tenant from the Unit's tenants array
    unit.tenants.pull(tenantId);
    const updatedUnit = await unit.save();

    // Deactivate or remove the specific PropertyUser association for this unit
    // We'll mark it inactive and set unit to null, allowing for future re-assignment to another unit
    await PropertyUser.findOneAndUpdate(
        { user: tenantId, property: propertyId, unit: unitId, roles: PROPERTY_USER_ROLES_ENUM.TENANT },
        { $set: { isActive: false, unit: null, endDate: new Date() } }
    );
    logger.info(`UnitService: Deactivated PropertyUser association for tenant ${tenantUser.email} from unit ${unit.unitName}.`);


    // Send notification to the tenant
    await createInAppNotification(
        tenantId,
        NOTIFICATION_TYPE_ENUM.find(t => t === 'unit_removed'),
        `You have been removed from unit ${unit.unitName} in ${property.name}.`,
        { kind: AUDIT_RESOURCE_TYPE_ENUM.Unit, item: unitId },
        null, // No specific link might be needed if they are removed
        { unitName: unit.unitName, propertyName: property.name },
        currentUser._id
    );

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.REMOVE_TENANT,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
        resourceId: unitId,
        newValue: { tenantId, unitId, propertyId },
        ipAddress: ipAddress,
        description: `Tenant ${tenantUser.email} removed from unit ${unit.unitName} by ${currentUser.email}.`,
        status: 'success'
    });

    return updatedUnit;
};

module.exports = {
    createUnit,
    getUnitsForProperty,
    getUnitById,
    updateUnit,
    deleteUnit,
    assignTenantToUnit,
    removeTenantFromUnit,
};
