// src/services/propertyService.js

const Property = require('../models/property');
const User = require('../models/user');
const Unit = require('../models/unit');
const PropertyUser = require('../models/propertyUser');
const Lease = require('../models/lease');
const Rent = require('../models/rent');
const Message = require('../models/message');
const Onboarding = require('../models/onboarding'); 
const Comment = require('../models/comment'); 
const Request = require('../models/request'); 
const ScheduledMaintenance = require('../models/scheduledMaintenance');

const { createAuditLog } = require('./auditService');
const { createInAppNotification } = require('./notificationService'); // For notifications
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    ROLE_ENUM, // Now an object
    PROPERTY_USER_ROLES_ENUM,
    AUDIT_ACTION_ENUM, // Now an object
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM,
    LEASE_STATUS_ENUM, // Added for lease status checks
    UNIT_STATUS_ENUM // Added for unit status updates
} = require('../utils/constants/enums');

/**
 * Helper to check if a user has management permission for a given property.
 * This is used for landlord/PM/admin roles.
 * @param {object} user - The authenticated user object.
 * @param {string} propertyId - The ID of the property to check access for.
 * @param {Array<string>} requiredRoles - Specific PropertyUser roles required (e.g., ['landlord', 'propertymanager']).
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkPropertyManagementPermission = async (user, propertyId, requiredRoles = [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS]) => {
    if (user.role === ROLE_ENUM.ADMIN) {
        return true; // Admin has global access
    }

    const hasAccess = await PropertyUser.exists({
        user: user._id,
        property: propertyId,
        isActive: true,
        roles: { $in: requiredRoles }
    });
    return hasAccess;
};

/**
 * Creates a new property.
 * @param {object} propertyData - Data for the new property.
 * @param {object} currentUser - The user creating the property.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Property>} The created property document.
 * @throws {AppError} If validation fails or user not authorized.
 */
