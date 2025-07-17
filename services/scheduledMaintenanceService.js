// src/services/scheduledMaintenanceService.js

const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Property = require('../models/property');
const Unit = require('../models/unit');
const User = require('../models/user');
const Vendor = require('../models/vendor');
const PropertyUser = require('../models/propertyUser');
const Request = require('../models/request'); // For checking associated requests
const Comment = require('../models/comment'); // For comments
const Notification = require('../models/notification'); // For notifications
const { createAuditLog } = require('./auditService');
const { createInAppNotification } = require('./notificationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    CATEGORY_ENUM,
    FREQUENCY_TYPE_ENUM,
    SCHEDULED_MAINTENANCE_STATUS_ENUM,
    ASSIGNED_TO_MODEL_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM,
    REGISTRATION_STATUS_ENUM // For pseudo-user status
} = require('../utils/constants/enums');
const crypto = require('crypto'); // For generating public token

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Helper to check if a user has management permission for a given property.
 * Used for authorizing actions on scheduled maintenance tasks.
 * @param {object} user - The authenticated user object.
 * @param {string} propertyId - The ID of the property to check access for.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkPropertyManagementPermission = async (user, propertyId) => {
    if (user.role === ROLE_ENUM.ADMIN) {
        return true; // Admin has global access
    }

    const hasAccess = await PropertyUser.exists({
        user: user._id,
        property: propertyId,
        isActive: true,
        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
    });
    return hasAccess;
};

/**
 * Creates a new scheduled maintenance task.
 * @param {object} taskData - Data for the new task.
 * @param {object} currentUser - The user creating the task.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<ScheduledMaintenance>} The created task document.
 * @throws {AppError} If property/unit/assignee not found, user not authorized, or validation fails.
 */
