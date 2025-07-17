// src/services/requestService.js

const Request = require('../models/request');
const Property = require('../models/property');
const Unit = require('../models/unit');
const User = require('../models/user');
const Vendor = require('../models/vendor');
const PropertyUser = require('../models/propertyUser');
const Comment = require('../models/comment');
const Notification = require('../models/notification');
const { createAuditLog } = require('./auditService');
const { createInAppNotification } = require('./notificationService');
const { uploadFile, deleteFile } = require('./cloudStorageService'); // Assuming these exist for Cloudinary operations
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    CATEGORY_ENUM,
    PRIORITY_ENUM,
    REQUEST_STATUS_ENUM,
    ASSIGNED_TO_MODEL_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM,
    REGISTRATION_STATUS_ENUM // For pseudo-user status
} = require('../utils/constants/enums');
const crypto = require('crypto'); // For generating public token

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Helper to check if a user has management or direct access permission for a request.
 * @param {object} user - The authenticated user object.
 * @param {object} request - The request document to check access for.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkRequestAccess = async (user, request) => {
    if (user.role === ROLE_ENUM.ADMIN) {
        return true; // Admin has global access
    }
    if (request.createdBy && request.createdBy.equals(user._id)) {
        return true; // Request creator can always access their own request
    }
    if (request.assignedTo && request.assignedTo.equals(user._id)) {
        return true; // Assigned user/vendor can access
    }

    // Check if user is a landlord or property manager for the request's property
    const userAssociations = await PropertyUser.find({
        user: user._id,
        property: request.property,
        isActive: true,
        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
    });
    if (userAssociations.length > 0) {
        return true;
    }

    // If tenant, check if they are associated with the request's unit
    if (user.role === ROLE_ENUM.TENANT && request.unit) {
        const tenantUnitAssociation = await PropertyUser.exists({
            user: user._id,
            property: request.property,
            unit: request.unit,
            roles: PROPERTY_USER_ROLES_ENUM.TENANT,
            isActive: true
        });
        if (tenantUnitAssociation) {
            return true;
        }
    }

    return false;
};

/**
 * Creates a new maintenance request.
 * @param {object} requestData - Data for the new request.
 * @param {object} currentUser - The user creating the request.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Request>} The created request document.
 * @throws {AppError} If property/unit not found, user not authorized, or validation fails.
 */
const createRequest = async (requestData, currentUser, ipAddress) => {
    const { title, description, category, priority, propertyId, unitId, media } = requestData;

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

    // Authorization: Admin, Landlord/PM for property, or Tenant for their unit
    let isAuthorized = false;
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: currentUser._id,
            property: propertyId,
            isActive: true
        });

        if (userAssociations.some(assoc => [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS].includes(assoc.roles[0]))) {
            isAuthorized = true; // Landlord/PM creating for their property
        } else if (currentUser.role === ROLE_ENUM.TENANT && unitId && userAssociations.some(assoc => assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && assoc.unit && assoc.unit.equals(unitId))) {
            isAuthorized = true; // Tenant creating for their unit
        }
    }

    if (!isAuthorized) {
        throw new AppError('Not authorized to create a request for this property/unit.', 403);
    }

    const newRequest = new Request({
        title,
        description,
        category: category ? category.toLowerCase() : CATEGORY_ENUM.find(c => c === 'general'),
        priority: priority ? priority.toLowerCase() : PRIORITY_ENUM.find(p => p === 'low'),
        media: media || [], // Expect media to be an array of URLs/IDs if uploaded separately
        createdBy: currentUser._id,
        property: propertyId,
        unit: unitId || null,
        status: REQUEST_STATUS_ENUM.find(s => s === 'new'), // Initial status
    });

    const createdRequest = await newRequest.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: createdRequest._id,
        newValue: createdRequest.toObject(),
        ipAddress: ipAddress,
        description: `Request "${createdRequest.title}" created by ${currentUser.email}.`,
        status: 'success'
    });

    // Notify relevant parties (Landlord/PMs associated with the property)
    const propertyManagersAndLandlords = await PropertyUser.find({
        property: propertyId,
        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
        isActive: true
    }).distinct('user');

    const requestLink = `${FRONTEND_URL}/requests/${createdRequest._id}`;

    for (const managerId of propertyManagersAndLandlords) {
        await createInAppNotification(
            managerId,
            NOTIFICATION_TYPE_ENUM.find(t => t === 'new_request'),
            `New request for ${property.name}${unitId ? ` unit ${unit.unitName}` : ''}: ${createdRequest.title}`,
            { kind: AUDIT_RESOURCE_TYPE_ENUM.Request, item: createdRequest._id },
            requestLink,
            { requestTitle: createdRequest.title, propertyName: property.name, unitName: unitId ? unit.unitName : undefined },
            currentUser._id
        );
    }

    logger.info(`RequestService: Request "${createdRequest.title}" created by ${currentUser.email}.`);
    return createdRequest;
};

/**
 * Gets all maintenance requests with filtering, search, and pagination.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Query filters (status, category, priority, propertyId, unitId, search, startDate, endDate, assignedToId, assignedToType).
 * @param {number} page - Page number.
 * @param {number} limit - Items per page.
 * @returns {Promise<object>} Object containing requests array, total count, page, and limit.
 * @throws {AppError} If user not authorized.
 */
