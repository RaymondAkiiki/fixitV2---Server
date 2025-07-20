// src/services/scheduledMaintenanceService.js

const mongoose = require('mongoose');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Property = require('../models/property');
const Unit = require('../models/unit');
const User = require('../models/user');
const Vendor = require('../models/vendor');
const PropertyUser = require('../models/propertyUser');
const Request = require('../models/request');
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
    FREQUENCY_TYPE_ENUM,
    SCHEDULED_MAINTENANCE_STATUS_ENUM,
    ASSIGNED_TO_MODEL_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM,
    REGISTRATION_STATUS_ENUM
} = require('../utils/constants/enums');

const crypto = require('crypto');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Helper to check if a user has management permission for a given property.
 * Used for authorizing actions on scheduled maintenance tasks.
 * @param {object} user - The authenticated user object.
 * @param {string} propertyId - The ID of the property to check access for.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkPropertyManagementPermission = async (user, propertyId) => {
    try {
        if (user.role === ROLE_ENUM.ADMIN) {
            return true; // Admin has global access
        }

        const hasAccess = await PropertyUser.exists({
            user: user._id,
            property: propertyId,
            isActive: true,
            roles: { $in: [
                PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
            ]}
        });
        
        return Boolean(hasAccess);
    } catch (error) {
        logger.error(`ScheduledMaintenanceService - Error checking property management permission: ${error.message}`, {
            userId: user?._id,
            propertyId
        });
        return false; // Fail safely
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { 
            title, 
            description, 
            category, 
            property: propertyId, 
            unit: unitId, 
            scheduledDate, 
            recurring, 
            frequency, 
            assignedToId, 
            assignedToModel, 
            files 
        } = taskData;

        // Validate property
        const property = await Property.findById(propertyId).session(session);
        if (!property) {
            throw new AppError('Property not found.', 404);
        }
        
        // Validate unit if provided
        if (unitId) {
            const unit = await Unit.findById(unitId).session(session);
            if (!unit) {
                throw new AppError('Unit not found.', 404);
            }
            
            if (unit.property.toString() !== propertyId) {
                throw new AppError('Unit does not belong to the specified property.', 400);
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
                assigneeExists = await User.findById(assignedToId).session(session);
                
                // Optionally validate user role if needed
                if (assigneeExists && ![
                    ROLE_ENUM.ADMIN,
                    ROLE_ENUM.PROPERTY_MANAGER,
                    ROLE_ENUM.LANDLORD,
                    ROLE_ENUM.VENDOR
                ].includes(assigneeExists.role)) {
                    throw new AppError(`Assigned user must have a role that can handle maintenance tasks.`, 400);
                }
            } else if (assignedToModel === 'Vendor') {
                assigneeExists = await Vendor.findById(assignedToId).session(session);
            }
            
            if (!assigneeExists) {
                throw new AppError(`Assigned ${assignedToModel} not found.`, 404);
            }
            
            assigneeRef = assignedToId;
            assigneeModelRef = assignedToModel;
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
                        'scheduled-maintenance'
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
                        relatedTo: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                        description: `Media for scheduled maintenance: ${title}`,
                        tags: ['scheduled-maintenance', category?.toLowerCase() || 'general'],
                        isPublic: false
                    });
                    
                    const savedMedia = await media.save({ session });
                    mediaIds.push(savedMedia._id);
                } catch (error) {
                    logger.error(`ScheduledMaintenanceService - Error uploading file: ${error.message}`);
                    throw new AppError(`Failed to upload file: ${error.message}`, 500);
                }
            }
        }

        // Find or create PropertyUser reference for task creator
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

        // Create frequency object for recurring tasks
        const frequencyData = recurring ? {
            type: frequency?.type?.toLowerCase() || 'monthly',
            interval: frequency?.interval || 1,
            dayOfWeek: frequency?.dayOfWeek || null,
            dayOfMonth: frequency?.dayOfMonth || null,
            monthOfYear: frequency?.monthOfYear || null,
            customDays: frequency?.customDays || [],
            endDate: frequency?.endDate || null,
            occurrences: frequency?.occurrences || null
        } : {};

        // Calculate next execution date
        const nextExecutionDate = scheduledDate;

        // Create the scheduled maintenance task
        const newScheduledMaintenance = new ScheduledMaintenance({
            title,
            description,
            category: category?.toLowerCase() || 'general',
            property: propertyId,
            unit: unitId || null,
            scheduledDate,
            recurring: !!recurring,
            frequency: frequencyData,
            assignedTo: assigneeRef,
            assignedToModel: assigneeModelRef,
            createdByPropertyUser: createdByPropertyUser._id,
            media: mediaIds,
            status: 'scheduled', // Default status
            nextDueDate: nextExecutionDate,
            nextExecutionAttempt: nextExecutionDate,
            statusHistory: [{
                status: 'scheduled',
                changedAt: new Date(),
                changedBy: currentUser._id,
                notes: 'Task created'
            }]
        });

        const createdTask = await newScheduledMaintenance.save({ session });

        // Update media records with relation to the new task
        if (mediaIds.length > 0) {
            await Media.updateMany(
                { _id: { $in: mediaIds } },
                { relatedId: createdTask._id },
                { session }
            );
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            createdTask._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Scheduled maintenance "${createdTask.title}" created by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    propertyId,
                    unitId,
                    category: createdTask.category,
                    scheduledDate,
                    recurring,
                    mediaCount: mediaIds.length
                },
                newValue: createdTask.toObject()
            },
            { session }
        );

        // Notify assignee if task is assigned
        if (assigneeRef && assigneeModelRef === 'User') {
            try {
                const assignee = await User.findById(assigneeRef).session(session);
                if (assignee) {
                    await notificationService.sendNotification({
                        recipientId: assignee._id,
                        type: NOTIFICATION_TYPE_ENUM.ASSIGNMENT,
                        message: `You have been assigned to scheduled maintenance: "${createdTask.title}"`,
                        link: `${FRONTEND_URL}/scheduled-maintenance/${createdTask._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                        relatedResourceId: createdTask._id,
                        emailDetails: {
                            subject: `New Scheduled Maintenance Assignment: ${createdTask.title}`,
                            html: `
                                <p>Hello ${assignee.firstName || 'there'},</p>
                                <p>You have been assigned to a scheduled maintenance task:</p>
                                <p><strong>Title:</strong> ${createdTask.title}</p>
                                <p><strong>Property:</strong> ${property.name}</p>
                                <p><strong>Category:</strong> ${createdTask.category}</p>
                                <p><strong>Scheduled Date:</strong> ${new Date(scheduledDate).toLocaleDateString()}</p>
                                <p><a href="${FRONTEND_URL}/scheduled-maintenance/${createdTask._id}">View Task</a></p>
                            `,
                            text: `You have been assigned to scheduled maintenance task: "${createdTask.title}". View at: ${FRONTEND_URL}/scheduled-maintenance/${createdTask._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                }
            } catch (notificationError) {
                logger.warn(`Failed to send assignment notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

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

        for (const managerId of propertyManagersAndLandlords) {
            if (managerId.toString() !== currentUser._id.toString()) { // Don't notify creator
                try {
                    await notificationService.sendNotification({
                        recipientId: managerId,
                        type: NOTIFICATION_TYPE_ENUM.NEW_SCHEDULED_MAINTENANCE,
                        message: `New scheduled maintenance for ${property.name}${unitId ? ` unit ${unitId}` : ''}: ${createdTask.title}`,
                        link: `${FRONTEND_URL}/scheduled-maintenance/${createdTask._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                        relatedResourceId: createdTask._id,
                        emailDetails: {
                            subject: `New Scheduled Maintenance: ${createdTask.title}`,
                            html: `
                                <p>A new scheduled maintenance task has been created:</p>
                                <p><strong>Title:</strong> ${createdTask.title}</p>
                                <p><strong>Property:</strong> ${property.name}</p>
                                <p><strong>Category:</strong> ${createdTask.category}</p>
                                <p><strong>Scheduled Date:</strong> ${new Date(scheduledDate).toLocaleDateString()}</p>
                                <p><a href="${FRONTEND_URL}/scheduled-maintenance/${createdTask._id}">View Task</a></p>
                            `,
                            text: `New scheduled maintenance: ${createdTask.title} for property: ${property.name}. View at: ${FRONTEND_URL}/scheduled-maintenance/${createdTask._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send scheduled maintenance notification: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
        }

        await session.commitTransaction();
        
        logger.info(`ScheduledMaintenanceService: Task "${createdTask.title}" created by ${currentUser.email}.`);
        
        // Return populated task
        return ScheduledMaintenance.findById(createdTask._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('createdByPropertyUser')
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName email name phone'
            })
            .populate('media');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`ScheduledMaintenanceService - Error creating task: ${error.message}`, {
            userId: currentUser?._id,
            propertyId: taskData?.property
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to create scheduled maintenance: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets all scheduled maintenance tasks with filtering, search, and pagination.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Query filters.
 * @param {number} page - Page number.
 * @param {number} limit - Items per page.
 * @returns {Promise<object>} Object containing tasks array, total count, page, and limit.
 * @throws {AppError} If user not authorized.
 */
const getAllScheduledMaintenance = async (currentUser, filters, page = 1, limit = 10) => {
    try {
        let query = {};
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Base filtering by role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin sees all tasks
        } else if (currentUser.role === ROLE_ENUM.VENDOR) {
            // Vendors only see tasks assigned to them
            query.assignedTo = currentUser._id;
            query.assignedToModel = 'User';
        } else { // Landlord, PropertyManager, Tenant
            // Find properties associated with user
            const associatedProperties = await PropertyUser.find({
                user: currentUser._id,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.TENANT,
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('property');

            if (associatedProperties.length === 0) {
                return { 
                    tasks: [], 
                    total: 0, 
                    page: parseInt(page), 
                    limit: parseInt(limit),
                    pages: 0
                };
            }
            
            query.property = { $in: associatedProperties };

            // If tenant, further filter by unit
            if (currentUser.role === ROLE_ENUM.TENANT) {
                const associatedUnits = await PropertyUser.find({ 
                    user: currentUser._id, 
                    roles: PROPERTY_USER_ROLES_ENUM.TENANT, 
                    isActive: true 
                }).distinct('unit');
                
                if (associatedUnits.length > 0) {
                    query.unit = { $in: associatedUnits };
                } else {
                    // Tenant not associated with any unit
                    return { 
                        tasks: [], 
                        total: 0, 
                        page: parseInt(page), 
                        limit: parseInt(limit),
                        pages: 0
                    };
                }
            }
        }

        // Apply additional filters
        if (filters.status) {
            if (!SCHEDULED_MAINTENANCE_STATUS_ENUM.includes(filters.status.toLowerCase())) {
                throw new AppError(`Invalid status filter: ${filters.status}. Allowed values: ${SCHEDULED_MAINTENANCE_STATUS_ENUM.join(', ')}`, 400);
            }
            query.status = filters.status.toLowerCase();
        }
        
        if (filters.recurring !== undefined) {
            query.recurring = (filters.recurring === 'true');
        }
        
        if (filters.propertyId) {
            // Ensure user has access to this specific property if filtering by it
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const hasPropertyAccess = await PropertyUser.exists({
                    user: currentUser._id,
                    property: filters.propertyId,
                    isActive: true
                });
                
                if (!hasPropertyAccess) {
                    throw new AppError('Not authorized to filter tasks by this property.', 403);
                }
            }
            
            query.property = filters.propertyId;
        }
        
        if (filters.unitId) {
            // Ensure unit belongs to the property (if propertyId filter is also applied)
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
        
        if (filters.category) {
            if (!CATEGORY_ENUM.includes(filters.category.toLowerCase())) {
                throw new AppError(`Invalid category filter: ${filters.category}. Allowed values: ${CATEGORY_ENUM.join(', ')}`, 400);
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
            if (filters.startDate) {
                query.scheduledDate.$gte = new Date(filters.startDate);
            }
            if (filters.endDate) {
                query.scheduledDate.$lte = new Date(filters.endDate);
            }
        }

        // Execute query with population
        const [tasks, total] = await Promise.all([
            ScheduledMaintenance.find(query)
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
                .sort({ scheduledDate: 1 })
                .skip(skip)
                .limit(parseInt(limit)),
            ScheduledMaintenance.countDocuments(query)
        ]);

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched list of scheduled maintenance tasks.`,
                status: 'success',
                metadata: { 
                    filters, 
                    page, 
                    limit,
                    count: tasks.length
                }
            }
        );

        return { 
            tasks, 
            total, 
            page: parseInt(page), 
            limit: parseInt(limit),
            pages: Math.ceil(total / parseInt(limit))
        };
    } catch (error) {
        logger.error(`ScheduledMaintenanceService - Error getting tasks: ${error.message}`, {
            userId: currentUser?._id,
            filters
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get scheduled maintenance tasks: ${error.message}`, 500);
    }
};

/**
 * Gets a single scheduled maintenance task by ID.
 * @param {string} taskId - The ID of the task.
 * @param {object} currentUser - The authenticated user.
 * @returns {Promise<ScheduledMaintenance>} The task document.
 * @throws {AppError} If task not found or user not authorized.
 */
const getScheduledMaintenanceById = async (taskId, currentUser) => {
    try {
        const task = await ScheduledMaintenance.findById(taskId)
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
            .populate({
                path: 'comments',
                populate: {
                    path: 'sender',
                    select: 'firstName lastName email role'
                }
            });

        if (!task) {
            throw new AppError("Scheduled maintenance task not found.", 404);
        }

        // Authorization check
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin has full access
        } else if (task.createdByPropertyUser?.user && 
                task.createdByPropertyUser.user._id.equals(currentUser._id)) {
            // Creator can view
        } else if (task.assignedTo && 
                task.assignedToModel === 'User' && 
                task.assignedTo._id.equals(currentUser._id)) {
            // Assigned user can view
        } else {
            // Check if user is associated with the property/unit
            const userAssociations = await PropertyUser.find({
                user: currentUser._id,
                property: task.property._id,
                isActive: true
            });

            const hasManagementRole = userAssociations.some(assoc => 
                assoc.roles.some(role => [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ].includes(role))
            );

            if (hasManagementRole) {
                // Management roles can view tasks for their properties
            } else if (currentUser.role === ROLE_ENUM.TENANT && 
                    task.unit && 
                    userAssociations.some(assoc => 
                        assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && 
                        assoc.unit && 
                        assoc.unit.equals(task.unit._id))) {
                // Tenant can view if associated with the specific unit
            } else {
                throw new AppError('Not authorized to view this scheduled maintenance task.', 403);
            }
        }

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ,
            AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            task._id,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} viewed scheduled maintenance task "${task.title}".`,
                status: 'success'
            }
        );

        return task;
    } catch (error) {
        logger.error(`ScheduledMaintenanceService - Error getting task: ${error.message}`, {
            userId: currentUser?._id,
            taskId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get scheduled maintenance task: ${error.message}`, 500);
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const task = await ScheduledMaintenance.findById(taskId).session(session);
        if (!task) {
            throw new AppError("Scheduled maintenance task not found.", 404);
        }

        // Authorization: Admin, or PM/Landlord associated with the property
        const isAuthorized = await checkPropertyManagementPermission(currentUser, task.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to update this scheduled maintenance task.', 403);
        }

        // Store old task for audit log
        const oldTask = task.toObject();

        // Handle assignedTo (polymorphic) validation if provided
        if (updateData.assignedToId !== undefined && updateData.assignedToModel !== undefined) {
            if (updateData.assignedToId === null && updateData.assignedToModel === null) {
                // Allow clearing assignment
                task.assignedTo = null;
                task.assignedToModel = null;
            } else {
                if (!ASSIGNED_TO_MODEL_ENUM.includes(updateData.assignedToModel)) {
                    throw new AppError(`Invalid assignedToModel type: ${updateData.assignedToModel}. Allowed values: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}.`, 400);
                }
                
                let assigneeExists;
                if (updateData.assignedToModel === 'User') {
                    assigneeExists = await User.findById(updateData.assignedToId).session(session);
                    // Optionally validate user role if needed
                    if (assigneeExists && ![
                        ROLE_ENUM.ADMIN,
                        ROLE_ENUM.PROPERTY_MANAGER,
                        ROLE_ENUM.LANDLORD,
                        ROLE_ENUM.VENDOR
                    ].includes(assigneeExists.role)) {
                        throw new AppError(`Assigned user must have a role that can handle maintenance tasks.`, 400);
                    }
                } else if (updateData.assignedToModel === 'Vendor') {
                    assigneeExists = await Vendor.findById(updateData.assignedToId).session(session);
                }
                
                if (!assigneeExists) {
                    throw new AppError(`Assigned ${updateData.assignedToModel} not found.`, 404);
                }
                
                // Store old assignee for notifications
                const oldAssignee = task.assignedTo;
                const oldAssigneeModel = task.assignedToModel;
                
                // Update assignment
                task.assignedTo = updateData.assignedToId;
                task.assignedToModel = updateData.assignedToModel;
                
                // Notify new assignee if it's a user
                if (updateData.assignedToModel === 'User' && 
                    (!oldAssignee || !oldAssignee.equals(updateData.assignedToId) || oldAssigneeModel !== 'User')) {
                    try {
                        await notificationService.sendNotification({
                            recipientId: updateData.assignedToId,
                            type: NOTIFICATION_TYPE_ENUM.ASSIGNMENT,
                            message: `You have been assigned to scheduled maintenance: "${task.title}"`,
                            link: `${FRONTEND_URL}/scheduled-maintenance/${task._id}`,
                            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                            relatedResourceId: task._id,
                            emailDetails: {
                                subject: `New Scheduled Maintenance Assignment: ${task.title}`,
                                html: `
                                    <p>Hello ${assigneeExists.firstName || 'there'},</p>
                                    <p>You have been assigned to a scheduled maintenance task:</p>
                                    <p><strong>Title:</strong> ${task.title}</p>
                                    <p><strong>Category:</strong> ${task.category}</p>
                                    <p><strong>Scheduled Date:</strong> ${new Date(task.scheduledDate).toLocaleDateString()}</p>
                                    <p><a href="${FRONTEND_URL}/scheduled-maintenance/${task._id}">View Task</a></p>
                                `,
                                text: `You have been assigned to scheduled maintenance task: "${task.title}". View at: ${FRONTEND_URL}/scheduled-maintenance/${task._id}`
                            },
                            senderId: currentUser._id
                        }, { session });
                    } catch (notificationError) {
                        logger.warn(`Failed to send assignment notification: ${notificationError.message}`);
                        // Continue even if notification fails
                    }
                }
            }
        }

        // Handle status changes
        if (updateData.status && task.status !== updateData.status.toLowerCase()) {
            const oldStatus = task.status;
            const newStatus = updateData.status.toLowerCase();

            if (!SCHEDULED_MAINTENANCE_STATUS_ENUM.includes(newStatus)) {
                throw new AppError(`Invalid status: ${newStatus}. Allowed values: ${SCHEDULED_MAINTENANCE_STATUS_ENUM.join(', ')}`, 400);
            }

            task.status = newStatus;
            
            // Add to status history
            task.statusHistory.push({
                status: newStatus,
                changedAt: new Date(),
                changedBy: currentUser._id,
                notes: updateData.statusNotes || `Status changed from ${oldStatus} to ${newStatus}`
            });
            
            // Update lastExecutedAt if task is marked as completed
            if (newStatus === 'completed' && !task.lastExecutedAt) {
                task.lastExecutedAt = new Date();
            }
            
            // Calculate next execution date for recurring tasks
            if (newStatus === 'completed' && task.recurring) {
                task.nextDueDate = task.calculateNextDueDate();
                task.nextExecutionAttempt = task.nextDueDate;
                
                // Reset status to 'scheduled' for next occurrence
                if (task.nextDueDate) {
                    task.status = 'scheduled';
                    task.statusHistory.push({
                        status: 'scheduled',
                        changedAt: new Date(),
                        changedBy: currentUser._id,
                        notes: `Automatically scheduled next occurrence for ${task.nextDueDate.toLocaleDateString()}`
                    });
                }
            }
            
            // Notify assignee about status change
            if (task.assignedTo && task.assignedToModel === 'User') {
                const assignee = await User.findById(task.assignedTo).session(session);
                if (assignee && !assignee._id.equals(currentUser._id)) {
                    try {
                        await notificationService.sendNotification({
                            recipientId: assignee._id,
                            type: NOTIFICATION_TYPE_ENUM.STATUS_UPDATE,
                            message: `Assigned maintenance task "${task.title}" is now ${task.status}.`,
                            link: `${FRONTEND_URL}/scheduled-maintenance/${task._id}`,
                            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                            relatedResourceId: task._id,
                            emailDetails: {
                                subject: `Scheduled Maintenance Status Update: ${task.title}`,
                                html: `
                                    <p>Hello ${assignee.firstName || 'there'},</p>
                                    <p>The status of a maintenance task assigned to you has been updated:</p>
                                    <p><strong>Title:</strong> ${task.title}</p>
                                    <p><strong>New Status:</strong> ${task.status}</p>
                                    <p><a href="${FRONTEND_URL}/scheduled-maintenance/${task._id}">View Task</a></p>
                                `,
                                text: `Assigned maintenance task "${task.title}" is now ${task.status}. View at: ${FRONTEND_URL}/scheduled-maintenance/${task._id}`
                            },
                            senderId: currentUser._id
                        }, { session });
                    } catch (notificationError) {
                        logger.warn(`Failed to send status update notification: ${notificationError.message}`);
                        // Continue even if notification fails
                    }
                }
            }
        }

        // Apply other updates from updateData
        Object.keys(updateData).forEach(key => {
            if (updateData[key] !== undefined) {
                if (key === 'category') {
                    if (!CATEGORY_ENUM.includes(updateData[key].toLowerCase())) {
                        throw new AppError(`Invalid category: ${updateData[key]}. Allowed values: ${CATEGORY_ENUM.join(', ')}`, 400);
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
                        customDays: updateData[key]?.customDays || task.frequency.customDays || [],
                        endDate: updateData[key]?.endDate || task.frequency.endDate,
                        occurrences: updateData[key]?.occurrences || task.frequency.occurrences
                    };
                    
                    // If frequency changed, recalculate next due date
                    if (task.status === 'scheduled') {
                        task.nextDueDate = task.calculateNextDueDate();
                        task.nextExecutionAttempt = task.nextDueDate;
                    }
                } else if (key === 'scheduledDate') {
                    task[key] = updateData[key];
                    
                    // If scheduled date changed and task is not completed, update nextDueDate
                    if (task.status !== 'completed') {
                        task.nextDueDate = updateData[key];
                        task.nextExecutionAttempt = updateData[key];
                    }
                } else if (key !== 'assignedToId' && key !== 'assignedToModel' && key !== 'status' && key !== 'statusNotes') {
                    // Already handled special fields above
                    task[key] = updateData[key];
                }
            }
        });

        // If recurring is set to false, clear frequency and next due date
        if (updateData.recurring === false) {
            task.frequency = {};
            if (task.status !== 'completed') {
                // Keep the next due date as the scheduled date for non-recurring tasks
                task.nextDueDate = task.scheduledDate;
                task.nextExecutionAttempt = task.scheduledDate;
            }
        }

        // Save all changes
        const updatedTask = await task.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            updatedTask._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Scheduled maintenance "${updatedTask.title}" updated by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldTask,
                newValue: updatedTask.toObject()
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`ScheduledMaintenanceService: Task "${updatedTask.title}" updated by ${currentUser.email}.`);
        
        // Return populated task
        return ScheduledMaintenance.findById(updatedTask._id)
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
        
        logger.error(`ScheduledMaintenanceService - Error updating task: ${error.message}`, {
            userId: currentUser?._id,
            taskId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to update scheduled maintenance: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const task = await ScheduledMaintenance.findById(taskId).session(session);
        if (!task) {
            throw new AppError("Scheduled maintenance task not found.", 404);
        }

        // Authorization: Admin, or PM/Landlord associated with the property
        const isAuthorized = await checkPropertyManagementPermission(currentUser, task.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to delete this scheduled maintenance task.', 403);
        }

        // Check if there are active Requests generated from this schedule
        const generatedRequestsCount = await Request.countDocuments({ 
            generatedFromScheduledMaintenance: taskId,
            status: { $nin: ['completed', 'verified', 'archived'] }
        }).session(session);
        
        if (generatedRequestsCount > 0) {
            throw new AppError('Cannot delete scheduled maintenance with active associated requests. Please complete or delete the requests first.', 400);
        }

        // Store old task for audit log
        const oldTask = task.toObject();

        // Cleanup related data
        
        // 1. Delete associated comments
        await Comment.deleteMany({ 
            contextType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance, 
            contextId: taskId 
        }).session(session);
        
        logger.info(`ScheduledMaintenanceService: Deleted comments for task "${task.title}".`);

        // 2. Delete associated notifications
        await Notification.deleteMany({ 
            'relatedResource.kind': AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance, 
            'relatedResource.item': taskId 
        }).session(session);
        
        logger.info(`ScheduledMaintenanceService: Deleted notifications for task "${task.title}".`);

        // 3. Delete associated media
        if (task.media && task.media.length > 0) {
            const mediaRecords = await Media.find({ 
                _id: { $in: task.media } 
            }).session(session);
            
            for (const media of mediaRecords) {
                try {
                    // Extract public ID from media URL
                    const publicIdMatch = media.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
                    if (publicIdMatch && publicIdMatch[1]) {
                        await deleteFile(publicIdMatch[1]);
                        logger.info(`ScheduledMaintenanceService: Deleted media ${publicIdMatch[1]} from storage.`);
                    } else {
                        logger.warn(`ScheduledMaintenanceService: Could not extract public ID from media URL: ${media.url}`);
                    }
                    
                    // Delete the media record
                    await media.deleteOne({ session });
                } catch (error) {
                    logger.error(`ScheduledMaintenanceService: Failed to delete media ${media._id}: ${error.message}`);
                    // Continue with deletion even if media deletion fails
                }
            }
        }

        // 4. Update request references (set to null or update as needed)
        await Request.updateMany(
            { generatedFromScheduledMaintenance: taskId },
            { $set: { generatedFromScheduledMaintenance: null } },
            { session }
        );
        
        logger.info(`ScheduledMaintenanceService: Updated references in requests for task "${task.title}".`);

        // 5. Finally, delete the task document
        await task.deleteOne({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            taskId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Scheduled maintenance "${oldTask.title}" deleted by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldTask,
                newValue: null
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`ScheduledMaintenanceService: Task "${oldTask.title}" deleted by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`ScheduledMaintenanceService - Error deleting task: ${error.message}`, {
            userId: currentUser?._id,
            taskId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete scheduled maintenance: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const task = await ScheduledMaintenance.findById(taskId).session(session);
        if (!task) {
            throw new AppError('Scheduled maintenance task not found.', 404);
        }

        // Authorization: PM/Landlord/Admin associated with the property
        const isAuthorized = await checkPropertyManagementPermission(currentUser, task.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to enable public link for this scheduled maintenance task.', 403);
        }

        // Store old state for audit log
        const oldPublicLinkState = {
            publicLinkEnabled: task.publicLinkEnabled,
            publicLinkToken: task.publicLinkToken,
            publicLinkExpires: task.publicLinkExpires
        };

        // Generate a new token if one doesn't exist
        if (!task.publicLinkToken || !task.publicLinkEnabled) {
            task.publicLinkToken = crypto.randomBytes(24).toString('hex');
        }

        task.publicLinkEnabled = true;
        
        // Set expiration date
        if (expiresInDays) {
            task.publicLinkExpires = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
        } else if (!task.publicLinkExpires || task.publicLinkExpires < new Date()) {
            // If no expiry specified or it's already expired, set a default (e.g., 7 days)
            task.publicLinkExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }
        
        await task.save({ session });

        const publicLink = `${FRONTEND_URL}/scheduled-maintenance/public/${task.publicLinkToken}`;

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.ENABLE_PUBLIC_LINK,
            AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            task._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Public link enabled for scheduled task "${task.title}" by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldPublicLinkState,
                newValue: {
                    publicLinkEnabled: task.publicLinkEnabled,
                    publicLinkToken: task.publicLinkToken,
                    publicLinkExpires: task.publicLinkExpires
                }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`ScheduledMaintenanceService: Public link enabled for task "${task.title}" by ${currentUser.email}.`);
        
        return publicLink;
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`ScheduledMaintenanceService - Error enabling public link: ${error.message}`, {
            userId: currentUser?._id,
            taskId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to enable public link: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const task = await ScheduledMaintenance.findById(taskId).session(session);
        if (!task) {
            throw new AppError('Scheduled maintenance task not found.', 404);
        }

        // Authorization: PM/Landlord/Admin associated with the property
        const isAuthorized = await checkPropertyManagementPermission(currentUser, task.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to disable public link for this scheduled maintenance task.', 403);
        }

        // Store old state for audit log
        const oldPublicLinkState = {
            publicLinkEnabled: task.publicLinkEnabled,
            publicLinkToken: task.publicLinkToken,
            publicLinkExpires: task.publicLinkExpires
        };

        // Disable the public link
        task.publicLinkEnabled = false;
        await task.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DISABLE_PUBLIC_LINK,
            AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            task._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Public link disabled for scheduled task "${task.title}" by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldPublicLinkState,
                newValue: {
                    publicLinkEnabled: false,
                    publicLinkToken: task.publicLinkToken,
                    publicLinkExpires: task.publicLinkExpires
                }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`ScheduledMaintenanceService: Public link disabled for task "${task.title}" by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`ScheduledMaintenanceService - Error disabling public link: ${error.message}`, {
            userId: currentUser?._id,
            taskId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to disable public link: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets external (public) view of a scheduled maintenance task using a public token.
 * @param {string} publicToken - The public token for the task.
 * @returns {Promise<object>} Limited task details for public view.
 * @throws {AppError} If token is invalid, expired, or disabled.
 */
const getPublicScheduledMaintenanceView = async (publicToken) => {
    try {
        const task = await ScheduledMaintenance.findOne({
            publicLinkToken: publicToken,
            publicLinkEnabled: true,
            publicLinkExpires: { $gt: new Date() } // Must not be expired
        })
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate({
                path: 'comments',
                match: { isInternalNote: false }, // Filter out internal notes
                populate: {
                    path: 'sender',
                    select: 'firstName lastName'
                }
            })
            .populate('media');

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
            property: {
                name: task.property.name,
                address: task.property.address
            },
            unit: task.unit ? { unitName: task.unit.unitName } : null,
            media: task.media,
            comments: task.comments.map(comment => ({
                message: comment.message,
                timestamp: comment.timestamp,
                senderName: comment.sender ? 
                    `${comment.sender.firstName || ''} ${comment.sender.lastName || ''}`.trim() : 
                    comment.externalUserName || 'Unknown'
            })),
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            // Format dates for display
            scheduledDateFormatted: new Date(task.scheduledDate).toLocaleDateString(),
            lastExecutedAtFormatted: task.lastExecutedAt ? 
                new Date(task.lastExecutedAt).toLocaleDateString() : null,
            // Format enum values for display
            categoryFormatted: task.category.charAt(0).toUpperCase() + task.category.slice(1),
            statusFormatted: task.status.charAt(0).toUpperCase() + task.status.slice(1).replace(/_/g, ' ')
        };
    } catch (error) {
        logger.error(`ScheduledMaintenanceService - Error getting public task view: ${error.message}`, {
            publicToken
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get public maintenance task view: ${error.message}`, 500);
    }
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
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { status, commentMessage, name, phone } = updateData;

        // Validate required fields
        if (!name || !phone) {
            throw new AppError('Name and phone are required for accountability.', 400);
        }

        // Find the task by public token
        const task = await ScheduledMaintenance.findOne({
            publicLinkToken: publicToken,
            publicLinkEnabled: true,
            publicLinkExpires: { $gt: new Date() }
        }).session(session);

        if (!task) {
            throw new AppError('Invalid, expired, or disabled public link.', 404);
        }

        // Find or create a 'pseudo-user' for this external vendor interaction
        const pseudoEmail = `${phone.replace(/\D/g, '')}@external.vendor`;
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
            logger.info(`ScheduledMaintenanceService: Created pseudo-user for external update: ${publicUpdater.email}`);
        }

        // Update status if provided and valid
        const allowedPublicStatuses = ['in_progress', 'completed'];
        if (status) {
            const lowerStatus = status.toLowerCase();
            if (!allowedPublicStatuses.includes(lowerStatus)) {
                throw new AppError(`Invalid status for public update. Must be one of: ${allowedPublicStatuses.join(', ')}.`, 400);
            }
            
            const oldStatus = task.status;
            task.status = lowerStatus;
            
            // Add to status history
            task.statusHistory.push({
                status: lowerStatus,
                changedAt: new Date(),
                changedBy: publicUpdater._id,
                notes: `Status updated via public link by ${name} (${phone})`
            });
            
            // If status is completed, update lastExecutedAt
            if (lowerStatus === 'completed') {
                task.lastExecutedAt = new Date();
                
                // For recurring tasks, calculate next occurrence
                if (task.recurring) {
                    task.nextDueDate = task.calculateNextDueDate();
                    task.nextExecutionAttempt = task.nextDueDate;
                    
                    // Reset status to 'scheduled' for next occurrence
                    if (task.nextDueDate) {
                        task.status = 'scheduled';
                        task.statusHistory.push({
                            status: 'scheduled',
                            changedAt: new Date(),
                            changedBy: publicUpdater._id,
                            notes: `Automatically scheduled next occurrence for ${task.nextDueDate.toLocaleDateString()}`
                        });
                    }
                }
            }
            
            // Create audit log for status update
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.PUBLIC_UPDATE,
                AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                task._id,
                {
                    userId: publicUpdater._id,
                    ipAddress,
                    description: `External vendor ${name} updated scheduled task "${task.title}" status from ${oldStatus} to ${task.status}.`,
                    status: 'success',
                    oldValue: { status: oldStatus },
                    newValue: { status: task.status }
                },
                { session }
            );
            
            // Notify relevant internal users about public status update
            const propertyManagersAndLandlords = await PropertyUser.find({
                property: task.property,
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
                        message: `External vendor ${name} updated scheduled task "${task.title}" to ${lowerStatus}.`,
                        link: `${FRONTEND_URL}/scheduled-maintenance/${task._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                        relatedResourceId: task._id,
                        emailDetails: {
                            subject: `External Update: Scheduled Maintenance Status Changed`,
                            html: `
                                <p>An external vendor has updated the status of a scheduled maintenance task:</p>
                                <p><strong>Task:</strong> ${task.title}</p>
                                <p><strong>New Status:</strong> ${lowerStatus}</p>
                                <p><strong>Updated By:</strong> ${name} (${phone})</p>
                                <p><a href="${FRONTEND_URL}/scheduled-maintenance/${task._id}">View Task</a></p>
                            `,
                            text: `External vendor ${name} updated scheduled task "${task.title}" to ${lowerStatus}. View at: ${FRONTEND_URL}/scheduled-maintenance/${task._id}`
                        },
                        senderId: publicUpdater._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send status update notification: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
            
            // Also notify assignee if different from managers
            if (task.assignedTo && task.assignedToModel === 'User') {
                const assignee = await User.findById(task.assignedTo).session(session);
                
                // Check if assignee is already in the managers list
                const isManagerAlreadyNotified = propertyManagersAndLandlords.some(id => 
                    id.toString() === assignee._id.toString());
                
                if (assignee && !isManagerAlreadyNotified) {
                    try {
                        await notificationService.sendNotification({
                            recipientId: assignee._id,
                            type: NOTIFICATION_TYPE_ENUM.STATUS_UPDATE,
                            message: `External vendor ${name} updated scheduled task "${task.title}" to ${lowerStatus}.`,
                            link: `${FRONTEND_URL}/scheduled-maintenance/${task._id}`,
                            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                            relatedResourceId: task._id,
                            emailDetails: {
                                subject: `External Update: Scheduled Maintenance Status Changed`,
                                html: `
                                    <p>An external vendor has updated the status of a scheduled maintenance task you're assigned to:</p>
                                    <p><strong>Task:</strong> ${task.title}</p>
                                    <p><strong>New Status:</strong> ${lowerStatus}</p>
                                    <p><strong>Updated By:</strong> ${name} (${phone})</p>
                                    <p><a href="${FRONTEND_URL}/scheduled-maintenance/${task._id}">View Task</a></p>
                                `,
                                text: `External vendor ${name} updated scheduled task "${task.title}" to ${lowerStatus}. View at: ${FRONTEND_URL}/scheduled-maintenance/${task._id}`
                            },
                            senderId: publicUpdater._id
                        }, { session });
                    } catch (notificationError) {
                        logger.warn(`Failed to send assignee status update notification: ${notificationError.message}`);
                        // Continue even if notification fails
                    }
                }
            }
        }

        // Add comment if provided
                // Add comment if provided
        if (commentMessage) {
            const newComment = new Comment({
                contextType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                contextId: task._id,
                sender: publicUpdater._id,
                message: commentMessage,
                timestamp: new Date(),
                isInternalNote: false,
                isExternal: true,
                externalUserName: name,
                externalUserEmail: pseudoEmail
            });
            
            const savedComment = await newComment.save({ session });
            
            // Update task with comment reference
            if (!task.comments) {
                task.comments = [];
            }
            
            task.comments.push(savedComment._id);
            
            // Create audit log for comment
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.COMMENT_ADDED,
                AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                task._id,
                {
                    userId: publicUpdater._id,
                    ipAddress,
                    description: `External vendor ${name} added a comment to scheduled task "${task.title}".`,
                    status: 'success',
                    newValue: { commentId: savedComment._id, message: commentMessage }
                },
                { session }
            );
            
            // Notify relevant users about new comment
            const relevantUsers = new Set();
            
            // Add property managers and landlords
            const propertyManagers = await PropertyUser.find({
                property: task.property,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('user').session(session);
            
            propertyManagers.forEach(id => relevantUsers.add(id.toString()));
            
            // Add assignee if any
            if (task.assignedTo && task.assignedToModel === 'User') {
                relevantUsers.add(task.assignedTo.toString());
            }
            
            // Add task creator
            if (task.createdByPropertyUser) {
                const creator = await PropertyUser.findById(task.createdByPropertyUser)
                    .populate('user')
                    .session(session);
                
                if (creator && creator.user) {
                    relevantUsers.add(creator.user._id.toString());
                }
            }
            
            for (const userId of relevantUsers) {
                try {
                    const recipientUser = await User.findById(userId).session(session);
                    if (recipientUser) {
                        await notificationService.sendNotification({
                            recipientId: userId,
                            type: NOTIFICATION_TYPE_ENUM.NEW_COMMENT,
                            message: `New comment on scheduled task "${task.title}" from external vendor ${name}.`,
                            link: `${FRONTEND_URL}/scheduled-maintenance/${task._id}`,
                            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                            relatedResourceId: task._id,
                            emailDetails: {
                                subject: `New Comment on Scheduled Maintenance: ${task.title}`,
                                html: `
                                    <p>Hello ${recipientUser.firstName || 'there'},</p>
                                    <p>A new comment has been added to a scheduled maintenance task by an external vendor:</p>
                                    <p><strong>Task:</strong> ${task.title}</p>
                                    <p><strong>Vendor:</strong> ${name}</p>
                                    <p><strong>Comment:</strong> ${commentMessage}</p>
                                    <p><a href="${FRONTEND_URL}/scheduled-maintenance/${task._id}">View Task</a></p>
                                `,
                                text: `New comment on scheduled task "${task.title}" from external vendor ${name}: "${commentMessage}". View at: ${FRONTEND_URL}/scheduled-maintenance/${task._id}`
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
        const updatedTask = await task.save({ session });

        await session.commitTransaction();
        
        logger.info(`ScheduledMaintenanceService: External update to task "${updatedTask.title}" by ${name} (${phone}).`);
        
        return updatedTask;
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`ScheduledMaintenanceService - Error processing public update: ${error.message}`, {
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
 * Uploads media files to a scheduled maintenance task.
 * @param {string} taskId - The ID of the task.
 * @param {Array<object>} files - Array of file objects (from multer, containing buffer/path).
 * @param {object} currentUser - The user uploading the media.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<ScheduledMaintenance>} The updated task document.
 * @throws {AppError} If task not found, user not authorized, or no files uploaded.
 */
const uploadMediaToScheduledMaintenance = async (taskId, files, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const task = await ScheduledMaintenance.findById(taskId).session(session);
        if (!task) {
            throw new AppError('Scheduled maintenance task not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, task.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to upload media to this task.', 403);
        }

        if (!files || files.length === 0) {
            throw new AppError('No media files provided for upload.', 400);
        }

        // Store old media for audit log
        const oldMedia = task.media ? [...task.media] : [];
        const uploadedMediaIds = [];

        // Process each file
        for (const file of files) {
            try {
                const uploadResult = await uploadFile(
                    file.buffer, 
                    file.mimetype, 
                    file.originalname, 
                    'scheduled-maintenance'
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
                    relatedTo: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                    relatedId: task._id,
                    description: `Media for scheduled maintenance: ${task.title}`,
                    tags: ['scheduled-maintenance', task.category],
                    isPublic: false
                });
                
                const savedMedia = await media.save({ session });
                uploadedMediaIds.push(savedMedia._id);
            } catch (error) {
                logger.error(`ScheduledMaintenanceService - Error uploading file: ${error.message}`);
                throw new AppError(`Failed to upload file: ${error.message}`, 500);
            }
        }

        // Update task with new media
        if (!task.media) {
            task.media = [];
        }
        
        task.media = [...task.media, ...uploadedMediaIds];
        const updatedTask = await task.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.FILE_UPLOAD,
            AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            updatedTask._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `${files.length} media files uploaded to scheduled task "${updatedTask.title}" by ${currentUser.email}.`,
                status: 'success',
                oldValue: { media: oldMedia },
                newValue: { media: updatedTask.media },
                metadata: { uploadedCount: files.length }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`ScheduledMaintenanceService: ${files.length} media files uploaded to task "${updatedTask.title}" by ${currentUser.email}.`);
        
        // Return populated task
        return ScheduledMaintenance.findById(updatedTask._id)
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
        
        logger.error(`ScheduledMaintenanceService - Error uploading media: ${error.message}`, {
            userId: currentUser?._id,
            taskId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to upload media: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Deletes a media file from a scheduled maintenance task and from cloud storage.
 * @param {string} taskId - The ID of the task.
 * @param {string} mediaUrl - The URL of the media to delete.
 * @param {object} currentUser - The user performing the deletion.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<ScheduledMaintenance>} The updated task document.
 * @throws {AppError} If task not found, user not authorized, or media not found.
 */
const deleteMediaFromScheduledMaintenance = async (taskId, mediaUrl, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const task = await ScheduledMaintenance.findById(taskId).session(session);
        if (!task) {
            throw new AppError('Scheduled maintenance task not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, task.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to delete media from this task.', 403);
        }

        // Find the media by URL
        const media = await Media.findOne({ 
            url: mediaUrl,
            relatedTo: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            relatedId: task._id
        }).session(session);
        
        if (!media) {
            throw new AppError('Media not found for this task.', 404);
        }

        // Store old media for audit log
        const oldMedia = task.media ? [...task.media] : [];

        // Remove media ID from task
        if (task.media && task.media.length > 0) {
            task.media = task.media.filter(id => !id.equals(media._id));
            await task.save({ session });
        }

        // Delete from cloud storage
        try {
            const publicIdMatch = media.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
            if (publicIdMatch && publicIdMatch[1]) {
                await deleteFile(publicIdMatch[1]);
                logger.info(`ScheduledMaintenanceService: Deleted media ${publicIdMatch[1]} from storage.`);
            } else {
                logger.warn(`ScheduledMaintenanceService: Could not extract public ID from media URL: ${media.url}. Skipping cloud storage deletion.`);
            }
        } catch (error) {
            logger.error(`ScheduledMaintenanceService: Failed to delete media from cloud storage: ${error.message}`);
            // Continue with database deletion even if cloud storage deletion fails
        }

        // Delete media document
        await media.deleteOne({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.FILE_DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            task._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Media deleted from scheduled task "${task.title}" by ${currentUser.email}.`,
                status: 'success',
                oldValue: { media: oldMedia },
                newValue: { media: task.media }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`ScheduledMaintenanceService: Media deleted from task "${task.title}" by ${currentUser.email}.`);
        
        // Return populated task
        return ScheduledMaintenance.findById(task._id)
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
        
        logger.error(`ScheduledMaintenanceService - Error deleting media: ${error.message}`, {
            userId: currentUser?._id,
            taskId,
            mediaUrl
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete media: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Adds a comment to a scheduled maintenance task.
 * @param {string} taskId - The ID of the task.
 * @param {string} message - The comment message.
 * @param {boolean} isInternalNote - Whether this is an internal note (only visible to management).
 * @param {object} currentUser - The user adding the comment.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Comment>} The created comment.
 * @throws {AppError} If task not found, user not authorized, or message empty.
 */
const addCommentToScheduledMaintenance = async (taskId, message, isInternalNote, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const task = await ScheduledMaintenance.findById(taskId).session(session);
        if (!task) {
            throw new AppError('Scheduled maintenance task not found.', 404);
        }

        // Check authorization - Anyone with access to view the task can comment on it
        // For internal notes, only managers/admins can add them
        if (isInternalNote) {
            const isAuthorized = await checkPropertyManagementPermission(currentUser, task.property);
            if (!isAuthorized) {
                throw new AppError('Not authorized to add internal notes to this task.', 403);
            }
        } else {
            // For regular comments, we check if user has view access using similar logic as getScheduledMaintenanceById
            if (currentUser.role === ROLE_ENUM.ADMIN) {
                // Admin has full access
            } else if (task.createdByPropertyUser?.user && 
                    task.createdByPropertyUser.user._id.equals(currentUser._id)) {
                // Creator can comment
            } else if (task.assignedTo && 
                    task.assignedToModel === 'User' && 
                    task.assignedTo._id.equals(currentUser._id)) {
                // Assigned user can comment
            } else {
                const userAssociations = await PropertyUser.find({
                    user: currentUser._id,
                    property: task.property,
                    isActive: true
                }).session(session);

                const hasManagementRole = userAssociations.some(assoc => 
                    assoc.roles.some(role => [
                        PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                        PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                        PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                    ].includes(role))
                );

                if (hasManagementRole) {
                    // Management roles can comment on tasks for their properties
                } else if (currentUser.role === ROLE_ENUM.TENANT && 
                        task.unit && 
                        userAssociations.some(assoc => 
                            assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && 
                            assoc.unit && 
                            assoc.unit.equals(task.unit))) {
                    // Tenant can comment if associated with the specific unit
                } else {
                    throw new AppError('Not authorized to comment on this task.', 403);
                }
            }
        }

        if (!message || message.trim() === '') {
            throw new AppError('Comment message cannot be empty.', 400);
        }

        // Create the comment
        const newComment = new Comment({
            contextType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            contextId: task._id,
            sender: currentUser._id,
            message: message.trim(),
            timestamp: new Date(),
            isInternalNote: !!isInternalNote
        });
        
        const savedComment = await newComment.save({ session });
        
        // Update task with comment reference
        if (!task.comments) {
            task.comments = [];
        }
        
        task.comments.push(savedComment._id);
        await task.save({ session });
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.COMMENT_ADDED,
            AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            task._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `${isInternalNote ? 'Internal note' : 'Comment'} added to scheduled task "${task.title}" by ${currentUser.email}.`,
                status: 'success',
                newValue: { commentId: savedComment._id, message, isInternalNote }
            },
            { session }
        );
        
        // Notify relevant users (but not for internal notes, and not the commenter)
        if (!isInternalNote) {
            const relevantUsers = new Set();
            
            // For regular comments, notify:
            // 1. The task creator (if not the commenter)
            if (task.createdByPropertyUser) {
                const creator = await PropertyUser.findById(task.createdByPropertyUser)
                    .populate('user')
                    .session(session);
                
                if (creator && creator.user && !creator.user._id.equals(currentUser._id)) {
                    relevantUsers.add(creator.user._id.toString());
                }
            }
            
            // 2. The assignee (if not the commenter)
            if (task.assignedTo && 
                task.assignedToModel === 'User' && 
                !task.assignedTo.equals(currentUser._id)) {
                relevantUsers.add(task.assignedTo.toString());
            }
            
            // 3. Property managers and landlords (if not the commenter)
            const propertyManagers = await PropertyUser.find({
                property: task.property,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true,
                user: { $ne: currentUser._id } // Exclude commenter
            }).distinct('user').session(session);
            
            propertyManagers.forEach(id => relevantUsers.add(id.toString()));
            
            // Send notifications
            for (const userId of relevantUsers) {
                try {
                    const recipientUser = await User.findById(userId).session(session);
                    if (recipientUser) {
                        await notificationService.sendNotification({
                            recipientId: userId,
                            type: NOTIFICATION_TYPE_ENUM.NEW_COMMENT,
                            message: `New comment on scheduled task "${task.title}" from ${currentUser.firstName} ${currentUser.lastName}.`,
                            link: `${FRONTEND_URL}/scheduled-maintenance/${task._id}`,
                            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
                            relatedResourceId: task._id,
                            emailDetails: {
                                subject: `New Comment on Scheduled Maintenance: ${task.title}`,
                                html: `
                                    <p>Hello ${recipientUser.firstName || 'there'},</p>
                                    <p>A new comment has been added to a scheduled maintenance task:</p>
                                    <p><strong>Task:</strong> ${task.title}</p>
                                    <p><strong>From:</strong> ${currentUser.firstName} ${currentUser.lastName}</p>
                                    <p><strong>Comment:</strong> ${message}</p>
                                    <p><a href="${FRONTEND_URL}/scheduled-maintenance/${task._id}">View Task</a></p>
                                `,
                                text: `New comment on scheduled task "${task.title}" from ${currentUser.firstName} ${currentUser.lastName}: "${message}". View at: ${FRONTEND_URL}/scheduled-maintenance/${task._id}`
                            },
                            senderId: currentUser._id
                        }, { session });
                    }
                } catch (notificationError) {
                    logger.warn(`Failed to send comment notification to user ${userId}: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
        }
        
        await session.commitTransaction();
        
        logger.info(`ScheduledMaintenanceService: ${isInternalNote ? 'Internal note' : 'Comment'} added to task "${task.title}" by ${currentUser.email}.`);
        
        // Return populated comment
        return Comment.findById(savedComment._id)
            .populate('sender', 'firstName lastName email role');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`ScheduledMaintenanceService - Error adding comment: ${error.message}`, {
            userId: currentUser?._id,
            taskId,
            isInternalNote
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to add comment: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Creates a maintenance request from a scheduled maintenance task.
 * @param {string} taskId - The ID of the scheduled maintenance task.
 * @param {object} currentUser - The user creating the request.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<object>} Object containing the created request and updated task.
 * @throws {AppError} If task not found, user not authorized, or already has an active request.
 */
const createRequestFromScheduledMaintenance = async (taskId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const task = await ScheduledMaintenance.findById(taskId)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .session(session);
        
        if (!task) {
            throw new AppError('Scheduled maintenance task not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, task.property._id);
        if (!isAuthorized) {
            throw new AppError('Not authorized to create a request from this scheduled maintenance task.', 403);
        }

        // Check if there's already an active request for this task
        const existingRequest = await Request.findOne({
            generatedFromScheduledMaintenance: taskId,
            status: { $nin: ['completed', 'verified', 'archived'] }
        }).session(session);

        if (existingRequest) {
            throw new AppError('This scheduled maintenance task already has an active request associated with it.', 400);
        }

        // Find or create PropertyUser reference for request creator
        let createdByPropertyUser = await PropertyUser.findOne({
            user: currentUser._id,
            property: task.property._id,
            isActive: true
        }).session(session);
        
        if (!createdByPropertyUser) {
            // Create new PropertyUser association
            createdByPropertyUser = new PropertyUser({
                user: currentUser._id,
                property: task.property._id,
                unit: task.unit?._id || null,
                roles: [currentUser.role === ROLE_ENUM.TENANT ? 
                    PROPERTY_USER_ROLES_ENUM.TENANT : 
                    PROPERTY_USER_ROLES_ENUM.USER],
                isActive: true
            });
            
            await createdByPropertyUser.save({ session });
        }

        // Copy media from scheduled maintenance to request
        const mediaIds = task.media || [];

        // Create new request based on scheduled maintenance task
        const newRequest = new Request({
            title: `Scheduled: ${task.title}`,
            description: task.description,
            category: task.category,
            priority: 'medium', // Default priority for scheduled tasks
            media: mediaIds,
            status: 'new',
            property: task.property._id,
            unit: task.unit?._id || null,
            createdByPropertyUser: createdByPropertyUser._id,
            assignedTo: task.assignedTo,
            assignedToModel: task.assignedToModel,
            assignedByPropertyUser: createdByPropertyUser._id,
            assignedAt: task.assignedTo ? new Date() : null,
            generatedFromScheduledMaintenance: task._id,
            statusHistory: [{
                status: 'new',
                changedAt: new Date(),
                changedBy: currentUser._id,
                notes: `Request created from scheduled maintenance task: ${task.title}`
            }]
        });

        // If request has an assignee, add assigned status to history
        if (task.assignedTo) {
            newRequest.status = 'assigned';
            newRequest.statusHistory.push({
                status: 'assigned',
                changedAt: new Date(),
                changedBy: currentUser._id,
                notes: 'Automatically assigned based on scheduled maintenance settings'
            });
        }

        const createdRequest = await newRequest.save({ session });

        // Update the scheduled maintenance task with reference to the request and mark as in progress
        task.lastGeneratedRequest = createdRequest._id;
        if (task.status === 'scheduled') {
            task.status = 'in_progress';
            task.statusHistory.push({
                status: 'in_progress',
                changedAt: new Date(),
                changedBy: currentUser._id,
                notes: 'Status updated when maintenance request was created'
            });
        }
        
        const updatedTask = await task.save({ session });

        // Create audit logs
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.Request,
            createdRequest._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Request "${createdRequest.title}" created from scheduled maintenance by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    scheduledMaintenanceId: task._id,
                    category: createdRequest.category,
                    mediaCount: mediaIds.length
                },
                newValue: createdRequest.toObject()
            },
            { session }
        );

        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            updatedTask._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Scheduled maintenance "${updatedTask.title}" updated to reference new request by ${currentUser.email}.`,
                status: 'success',
                oldValue: { lastGeneratedRequest: task.lastGeneratedRequest, status: task.status },
                newValue: { lastGeneratedRequest: updatedTask.lastGeneratedRequest, status: updatedTask.status }
            },
            { session }
        );

        // Notify assignee if request is assigned
        if (newRequest.assignedTo && newRequest.assignedToModel === 'User') {
            try {
                const assignee = await User.findById(newRequest.assignedTo).session(session);
                if (assignee && !assignee._id.equals(currentUser._id)) {
                    await notificationService.sendNotification({
                        recipientId: assignee._id,
                        type: NOTIFICATION_TYPE_ENUM.ASSIGNMENT,
                        message: `You have been assigned to maintenance request: "${createdRequest.title}"`,
                        link: `${FRONTEND_URL}/requests/${createdRequest._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                        relatedResourceId: createdRequest._id,
                        emailDetails: {
                            subject: `New Maintenance Request Assignment: ${createdRequest.title}`,
                            html: `
                                <p>Hello ${assignee.firstName || 'there'},</p>
                                <p>You have been assigned to a maintenance request created from a scheduled task:</p>
                                <p><strong>Title:</strong> ${createdRequest.title}</p>
                                <p><strong>Property:</strong> ${task.property.name}</p>
                                <p><strong>Category:</strong> ${createdRequest.category}</p>
                                <p><a href="${FRONTEND_URL}/requests/${createdRequest._id}">View Request</a></p>
                            `,
                            text: `You have been assigned to maintenance request: "${createdRequest.title}" created from scheduled maintenance. View at: ${FRONTEND_URL}/requests/${createdRequest._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                }
            } catch (notificationError) {
                logger.warn(`Failed to send assignment notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        // Notify property managers and landlords
        const propertyManagersAndLandlords = await PropertyUser.find({
            property: task.property._id,
            roles: { $in: [
                PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
                PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
            ]},
            isActive: true
        }).distinct('user').session(session);

        for (const managerId of propertyManagersAndLandlords) {
            if (managerId.toString() !== currentUser._id.toString()) { // Don't notify creator
                try {
                    await notificationService.sendNotification({
                        recipientId: managerId,
                        type: NOTIFICATION_TYPE_ENUM.NEW_REQUEST,
                        message: `New request from scheduled maintenance: ${createdRequest.title}`,
                        link: `${FRONTEND_URL}/requests/${createdRequest._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
                        relatedResourceId: createdRequest._id,
                        emailDetails: {
                            subject: `New Maintenance Request from Scheduled Task: ${createdRequest.title}`,
                            html: `
                                <p>A new maintenance request has been created from a scheduled task:</p>
                                <p><strong>Title:</strong> ${createdRequest.title}</p>
                                <p><strong>Property:</strong> ${task.property.name}</p>
                                <p><strong>Category:</strong> ${createdRequest.category}</p>
                                <p><a href="${FRONTEND_URL}/requests/${createdRequest._id}">View Request</a></p>
                            `,
                            text: `New maintenance request from scheduled task: ${createdRequest.title}. View at: ${FRONTEND_URL}/requests/${createdRequest._id}`
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
        
        logger.info(`ScheduledMaintenanceService: Request "${createdRequest.title}" created from scheduled maintenance "${task.title}" by ${currentUser.email}.`);
        
        // Return both the created request and updated task
        const populatedRequest = await Request.findById(createdRequest._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('createdByPropertyUser')
            .populate({
                path: 'assignedTo',
                refPath: 'assignedToModel',
                select: 'firstName lastName email name phone'
            })
            .populate('media');
            
        return {
            request: populatedRequest,
            task: updatedTask
        };
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`ScheduledMaintenanceService - Error creating request from scheduled maintenance: ${error.message}`, {
            userId: currentUser?._id,
            taskId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to create request from scheduled maintenance: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    uploadMediaToScheduledMaintenance,
    deleteMediaFromScheduledMaintenance,
    addCommentToScheduledMaintenance,
    createRequestFromScheduledMaintenance
};