const createScheduledMaintenance = async (taskData, currentUser, ipAddress) => {
    const { title, description, category, property: propertyId, unit: unitId, scheduledDate, recurring, frequency, assignedToId, assignedToModel, media } = taskData;

    const property = await Property.findById(propertyId);
    if (!property) {
        throw new AppError('Property not found.', 404);
    }
    if (unitId) {
        const unit = await Unit.findById(unitId);
        if (!unit || unit.property.toString() !== propertyId) {
            throw new AppError('Unit not found or does not belong to the specified property.', 404);
        }
    }

    // Authorization: User can create if they are: Admin, or Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
    if (!isAuthorized) {
        throw new AppError('Not authorized to create scheduled maintenance for this property.', 403);
    }

    // Validate and format assignedTo
    let assigneeRef = null;
    let assigneeModelRef = null;
    if (assignedToId && assignedToModel) {
        if (!ASSIGNED_TO_MODEL_ENUM.includes(assignedToModel)) {
            throw new AppError(`Invalid assignedToModel type. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}.`, 400);
        }
        let assigneeExists;
        if (assignedToModel === 'User') {
            assigneeExists = await User.findById(assignedToId);
        } else if (assignedToModel === 'Vendor') {
            assigneeExists = await Vendor.findById(assignedToId);
        }
        if (!assigneeExists) {
            throw new AppError(`Assigned ${assignedToModel} not found.`, 404);
        }
        assigneeRef = assignedToId;
        assigneeModelRef = assignedToModel;
    }

    const newScheduledMaintenance = new ScheduledMaintenance({
        title,
        description,
        category: category.toLowerCase(),
        property: propertyId,
        unit: unitId || null,
        scheduledDate,
        recurring: !!recurring,
        frequency: recurring ? {
            type: frequency?.type?.toLowerCase(),
            interval: frequency?.interval,
            dayOfWeek: frequency?.dayOfWeek,
            dayOfMonth: frequency?.dayOfMonth,
            monthOfYear: frequency?.monthOfYear,
            customDays: frequency?.customDays || []
        } : {},
        assignedTo: assigneeRef,
        assignedToModel: assigneeModelRef,
        createdBy: currentUser._id,
        media: media || [], // Expect media to be an array of URLs/IDs if uploaded separately
        status: SCHEDULED_MAINTENANCE_STATUS_ENUM.find(s => s === 'scheduled'), // Default status
        lastExecutedAt: null, // Initially null
        nextExecutionAttempt: scheduledDate // Initial next execution is the scheduled date
    });

    const createdTask = await newScheduledMaintenance.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
        resourceId: createdTask._id,
        newValue: createdTask.toObject(),
        ipAddress: ipAddress,
        description: `Scheduled maintenance "${createdTask.title}" created by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`ScheduledMaintenanceService: Task "${createdTask.title}" created by ${currentUser.email}.`);
    return createdTask;
};

/**
 * Gets all scheduled maintenance tasks with filtering, search, and pagination.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Query filters (status, recurring, propertyId, unitId, category, search, startDate, endDate).
 * @param {number} page - Page number.
 * @param {number} limit - Items per page.
 * @returns {Promise<object>} Object containing tasks array, total count, page, and limit.
 * @throws {AppError} If user not authorized.
 */
const getAllScheduledMaintenance = async (currentUser, filters, page = 1, limit = 10) => {
    let query = {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Base filtering by role
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin sees all
    } else if (currentUser.role === ROLE_ENUM.VENDOR) {
        // Vendors only see tasks assigned to them (if assignedToModel is User)
        query.assignedTo = currentUser._id;
        query.assignedToModel = 'User'; // Assuming vendors are internal Users in this context
    } else { // Landlord, PropertyManager, Tenant
        const associatedProperties = await PropertyUser.find({
            user: currentUser._id,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.TENANT, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('property');

        if (associatedProperties.length === 0) {
            return { tasks: [], total: 0, page: parseInt(page), limit: parseInt(limit) };
        }
        query.property = { $in: associatedProperties };

        // If tenant, further filter by unit
        if (currentUser.role === ROLE_ENUM.TENANT) {
            const associatedUnits = await PropertyUser.find({ user: currentUser._id, roles: PROPERTY_USER_ROLES_ENUM.TENANT, isActive: true }).distinct('unit');
            if (associatedUnits.length > 0) {
                query.unit = { $in: associatedUnits };
            } else {
                return { tasks: [], total: 0, page: parseInt(page), limit: parseInt(limit) }; // Tenant not associated with any unit
            }
        }
    }

    // Apply additional filters from query parameters
    if (filters.status) {
        if (!SCHEDULED_MAINTENANCE_STATUS_ENUM.includes(filters.status.toLowerCase())) {
            throw new AppError(`Invalid status filter: ${filters.status}`, 400);
        }
        query.status = filters.status.toLowerCase();
    }
    if (filters.recurring !== undefined) {
        query.recurring = (filters.recurring === 'true');
    }
    if (filters.propertyId) {
        // Ensure user has access to this specific property if filtering by it
        if (currentUser.role !== ROLE_ENUM.ADMIN && !(await checkPropertyManagementPermission(currentUser, filters.propertyId))) {
            throw new AppError('Not authorized to filter tasks by this property.', 403);
        }
        query.property = filters.propertyId;
    }
    if (filters.unitId) {
        // Ensure unit belongs to the property (if propertyId filter is also applied)
        const unitExists = await Unit.exists({ _id: filters.unitId, property: query.property });
        if (!unitExists) {
            throw new AppError('Unit not found in the specified property for filtering.', 404);
        }
        query.unit = filters.unitId;
    }
    if (filters.category) {
        if (!CATEGORY_ENUM.includes(filters.category.toLowerCase())) {
            throw new AppError(`Invalid category filter: ${filters.category}`, 400);
        }
        query.category = filters.category.toLowerCase();
    }
    if (filters.search) {
        query.$or = [
            { title: { $regex: filters.search, $options: 'i' } },
            { description: { $regex: filters.search, $options: 'i' } }
        ];
    }
    if (filters.startDate || filters.endDate) {
        query.scheduledDate = {};
        if (filters.startDate) query.scheduledDate.$gte = new Date(filters.startDate);
        if (filters.endDate) query.scheduledDate.$lte = new Date(filters.endDate);
    }

    const tasks = await ScheduledMaintenance.find(query)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'firstName lastName email role')
        .populate({
            path: 'assignedTo',
            select: 'firstName lastName email name phone', // Select relevant fields for User or Vendor
        })
        .sort({ scheduledDate: 1 })
        .limit(parseInt(limit))
        .skip(skip);

    const total = await ScheduledMaintenance.countDocuments(query);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ_ALL,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched list of scheduled maintenance tasks.`,
        status: 'success',
        metadata: { filters }
    });

    return { tasks, total, page: parseInt(page), limit: parseInt(limit) };
};

/**
 * Gets a single scheduled maintenance task by ID.
 * @param {string} taskId - The ID of the task.
 * @param {object} currentUser - The authenticated user.
 * @returns {Promise<ScheduledMaintenance>} The task document.
 * @throws {AppError} If task not found or user not authorized.
 */