const getAllRequests = async (currentUser, filters, page = 1, limit = 10) => {
    let query = {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Base filtering by role
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin sees all requests
    } else if (currentUser.role === ROLE_ENUM.TENANT) {
        query.createdBy = currentUser._id; // Tenant sees only their own requests
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
        // Landlord/PM sees requests for properties they own/manage
        const associatedProperties = await PropertyUser.find({
            user: currentUser._id,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('property');

        if (associatedProperties.length === 0) {
            return { requests: [], total: 0, page: parseInt(page), limit: parseInt(limit) };
        }
        query.property = { $in: associatedProperties };
    } else if (currentUser.role === ROLE_ENUM.VENDOR) {
        query.assignedTo = currentUser._id; // Vendors see only requests assigned to them
        query.assignedToModel = 'User'; // Assigned to them as an internal User
    } else {
        throw new AppError('Access denied: You do not have permission to list requests.', 403);
    }

    // Apply additional filters from query parameters
    if (filters.status) {
        if (!REQUEST_STATUS_ENUM.includes(filters.status.toLowerCase())) {
            throw new AppError(`Invalid status filter: ${filters.status}`, 400);
        }
        query.status = filters.status.toLowerCase();
    }
    if (filters.category) {
        if (!CATEGORY_ENUM.includes(filters.category.toLowerCase())) {
            throw new AppError(`Invalid category filter: ${filters.category}`, 400);
        }
        query.category = filters.category.toLowerCase();
    }
    if (filters.priority) {
        if (!PRIORITY_ENUM.includes(filters.priority.toLowerCase())) {
            throw new AppError(`Invalid priority filter: ${filters.priority}`, 400);
        }
        query.priority = filters.priority.toLowerCase();
    }
    if (filters.propertyId) {
        // If filtering by a specific property, ensure user has access to that property
        const hasAccess = await PropertyUser.exists({
            user: currentUser._id,
            property: filters.propertyId,
            isActive: true,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.TENANT, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
        });
        if (!hasAccess && currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Not authorized to filter requests by this property.', 403);
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
    if (filters.search) {
        query.$or = [
            { title: { $regex: filters.search, $options: 'i' } },
            { description: { $regex: filters.search, $options: 'i' } }
        ];
    }
    if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
    }
    if (filters.assignedToId && filters.assignedToType) {
        if (!ASSIGNED_TO_MODEL_ENUM.includes(filters.assignedToType)) {
            throw new AppError(`Invalid assignedToType filter: ${filters.assignedToType}`, 400);
        }
        query.assignedTo = filters.assignedToId;
        query.assignedToModel = filters.assignedToType;
    }

    const requests = await Request.find(query)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'firstName lastName email role')
        .populate({
            path: 'assignedTo', // Polymorphic population
            select: 'firstName lastName email name phone', // Select relevant fields for User or Vendor
        })
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip);

    const total = await Request.countDocuments(query);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ_ALL,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched list of requests.`,
        status: 'success',
        metadata: { filters }
    });

    return { requests, total, page: parseInt(page), limit: parseInt(limit) };
};

/**
 * Gets specific request details by ID.
 * @param {string} requestId - The ID of the request.
 * @param {object} currentUser - The authenticated user.
 * @returns {Promise<Request>} The request document.
 * @throws {AppError} If request not found or user not authorized.
 */
const getRequestById = async (requestId, currentUser) => {
    const request = await Request.findById(requestId)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'firstName lastName email role')
        .populate({
            path: 'assignedTo',
            select: 'firstName lastName email name phone',
        })
        .populate({
            path: 'comments',
            populate: {
                path: 'sender',
                select: 'firstName lastName email role'
            }
        })
        .populate('media'); // Populate media if it's a separate collection

    if (!request) {
        throw new AppError('Maintenance request not found.', 404);
    }

    // Authorization:
    const isAuthorized = await checkRequestAccess(currentUser, request);
    if (!isAuthorized) {
        throw new AppError('Not authorized to view this request.', 403);
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: request._id,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched details for request "${request.title}".`,
        status: 'success'
    });

    return request;
};

/**
 * Updates a maintenance request.
 * @param {string} requestId - The ID of the request to update.
 * @param {object} updateData - Data to update the request with.
 * @param {object} currentUser - The user performing the update.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Request>} The updated request document.
 * @throws {AppError} If request not found, user not authorized, or validation fails.
 */
