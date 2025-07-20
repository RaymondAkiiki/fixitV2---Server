// src/services/requestService.js

const mongoose = require('mongoose');
const Request = require('../models/request');
const User = require('../models/user');
const Property = require('../models/property');
const Unit = require('../models/unit');
const Vendor = require('../models/vendor');
const PropertyUser = require('../models/propertyUser');
const Comment = require('../models/comment');
const Media = require('../models/media');
const Notification = require('../models/notification');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { uploadFile, deleteFile } = require('../utils/fileUpload');
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
    REGISTRATION_STATUS_ENUM
} = require('../utils/constants/enums');

const crypto = require('crypto');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Helper to check if a user has management or direct access permission for a request.
 * @param {object} user - The authenticated user object.
 * @param {object} request - The request document to check access for.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkRequestAccess = async (user, request) => {
    try {
        // Admin has global access
        if (user.role === ROLE_ENUM.ADMIN) {
            return true;
        }
        
        // Request creator can always access their own request
        if (request.createdBy && request.createdBy.equals(user._id)) {
            return true;
        }
        
        // Assigned user/vendor can access
        if (request.assignedTo && request.assignedToModel === 'User' && request.assignedTo.equals(user._id)) {
            return true;
        }

        // Check if user is a landlord or property manager for the request's property
        const hasManagementAccess = await PropertyUser.exists({
            user: user._id,
            property: request.property,
            isActive: true,
            roles: { $in: [
                PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
            ]}
        });
        
        if (hasManagementAccess) {
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
    } catch (error) {
        logger.error(`RequestService - Error checking request access: ${error.message}`, {
            userId: user?._id,
            requestId: request?._id
        });
        return false; // Fail safely
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { 
            title, 
            description, 
            category, 
            priority, 
            propertyId, 
            unitId, 
            files 
        } = requestData;

        // Validate property
        const property = await Property.findById(propertyId).session(session);
        if (!property) {
            throw new AppError('Property not found.', 404);
        }
        
        // Validate unit if provided
        let unit = null;
        if (unitId) {
            unit = await Unit.findById(unitId).session(session);
            if (!unit) {
                throw new AppError('Unit not found.', 404);
            }
            
            if (unit.property.toString() !== propertyId) {
                throw new AppError('Unit does not belong to the specified property.', 400);
            }
        }

        // Check authorization
        let isAuthorized = false;
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            isAuthorized = true;
        } else {
            const userAssociations = await PropertyUser.find({
                user: currentUser._id,
                property: propertyId,
                isActive: true
            }).session(session);

            const isManager = userAssociations.some(assoc => 
                assoc.roles.some(role => [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ].includes(role))
            );
            
            if (isManager) {
                isAuthorized = true; // Management role can create for their property
            } else if (currentUser.role === ROLE_ENUM.TENANT && unitId) {
                const isTenantForUnit = userAssociations.some(assoc => 
                    assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && 
                    assoc.unit && 
                    assoc.unit.equals(unitId)
                );
                
                if (isTenantForUnit) {
                    isAuthorized = true; // Tenant creating for their unit
                }
            }
        }

        if (!isAuthorized) {
            throw new AppError('Not authorized to create a request for this property/unit.', 403);
        }

        // Process media files if provided
        let mediaIds = [];
        if (files && files.length > 0) {
            for (const file of files) {
                try {
                    const uploadResult = await uploadFile(
                        file.buffer, 
                        file.mimetype, 
                        file.originalname, 
                        'requests'
                    );
                    
                    // Create media record
                    const media = new Media({
                        filename: file.originalname,
                        originalname: file.originalname,
                        mimeType: file.mimetype,
                        size: file.size,
                        url: uploadResult.url,
                        thumbnailUrl: uploadResult.thumbnailUrl || null,
                        uploadedBy: currentUser._id,
                        relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Request,
                        description: `Media for request: ${title}`,
                        tags: ['request', category?.toLowerCase() || 'general'],
                        isPublic: false
                    });
                    
                    const savedMedia = await media.save({ session });
                    mediaIds.push(savedMedia._id);
                } catch (error) {
                    logger.error(`RequestService - Error uploading file: ${error.message}`);
                    throw new AppError(`Failed to upload file: ${error.message}`, 500);
                }
            }
        }

        // Find or create PropertyUser reference for request creator
        let createdByPropertyUser = await PropertyUser.findOne({
            user: currentUser._id,
            property: propertyId,
            isActive: true
        }).session(session);
        
        if (!createdByPropertyUser) {
            // Create new PropertyUser association
            createdByPropertyUser = new PropertyUser({
                user: currentUser._id,
                property: propertyId,
                unit: unitId || null,
                roles: [currentUser.role === ROLE_ENUM.TENANT ? 
                    PROPERTY_USER_ROLES_ENUM.TENANT : 
                    PROPERTY_USER_ROLES_ENUM.USER],
                isActive: true
            });
            
            await createdByPropertyUser.save({ session });
        }

        // Create request
        const newRequest = new Request({
            title,
            description,
            category: category ? category.toLowerCase() : 'general',
            priority: priority ? priority.toLowerCase() : 'low',
            media: mediaIds,
            status: 'new',
            property: propertyId,
            unit: unitId || null,
            createdByPropertyUser: createdByPropertyUser._id,
            statusHistory: [{
                status: 'new',
                changedAt: new Date(),
                changedBy: currentUser._id,
                notes: 'Request created'
            }]
        });

        const createdRequest = await newRequest.save({ session });

        // Update media records with relation to the new request
        if (mediaIds.length > 0) {
            await Media.updateMany(
                { _id: { $in: mediaIds } },
                { relatedId: createdRequest._id },
                { session }
            );
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            createdRequest._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Request "${createdRequest.title}" created by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    propertyId,
                    unitId,
                    category: createdRequest.category,
                    priority: createdRequest.priority,
                    mediaCount: mediaIds.length
                },
                newValue: createdRequest.toObject()
            },
            { session }
        );

        // Notify property managers and landlords
        const propertyManagersAndLandlords = await PropertyUser.find({
            property: propertyId,
            roles: { $in: [
                PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
            ]},
            isActive: true
        }).distinct('user').session(session);

        const requestLink = `${FRONTEND_URL}/requests/${createdRequest._id}`;

        // Send notifications
        for (const managerId of propertyManagersAndLandlords) {
            if (managerId.toString() !== currentUser._id.toString()) { // Don't notify creator
                try {
                    await notificationService.sendNotification({
                        recipientId: managerId,
                        type: NOTIFICATION_TYPE_ENUM.NEW_REQUEST,
                        message: `New request for ${property.name}${unit ? ` unit ${unit.unitName}` : ''}: ${createdRequest.title}`,
                        link: requestLink,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                        relatedResourceId: createdRequest._id,
                        emailDetails: {
                            subject: `New Maintenance Request: ${createdRequest.title}`,
                            html: `
                                <p>A new maintenance request has been created:</p>
                                <p><strong>Title:</strong> ${createdRequest.title}</p>
                                <p><strong>Property:</strong> ${property.name}</p>
                                ${unit ? `<p><strong>Unit:</strong> ${unit.unitName}</p>` : ''}
                                <p><strong>Category:</strong> ${createdRequest.category}</p>
                                <p><strong>Priority:</strong> ${createdRequest.priority}</p>
                                <p><strong>Description:</strong> ${createdRequest.description}</p>
                                <p><a href="${requestLink}">View Request</a></p>
                            `,
                            text: `New maintenance request: ${createdRequest.title}. Property: ${property.name}${unit ? `, Unit: ${unit.unitName}` : ''}. View at: ${requestLink}`
                        },
                        senderId: currentUser._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send request creation notification: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
        }

        await session.commitTransaction();
        
        logger.info(`RequestService: Request "${createdRequest.title}" created by ${currentUser.email}.`);
        
        // Return populated request
        return Request.findById(createdRequest._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('createdByPropertyUser')
            .populate('media');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error creating request: ${error.message}`, {
            userId: currentUser?._id,
            propertyId: requestData?.propertyId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to create request: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets all maintenance requests with filtering, search, and pagination.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Query filters.
 * @param {number} page - Page number.
 * @param {number} limit - Items per page.
 * @returns {Promise<object>} Object containing requests array, total count, page, and limit.
 * @throws {AppError} If user not authorized.
 */
const getAllRequests = async (currentUser, filters, page = 1, limit = 10) => {
    try {
        let query = {};
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Base filtering by role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin sees all requests
        } else if (currentUser.role === ROLE_ENUM.TENANT) {
            // Find PropertyUser entries for this tenant
            const propertyUserIds = await PropertyUser.find({
                user: currentUser._id,
                roles: PROPERTY_USER_ROLES_ENUM.TENANT,
                isActive: true
            }).distinct('_id');
            
            query.createdByPropertyUser = { $in: propertyUserIds };
        } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            // Landlord/PM sees requests for properties they own/manage
            const associatedProperties = await PropertyUser.find({
                user: currentUser._id,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('property');

            if (associatedProperties.length === 0) {
                return { 
                    requests: [], 
                    total: 0, 
                    page: parseInt(page), 
                    limit: parseInt(limit),
                    pages: 0
                };
            }
            
            query.property = { $in: associatedProperties };
        } else if (currentUser.role === ROLE_ENUM.VENDOR) {
            query.assignedTo = currentUser._id;
            query.assignedToModel = 'User';
        } else {
            throw new AppError('Access denied: You do not have permission to list requests.', 403);
        }

        // Apply additional filters
        if (filters.status) {
            if (!REQUEST_STATUS_ENUM.includes(filters.status.toLowerCase())) {
                throw new AppError(`Invalid status filter: ${filters.status}. Allowed values: ${REQUEST_STATUS_ENUM.join(', ')}`, 400);
            }
            query.status = filters.status.toLowerCase();
        }
        
        if (filters.category) {
            if (!CATEGORY_ENUM.includes(filters.category.toLowerCase())) {
                throw new AppError(`Invalid category filter: ${filters.category}. Allowed values: ${CATEGORY_ENUM.join(', ')}`, 400);
            }
            query.category = filters.category.toLowerCase();
        }
        
        if (filters.priority) {
            if (!PRIORITY_ENUM.includes(filters.priority.toLowerCase())) {
                throw new AppError(`Invalid priority filter: ${filters.priority}. Allowed values: ${PRIORITY_ENUM.join(', ')}`, 400);
            }
            query.priority = filters.priority.toLowerCase();
        }
        
        if (filters.propertyId) {
            // Check if user has access to this property
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const hasAccess = await PropertyUser.exists({
                    user: currentUser._id,
                    property: filters.propertyId,
                    isActive: true
                });
                
                if (!hasAccess) {
                    throw new AppError('Not authorized to filter requests by this property.', 403);
                }
            }
            
            query.property = filters.propertyId;
        }
        
        if (filters.unitId) {
            // Ensure unit belongs to the property if propertyId filter is applied
            if (filters.propertyId) {
                const unitExists = await Unit.exists({ 
                    _id: filters.unitId, 
                    property: filters.propertyId 
                });
                
                if (!unitExists) {
                    throw new AppError('Unit not found in the specified property.', 404);
                }
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
            if (filters.startDate) {
                query.createdAt.$gte = new Date(filters.startDate);
            }
            if (filters.endDate) {
                query.createdAt.$lte = new Date(filters.endDate);
            }
        }
        
        if (filters.assignedToId && filters.assignedToType) {
            if (!ASSIGNED_TO_MODEL_ENUM.includes(filters.assignedToType)) {
                throw new AppError(`Invalid assignedToType filter: ${filters.assignedToType}. Allowed values: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}`, 400);
            }
            
            query.assignedTo = filters.assignedToId;
            query.assignedToModel = filters.assignedToType;
        }

        // Execute query with population
        const [requests, total] = await Promise.all([
            Request.find(query)
                .populate('property', 'name address')
                .populate('unit', 'unitName')
                .populate({
                    path: 'createdByPropertyUser',
                    populate: {
                        path: 'user',
                        select: 'firstName lastName email role'
                    }
                })
                .populate({
                    path: 'assignedTo',
                    refPath: 'assignedToModel',
                    select: 'firstName lastName email name phone'
                })
                .populate('media')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Request.countDocuments(query)
        ]);

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched list of requests.`,
                status: 'success',
                metadata: { 
                    filters, 
                    page, 
                    limit,
                    count: requests.length
                }
            }
        );

        return { 
            requests, 
            total, 
            page: parseInt(page), 
            limit: parseInt(limit),
            pages: Math.ceil(total / parseInt(limit))
        };
    } catch (error) {
        logger.error(`RequestService - Error getting requests: ${error.message}`, {
            userId: currentUser?._id,
            filters
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get requests: ${error.message}`, 500);
    }
};

/**
 * Gets specific request details by ID.
 * @param {string} requestId - The ID of the request.
 * @param {object} currentUser - The authenticated user.
 * @returns {Promise<Request>} The request document.
 * @throws {AppError} If request not found or user not authorized.
 */
const getRequestById = async (requestId, currentUser) => {
    try {
        const request = await Request.findById(requestId)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email role'
                }
            })
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName email name phone'
            })
            .populate({
                path: 'comments',
                populate: {
                    path: 'sender',
                    select: 'firstName lastName email role'
                }
            })
            .populate('media');

        if (!request) {
            throw new AppError('Maintenance request not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRequestAccess(currentUser, request);
        if (!isAuthorized) {
            throw new AppError('You do not have permission to view this request.', 403);
        }

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            request._id,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} viewed request "${request.title}".`,
                status: 'success'
            }
        );

        return request;
    } catch (error) {
        logger.error(`RequestService - Error getting request: ${error.message}`, {
            userId: currentUser?._id,
            requestId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get request: ${error.message}`, 500);
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const request = await Request.findById(requestId).session(session);
        if (!request) {
            throw new AppError('Maintenance request not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRequestAccess(currentUser, request);
        if (!isAuthorized) {
            throw new AppError('You do not have permission to update this request.', 403);
        }

        // Store old request for audit log
        const oldRequest = request.toObject();

        // Handle different update scenarios based on user role
        if (currentUser.role === ROLE_ENUM.TENANT) {
            // Tenants can only update title/description for 'new' requests they created
            if (request.status !== 'new') {
                throw new AppError('Tenants can only update new requests.', 403);
            }
            
            const createdByUser = await User.findById(request.createdBy);
            if (!createdByUser || !createdByUser._id.equals(currentUser._id)) {
                throw new AppError('You can only update requests you created.', 403);
            }
            
            // Only allow title and description updates
            if (updateData.title !== undefined) {
                request.title = updateData.title;
            }
            
            if (updateData.description !== undefined) {
                request.description = updateData.description;
            }
            
            // Prevent tenant from changing other fields
            if (updateData.category || updateData.priority || updateData.status || 
                updateData.assignedToId || updateData.assignedToModel) {
                throw new AppError('Tenants can only update title and description for new requests.', 403);
            }
        } else {
            // Admin, PM, Landlord can update most fields
            if (updateData.title !== undefined) {
                request.title = updateData.title;
            }
            
            if (updateData.description !== undefined) {
                request.description = updateData.description;
            }
            
            if (updateData.category !== undefined) {
                if (!CATEGORY_ENUM.includes(updateData.category.toLowerCase())) {
                    throw new AppError(`Invalid category: ${updateData.category}. Allowed values: ${CATEGORY_ENUM.join(', ')}`, 400);
                }
                request.category = updateData.category.toLowerCase();
            }
            
            if (updateData.priority !== undefined) {
                if (!PRIORITY_ENUM.includes(updateData.priority.toLowerCase())) {
                    throw new AppError(`Invalid priority: ${updateData.priority}. Allowed values: ${PRIORITY_ENUM.join(', ')}`, 400);
                }
                request.priority = updateData.priority.toLowerCase();
            }
            
            // Handle status changes
            if (updateData.status && request.status !== updateData.status.toLowerCase()) {
                const oldStatus = request.status;
                const newStatus = updateData.status.toLowerCase();

                if (!REQUEST_STATUS_ENUM.includes(newStatus)) {
                    throw new AppError(`Invalid status: ${newStatus}. Allowed values: ${REQUEST_STATUS_ENUM.join(', ')}`, 400);
                }

                request.status = newStatus;
                
                // Add to status history
                request.statusHistory.push({
                    status: newStatus,
                    changedAt: new Date(),
                    changedBy: currentUser._id,
                    notes: updateData.statusNotes || `Status changed from ${oldStatus} to ${newStatus}`
                });
                
                // Set special status-related fields
                if (newStatus === 'completed') {
                    request.resolvedAt = new Date();
                } else if (newStatus === 'reopened') {
                    request.resolvedAt = null;
                }

                // Notify tenant about status update
                const createdByPropertyUser = await PropertyUser.findById(request.createdByPropertyUser)
                    .populate('user')
                    .session(session);
                
                if (createdByPropertyUser && createdByPropertyUser.user) {
                    const tenant = createdByPropertyUser.user;
                    
                    try {
                        await notificationService.sendNotification({
                            recipientId: tenant._id,
                            type: NOTIFICATION_TYPE_ENUM.STATUS_UPDATE,
                            message: `Your request "${request.title}" is now ${request.status}.`,
                            link: `${FRONTEND_URL}/requests/${request._id}`,
                            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                            relatedResourceId: request._id,
                            emailDetails: {
                                subject: `Maintenance Request Status Update: ${request.title}`,
                                html: `
                                    <p>Hello ${tenant.firstName},</p>
                                    <p>The status of your maintenance request has been updated:</p>
                                    <p><strong>Title:</strong> ${request.title}</p>
                                    <p><strong>New Status:</strong> ${request.status}</p>
                                    <p><a href="${FRONTEND_URL}/requests/${request._id}">View Request</a></p>
                                `,
                                text: `Your maintenance request "${request.title}" is now ${request.status}. View at: ${FRONTEND_URL}/requests/${request._id}`
                            },
                            senderId: currentUser._id
                        }, { session });
                    } catch (notificationError) {
                        logger.warn(`Failed to send status update notification: ${notificationError.message}`);
                        // Continue even if notification fails
                    }
                }

                // Notify assignee if assigned
                if (request.assignedTo && request.assignedToModel === 'User') {
                    const assignedUser = await User.findById(request.assignedTo).session(session);
                    if (assignedUser && !assignedUser._id.equals(currentUser._id)) {
                        try {
                            await notificationService.sendNotification({
                                recipientId: assignedUser._id,
                                type: NOTIFICATION_TYPE_ENUM.STATUS_UPDATE,
                                message: `Assigned request "${request.title}" is now ${request.status}.`,
                                link: `${FRONTEND_URL}/requests/${request._id}`,
                                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                                relatedResourceId: request._id,
                                emailDetails: {
                                    subject: `Maintenance Request Status Update: ${request.title}`,
                                    html: `
                                        <p>Hello ${assignedUser.firstName},</p>
                                        <p>The status of a request assigned to you has been updated:</p>
                                        <p><strong>Title:</strong> ${request.title}</p>
                                        <p><strong>New Status:</strong> ${request.status}</p>
                                        <p><a href="${FRONTEND_URL}/requests/${request._id}">View Request</a></p>
                                    `,
                                    text: `Assigned request "${request.title}" is now ${request.status}. View at: ${FRONTEND_URL}/requests/${request._id}`
                                },
                                senderId: currentUser._id
                            }, { session });
                        } catch (notificationError) {
                            logger.warn(`Failed to send assignee status update notification: ${notificationError.message}`);
                            // Continue even if notification fails
                        }
                    }
                }
            }
        }

        // Save changes
        const updatedRequest = await request.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            updatedRequest._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Request "${updatedRequest.title}" updated by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldRequest,
                newValue: updatedRequest.toObject()
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`RequestService: Request "${updatedRequest.title}" updated by ${currentUser.email}.`);
        
        // Return populated request
        return Request.findById(updatedRequest._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email role'
                }
            })
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName email name phone'
            })
            .populate('media');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error updating request: ${error.message}`, {
            userId: currentUser?._id,
            requestId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to update request: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const request = await Request.findById(requestId).session(session);
        if (!request) {
            throw new AppError('Maintenance request not found.', 404);
        }

        // Authorization: Admin, or Landlord/PM associated with the property
        let isAuthorized = false;
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            isAuthorized = true;
        } else {
            const hasManagementAccess = await PropertyUser.exists({
                user: currentUser._id,
                property: request.property,
                isActive: true,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]}
            });
            
            if (hasManagementAccess) {
                isAuthorized = true;
            }
        }

        if (!isAuthorized) {
            throw new AppError('Not authorized to delete this request.', 403);
        }

        // Store old request for audit log
        const oldRequest = request.toObject();

        // --- Cleanup related data ---
        // 1. Delete associated comments
        await Comment.deleteMany({ 
            contextType: AUDIT_RESOURCE_TYPE_ENUM.Request, 
            contextId: requestId 
        }).session(session);
        
        logger.info(`RequestService: Deleted comments for request "${request.title}".`);

        // 2. Delete associated notifications
        await Notification.deleteMany({ 
            'relatedResource.kind': AUDIT_RESOURCE_TYPE_ENUM.Request, 
            'relatedResource.item': requestId 
        }).session(session);
        
        logger.info(`RequestService: Deleted notifications for request "${request.title}".`);

        // 3. Delete associated media
        if (request.media && request.media.length > 0) {
            const mediaRecords = await Media.find({ 
                _id: { $in: request.media } 
            }).session(session);
            
            for (const media of mediaRecords) {
                try {
                    // Extract public ID from Cloudinary URL
                    const publicIdMatch = media.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
                    if (publicIdMatch && publicIdMatch[1]) {
                        await deleteFile(publicIdMatch[1]);
                        logger.info(`RequestService: Deleted media ${publicIdMatch[1]} from storage.`);
                    } else {
                        logger.warn(`RequestService: Could not extract public ID from media URL: ${media.url}`);
                    }
                    
                    // Delete the media record
                    await media.deleteOne({ session });
                } catch (error) {
                    logger.error(`RequestService: Failed to delete media ${media._id}: ${error.message}`);
                    // Continue with deletion even if media deletion fails
                }
            }
        }

        // 4. Delete the request
        await request.deleteOne({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            requestId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Request "${oldRequest.title}" deleted by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldRequest,
                newValue: null
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`RequestService: Request "${oldRequest.title}" deleted by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error deleting request: ${error.message}`, {
            userId: currentUser?._id,
            requestId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete request: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const request = await Request.findById(requestId).session(session);
        if (!request) {
            throw new AppError('Request not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRequestAccess(currentUser, request);
        if (!isAuthorized) {
            throw new AppError('Not authorized to assign this request.', 403);
        }

        // Check assignee existence and type
        if (!ASSIGNED_TO_MODEL_ENUM.includes(assignedToModel)) {
            throw new AppError(`Invalid assignedToModel type. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}.`, 400);
        }

        let assignee = null;
        if (assignedToModel === 'User') {
            assignee = await User.findById(assignedToId).session(session);
            // Restrict which user roles can be assigned
            if (assignee && ![
                ROLE_ENUM.PROPERTY_MANAGER, 
                ROLE_ENUM.LANDLORD, 
                ROLE_ENUM.ADMIN, 
                ROLE_ENUM.VENDOR
            ].includes(assignee.role)) {
                throw new AppError('Assigned user must be a Property Manager, Landlord, Admin, or internal Vendor.', 400);
            }
        } else if (assignedToModel === 'Vendor') {
            assignee = await Vendor.findById(assignedToId).session(session);
        }

        if (!assignee) {
            throw new AppError(`Assignee (${assignedToModel}) not found.`, 404);
        }

        // Store old data for audit log
        const oldAssignedTo = request.assignedTo;
        const oldAssignedToModel = request.assignedToModel;
        const oldStatus = request.status;

        // Find or create PropertyUser for the assigner
        let assignedByPropertyUser = await PropertyUser.findOne({
            user: currentUser._id,
            property: request.property,
            isActive: true
        }).session(session);
        
        if (!assignedByPropertyUser) {
            assignedByPropertyUser = new PropertyUser({
                user: currentUser._id,
                property: request.property,
                roles: [currentUser.role === ROLE_ENUM.TENANT ? 
                    PROPERTY_USER_ROLES_ENUM.TENANT : 
                    PROPERTY_USER_ROLES_ENUM.USER],
                isActive: true
            });
            
            await assignedByPropertyUser.save({ session });
        }

        // Update assignment
        request.assignedTo = assignedToId;
        request.assignedToModel = assignedToModel;
        request.assignedByPropertyUser = assignedByPropertyUser._id;
        request.assignedAt = new Date();
        
        // Update status to 'assigned' if it's currently 'new'
        if (request.status === 'new') {
            request.status = 'assigned';
            
            // Add to status history
            request.statusHistory.push({
                status: 'assigned',
                changedAt: new Date(),
                changedBy: currentUser._id,
                notes: `Assigned to ${assignee.name || assignee.email}`
            });
        }
        
        const updatedRequest = await request.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.ASSIGN,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            updatedRequest._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Request "${updatedRequest.title}" assigned to ${assignee.name || assignee.email} by ${currentUser.email}.`,
                status: 'success',
                oldValue: { 
                    assignedTo: oldAssignedTo, 
                    assignedToModel: oldAssignedToModel, 
                    status: oldStatus 
                },
                newValue: { 
                    assignedTo: updatedRequest.assignedTo, 
                    assignedToModel: updatedRequest.assignedToModel, 
                    status: updatedRequest.status 
                }
            },
            { session }
        );

        // Notify assignee if it's a user
        if (assignedToModel === 'User') {
            try {
                await notificationService.sendNotification({
                    recipientId: assignee._id,
                    type: NOTIFICATION_TYPE_ENUM.ASSIGNMENT,
                    message: `You have been assigned to request: "${updatedRequest.title}"`,
                    link: `${FRONTEND_URL}/requests/${updatedRequest._id}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                    relatedResourceId: updatedRequest._id,
                    emailDetails: {
                        subject: `New Request Assignment: ${updatedRequest.title}`,
                        html: `
                            <p>Hello ${assignee.firstName || 'there'},</p>
                            <p>You have been assigned to a maintenance request:</p>
                            <p><strong>Title:</strong> ${updatedRequest.title}</p>
                            <p><strong>Category:</strong> ${updatedRequest.category}</p>
                            <p><strong>Priority:</strong> ${updatedRequest.priority}</p>
                            <p><a href="${FRONTEND_URL}/requests/${updatedRequest._id}">View Request</a></p>
                        `,
                        text: `You have been assigned to maintenance request: "${updatedRequest.title}". View at: ${FRONTEND_URL}/requests/${updatedRequest._id}`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send assignment notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }
        
        // Also notify tenant about assignment
        const createdByPropertyUser = await PropertyUser.findById(request.createdByPropertyUser)
            .populate('user')
            .session(session);
        
        if (createdByPropertyUser && createdByPropertyUser.user && 
            createdByPropertyUser.user.role === ROLE_ENUM.TENANT) {
            try {
                await notificationService.sendNotification({
                    recipientId: createdByPropertyUser.user._id,
                    type: NOTIFICATION_TYPE_ENUM.REQUEST_ASSIGNED,
                    message: `Your request "${updatedRequest.title}" has been assigned.`,
                    link: `${FRONTEND_URL}/requests/${updatedRequest._id}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                    relatedResourceId: updatedRequest._id,
                    emailDetails: {
                        subject: `Your Maintenance Request Has Been Assigned: ${updatedRequest.title}`,
                        html: `
                            <p>Hello ${createdByPropertyUser.user.firstName},</p>
                            <p>Your maintenance request has been assigned:</p>
                            <p><strong>Title:</strong> ${updatedRequest.title}</p>
                            <p>Your request is now being handled.</p>
                            <p><a href="${FRONTEND_URL}/requests/${updatedRequest._id}">View Request</a></p>
                        `,
                        text: `Your maintenance request "${updatedRequest.title}" has been assigned. View at: ${FRONTEND_URL}/requests/${updatedRequest._id}`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send tenant assignment notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        await session.commitTransaction();
        
        logger.info(`RequestService: Request "${updatedRequest.title}" assigned to ${assignee.name || assignee.email} by ${currentUser.email}.`);
        
        // Return populated request
        return Request.findById(updatedRequest._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email role'
                }
            })
            .populate({
                path: 'assignedByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email role'
                }
            })
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName email name phone'
            });
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error assigning request: ${error.message}`, {
            userId: currentUser?._id,
            requestId,
            assignedToId,
            assignedToModel
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to assign request: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const request = await Request.findById(requestId).session(session);
        if (!request) {
            throw new AppError('Request not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRequestAccess(currentUser, request);
        if (!isAuthorized) {
            throw new AppError('Not authorized to upload media to this request.', 403);
        }

        if (!files || files.length === 0) {
            throw new AppError('No media files provided for upload.', 400);
        }

        // Store old media for audit log
        const oldMedia = request.media ? [...request.media] : [];
        const uploadedMediaIds = [];

        // Process each file
        for (const file of files) {
            try {
                const uploadResult = await uploadFile(
                    file.buffer, 
                    file.mimetype, 
                    file.originalname, 
                    'requests'
                );
                
                // Create media record
                const media = new Media({
                    filename: file.originalname,
                    originalname: file.originalname,
                    mimeType: file.mimetype,
                    size: file.size,
                    url: uploadResult.url,
                    thumbnailUrl: uploadResult.thumbnailUrl || null,
                    uploadedBy: currentUser._id,
                    relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Request,
                    relatedId: request._id,
                    description: `Media for request: ${request.title}`,
                    tags: ['request', request.category],
                    isPublic: false
                });
                
                const savedMedia = await media.save({ session });
                uploadedMediaIds.push(savedMedia._id);
            } catch (error) {
                logger.error(`RequestService - Error uploading file: ${error.message}`);
                throw new AppError(`Failed to upload file: ${error.message}`, 500);
            }
        }

        // Update request with new media
        if (!request.media) {
            request.media = [];
        }
        
        request.media = [...request.media, ...uploadedMediaIds];
        const updatedRequest = await request.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.FILE_UPLOAD,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            updatedRequest._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `${files.length} media files uploaded to request "${updatedRequest.title}" by ${currentUser.email}.`,
                status: 'success',
                oldValue: { media: oldMedia },
                newValue: { media: updatedRequest.media },
                metadata: { uploadedCount: files.length }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`RequestService: ${files.length} media files uploaded to request "${updatedRequest.title}" by ${currentUser.email}.`);
        
        // Return populated request
        return Request.findById(updatedRequest._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email role'
                }
            })
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName email name phone'
            })
            .populate('media');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error uploading media: ${error.message}`, {
            userId: currentUser?._id,
            requestId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to upload media: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const request = await Request.findById(requestId).session(session);
        if (!request) {
            throw new AppError('Request not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRequestAccess(currentUser, request);
        if (!isAuthorized) {
            throw new AppError('Not authorized to delete media from this request.', 403);
        }

        // Find the media by URL
        const media = await Media.findOne({ 
            url: mediaUrl,
            relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Request,
            relatedId: request._id
        }).session(session);
        
        if (!media) {
            throw new AppError('Media not found for this request.', 404);
        }

        // Store old media for audit log
        const oldMedia = request.media ? [...request.media] : [];

        // Remove media ID from request
        if (request.media && request.media.length > 0) {
            request.media = request.media.filter(id => !id.equals(media._id));
            await request.save({ session });
        }

        // Delete from cloud storage
        try {
            const publicIdMatch = media.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
            if (publicIdMatch && publicIdMatch[1]) {
                await deleteFile(publicIdMatch[1]);
                logger.info(`RequestService: Deleted media ${publicIdMatch[1]} from storage.`);
            } else {
                logger.warn(`RequestService: Could not extract public ID from media URL: ${media.url}. Skipping cloud storage deletion.`);
            }
        } catch (error) {
            logger.error(`RequestService: Failed to delete media from cloud storage: ${error.message}`);
            // Continue with database deletion even if cloud storage deletion fails
        }

        // Delete media document
        await media.deleteOne({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.FILE_DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            request._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Media deleted from request "${request.title}" by ${currentUser.email}.`,
                status: 'success',
                oldValue: { media: oldMedia },
                newValue: { media: request.media }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`RequestService: Media deleted from request "${request.title}" by ${currentUser.email}.`);
        
        // Return populated request
        return Request.findById(request._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email role'
                }
            })
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName email name phone'
            })
            .populate('media');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error deleting media: ${error.message}`, {
            userId: currentUser?._id,
            requestId,
            mediaUrl
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete media: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const request = await Request.findById(requestId).session(session);
        if (!request) {
            throw new AppError('Request not found.', 404);
        }

        // Check if user is the creator of the request (and is a tenant)
        const createdByPropertyUser = await PropertyUser.findById(request.createdByPropertyUser)
            .populate('user')
            .session(session);
        
        if (!createdByPropertyUser || 
            !createdByPropertyUser.user || 
            !createdByPropertyUser.user._id.equals(currentUser._id) || 
            currentUser.role !== ROLE_ENUM.TENANT) {
            throw new AppError('You can only submit feedback for your own requests.', 403);
        }

        // Feedback can only be submitted for completed or verified requests
        if (!['completed', 'verified'].includes(request.status)) {
            throw new AppError('Feedback can only be submitted after the request is completed or verified.', 400);
        }

        // Prevent submitting feedback multiple times
        if (request.feedback && request.feedback.submittedAt) {
            throw new AppError('Feedback has already been submitted for this request.', 400);
        }

        // Store old feedback for audit log
        const oldFeedback = request.feedback ? { ...request.feedback.toObject() } : null;

        // Create feedback
        request.feedback = {
            rating,
            comment: comment || null,
            submittedAt: new Date(),
            submittedBy: currentUser._id
        };
        
        const updatedRequest = await request.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.FEEDBACK_SUBMITTED,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            updatedRequest._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Feedback submitted for request "${updatedRequest.title}" by tenant ${currentUser.email}.`,
                status: 'success',
                oldValue: oldFeedback,
                newValue: updatedRequest.feedback
            },
            { session }
        );

        // Notify assignee and property managers
        if (request.assignedTo && request.assignedToModel === 'User') {
            try {
                const assignee = await User.findById(request.assignedTo).session(session);
                if (assignee) {
                    await notificationService.sendNotification({
                        recipientId: assignee._id,
                        type: NOTIFICATION_TYPE_ENUM.FEEDBACK_RECEIVED,
                        message: `Feedback received for request "${updatedRequest.title}". Rating: ${rating}/5`,
                        link: `${FRONTEND_URL}/requests/${updatedRequest._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                        relatedResourceId: updatedRequest._id,
                        emailDetails: {
                            subject: `Feedback Received: ${updatedRequest.title}`,
                            html: `
                                <p>Hello ${assignee.firstName || 'there'},</p>
                                <p>Feedback has been received for a request you were assigned to:</p>
                                <p><strong>Request:</strong> ${updatedRequest.title}</p>
                                <p><strong>Rating:</strong> ${rating}/5</p>
                                ${comment ? `<p><strong>Comment:</strong> ${comment}</p>` : ''}
                                <p><a href="${FRONTEND_URL}/requests/${updatedRequest._id}">View Request</a></p>
                            `,
                            text: `Feedback received for request "${updatedRequest.title}". Rating: ${rating}/5. View at: ${FRONTEND_URL}/requests/${updatedRequest._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                }
            } catch (notificationError) {
                logger.warn(`Failed to send feedback notification to assignee: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        // Also notify property managers
        const propertyManagers = await PropertyUser.find({
            property: request.property,
            roles: { $in: [
                PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                PROPERTY_USER_ROLES_ENUM.LANDLORD
            ]},
            isActive: true
        }).populate('user').session(session);
        
        for (const manager of propertyManagers) {
            if (manager.user && !manager.user._id.equals(currentUser._id)) {
                try {
                    await notificationService.sendNotification({
                        recipientId: manager.user._id,
                        type: NOTIFICATION_TYPE_ENUM.FEEDBACK_RECEIVED,
                        message: `Tenant feedback received for request "${updatedRequest.title}". Rating: ${rating}/5`,
                        link: `${FRONTEND_URL}/requests/${updatedRequest._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                        relatedResourceId: updatedRequest._id,
                        emailDetails: {
                            subject: `Tenant Feedback Received: ${updatedRequest.title}`,
                            html: `
                                <p>Hello ${manager.user.firstName || 'there'},</p>
                                <p>A tenant has submitted feedback for a maintenance request:</p>
                                <p><strong>Request:</strong> ${updatedRequest.title}</p>
                                <p><strong>Rating:</strong> ${rating}/5</p>
                                ${comment ? `<p><strong>Comment:</strong> ${comment}</p>` : ''}
                                <p><a href="${FRONTEND_URL}/requests/${updatedRequest._id}">View Request</a></p>
                            `,
                            text: `Tenant feedback received for request "${updatedRequest.title}". Rating: ${rating}/5. View at: ${FRONTEND_URL}/requests/${updatedRequest._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send feedback notification to manager: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
        }

        await session.commitTransaction();
        
        logger.info(`RequestService: Feedback submitted for request "${updatedRequest.title}" by ${currentUser.email}.`);
        
        // Return populated request
        return Request.findById(updatedRequest._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email role'
                }
            })
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName email name phone'
            });
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error submitting feedback: ${error.message}`, {
            userId: currentUser?._id,
            requestId,
            rating
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to submit feedback: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const request = await Request.findById(requestId).session(session);
        if (!request) {
            throw new AppError('Request not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRequestAccess(currentUser, request);
        if (!isAuthorized) {
            throw new AppError('Not authorized to enable public link for this request.', 403);
        }

        // Store old state for audit log
        const oldPublicLinkState = {
            publicLinkEnabled: request.publicLinkEnabled,
            publicToken: request.publicToken,
            publicLinkExpiresAt: request.publicLinkExpiresAt
        };

        // Generate a new token if one doesn't exist
        if (!request.publicToken) {
            request.publicToken = crypto.randomBytes(24).toString('hex');
        }

        request.publicLinkEnabled = true;
        
        if (expiresInDays) {
            request.publicLinkExpiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
        } else {
            // Default to 7 days
            request.publicLinkExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }
        
        await request.save({ session });

        const publicLink = `${FRONTEND_URL}/requests/public/${request.publicToken}`;

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.ENABLE_PUBLIC_LINK,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            request._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Public link enabled for request "${request.title}" by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldPublicLinkState,
                newValue: {
                    publicLinkEnabled: request.publicLinkEnabled,
                    publicToken: request.publicToken,
                    publicLinkExpiresAt: request.publicLinkExpiresAt
                }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`RequestService: Public link enabled for request "${request.title}" by ${currentUser.email}.`);
        
        return publicLink;
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error enabling public link: ${error.message}`, {
            userId: currentUser?._id,
            requestId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to enable public link: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const request = await Request.findById(requestId).session(session);
        if (!request) {
            throw new AppError('Request not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRequestAccess(currentUser, request);
        if (!isAuthorized) {
            throw new AppError('Not authorized to disable public link for this request.', 403);
        }

        // Store old state for audit log
        const oldPublicLinkState = {
            publicLinkEnabled: request.publicLinkEnabled,
            publicToken: request.publicToken,
            publicLinkExpiresAt: request.publicLinkExpiresAt
        };

        // Disable the public link
        request.publicLinkEnabled = false;
        await request.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DISABLE_PUBLIC_LINK,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            request._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Public link disabled for request "${request.title}" by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldPublicLinkState,
                newValue: {
                    publicLinkEnabled: request.publicLinkEnabled,
                    publicToken: request.publicToken,
                    publicLinkExpiresAt: request.publicLinkExpiresAt
                }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`RequestService: Public link disabled for request "${request.title}" by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error disabling public link: ${error.message}`, {
            userId: currentUser?._id,
            requestId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to disable public link: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets external (public) view of a request using a public token.
 * @param {string} publicToken - The public token for the request.
 * @returns {Promise<object>} Limited request details for public view.
 * @throws {AppError} If token is invalid, expired, or disabled.
 */
const getPublicRequestView = async (publicToken) => {
    try {
        const request = await Request.findOne({
            publicToken,
            publicLinkEnabled: true,
            publicLinkExpiresAt: { $gt: new Date() } // Not expired
        })
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName' // Limited user info for public view
                }
            })
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName name' // Limited assignee info for public view
            })
            .populate({
                path: 'comments',
                match: { isInternalNote: false }, // Filter out internal notes
                populate: {
                    path: 'sender',
                    select: 'firstName lastName'
                }
            })
            .populate('media');

        if (!request) {
            throw new AppError('Invalid, expired, or disabled public link.', 404);
        }

        // Return limited data for public view
        return {
            _id: request._id,
            title: request.title,
            description: request.description,
            category: request.category,
            priority: request.priority,
            status: request.status,
            property: {
                name: request.property.name,
                address: request.property.address
            },
            unit: request.unit ? { unitName: request.unit.unitName } : null,
            createdAt: request.createdAt,
            updatedAt: request.updatedAt,
            statusHistory: request.statusHistory.map(status => ({
                status: status.status,
                changedAt: status.changedAt
            })),
            media: request.media,
            comments: request.comments.map(comment => ({
                message: comment.message,
                timestamp: comment.timestamp,
                senderName: comment.sender ? 
                    `${comment.sender.firstName || ''} ${comment.sender.lastName || ''}`.trim() : 
                    comment.externalUserName || 'Unknown'
            }))
        };
    } catch (error) {
        logger.error(`RequestService - Error getting public request view: ${error.message}`, {
            publicToken
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get public request view: ${error.message}`, 500);
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { status, commentMessage, name, phone } = updateData;

        // Validate external user info
        if (!name || !phone) {
            throw new AppError('Name and phone are required for accountability.', 400);
        }

        // Find the request
        const request = await Request.findOne({
            publicToken,
            publicLinkEnabled: true,
            publicLinkExpiresAt: { $gt: new Date() } // Not expired
        }).session(session);

        if (!request) {
            throw new AppError('Invalid, expired, or disabled public link.', 404);
        }

        // Find or create a 'pseudo-user' for this external interaction
        let pseudoEmail = `${phone.replace(/\D/g, '')}@external.vendor`;
        let publicUpdater = await User.findOne({ 
            email: pseudoEmail, 
            role: ROLE_ENUM.VENDOR 
        }).session(session);
        
        if (!publicUpdater) {
            publicUpdater = new User({
                firstName: name.split(' ')[0] || 'External',
                lastName: name.split(' ').slice(1).join(' ') || 'Vendor',
                email: pseudoEmail,
                phone: phone,
                role: ROLE_ENUM.VENDOR,
                status: REGISTRATION_STATUS_ENUM.ACTIVE,
                isEmailVerified: false,
                passwordHash: crypto.randomBytes(16).toString('hex') // Random password
            });
            
            await publicUpdater.save({ session });
            logger.info(`RequestService: Created pseudo-user for external update: ${publicUpdater.email}`);
        }

        // Update status if provided and valid
        const allowedPublicStatuses = ['in_progress', 'completed'];
        if (status) {
            const lowerStatus = status.toLowerCase();
            if (!allowedPublicStatuses.includes(lowerStatus)) {
                throw new AppError(`Invalid status for public update. Must be one of: ${allowedPublicStatuses.join(', ')}.`, 400);
            }
            
            const oldStatus = request.status;
            request.status = lowerStatus;
            
            // Set resolved date for completed status
            if (lowerStatus === 'completed') {
                request.resolvedAt = new Date();
            }
            
            // Add to status history
            request.statusHistory.push({
                status: lowerStatus,
                changedAt: new Date(),
                changedBy: publicUpdater._id,
                notes: `Status updated via public link by ${name} (${phone})`
            });
            
            // Create audit log for status update
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.PUBLIC_UPDATE,
                AUDIT_RESOURCE_TYPE_ENUM.Request,
                request._id,
                {
                    userId: publicUpdater._id,
                    ipAddress,
                    description: `External vendor ${name} updated request "${request.title}" status from ${oldStatus} to ${request.status}.`,
                    status: 'success',
                    oldValue: { status: oldStatus },
                    newValue: { status: request.status }
                },
                { session }
            );
            
            // Notify relevant internal users about status update
            const propertyManagersAndLandlords = await PropertyUser.find({
                property: request.property,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('user').session(session);

            for (const managerId of propertyManagersAndLandlords) {
                try {
                    await notificationService.sendNotification({
                        recipientId: managerId,
                        type: NOTIFICATION_TYPE_ENUM.STATUS_UPDATE,
                        message: `External vendor ${name} updated request "${request.title}" to ${request.status}.`,
                        link: `${FRONTEND_URL}/requests/${request._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                        relatedResourceId: request._id,
                        emailDetails: {
                            subject: `External Update: Maintenance Request Status Changed`,
                            html: `
                                <p>Hello,</p>
                                <p>An external vendor has updated the status of a maintenance request:</p>
                                <p><strong>Request:</strong> ${request.title}</p>
                                <p><strong>New Status:</strong> ${request.status}</p>
                                <p><strong>Updated By:</strong> ${name} (${phone})</p>
                                <p><a href="${FRONTEND_URL}/requests/${request._id}">View Request</a></p>
                            `,
                            text: `External vendor ${name} updated request "${request.title}" to ${request.status}. View at: ${FRONTEND_URL}/requests/${request._id}`
                        },
                        senderId: publicUpdater._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send status update notification to manager: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
            
            // Also notify tenant
            const createdByPropertyUser = await PropertyUser.findById(request.createdByPropertyUser)
                .populate('user')
                .session(session);
            
            if (createdByPropertyUser && createdByPropertyUser.user) {
                try {
                    await notificationService.sendNotification({
                        recipientId: createdByPropertyUser.user._id,
                        type: NOTIFICATION_TYPE_ENUM.STATUS_UPDATE,
                        message: `Your request "${request.title}" has been updated to ${request.status} by vendor ${name}.`,
                        link: `${FRONTEND_URL}/requests/${request._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                        relatedResourceId: request._id,
                        emailDetails: {
                            subject: `Your Maintenance Request Status Update`,
                            html: `
                                <p>Hello ${createdByPropertyUser.user.firstName || 'there'},</p>
                                <p>The status of your maintenance request has been updated by an external vendor:</p>
                                <p><strong>Request:</strong> ${request.title}</p>
                                <p><strong>New Status:</strong> ${request.status}</p>
                                <p><strong>Updated By:</strong> ${name}</p>
                                <p><a href="${FRONTEND_URL}/requests/${request._id}">View Request</a></p>
                            `,
                            text: `Your request "${request.title}" has been updated to ${request.status} by vendor ${name}. View at: ${FRONTEND_URL}/requests/${request._id}`
                        },
                        senderId: publicUpdater._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send tenant status update notification: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
        }

        // Add comment if provided
        if (commentMessage) {
            const newComment = new Comment({
                contextType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                contextId: request._id,
                sender: publicUpdater._id,
                message: commentMessage,
                timestamp: new Date(),
                isInternalNote: false,
                isExternal: true,
                externalUserName: name,
                externalUserEmail: pseudoEmail
            });
            
            const savedComment = await newComment.save({ session });
            
            // Update request with comment reference
            if (!request.comments) {
                request.comments = [];
            }
            
            request.comments.push(savedComment._id);
            
            // Create audit log for comment
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.COMMENT_ADDED,
                AUDIT_RESOURCE_TYPE_ENUM.Request,
                request._id,
                {
                    userId: publicUpdater._id,
                    ipAddress,
                    description: `External vendor ${name} added a comment to request "${request.title}".`,
                    status: 'success',
                    newValue: { commentId: savedComment._id, message: commentMessage }
                },
                { session }
            );
            
            // Notify relevant users about new comment
            const relevantUsers = new Set();
            
            // Add tenant
            if (createdByPropertyUser && createdByPropertyUser.user) {
                relevantUsers.add(createdByPropertyUser.user._id.toString());
            }
            
            // Add assignee if any
            if (request.assignedTo && request.assignedToModel === 'User') {
                relevantUsers.add(request.assignedTo.toString());
            }
            
            // Add property managers and landlords
            const propertyManagers = await PropertyUser.find({
                property: request.property,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('user').session(session);
            
            propertyManagers.forEach(id => relevantUsers.add(id.toString()));
            
            for (const userId of relevantUsers) {
                try {
                    const recipientUser = await User.findById(userId).session(session);
                    if (recipientUser) {
                        await notificationService.sendNotification({
                            recipientId: userId,
                            type: NOTIFICATION_TYPE_ENUM.NEW_COMMENT,
                            message: `New comment on request "${request.title}" from external vendor ${name}.`,
                            link: `${FRONTEND_URL}/requests/${request._id}`,
                            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                            relatedResourceId: request._id,
                            emailDetails: {
                                subject: `New Comment on Maintenance Request: ${request.title}`,
                                html: `
                                    <p>Hello ${recipientUser.firstName || 'there'},</p>
                                    <p>A new comment has been added to a maintenance request by an external vendor:</p>
                                    <p><strong>Request:</strong> ${request.title}</p>
                                    <p><strong>Vendor:</strong> ${name}</p>
                                    <p><strong>Comment:</strong> ${commentMessage}</p>
                                    <p><a href="${FRONTEND_URL}/requests/${request._id}">View Request</a></p>
                                `,
                                text: `New comment on request "${request.title}" from external vendor ${name}: "${commentMessage}". View at: ${FRONTEND_URL}/requests/${request._id}`
                            },
                            senderId: publicUpdater._id
                        }, { session });
                    }
                } catch (notificationError) {
                    logger.warn(`Failed to send comment notification to user ${userId}: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
        }

        // Save all changes
        const updatedRequest = await request.save({ session });

        await session.commitTransaction();
        
        logger.info(`RequestService: External update to request "${updatedRequest.title}" by ${name} (${phone}).`);
        
        return updatedRequest;
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error processing public update: ${error.message}`, {
            publicToken,
            name: updateData?.name,
            phone: updateData?.phone
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to process public update: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const request = await Request.findById(requestId).session(session);
        if (!request) {
            throw new AppError('Request not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRequestAccess(currentUser, request);
        if (!isAuthorized || 
            ![ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            throw new AppError('Not authorized to verify this request.', 403);
        }

        // Validate request is in completed status
        if (request.status !== 'completed') {
            throw new AppError('Only completed requests can be verified.', 400);
        }

        // Store old status for audit log
        const oldStatus = request.status;

        // Update status to verified
        request.status = 'verified';
        
        // Add to status history
        request.statusHistory.push({
            status: 'verified',
            changedAt: new Date(),
            changedBy: currentUser._id,
            notes: `Verified by ${currentUser.email}`
        });
        
        const updatedRequest = await request.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.VERIFY,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            updatedRequest._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Request "${updatedRequest.title}" verified by ${currentUser.email}.`,
                status: 'success',
                oldValue: { status: oldStatus },
                newValue: { status: updatedRequest.status }
            },
            { session }
        );

        // Notify tenant
        const createdByPropertyUser = await PropertyUser.findById(request.createdByPropertyUser)
            .populate('user')
            .session(session);
        
        if (createdByPropertyUser && createdByPropertyUser.user) {
            try {
                await notificationService.sendNotification({
                    recipientId: createdByPropertyUser.user._id,
                    type: NOTIFICATION_TYPE_ENUM.REQUEST_VERIFIED,
                    message: `Your request "${updatedRequest.title}" has been verified.`,
                    link: `${FRONTEND_URL}/requests/${updatedRequest._id}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                    relatedResourceId: updatedRequest._id,
                    emailDetails: {
                        subject: `Your Maintenance Request Has Been Verified: ${updatedRequest.title}`,
                        html: `
                            <p>Hello ${createdByPropertyUser.user.firstName || 'there'},</p>
                            <p>Your maintenance request has been verified:</p>
                            <p><strong>Request:</strong> ${updatedRequest.title}</p>
                            <p>If you're satisfied with the work, please consider providing feedback.</p>
                            <p><a href="${FRONTEND_URL}/requests/${updatedRequest._id}">View Request</a></p>
                        `,
                        text: `Your maintenance request "${updatedRequest.title}" has been verified. View at: ${FRONTEND_URL}/requests/${updatedRequest._id}`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send verification notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        await session.commitTransaction();
        
        logger.info(`RequestService: Request "${updatedRequest.title}" verified by ${currentUser.email}.`);
        
        // Return populated request
        return Request.findById(updatedRequest._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email role'
                }
            })
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName email name phone'
            });
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error verifying request: ${error.message}`, {
            userId: currentUser?._id,
            requestId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to verify request: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const request = await Request.findById(requestId).session(session);
        if (!request) {
            throw new AppError('Request not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRequestAccess(currentUser, request);
        if (!isAuthorized || 
            ![ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            throw new AppError('Not authorized to reopen this request.', 403);
        }

        // Validate request status
        if (!['completed', 'verified'].includes(request.status)) {
            throw new AppError('Only completed or verified requests can be reopened.', 400);
        }

        // Store old status for audit log
        const oldStatus = request.status;

        // Update status to reopened
        request.status = 'reopened';
        request.resolvedAt = null; // Clear resolved date
        
        // Add to status history
        request.statusHistory.push({
            status: 'reopened',
            changedAt: new Date(),
            changedBy: currentUser._id,
            notes: `Reopened by ${currentUser.email}`
        });
        
        const updatedRequest = await request.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.REOPEN,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            updatedRequest._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Request "${updatedRequest.title}" reopened by ${currentUser.email}.`,
                status: 'success',
                oldValue: { 
                    status: oldStatus,
                    resolvedAt: request.resolvedAt 
                },
                newValue: { 
                    status: updatedRequest.status,
                    resolvedAt: null 
                }
            },
            { session }
        );

        // Notify tenant
        const createdByPropertyUser = await PropertyUser.findById(request.createdByPropertyUser)
            .populate('user')
            .session(session);
        
        if (createdByPropertyUser && createdByPropertyUser.user) {
            try {
                await notificationService.sendNotification({
                    recipientId: createdByPropertyUser.user._id,
                    type: NOTIFICATION_TYPE_ENUM.REQUEST_REOPENED,
                    message: `Your request "${updatedRequest.title}" has been reopened.`,
                    link: `${FRONTEND_URL}/requests/${updatedRequest._id}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                    relatedResourceId: updatedRequest._id,
                    emailDetails: {
                        subject: `Your Maintenance Request Has Been Reopened: ${updatedRequest.title}`,
                        html: `
                            <p>Hello ${createdByPropertyUser.user.firstName || 'there'},</p>
                            <p>Your maintenance request has been reopened:</p>
                            <p><strong>Request:</strong> ${updatedRequest.title}</p>
                            <p>This means more work needs to be done on this request.</p>
                            <p><a href="${FRONTEND_URL}/requests/${updatedRequest._id}">View Request</a></p>
                        `,
                        text: `Your maintenance request "${updatedRequest.title}" has been reopened. View at: ${FRONTEND_URL}/requests/${updatedRequest._id}`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send reopen notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        // Notify assignee if assigned
        if (request.assignedTo && request.assignedToModel === 'User') {
            try {
                const assignee = await User.findById(request.assignedTo).session(session);
                if (assignee) {
                    await notificationService.sendNotification({
                        recipientId: assignee._id,
                        type: NOTIFICATION_TYPE_ENUM.REQUEST_REOPENED,
                        message: `Request "${updatedRequest.title}" has been reopened.`,
                        link: `${FRONTEND_URL}/requests/${updatedRequest._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                        relatedResourceId: updatedRequest._id,
                        emailDetails: {
                            subject: `Maintenance Request Reopened: ${updatedRequest.title}`,
                            html: `
                                <p>Hello ${assignee.firstName || 'there'},</p>
                                <p>A maintenance request you were assigned to has been reopened:</p>
                                <p><strong>Request:</strong> ${updatedRequest.title}</p>
                                <p>Please review this request as additional work may be required.</p>
                                <p><a href="${FRONTEND_URL}/requests/${updatedRequest._id}">View Request</a></p>
                            `,
                            text: `Maintenance request "${updatedRequest.title}" has been reopened. View at: ${FRONTEND_URL}/requests/${updatedRequest._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                }
            } catch (notificationError) {
                logger.warn(`Failed to send assignee reopen notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        await session.commitTransaction();
        
        logger.info(`RequestService: Request "${updatedRequest.title}" reopened by ${currentUser.email}.`);
        
        // Return populated request
        return Request.findById(updatedRequest._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email role'
                }
            })
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName email name phone'
            });
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error reopening request: ${error.message}`, {
            userId: currentUser?._id,
            requestId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to reopen request: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const request = await Request.findById(requestId).session(session);
        if (!request) {
            throw new AppError('Request not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRequestAccess(currentUser, request);
        if (!isAuthorized || 
            ![ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            throw new AppError('Not authorized to archive this request.', 403);
        }

        // Validate request status
        const archivableStatuses = ['completed', 'verified', 'reopened'];
        if (!archivableStatuses.includes(request.status)) {
            throw new AppError(`Only ${archivableStatuses.join(', ')} requests can be archived.`, 400);
        }

        // Store old status for audit log
        const oldStatus = request.status;

        // Update status to archived
        request.status = 'archived';
        
        // Add to status history
        request.statusHistory.push({
            status: 'archived',
            changedAt: new Date(),
            changedBy: currentUser._id,
            notes: `Archived by ${currentUser.email}`
        });
        
        const updatedRequest = await request.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.ARCHIVE,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            updatedRequest._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Request "${updatedRequest.title}" archived by ${currentUser.email}.`,
                status: 'success',
                oldValue: { status: oldStatus },
                newValue: { status: updatedRequest.status }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`RequestService: Request "${updatedRequest.title}" archived by ${currentUser.email}.`);
        
        // Return populated request
        return Request.findById(updatedRequest._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email role'
                }
            })
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName email name phone'
            });
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RequestService - Error archiving request: ${error.message}`, {
            userId: currentUser?._id,
            requestId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to archive request: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    archiveRequest
};