const getScheduledMaintenanceById = async (taskId, currentUser) => {
    const task = await ScheduledMaintenance.findById(taskId)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'firstName lastName email role')
        .populate({
            path: 'assignedTo',
            select: 'firstName lastName email name phone',
        })
        .populate({
            path: 'comments.sender', // Populate sender of comments
            select: 'firstName lastName email role'
        });

    if (!task) {
        throw new AppError("Scheduled maintenance task not found.", 404);
    }

    // Authorization: User can view if they are:
    // - Admin
    // - The creator of the task
    // - Assigned to the task
    // - A Landlord/PM/Tenant associated with the property/unit
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin has full access
    } else if (task.createdBy && task.createdBy._id.equals(currentUser._id)) {
        // Creator can view
    } else if (task.assignedTo && task.assignedTo._id.equals(currentUser._id)) {
        // Assigned user can view
    } else {
        const userAssociations = await PropertyUser.find({
            user: currentUser._id,
            property: task.property,
            isActive: true
        });

        if (userAssociations.some(assoc => [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS].includes(assoc.roles[0]))) {
            // Landlord/PM can view if associated with the property
        } else if (currentUser.role === ROLE_ENUM.TENANT && task.unit && userAssociations.some(assoc => assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && assoc.unit && assoc.unit.equals(task.unit))) {
            // Tenant can view if associated with the specific unit
        } else {
            throw new AppError('Not authorized to view this scheduled maintenance task.', 403);
        }
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
        resourceId: task._id,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched details for scheduled task "${task.title}".`,
        status: 'success'
    });

    return task;
};

/**
 * Updates a scheduled maintenance task.
 * @param {string} taskId - The ID of the task to update.
 * @param {object} updateData - Data to update the task with.
 * @param {object} currentUser - The user performing the update.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<ScheduledMaintenance>} The updated task document.
 * @throws {AppError} If task not found, user not authorized, or validation fails.
 */
const updateScheduledMaintenance = async (taskId, updateData, currentUser, ipAddress) => {
    const task = await ScheduledMaintenance.findById(taskId);
    if (!task) {
        throw new AppError("Scheduled maintenance task not found.", 404);
    }

    // Authorization: Admin, or PM/Landlord associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, task.property);
    if (!isAuthorized) {
        throw new AppError('Not authorized to update this scheduled maintenance task.', 403);
    }

    const oldTask = task.toObject(); // Capture old state for audit log

    // Handle assignedTo (polymorphic) validation if provided
    if (updateData.assignedToId !== undefined && updateData.assignedToModel !== undefined) {
        if (updateData.assignedToId === null && updateData.assignedToModel === null) { // Allow clearing assignment
            task.assignedTo = null;
            task.assignedToModel = null;
        } else {
            if (!ASSIGNED_TO_MODEL_ENUM.includes(updateData.assignedToModel)) {
                throw new AppError(`Invalid assignedToModel type: ${updateData.assignedToModel}. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}.`, 400);
            }
            let assigneeExists;
            if (updateData.assignedToModel === 'User') {
                assigneeExists = await User.findById(updateData.assignedToId);
            } else if (updateData.assignedToModel === 'Vendor') {
                assigneeExists = await Vendor.findById(updateData.assignedToId);
            }
            if (!assigneeExists) {
                throw new AppError(`Assigned ${updateData.assignedToModel} not found.`, 404);
            }
            task.assignedTo = updateData.assignedToId;
            task.assignedToModel = updateData.assignedToModel;
        }
    }

    // Apply updates from updateData
    Object.keys(updateData).forEach(key => {
        if (updateData[key] !== undefined) {
            if (key === 'category') {
                if (!CATEGORY_ENUM.includes(updateData[key].toLowerCase())) {
                    throw new AppError(`Invalid category: ${updateData[key]}. Allowed: ${CATEGORY_ENUM.join(', ')}`, 400);
                }
                task[key] = updateData[key].toLowerCase();
            } else if (key === 'status') {
                if (!SCHEDULED_MAINTENANCE_STATUS_ENUM.includes(updateData[key].toLowerCase())) {
                    throw new AppError(`Invalid status: ${updateData[key]}. Allowed: ${SCHEDULED_MAINTENANCE_STATUS_ENUM.join(', ')}`, 400);
                }
                task[key] = updateData[key].toLowerCase();
            } else if (key === 'recurring') {
                task[key] = !!updateData[key];
            } else if (key === 'frequency' && task.recurring) {
                task.frequency = {
                    type: updateData[key]?.type?.toLowerCase() || task.frequency.type,
                    interval: updateData[key]?.interval || task.frequency.interval,
                    dayOfWeek: updateData[key]?.dayOfWeek || task.frequency.dayOfWeek,
                    dayOfMonth: updateData[key]?.dayOfMonth || task.frequency.dayOfMonth,
                    monthOfYear: updateData[key]?.monthOfYear || task.frequency.monthOfYear,
                    customDays: updateData[key]?.customDays || task.frequency.customDays || []
                };
            } else if (key !== 'assignedToId' && key !== 'assignedToModel') { // Already handled assignedTo
                task[key] = updateData[key];
            }
        }
    });

    // If recurring is set to false, clear frequency
    if (updateData.recurring === false) {
        task.frequency = {};
    }

    const updatedTask = await task.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
        resourceId: updatedTask._id,
        oldValue: oldTask,
        newValue: updatedTask.toObject(),
        ipAddress: ipAddress,
        description: `Scheduled maintenance "${updatedTask.title}" updated by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`ScheduledMaintenanceService: Task "${updatedTask.title}" updated by ${currentUser.email}.`);
    return updatedTask;
};