const updateRequest = async (requestId, updateData, currentUser, ipAddress) => {
    const request = await Request.findById(requestId);
    if (!request) {
        throw new AppError('Maintenance request not found.', 404);
    }

    const oldRequest = request.toObject(); // Capture old state for audit log

    // Authorization: Admin, Landlord/PM for property. Tenant can only update title/description for 'new' status.
    let isAuthorized = false;
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: currentUser._id,
            property: request.property,
            isActive: true,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
        });

        if (userAssociations.length > 0) {
            isAuthorized = true; // Landlord/PM can update most fields
        } else if (request.createdBy.equals(currentUser._id) && currentUser.role === ROLE_ENUM.TENANT) {
            // Tenant can only update title/description for 'new' requests they created
            if (request.status === REQUEST_STATUS_ENUM.find(s => s === 'new')) {
                request.title = updateData.title !== undefined ? updateData.title : request.title;
                request.description = updateData.description !== undefined ? updateData.description : request.description;
                // Prevent tenant from changing other fields
                if (updateData.category || updateData.priority || updateData.status || updateData.assignedToId || updateData.assignedToModel) {
                    throw new AppError('Tenants can only update title and description for new requests.', 403);
                }
                const updatedRequest = await request.save();
                await createAuditLog({
                    action: AUDIT_ACTION_ENUM.UPDATE,
                    user: currentUser._id,
                    resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                    resourceId: updatedRequest._id,
                    oldValue: oldRequest,
                    newValue: updatedRequest.toObject(),
                    ipAddress: ipAddress,
                    description: `Tenant ${currentUser.email} updated their request "${updatedRequest.title}".`,
                    status: 'success'
                });
                return updatedRequest;
            } else {
                throw new AppError('Tenants can only update new requests.', 403);
            }
        }
    }

    if (!isAuthorized) {
        throw new AppError('Not authorized to update this request.', 403);
    }

    // Apply updates for authorized roles (Admin, PM, Landlord)
    request.title = updateData.title !== undefined ? updateData.title : request.title;
    request.description = updateData.description !== undefined ? updateData.description : request.description;
    request.category = updateData.category !== undefined ? updateData.category.toLowerCase() : request.category;
    request.priority = updateData.priority !== undefined ? updateData.priority.toLowerCase() : request.priority;

    // Handle status changes (separate logic for notifications)
    if (updateData.status && request.status !== updateData.status.toLowerCase()) {
        const oldStatus = request.status;
        const newStatus = updateData.status.toLowerCase();

        if (!REQUEST_STATUS_ENUM.includes(newStatus)) {
            throw new AppError(`Invalid status: ${newStatus}. Allowed: ${REQUEST_STATUS_ENUM.join(', ')}`, 400);
        }

        request.status = newStatus;
        if (newStatus === REQUEST_STATUS_ENUM.find(s => s === 'completed')) {
            request.resolvedAt = new Date();
        } else if (newStatus === REQUEST_STATUS_ENUM.find(s => s === 'reopened')) {
            request.resolvedAt = null; // Clear resolved date if re-opened
            request.verifiedBy = null; // Clear verified by
        }

        // Notify tenant/assignee about status update
        const creator = await User.findById(request.createdBy);
        if (creator) {
            const requestLink = `${FRONTEND_URL}/requests/${request._id}`;
            await createInAppNotification(
                creator._id,
                NOTIFICATION_TYPE_ENUM.find(t => t === 'status_update'),
                `Your request "${request.title}" is now ${request.status}.`,
                { kind: AUDIT_RESOURCE_TYPE_ENUM.Request, item: request._id },
                requestLink,
                { requestTitle: request.title, newStatus: request.status },
                currentUser._id
            );
        }
        if (request.assignedTo && request.assignedToModel === 'User') {
            const assignedUser = await User.findById(request.assignedTo);
            if (assignedUser) {
                const requestLink = `${FRONTEND_URL}/requests/${request._id}`;
                await createInAppNotification(
                    assignedUser._id,
                    NOTIFICATION_TYPE_ENUM.find(t => t === 'status_update'),
                    `Assigned request "${request.title}" is now ${request.status}.`,
                    { kind: AUDIT_RESOURCE_TYPE_ENUM.Request, item: request._id },
                    requestLink,
                    { requestTitle: request.title, newStatus: request.status },
                    currentUser._id
                );
            }
        }
    }

    const updatedRequest = await request.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: updatedRequest._id,
        oldValue: oldRequest,
        newValue: updatedRequest.toObject(),
        ipAddress: ipAddress,
        description: `Request "${updatedRequest.title}" updated by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`RequestService: Request "${updatedRequest.title}" updated by ${currentUser.email}.`);
    return updatedRequest;
};

/**
 * Deletes a maintenance request and cleans up related references.
 * @param {string} requestId - The ID of the request to delete.
 * @param {object} currentUser - The user performing the deletion.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If request not found or user not authorized.
 */
const deleteRequest = async (requestId, currentUser, ipAddress) => {
    const requestToDelete = await Request.findById(requestId);
    if (!requestToDelete) {
        throw new AppError('Maintenance request not found.', 404);
    }

    // Authorization: Admin, or Landlord/PM associated with the property
    let isAuthorized = false;
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: currentUser._id,
            property: requestToDelete.property,
            isActive: true,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        throw new AppError('Not authorized to delete this request.', 403);
    }

    const oldRequest = requestToDelete.toObject(); // Capture for audit log

    // --- Cleanup related data ---
    // 1. Delete associated comments
    await Comment.deleteMany({ contextId: requestId, contextType: AUDIT_RESOURCE_TYPE_ENUM.Request });
    logger.info(`RequestService: Deleted comments for request "${requestToDelete.title}".`);

    // 2. Delete associated notifications
    await Notification.deleteMany({ 'relatedResource.item': requestId, 'relatedResource.kind': AUDIT_RESOURCE_TYPE_ENUM.Request });
    logger.info(`RequestService: Deleted notifications for request "${requestToDelete.title}".`);

    // 3. Delete associated media from Cloudinary (assuming media URLs contain public IDs)
    for (const mediaUrl of requestToDelete.media) {
        try {
            // Extract public ID from Cloudinary URL (example: 'your_app_name/folder/public_id.ext')
            const publicIdMatch = mediaUrl.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
            if (publicIdMatch && publicIdMatch[1]) {
                const publicId = publicIdMatch[1];
                // Assuming your Cloudinary public IDs might include folders like 'your_app_name/requests/...'
                // You might need to refine publicId extraction based on your Cloudinary upload settings.
                // For example, if you upload to 'your_app_name/requests/image_name', the publicId is 'your_app_name/requests/image_name'
                // You should store the public_id from Cloudinary's upload response directly in the Media model
                // and use that for deletion. For now, assuming direct URL to public_id mapping.
                await deleteFile(publicId); // Call cloudStorageService to delete from Cloudinary
                logger.info(`RequestService: Deleted media ${publicId} from Cloudinary.`);
            } else {
                logger.warn(`RequestService: Could not extract public ID from media URL: ${mediaUrl}`);
            }
        } catch (error) {
            logger.error(`RequestService: Failed to delete media ${mediaUrl} from Cloudinary: ${error.message}`);
            // Continue with deletion even if Cloudinary deletion fails
        }
    }

    // 4. Finally, delete the request document
    await requestToDelete.deleteOne();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: requestId,
        oldValue: oldRequest,
        newValue: null,
        ipAddress: ipAddress,
        description: `Request "${oldRequest.title}" deleted by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`RequestService: Request "${oldRequest.title}" deleted by ${currentUser.email}.`);
};