const createProperty = async (propertyData, currentUser, ipAddress) => {
    const { name, address, propertyType, yearBuilt, numberOfUnits, details, annualOperatingBudget, notes, mainContactUser } = propertyData;

    // Authorization: Only Landlords, Property Managers, and Admins can create properties.
    // This is also handled by route middleware, but a double-check here for robustness.
    if (![ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.ADMIN].includes(currentUser.role)) {
        throw new AppError('You are not authorized to create properties.', 403);
    }

    // Ensure mainContactUser exists if provided
    if (mainContactUser) {
        const contactUserExists = await User.exists({ _id: mainContactUser });
        if (!contactUserExists) {
            throw new AppError('Main contact user not found.', 404);
        }
    }

    const newProperty = new Property({
        name,
        address,
        propertyType,
        yearBuilt,
        numberOfUnits,
        details,
        annualOperatingBudget,
        notes,
        mainContactUser,
        createdBy: currentUser._id,
        isActive: true // Default to active
    });

    const createdProperty = await newProperty.save();

    // After creating property, link the creator to it via PropertyUser model
    // The creator becomes a 'landlord' if they are a landlord, or 'propertymanager' if they are a PM.
    let roleForCreator = currentUser.role;
    if (roleForCreator === ROLE_ENUM.ADMIN) {
        // Admins might not be the primary landlord/PM, but are linked for management access.
        // Assign them as a property manager by default on this property.
        roleForCreator = PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER; // Changed to use PROPERTY_USER_ROLES_ENUM
    }

    await PropertyUser.create({
        user: currentUser._id,
        property: createdProperty._id,
        roles: [roleForCreator], // Assign initial role on this property
        invitedBy: currentUser._id, // Self-invited
        isActive: true,
        startDate: new Date(),
    });

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE, // Correctly uses CREATE from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
        resourceId: createdProperty._id,
        newValue: createdProperty.toObject(),
        ipAddress: ipAddress,
        description: `Property "${createdProperty.name}" created by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`PropertyService: Property "${createdProperty.name}" created by ${currentUser.email}.`);
    return createdProperty;
};

/**
 * Gets all properties accessible by the logged-in user with filtering and pagination.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Query filters (search, city, country, isActive, propertyType, sortBy, sortOrder, page, limit).
 * @returns {Promise<object>} Object containing properties array, total count, page, and limit.
 * @throws {AppError} If user not authorized.
 */
const getAllProperties = async (currentUser, filters) => {
    let query = {};
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 10;
    const skip = (page - 1) * limit;

    // Base filtering based on user role
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin sees all
    } else {
        // For other roles, find properties associated with the current user via PropertyUser model
        const associatedPropertyUsers = await PropertyUser.find({ user: currentUser._id, isActive: true }).distinct('property');

        if (associatedPropertyUsers.length === 0) {
            return { properties: [], total: 0, page, limit };
        }
        query._id = { $in: associatedPropertyUsers };
    }

    // Apply additional filters from query parameters
    if (filters.search) {
        query.name = { $regex: filters.search, $options: 'i' };
    }
    if (filters.city) {
        query['address.city'] = { $regex: filters.city, $options: 'i' };
    }
    if (filters.country) {
        query['address.country'] = { $regex: filters.country, $options: 'i' };
    }
    if (filters.isActive !== undefined) {
        query.isActive = filters.isActive === 'true'; // Convert string to boolean
    }
    if (filters.propertyType) {
        query.propertyType = filters.propertyType.toLowerCase();
    }

    const sortBy = filters.sortBy || 'name';
    const sortOrder = filters.sortOrder === 'desc' ? -1 : 1;
    const sortOptions = { [sortBy]: sortOrder };

    const properties = await Property.find(query)
        .populate('units', 'unitName status') // Populate basic unit info
        .populate('createdBy', 'firstName lastName email') // Populate creator
        .populate('mainContactUser', 'firstName lastName email') // Populate main contact
        .sort(sortOptions)
        .limit(limit)
        .skip(skip);

    const total = await Property.countDocuments(query);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.FETCH_ALL_PROPERTIES, // Changed from READ_ALL
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
        ipAddress: currentUser.ip, // Ensure currentUser.ip is populated by middleware
        description: `User ${currentUser.email} fetched list of properties.`,
        status: 'success',
        metadata: { filters }
    });

    return { properties, total, page, limit };
};

/**
 * Gets a single property by ID, including associated users.
 * @param {string} propertyId - The ID of the property.
 * @param {object} currentUser - The authenticated user.
 * @returns {Promise<object>} The property document with associated users.
 * @throws {AppError} If property not found or user not authorized.
 */
const getPropertyById = async (propertyId, currentUser) => {
    const property = await Property.findById(propertyId)
        .populate('units') // Populate units details
        .populate('createdBy', 'firstName lastName email') // Populate who created the property
        .populate('mainContactUser', 'firstName lastName email'); // Populate main contact user

    if (!property) {
        throw new AppError('Property not found.', 404);
    }

    // Authorization: Admin can view any property. Others must be associated.
    // Enhanced requiredRoles to include TENANT for viewing their associated properties.
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId, [
        PROPERTY_USER_ROLES_ENUM.LANDLORD,
        PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
        PROPERTY_USER_ROLES_ENUM.TENANT, // Tenants can view their associated properties
        PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS // For users with admin-like access on a property
    ]);

    if (!isAuthorized) {
        throw new AppError('Not authorized to view this property.', 403);
    }

    // Optionally, fetch and include details about associated Landlords, PMs, Tenants via PropertyUser
    const associatedUsers = await PropertyUser.find({ property: propertyId, isActive: true })
        .populate('user', 'firstName lastName email role'); // Populate user details

    const landlords = associatedUsers.filter(au => au.roles.includes(PROPERTY_USER_ROLES_ENUM.LANDLORD)).map(au => au.user);
    const propertyManagers = associatedUsers.filter(au => au.roles.includes(PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER)).map(au => au.user);
    const tenants = associatedUsers.filter(au => au.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT)).map(au => ({ user: au.user, unit: au.unit })); // Include unit for tenants

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ_ONE_PROPERTY, // Changed from READ
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
        resourceId: property._id,
        ipAddress: currentUser.ip, // Ensure currentUser.ip is populated by middleware
        description: `User ${currentUser.email} fetched property ${property.name}.`,
        status: 'success'
    });

    return {
        ...property.toObject(),
        landlords,
        propertyManagers,
        tenants,
    };
};

/**
 * Updates a property's details.
 * @param {string} propertyId - The ID of the property to update.
 * @param {object} updateData - Data to update the property with.
 * @param {object} currentUser - The user performing the update.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Property>} The updated property document.
 * @throws {AppError} If property not found, user not authorized, or validation fails.
 */
const updateProperty = async (propertyId, updateData, currentUser, ipAddress) => {
    let property = await Property.findById(propertyId);
    if (!property) {
        throw new AppError('Property not found.', 404);
    }

    // Authorization: Only Admin, or Landlord/PM associated with this property can update
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId, [
        PROPERTY_USER_ROLES_ENUM.LANDLORD,
        PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
        PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
    ]);

    if (!isAuthorized) {
        throw new AppError('Not authorized to update this property.', 403);
    }

    const oldProperty = property.toObject(); // Capture old state for audit log

    // Apply updates to the property document
    Object.assign(property, updateData);
    const updatedProperty = await property.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE, // Correctly uses UPDATE from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
        resourceId: updatedProperty._id,
        oldValue: oldProperty,
        newValue: updatedProperty.toObject(),
        ipAddress: ipAddress,
        description: `Property "${updatedProperty.name}" updated by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`PropertyService: Property "${updatedProperty.name}" updated by ${currentUser.email}.`);
    return updatedProperty;
};