/**
 * Deletes a scheduled maintenance task and cleans up related references.
 * @param {string} taskId - The ID of the task to delete.
 * @param {object} currentUser - The user performing the deletion.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If task not found, user not authorized, or dependent data exists.
 */
const deleteScheduledMaintenance = async (taskId, currentUser, ipAddress) => {
    const taskToDelete = await ScheduledMaintenance.findById(taskId);
    if (!taskToDelete) {
        throw new AppError("Scheduled maintenance task not found.", 404);
    }

    // Authorization: Admin, or PM/Landlord associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, taskToDelete.property);
    if (!isAuthorized) {
        throw new AppError('Not authorized to delete this scheduled maintenance task.', 403);
    }

    // Check if there are active Requests generated from this schedule
    const generatedRequestsCount = await Request.countDocuments({ scheduledMaintenanceRef: taskId });
    if (generatedRequestsCount > 0) {
        throw new AppError('Cannot delete scheduled maintenance with associated requests. Please handle them first (e.g., reassign or delete requests).', 400);
    }

    const oldTask = taskToDelete.toObject(); // Capture for audit log

    // Cleanup related comments and notifications
    await Comment.deleteMany({ contextId: taskId, contextType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance });
    await Notification.deleteMany({ 'relatedResource.item': taskId, 'relatedResource.kind': AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance });
    logger.info(`ScheduledMaintenanceService: Deleted comments and notifications for task "${taskToDelete.title}".`);

    // Finally, delete the task document
    await taskToDelete.deleteOne();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
        resourceId: taskId,
        oldValue: oldTask,
        newValue: null,
        ipAddress: ipAddress,
        description: `Scheduled maintenance "${oldTask.title}" deleted by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`ScheduledMaintenanceService: Task "${oldTask.title}" deleted by ${currentUser.email}.`);
};

/**
 * Enables a public link for a scheduled maintenance task.
 * @param {string} taskId - The ID of the task.
 * @param {number} [expiresInDays] - Optional: duration in days for the link to be valid.
 * @param {object} currentUser - The user enabling the link.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<string>} The generated public link URL.
 * @throws {AppError} If task not found or user not authorized.
 */
const enableScheduledMaintenancePublicLink = async (taskId, expiresInDays, currentUser, ipAddress) => {
    const task = await ScheduledMaintenance.findById(taskId);
    if (!task) {
        throw new AppError('Scheduled maintenance task not found.', 404);
    }

    // Authorization: PM/Landlord/Admin associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, task.property);
    if (!isAuthorized) {
        throw new AppError('Not authorized to enable public link for this scheduled maintenance task.', 403);
    }

    // Generate a new token if one doesn't exist or is being re-enabled
    if (!task.publicLinkToken || !task.publicLinkEnabled) {
        task.publicLinkToken = crypto.randomBytes(24).toString('hex');
    }

    task.publicLinkEnabled = true;
    if (expiresInDays) {
        task.publicLinkExpires = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    } else if (!task.publicLinkExpires || task.publicLinkExpires < new Date()) {
        // If no expiry specified or it's already expired, set a default (e.g., 7 days)
        task.publicLinkExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    await task.save();

    const publicLink = `${FRONTEND_URL}/public/scheduled-maintenance/${task.publicLinkToken}`;

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.ENABLE_PUBLIC_LINK,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
        resourceId: task._id,
        newValue: { publicLinkToken: task.publicLinkToken, publicLinkExpires: task.publicLinkExpires },
        ipAddress: ipAddress,
        description: `Public link enabled for scheduled task "${task.title}" by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`ScheduledMaintenanceService: Public link enabled for task "${task.title}" by ${currentUser.email}.`);
    return publicLink;
};