/**
 * Assigns a request to a user or vendor.
 * @param {string} requestId - The ID of the request.
 * @param {string} assignedToId - The ID of the user/vendor to assign.
 * @param {string} assignedToModel - 'User' or 'Vendor'.
 * @param {object} currentUser - The user performing the assignment.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Request>} The updated request document.
 * @throws {AppError} If request/assignee not found, user not authorized, or invalid assignee type.
 */
const assignRequest = async (requestId, assignedToId, assignedToModel, currentUser, ipAddress) => {
    const request = await Request.findById(requestId);
    if (!request) {
        throw new AppError('Request not found.', 404);
    }

    // Authorization: Admin, PM, Landlord associated with property
    const isAuthorized = await checkRequestAccess(currentUser, request); // Reusing checkRequestAccess for broader management
    if (!isAuthorized) {
        throw new AppError('Not authorized to assign this request.', 403);
    }

    // Check assignee existence and type
    let assignee = null;
    if (!ASSIGNED_TO_MODEL_ENUM.includes(assignedToModel)) {
        throw new AppError(`Invalid assignedToModel type. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}.`, 400);
    }

    if (assignedToModel === 'User') {
        assignee = await User.findById(assignedToId);
        // Optionally, restrict which user roles can be assigned (e.g., only PMs, Landlords, or internal Vendors)
        if (assignee && ![ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD, ROLE_ENUM.ADMIN, ROLE_ENUM.VENDOR].includes(assignee.role)) {
            throw new AppError('Assigned user must be a Property Manager, Landlord, Admin, or an internal Vendor user.', 400);
        }
    } else if (assignedToModel === 'Vendor') {
        assignee = await Vendor.findById(assignedToId);
    }

    if (!assignee) {
        throw new AppError(`Assignee (${assignedToModel}) not found.`, 404);
    }

    const oldAssignedTo = request.assignedTo;
    const oldAssignedToModel = request.assignedToModel;
    const oldStatus = request.status;

    // Update assignment
    request.assignedTo = assignedToId;
    request.assignedToModel = assignedToModel;
    request.assignedBy = currentUser._id; // Record who assigned it
    request.status = REQUEST_STATUS_ENUM.find(s => s === 'assigned'); // Update status to 'assigned'
    const updatedRequest = await request.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.ASSIGN,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: updatedRequest._id,
        oldValue: { assignedTo: oldAssignedTo, assignedToModel: oldAssignedToModel, status: oldStatus },
        newValue: { assignedTo: updatedRequest.assignedTo, assignedToModel: updatedRequest.assignedToModel, status: updatedRequest.status },
        ipAddress: ipAddress,
        description: `Request "${updatedRequest.title}" assigned to ${assignee.name || assignee.email} by ${currentUser.email}.`,
        status: 'success'
    });

    // Notify assignee
    if (assignee.email) { // Assuming both User and Vendor models have an email field
        const requestLink = `${FRONTEND_URL}/requests/${updatedRequest._id}`;
        await createInAppNotification(
            assignee._id, // If Vendor is a User, use their ID. If Vendor is a separate model, this needs adjustment.
            NOTIFICATION_TYPE_ENUM.find(t => t === 'assignment'),
            `You have been assigned to request: "${updatedRequest.title}"`,
            { kind: AUDIT_RESOURCE_TYPE_ENUM.Request, item: updatedRequest._id },
            requestLink,
            { requestTitle: updatedRequest.title, assignedBy: currentUser.email },
            currentUser._id
        );
    }

    logger.info(`RequestService: Request "${updatedRequest.title}" assigned to ${assignee.name || assignee.email} by ${currentUser.email}.`);
    return updatedRequest;
};

/**
 * Uploads media files to a request.
 * @param {string} requestId - The ID of the request.
 * @param {Array<object>} files - Array of file objects (from multer, containing buffer/path).
 * @param {object} currentUser - The user uploading the media.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Request>} The updated request document.
 * @throws {AppError} If request not found, user not authorized, or no files uploaded.
 */