/**
 * Deletes a property and all its associated data (cascade delete).
 * @param {string} propertyId - The ID of the property to delete.
 * @param {object} currentUser - The user performing the deletion.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If property not found, user not authorized, or has active dependents.
 */
const deleteProperty = async (propertyId, currentUser, ipAddress) => {
    const property = await Property.findById(propertyId);
    if (!property) {
        throw new AppError('Property not found.', 404);
    }

    // Authorization: Only Admin can delete. Landlords can delete their own properties.
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId, [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS]);
    if (!isAuthorized) {
        throw new AppError('Not authorized to delete this property.', 403);
    }

    const oldProperty = property.toObject(); // Capture old state for audit log

    // IMPORTANT: Before deleting, check for active dependents that prevent deletion.
    // This prevents accidental data loss and maintains data integrity.
    const activeLeasesCount = await Lease.countDocuments({ property: propertyId, status: LEASE_STATUS_ENUM.find(s => s === 'active') });
    if (activeLeasesCount > 0) {
        throw new AppError('Cannot delete property with active leases. Please terminate them first.', 400);
    }

    // --- Cascade Delete (ORDER MATTERS for dependencies) ---
    // Delete associated data in an order that respects foreign key dependencies where applicable.
    // 1. Delete all Rents associated with units of this property (or directly by property if Rent model supported it)
    const unitsInProperty = await Unit.find({ property: propertyId }).select('_id');
    const unitIds = unitsInProperty.map(unit => unit._id);
    if (unitIds.length > 0) {
        await Rent.deleteMany({ unit: { $in: unitIds } });
        logger.info(`PropertyService: Deleted ${unitIds.length} units' rent records for property ${propertyId}.`);
    }

    // 2. Delete all Leases associated with this property
    await Lease.deleteMany({ property: propertyId });
    logger.info(`PropertyService: Deleted leases for property ${propertyId}.`);

    // 3. Delete all Requests associated with this property or its units
    await Request.deleteMany({ $or: [{ property: propertyId }, { unit: { $in: unitIds } }] });
    logger.info(`PropertyService: Deleted requests for property ${propertyId}.`);

    // 4. Delete all ScheduledMaintenance associated with this property or its units
    await ScheduledMaintenance.deleteMany({ $or: [{ property: propertyId }, { unit: { $in: unitIds } }] });
    logger.info(`PropertyService: Deleted scheduled maintenance for property ${propertyId}.`);

    // 5. Delete all Comments associated with this property or its units/requests/scheduled maintenance
    // This is complex due to `contextType` and `contextId`. Simpler to delete comments related to the property itself.
    // For comments related to requests/scheduled maintenance, they are implicitly deleted when those resources are deleted.
    await Comment.deleteMany({ contextType: AUDIT_RESOURCE_TYPE_ENUM.Property, contextId: propertyId });
    logger.info(`PropertyService: Deleted direct property comments for property ${propertyId}.`);

    // 6. Delete all Messages related to this property or its units
    await Message.deleteMany({ $or: [{ property: propertyId }, { unit: { $in: unitIds } }] });
    logger.info(`PropertyService: Deleted messages for property ${propertyId}.`);

    // 7. Delete all Onboarding materials related to this property or its units
    await Onboarding.deleteMany({ $or: [{ property: propertyId }, { unit: { $in: unitIds } }] });
    logger.info(`PropertyService: Deleted onboarding materials for property ${propertyId}.`);

    // 8. Delete all PropertyUser associations for this property
    await PropertyUser.deleteMany({ property: propertyId });
    logger.info(`PropertyService: Deleted PropertyUser associations for property ${propertyId}.`);

    // 9. Delete all Units belonging to this property
    await Unit.deleteMany({ property: propertyId });
    logger.info(`PropertyService: Deleted units for property ${propertyId}.`);

    // 10. Finally, delete the property itself
    await property.deleteOne();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE, // Correctly uses DELETE from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
        resourceId: propertyId,
        oldValue: oldProperty,
        newValue: null,
        ipAddress: ipAddress,
        description: `Property "${oldProperty.name}" and all its associated data deleted by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`PropertyService: Property "${oldProperty.name}" deleted by ${currentUser.email}.`);
};

/**
 * Assigns a user to a property with specific roles.
 * This is a generic assignment function, replacing assign/remove PM/Tenant.
 * @param {string} propertyId - The ID of the property.
 * @param {string} userIdToAssign - The ID of the user to assign.
 * @param {Array<string>} roles - An array of roles to assign (e.g., ['propertymanager'], ['tenant']).
 * @param {string} [unitId=null] - Optional. The ID of the unit if assigning a tenant.
 * @param {object} currentUser - The user performing the assignment.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<PropertyUser>} The created or updated PropertyUser document.
 * @throws {AppError} If property/user/unit not found, user not authorized, or assignment conflict.
 */
const assignUserToProperty = async (propertyId, userIdToAssign, roles, unitId = null, currentUser, ipAddress) => {
    const property = await Property.findById(propertyId);
    if (!property) {
        throw new AppError('Property not found.', 404);
    }

    const userToAssign = await User.findById(userIdToAssign);
    if (!userToAssign) {
        throw new AppError('User to assign not found.', 404);
    }

    // Authorization: Only Admin or Landlord of the property can assign users.
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId, [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS]);
    if (!isAuthorized) {
        throw new AppError('Not authorized to assign users to this property.', 403);
    }

    // Validate roles and unitId for 'tenant' role
    if (roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT)) {
        if (!unitId) {
            throw new AppError('Unit ID is required when assigning a tenant.', 400);
        }
        const unit = await Unit.findById(unitId);
        if (!unit || !unit.property.equals(propertyId)) {
            throw new AppError('Unit not found or does not belong to the specified property.', 404);
        }
        // Check if unit has an active lease (if assigning a tenant via this method, it should ideally be vacant)
        const activeLeaseForUnit = await Lease.findOne({ unit: unitId, status: LEASE_STATUS_ENUM.find(s => s === 'active') });
        if (activeLeaseForUnit) {
            throw new AppError('Unit is currently occupied by an active lease. Terminate existing lease first.', 409);
        }
    } else if (unitId) {
        // If roles are not tenant, unitId should not be provided or should be null
        throw new AppError('Unit ID should only be provided when assigning a tenant role.', 400);
    }

    // Find existing association
    let assignment = await PropertyUser.findOne({
        user: userIdToAssign,
        property: propertyId,
        unit: unitId // Important: include unitId in query for tenant roles
    });

    let actionType = AUDIT_ACTION_ENUM.CREATE;
    let description = `User ${userToAssign.email} assigned to property ${property.name} with roles ${roles.join(', ')} by ${currentUser.email}.`;
    let oldValue = null;
    let newValue = null;

    if (assignment) {
        oldValue = assignment.toObject();
        // If roles are already present and active, conflict
        const existingActiveRoles = assignment.roles.filter(r => roles.includes(r));
        if (assignment.isActive && existingActiveRoles.length === roles.length) {
            throw new AppError(`User is already assigned with the specified active roles for this property/unit.`, 409);
        }

        // Update existing assignment
        assignment.roles = [...new Set([...assignment.roles, ...roles])]; // Add new roles, avoid duplicates
        assignment.isActive = true; // Reactivate if it was inactive
        assignment.endDate = null; // Clear end date if reactivating
        assignment.invitedBy = currentUser._id; // Update invitedBy
        newValue = assignment.toObject();
        actionType = AUDIT_ACTION_ENUM.UPDATE;
        description = `User ${userToAssign.email} roles updated/reactivated for property ${property.name} by ${currentUser.email}.`;
    } else {
        // Create new assignment
        assignment = new PropertyUser({
            user: userIdToAssign,
            property: propertyId,
            unit: unitId,
            roles,
            invitedBy: currentUser._id,
            isActive: true,
            startDate: new Date(),
        });
        newValue = assignment.toObject();
    }

    const savedAssignment = await assignment.save();

    // If assigning a tenant, update unit status
    if (roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && unitId) {
        await Unit.findByIdAndUpdate(unitId, { status: UNIT_STATUS_ENUM.find(s => s === 'occupied') });
        logger.info(`PropertyService: Unit ${unitId} status updated to occupied.`);
    }

    await createAuditLog({
        action: actionType,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
        resourceId: savedAssignment._id,
        oldValue: oldValue,
        newValue: newValue,
        ipAddress: ipAddress,
        description: description,
        status: 'success'
    });

    logger.info(`PropertyService: ${description}`);
    return savedAssignment;
};

/**
 * Removes (deactivates) a user's association with a property/unit for specific roles.
 * @param {string} propertyId - The ID of the property.
 * @param {string} userIdToRemove - The ID of the user to remove.
 * @param {Array<string>} rolesToRemove - An array of roles to remove (e.g., ['propertymanager'], ['tenant']).
 * @param {string} [unitId=null] - Optional. The ID of the unit if removing a tenant.
 * @param {object} currentUser - The user performing the removal.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If property/user/association not found, user not authorized, or has active dependents.
 */
const removeUserFromProperty = async (propertyId, userIdToRemove, rolesToRemove, unitId = null, currentUser, ipAddress) => {
    const property = await Property.findById(propertyId);
    if (!property) {
        throw new AppError('Property not found.', 404);
    }

    const userToRemove = await User.findById(userIdToRemove);
    if (!userToRemove) {
        throw new AppError('User to remove not found.', 404);
    }

    // Authorization: Only Admin or Landlord of the property can remove users.
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId, [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS]);
    if (!isAuthorized) {
        throw new AppError('Not authorized to remove users from this property.', 403);
    }

    // Find the specific assignment
    const query = {
        user: userIdToRemove,
        property: propertyId,
        roles: { $in: rolesToRemove }
    };
    if (unitId) {
        query.unit = unitId;
    }

    const assignment = await PropertyUser.findOne(query);

    if (!assignment || !assignment.isActive) {
        throw new AppError(`User is not actively assigned with the specified roles for this property/unit.`, 404);
    }

    const oldAssignment = assignment.toObject(); // Capture old state for audit log

    // Prevent removal if active leases exist for tenants
    if (rolesToRemove.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && unitId) {
        const activeLease = await Lease.findOne({ tenant: userIdToRemove, unit: unitId, status: LEASE_STATUS_ENUM.find(s => s === 'active') });
        if (activeLease) {
            throw new AppError('Cannot remove tenant with an active lease for this unit. Terminate lease first.', 400);
        }
    }

    // Remove specified roles from the assignment
    assignment.roles = assignment.roles.filter(role => !rolesToRemove.includes(role));

    // If no roles remain, or if the specific tenant role is removed from a unit-specific assignment, deactivate the association
    if (assignment.roles.length === 0 || (rolesToRemove.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && unitId)) {
        assignment.isActive = false;
        assignment.endDate = new Date();
    }

    const savedAssignment = await assignment.save();

    // If a tenant was removed and no other active tenants/leases for the unit, update unit status to vacant
    if (rolesToRemove.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && unitId) {
        const remainingActiveTenants = await PropertyUser.countDocuments({ unit: unitId, roles: PROPERTY_USER_ROLES_ENUM.TENANT, isActive: true });
        const remainingActiveLeases = await Lease.countDocuments({ unit: unitId, status: LEASE_STATUS_ENUM.find(s => s === 'active') });

        if (remainingActiveTenants === 0 && remainingActiveLeases === 0) {
            await Unit.findByIdAndUpdate(unitId, { status: UNIT_STATUS_ENUM.find(s => s === 'vacant') });
            logger.info(`PropertyService: Unit ${unitId} status updated to vacant after tenant removal.`);
        }
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE, // Considered an update to the association
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
        resourceId: savedAssignment._id,
        oldValue: oldAssignment,
        newValue: savedAssignment.toObject(),
        ipAddress: ipAddress,
        description: `User ${userToRemove.email} removed from property ${property.name} for roles ${rolesToRemove.join(', ')} by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`PropertyService: User ${userToRemove.email} removed from property ${property.name} for roles ${rolesToRemove.join(', ')}.`);
    return savedAssignment;
};


module.exports = {
    createProperty,
    getAllProperties,
    getPropertyById,
    updateProperty,
    deleteProperty,
    assignUserToProperty,
    removeUserFromProperty,
};