/**
 * Disables a public link for a scheduled maintenance task.
 * @param {string} taskId - The ID of the task.
 * @param {object} currentUser - The user disabling the link.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If task not found or user not authorized.
 */
const disableScheduledMaintenancePublicLink = async (taskId, currentUser, ipAddress) => {
    const task = await ScheduledMaintenance.findById(taskId);
    if (!task) {
        throw new AppError('Scheduled maintenance task not found.', 404);
    }

    // Authorization: PM/Landlord/Admin associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, task.property);
    if (!isAuthorized) {
        throw new AppError('Not authorized to disable public link for this scheduled maintenance task.', 403);
    }

    task.publicLinkEnabled = false;
    task.publicLinkToken = undefined; // Clear the token
    task.publicLinkExpires = undefined; // Clear expiry
    await task.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DISABLE_PUBLIC_LINK,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
        resourceId: task._id,
        oldValue: { publicLinkToken: task.publicLinkToken, publicLinkExpires: task.publicLinkExpires },
        newValue: { publicLinkEnabled: false },
        ipAddress: ipAddress,
        description: `Public link disabled for scheduled task "${task.title}" by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`ScheduledMaintenanceService: Public link disabled for task "${task.title}" by ${currentUser.email}.`);
};

/**
 * Gets external (public) view of a scheduled maintenance task using a public token.
 * @param {string} publicToken - The public token for the task.
 * @returns {Promise<object>} Limited task details for public view.
 * @throws {AppError} If token is invalid, expired, or disabled.
 */
const getPublicScheduledMaintenanceView = async (publicToken) => {
    const task = await ScheduledMaintenance.findOne({
        publicLinkToken: publicToken,
        publicLinkEnabled: true,
        publicLinkExpires: { $gt: new Date() } // Must not be expired
    })
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate({
            path: 'comments',
            populate: {
                path: 'sender',
                select: 'firstName lastName' // Only populate sender name for public view
            }
        });

    if (!task) {
        throw new AppError('Invalid, expired, or disabled public link.', 404);
    }

    // Return a limited set of data for public view
    return {
        _id: task._id,
        title: task.title,
        description: task.description,
        category: task.category,
        scheduledDate: task.scheduledDate,
        recurring: task.recurring,
        frequency: task.frequency,
        status: task.status,
        property: task.property,
        unit: task.unit,
        media: task.media, // Include media URLs
        comments: task.comments.filter(comment => !comment.isInternalNote).map(comment => ({ // Filter out internal notes
            senderName: comment.sender ? `${comment.sender.firstName} ${comment.sender.lastName}` : comment.externalUserName,
            message: comment.message,
            timestamp: comment.timestamp
        })),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
    };
};

/**
 * Allows an external user to update status/add comments for a scheduled maintenance task via public link.
 * @param {string} publicToken - The public token for the task.
 * @param {object} updateData - Data for the update (status, commentMessage, name, phone).
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<ScheduledMaintenance>} The updated task document.
 * @throws {AppError} If token is invalid, expired, or disabled, or validation fails.
 */
const publicScheduledMaintenanceUpdate = async (publicToken, updateData, ipAddress) => {
    const { status, commentMessage, name, phone } = updateData;

    if (!name || !phone) {
        throw new AppError('Name and phone are required for accountability.', 400);
    }

    const task = await ScheduledMaintenance.findOne({
        publicLinkToken: publicToken,
        publicLinkEnabled: true,
        publicLinkExpires: { $gt: new Date() }
    });

    if (!task) {
        throw new AppError('Invalid, expired, or disabled public link.', 404);
    }

    // Find or create a 'pseudo-user' for this external vendor interaction for audit logging and comment sender
    // This pseudo-user helps maintain referential integrity in comments/audit logs.
    let publicUpdater = await User.findOne({ email: `${phone}@external.com`, role: ROLE_ENUM.VENDOR });
    if (!publicUpdater) {
        publicUpdater = await User.create({
            firstName: name.split(' ')[0] || 'External',
            lastName: name.split(' ')[1] || 'User',
            phone: phone,
            email: `${phone}@external.com`, // Dummy email for unique constraint
            role: ROLE_ENUM.VENDOR, // Assign a vendor role to external users for consistency
            status: REGISTRATION_STATUS_ENUM.ACTIVE, // Mark as active for immediate use
            isEmailVerified: false,
            passwordHash: 'N/A' // No password for pseudo-user
        });
        logger.info(`ScheduledMaintenanceService: Created pseudo-user for external update: ${publicUpdater.email}`);
    }

    // Update status if provided and valid (e.g., 'in_progress', 'completed')
    const allowedPublicStatuses = [
        SCHEDULED_MAINTENANCE_STATUS_ENUM.find(s => s === 'in_progress'),
        SCHEDULED_MAINTENANCE_STATUS_ENUM.find(s => s === 'completed')
    ];
    if (status) {
        const lowerStatus = status.toLowerCase();
        if (!allowedPublicStatuses.includes(lowerStatus)) {
            throw new AppError(`Invalid status for public update. Must be one of: ${allowedPublicStatuses.join(', ')}.`, 400);
        }
        const oldStatus = task.status;
        task.status = lowerStatus;
        await createAuditLog({
            action: AUDIT_ACTION_ENUM.PUBLIC_UPDATE,
            user: publicUpdater._id,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            resourceId: task._id,
            oldValue: { status: oldStatus },
            newValue: { status: task.status },
            ipAddress: ipAddress,
            description: `External vendor ${name} updated scheduled task "${task.title}" status from ${oldStatus} to ${task.status}.`,
            status: 'success'
        });
        // Notify relevant internal users about public status update
        const propertyManagersAndLandlords = await PropertyUser.find({
            property: task.property,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('user');

        for (const managerId of propertyManagersAndLandlords) {
            await createInAppNotification(
                managerId,
                NOTIFICATION_TYPE_ENUM.find(t => t === 'status_update'),
                `External vendor ${name} updated scheduled task "${task.title}" to ${task.status}.`,
                { kind: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance, item: task._id },
                `${FRONTEND_URL}/scheduled-maintenance/${task._id}`,
                { taskTitle: task.title, newStatus: task.status, updaterName: name },
                publicUpdater._id
            );
        }
    }

    // Add comment if provided
    if (commentMessage) {
        const newComment = await Comment.create({
            contextType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            contextId: task._id,
            sender: publicUpdater._id, // Link to the pseudo-user
            message: commentMessage,
            isExternal: true, // Mark as external comment
            externalUserName: name,
            externalUserEmail: `${phone}@external.com`,
            timestamp: new Date()
        });
        task.comments.push(newComment._id); // Store reference to the new comment
        await createAuditLog({
            action: AUDIT_ACTION_ENUM.COMMENT_ADDED,
            user: publicUpdater._id,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            resourceId: task._id,
            newValue: { commentId: newComment._id, message: commentMessage },
            ipAddress: ipAddress,
            description: `External vendor ${name} added a comment to scheduled task "${task.title}".`,
            status: 'success'
        });

        // Notify relevant internal users about new comment
        const relevantUsers = new Set();
        if (task.createdBy) relevantUsers.add(task.createdBy.toString());
        if (task.assignedTo && task.assignedToModel === 'User') relevantUsers.add(task.assignedTo.toString());

        const propertyManagersAndLandlords = await PropertyUser.find({
            property: task.property,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('user');
        propertyManagersAndLandlords.forEach(id => relevantUsers.add(id.toString()));

        for (const userId of relevantUsers) {
            await createInAppNotification(
                userId,
                NOTIFICATION_TYPE_ENUM.find(t => t === 'new_comment'),
                `New comment on scheduled task "${task.title}" from external vendor ${name}.`,
                { kind: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance, item: task._id },
                `${FRONTEND_URL}/scheduled-maintenance/${task._id}`,
                { taskTitle: task.title, comment: commentMessage, updaterName: name },
                publicUpdater._id
            );
        }
    }

    const updatedTask = await task.save();
    return updatedTask;
};


module.exports = {
    createScheduledMaintenance,
    getAllScheduledMaintenance,
    getScheduledMaintenanceById,
    updateScheduledMaintenance,
    deleteScheduledMaintenance,
    enableScheduledMaintenancePublicLink,
    disableScheduledMaintenancePublicLink,
    getPublicScheduledMaintenanceView,
    publicScheduledMaintenanceUpdate,
};