const uploadMediaToRequest = async (requestId, files, currentUser, ipAddress) => {
    const request = await Request.findById(requestId);
    if (!request) {
        throw new AppError('Request not found.', 404);
    }

    const isAuthorized = await checkRequestAccess(currentUser, request);
    if (!isAuthorized) {
        throw new AppError('Not authorized to upload media to this request.', 403);
    }

    if (!files || files.length === 0) {
        throw new AppError('No media files provided for upload.', 400);
    }

    const uploadedMediaUrls = [];
    for (const file of files) {
        try {
            // Assuming uploadFile takes a buffer and returns { url, public_id, ... }
            const uploadResult = await uploadFile(file.buffer, file.mimetype, file.originalname, 'requests');
            uploadedMediaUrls.push(uploadResult.url);
            // If you store Media documents, create one here:
            // await Media.create({ url: uploadResult.url, publicId: uploadResult.public_id, ... });
        } catch (error) {
            logger.error(`RequestService: Failed to upload file ${file.originalname} to Cloudinary: ${error.message}`);
            // Decide whether to throw an error or continue with partial success
            throw new AppError(`Failed to upload media: ${error.message}`, 500); // Fail fast for now
        }
    }

    const oldMedia = [...request.media]; // Capture old state
    request.media = [...request.media, ...uploadedMediaUrls];
    const updatedRequest = await request.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.ADD_MEDIA,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: updatedRequest._id,
        oldValue: { media: oldMedia },
        newValue: { media: updatedRequest.media },
        ipAddress: ipAddress,
        description: `Media uploaded to request "${updatedRequest.title}" by ${currentUser.email}.`,
        status: 'success',
        metadata: { uploadedCount: uploadedMediaUrls.length }
    });

    logger.info(`RequestService: ${uploadedMediaUrls.length} media files uploaded to request "${updatedRequest.title}" by ${currentUser.email}.`);
    return updatedRequest;
};

/**
 * Deletes a media file from a request and from cloud storage.
 * @param {string} requestId - The ID of the request.
 * @param {string} mediaUrl - The URL of the media to delete.
 * @param {object} currentUser - The user performing the deletion.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Request>} The updated request document.
 * @throws {AppError} If request not found, user not authorized, or media not found.
 */
const deleteMediaFromRequest = async (requestId, mediaUrl, currentUser, ipAddress) => {
    const request = await Request.findById(requestId);
    if (!request) {
        throw new AppError('Request not found.', 404);
    }

    const isAuthorized = await checkRequestAccess(currentUser, request);
    if (!isAuthorized) {
        throw new AppError('Not authorized to delete media from this request.', 403);
    }

    const initialMediaCount = request.media.length;
    request.media = request.media.filter(url => url !== mediaUrl);

    if (request.media.length === initialMediaCount) {
        throw new AppError('Media URL not found in this request.', 404);
    }

    const oldMedia = [...request.media, mediaUrl]; // For audit log

    // Attempt to delete from Cloudinary
    try {
        const publicIdMatch = mediaUrl.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
        if (publicIdMatch && publicIdMatch[1]) {
            const publicId = publicIdMatch[1];
            await deleteFile(publicId); // Call cloudStorageService to delete from Cloudinary
            logger.info(`RequestService: Deleted media ${publicId} from Cloudinary.`);
        } else {
            logger.warn(`RequestService: Could not extract public ID from media URL: ${mediaUrl}. Skipping Cloudinary deletion.`);
        }
    } catch (error) {
        logger.error(`RequestService: Failed to delete media ${mediaUrl} from Cloudinary: ${error.message}`);
        // Decide whether to throw or proceed. For now, proceed with DB update.
    }

    const updatedRequest = await request.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE_MEDIA,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: updatedRequest._id,
        oldValue: { media: oldMedia },
        newValue: { media: updatedRequest.media },
        ipAddress: ipAddress,
        description: `Media ${mediaUrl} deleted from request "${updatedRequest.title}" by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`RequestService: Media ${mediaUrl} deleted from request "${updatedRequest.title}" by ${currentUser.email}.`);
    return updatedRequest;
};

/**
 * Submits feedback for a completed request.
 * @param {string} requestId - The ID of the request.
 * @param {number} rating - Rating (1-5).
 * @param {string} comment - Feedback comment.
 * @param {object} currentUser - The user submitting feedback.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Request>} The updated request document.
 * @throws {AppError} If request not found, user not authorized, or feedback already submitted.
 */
const submitFeedback = async (requestId, rating, comment, currentUser, ipAddress) => {
    const request = await Request.findById(requestId);
    if (!request) {
        throw new AppError('Request not found.', 404);
    }

    // Authorization: Only the creator of the request (and must be a tenant) can submit feedback.
    if (!request.createdBy.equals(currentUser._id) || currentUser.role !== ROLE_ENUM.TENANT) {
        throw new AppError('You can only submit feedback for your own requests.', 403);
    }

    // Feedback can only be submitted for completed or verified requests
    if (![REQUEST_STATUS_ENUM.find(s => s === 'completed'), REQUEST_STATUS_ENUM.find(s => s === 'verified')].includes(request.status)) {
        throw new AppError('Feedback can only be submitted after the request is completed or verified.', 400);
    }

    // Prevent submitting feedback multiple times
    if (request.feedback && request.feedback.submittedAt) {
        throw new AppError('Feedback has already been submitted for this request.', 400);
    }

    const oldFeedback = request.feedback ? request.feedback.toObject() : null;

    request.feedback = {
        rating,
        comment,
        submittedAt: new Date(),
        submittedBy: currentUser._id // Record who submitted it
    };
    const updatedRequest = await request.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.SUBMIT_FEEDBACK,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: updatedRequest._id,
        oldValue: oldFeedback,
        newValue: updatedRequest.feedback.toObject(),
        ipAddress: ipAddress,
        description: `Feedback submitted for request "${updatedRequest.title}" by tenant ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`RequestService: Feedback submitted for request "${updatedRequest.title}" by ${currentUser.email}.`);
    return updatedRequest;
};

/**
 * Enables a public link for a request.
 * @param {string} requestId - The ID of the request.
 * @param {number} [expiresInDays] - Optional: duration in days for the link to be valid.
 * @param {object} currentUser - The user enabling the link.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<string>} The generated public link URL.
 * @throws {AppError} If request not found or user not authorized.
 */
const enablePublicLink = async (requestId, expiresInDays, currentUser, ipAddress) => {
    const request = await Request.findById(requestId);
    if (!request) {
        throw new AppError('Request not found.', 404);
    }

    // Authorization: Admin, or PM/Landlord associated with the property
    const isAuthorized = await checkRequestAccess(currentUser, request); // Reusing checkRequestAccess
    if (!isAuthorized) {
        throw new AppError('Not authorized to enable public link for this request.', 403);
    }

    // Generate a new token if one doesn't exist or is being re-enabled
    if (!request.publicToken || !request.publicLinkEnabled) {
        request.publicToken = crypto.randomBytes(24).toString('hex');
    }

    request.publicLinkEnabled = true;
    if (expiresInDays) {
        request.publicLinkExpiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    } else if (!request.publicLinkExpiresAt || request.publicLinkExpiresAt < new Date()) {
        // If no expiry specified or it's already expired, set a default (e.g., 7 days)
        request.publicLinkExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    await request.save();

    const publicLink = `${FRONTEND_URL}/public/requests/${request.publicToken}`;

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.ENABLE_PUBLIC_LINK,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: request._id,
        newValue: { publicToken: request.publicToken, publicLinkExpiresAt: request.publicLinkExpiresAt },
        ipAddress: ipAddress,
        description: `Public link enabled for request "${request.title}" by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`RequestService: Public link enabled for request "${request.title}" by ${currentUser.email}.`);
    return publicLink;
};

/**
 * Disables a public link for a request.
 * @param {string} requestId - The ID of the request.
 * @param {object} currentUser - The user disabling the link.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If request not found or user not authorized.
 */
const disablePublicLink = async (requestId, currentUser, ipAddress) => {
    const request = await Request.findById(requestId);
    if (!request) {
        throw new AppError('Request not found.', 404);
    }

    // Authorization: Admin, or PM/Landlord associated with the property
    const isAuthorized = await checkRequestAccess(currentUser, request); // Reusing checkRequestAccess
    if (!isAuthorized) {
        throw new AppError('Not authorized to disable public link for this request.', 403);
    }

    const oldPublicLinkState = {
        publicLinkEnabled: request.publicLinkEnabled,
        publicToken: request.publicToken,
        publicLinkExpiresAt: request.publicLinkExpiresAt
    };

    request.publicLinkEnabled = false;
    request.publicToken = undefined; // Clear the token
    request.publicLinkExpiresAt = undefined; // Clear expiry
    await request.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DISABLE_PUBLIC_LINK,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: request._id,
        oldValue: oldPublicLinkState,
        newValue: { publicLinkEnabled: false },
        ipAddress: ipAddress,
        description: `Public link disabled for request "${request.title}" by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`RequestService: Public link disabled for request "${request.title}" by ${currentUser.email}.`);
};

/**
 * Gets external (public) view of a request using a public token.
 * @param {string} publicToken - The public token for the request.
 * @returns {Promise<object>} Limited request details for public view.
 * @throws {AppError} If token is invalid, expired, or disabled.
 */
const getPublicRequestView = async (publicToken) => {
    const request = await Request.findOne({
        publicToken: publicToken,
        publicLinkEnabled: true,
        publicLinkExpiresAt: { $gt: new Date() } // Must not be expired
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

    if (!request) {
        throw new AppError('Invalid, expired, or disabled public link.', 404);
    }

    // Return a limited set of data for public view
    return {
        _id: request._id,
        title: request.title,
        description: request.description,
        category: request.category,
        priority: request.priority,
        media: request.media, // URLs are safe to share
        status: request.status,
        property: request.property,
        unit: request.unit,
        comments: request.comments.filter(comment => !comment.isInternalNote).map(comment => ({ // Filter out internal notes
            senderName: comment.sender ? `${comment.sender.firstName} ${comment.sender.lastName}` : comment.externalUserName,
            message: comment.message,
            timestamp: comment.timestamp
        })),
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
    };
};

/**
 * Allows an external user to update status/add comments for a request via public link.
 * @param {string} publicToken - The public token for the request.
 * @param {object} updateData - Data for the update (status, commentMessage, name, phone).
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Request>} The updated request document.
 * @throws {AppError} If token is invalid, expired, or disabled, or validation fails.
 */
const publicRequestUpdate = async (publicToken, updateData, ipAddress) => {
    const { status, commentMessage, name, phone } = updateData;

    if (!name || !phone) {
        throw new AppError('Name and phone are required for accountability.', 400);
    }

    const request = await Request.findOne({
        publicToken: publicToken,
        publicLinkEnabled: true,
        publicLinkExpiresAt: { $gt: new Date() }
    });

    if (!request) {
        throw new AppError('Invalid, expired, or disabled public link.', 404);
    }

    // Find or create a 'pseudo-user' for this external vendor interaction for audit logging and comment sender
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
        logger.info(`RequestService: Created pseudo-user for external update: ${publicUpdater.email}`);
    }

    // Update status if provided and valid (e.g., 'in_progress', 'completed')
    const allowedPublicStatuses = [
        REQUEST_STATUS_ENUM.find(s => s === 'in_progress'),
        REQUEST_STATUS_ENUM.find(s => s === 'completed')
    ];
    if (status) {
        const lowerStatus = status.toLowerCase();
        if (!allowedPublicStatuses.includes(lowerStatus)) {
            throw new AppError(`Invalid status for public update. Must be one of: ${allowedPublicStatuses.join(', ')}.`, 400);
        }
        const oldStatus = request.status;
        request.status = lowerStatus;
        if (lowerStatus === REQUEST_STATUS_ENUM.find(s => s === 'completed')) {
            request.resolvedAt = new Date();
        }
        await createAuditLog({
            action: AUDIT_ACTION_ENUM.PUBLIC_UPDATE,
            user: publicUpdater._id,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            resourceId: request._id,
            oldValue: { status: oldStatus },
            newValue: { status: request.status },
            ipAddress: ipAddress,
            description: `External vendor ${name} updated request "${request.title}" status from ${oldStatus} to ${request.status}.`,
            status: 'success'
        });
        // Notify relevant internal users about public status update
        const propertyManagersAndLandlords = await PropertyUser.find({
            property: request.property,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('user');

        for (const managerId of propertyManagersAndLandlords) {
            await createInAppNotification(
                managerId,
                NOTIFICATION_TYPE_ENUM.find(t => t === 'status_update'),
                `External vendor ${name} updated request "${request.title}" to ${request.status}.`,
                { kind: AUDIT_RESOURCE_TYPE_ENUM.Request, item: request._id },
                `${FRONTEND_URL}/requests/${request._id}`,
                { requestTitle: request.title, newStatus: request.status, updaterName: name },
                publicUpdater._id
            );
        }
    }

    // Add comment if provided
    if (commentMessage) {
        const newComment = await Comment.create({
            contextType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            contextId: request._id,
            sender: publicUpdater._id, // Link to the pseudo-user
            message: commentMessage,
            isExternal: true, // Mark as external comment
            externalUserName: name,
            externalUserEmail: `${phone}@external.com`,
            timestamp: new Date()
        });
        request.comments.push(newComment._id); // Store reference to the new comment
        await createAuditLog({
            action: AUDIT_ACTION_ENUM.COMMENT_ADDED,
            user: publicUpdater._id,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            resourceId: request._id,
            newValue: { commentId: newComment._id, message: commentMessage },
            ipAddress: ipAddress,
            description: `External vendor ${name} added a comment to request "${request.title}".`,
            status: 'success'
        });

        // Notify relevant internal users about new comment
        const relevantUsers = new Set();
        if (request.createdBy) relevantUsers.add(request.createdBy.toString());
        if (request.assignedTo && request.assignedToModel === 'User') relevantUsers.add(request.assignedTo.toString());

        const propertyManagersAndLandlords = await PropertyUser.find({
            property: request.property,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('user');
        propertyManagersAndLandlords.forEach(id => relevantUsers.add(id.toString()));

        for (const userId of relevantUsers) {
            await createInAppNotification(
                userId,
                NOTIFICATION_TYPE_ENUM.find(t => t === 'new_comment'),
                `New comment on request "${request.title}" from external vendor ${name}.`,
                { kind: AUDIT_RESOURCE_TYPE_ENUM.Request, item: request._id },
                `${FRONTEND_URL}/requests/${request._id}`,
                { requestTitle: request.title, comment: commentMessage, updaterName: name },
                publicUpdater._id
            );
        }
    }

    const updatedRequest = await request.save();
    return updatedRequest;
};

/**
 * Verifies a completed request (PM/Landlord/Admin).
 * @param {string} requestId - The ID of the request to verify.
 * @param {object} currentUser - The user performing the verification.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Request>} The updated request document.
 * @throws {AppError} If request not found, user not authorized, or request not completed.
 */
const verifyRequest = async (requestId, currentUser, ipAddress) => {
    const request = await Request.findById(requestId);
    if (!request) {
        throw new AppError('Request not found.', 404);
    }

    // Authorization: Admin, or PM/Landlord associated with the property
    const isAuthorized = await checkRequestAccess(currentUser, request);
    if (!isAuthorized) {
        throw new AppError('Not authorized to verify this request.', 403);
    }

    if (request.status !== REQUEST_STATUS_ENUM.find(s => s === 'completed')) {
        throw new AppError('Only completed requests can be verified.', 400);
    }

    const oldStatus = request.status;
    request.status = REQUEST_STATUS_ENUM.find(s => s === 'verified');
    request.verifiedBy = currentUser._id; // Record who verified it
    const updatedRequest = await request.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.VERIFY,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: updatedRequest._id,
        oldValue: { status: oldStatus },
        newValue: { status: updatedRequest.status, verifiedBy: updatedRequest.verifiedBy },
        ipAddress: ipAddress,
        description: `Request "${updatedRequest.title}" verified by ${currentUser.email}.`,
        status: 'success'
    });

    // Notify tenant about verification
    const creator = await User.findById(request.createdBy);
    if (creator) {
        const requestLink = `${FRONTEND_URL}/requests/${updatedRequest._id}`;
        await createInAppNotification(
            creator._id,
            NOTIFICATION_TYPE_ENUM.find(t => t === 'task_verified'),
            `Your request "${updatedRequest.title}" has been verified.`,
            { kind: AUDIT_RESOURCE_TYPE_ENUM.Request, item: updatedRequest._id },
            requestLink,
            { requestTitle: updatedRequest.title },
            currentUser._id
        );
    }

    logger.info(`RequestService: Request "${updatedRequest.title}" verified by ${currentUser.email}.`);
    return updatedRequest;
};

/**
 * Reopens a completed/verified request (PM/Landlord/Admin).
 * @param {string} requestId - The ID of the request to reopen.
 * @param {object} currentUser - The user performing the reopening.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Request>} The updated request document.
 * @throws {AppError} If request not found, user not authorized, or request not completed/verified.
 */
const reopenRequest = async (requestId, currentUser, ipAddress) => {
    const request = await Request.findById(requestId);
    if (!request) {
        throw new AppError('Request not found.', 404);
    }

    // Authorization: Admin, or PM/Landlord associated with the property
    const isAuthorized = await checkRequestAccess(currentUser, request);
    if (!isAuthorized) {
        throw new AppError('Not authorized to reopen this request.', 403);
    }

    if (![REQUEST_STATUS_ENUM.find(s => s === 'completed'), REQUEST_STATUS_ENUM.find(s => s === 'verified')].includes(request.status)) {
        throw new AppError('Only completed or verified requests can be reopened.', 400);
    }

    const oldStatus = request.status;
    request.status = REQUEST_STATUS_ENUM.find(s => s === 'reopened');
    request.resolvedAt = null; // Clear resolved date
    request.verifiedBy = null; // Clear verified by
    const updatedRequest = await request.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.REOPEN,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: updatedRequest._id,
        oldValue: { status: oldStatus },
        newValue: { status: updatedRequest.status, resolvedAt: updatedRequest.resolvedAt, verifiedBy: updatedRequest.verifiedBy },
        ipAddress: ipAddress,
        description: `Request "${updatedRequest.title}" reopened by ${currentUser.email}.`,
        status: 'success'
    });

    // Notify tenant about reopening
    const creator = await User.findById(request.createdBy);
    if (creator) {
        const requestLink = `${FRONTEND_URL}/requests/${updatedRequest._id}`;
        await createInAppNotification(
            creator._id,
            NOTIFICATION_TYPE_ENUM.find(t => t === 'status_update'),
            `Your request "${updatedRequest.title}" has been reopened.`,
            { kind: AUDIT_RESOURCE_TYPE_ENUM.Request, item: updatedRequest._id },
            requestLink,
            { requestTitle: updatedRequest.title, newStatus: updatedRequest.status },
            currentUser._id
        );
    }

    logger.info(`RequestService: Request "${updatedRequest.title}" reopened by ${currentUser.email}.`);
    return updatedRequest;
};

/**
 * Archives a request (PM/Landlord/Admin).
 * @param {string} requestId - The ID of the request to archive.
 * @param {object} currentUser - The user performing the archiving.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Request>} The updated request document.
 * @throws {AppError} If request not found, user not authorized, or request status is not archivable.
 */
const archiveRequest = async (requestId, currentUser, ipAddress) => {
    const request = await Request.findById(requestId);
    if (!request) {
        throw new AppError('Request not found.', 404);
    }

    // Authorization: Admin, or PM/Landlord associated with the property
    const isAuthorized = await checkRequestAccess(currentUser, request);
    if (!isAuthorized) {
        throw new AppError('Not authorized to archive this request.', 403);
    }

    if (![
        REQUEST_STATUS_ENUM.find(s => s === 'completed'),
        REQUEST_STATUS_ENUM.find(s => s === 'verified'),
        REQUEST_STATUS_ENUM.find(s => s === 'reopened')
    ].includes(request.status)) {
        throw new AppError('Only completed, verified, or reopened requests can be archived.', 400);
    }

    const oldStatus = request.status;
    request.status = REQUEST_STATUS_ENUM.find(s => s === 'archived');
    const updatedRequest = await request.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.ARCHIVE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: updatedRequest._id,
        oldValue: { status: oldStatus },
        newValue: { status: updatedRequest.status },
        ipAddress: ipAddress,
        description: `Request "${updatedRequest.title}" archived by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`RequestService: Request "${updatedRequest.title}" archived by ${currentUser.email}.`);
    return updatedRequest;
};


module.exports = {
    createRequest,
    getAllRequests,
    getRequestById,
    updateRequest,
    deleteRequest,
    assignRequest,
    uploadMediaToRequest,
    deleteMediaFromRequest,
    submitFeedback,
    enablePublicLink,
    disablePublicLink,
    getPublicRequestView,
    publicRequestUpdate,
    verifyRequest,
    reopenRequest,
    archiveRequest,
};
