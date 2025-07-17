// src/services/publicService.js

const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance'); // For future expansion
const Comment = require('../models/comment');
const Property = require('../models/property'); // Needed for property details
const Unit = require('../models/unit'); // Needed for unit details
const User = require('../models/user'); // Needed for sender/assignee details
const PropertyUser = require('../models/propertyUser'); // For finding property managers/landlords to notify

const { createAuditLog } = require('./auditService');
const { createInAppNotification } = require('./notificationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM,
    PROPERTY_USER_ROLES_ENUM
} = require('../utils/constants/enums');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Fetches a maintenance request via its public link token.
 * Returns a sanitized view of the request for public consumption.
 * @param {string} publicToken - The unique public token for the request.
 * @param {string} ipAddress - IP address of the request for audit logging.
 * @param {string} userAgent - User-Agent string of the client for audit logging.
 * @returns {Promise<object>} Sanitized public view of the request.
 * @throws {AppError} If public link is invalid, expired, or request not found.
 */
const getPublicRequest = async (publicToken, ipAddress, userAgent) => {
    const request = await Request.findOne({
        publicToken: publicToken,
        publicLinkEnabled: true,
        publicLinkExpiresAt: { $gt: new Date() } // Link must not be expired
    })
    .populate('property', 'name address')
    .populate('unit', 'unitName')
    .populate({
        path: 'comments',
        match: { isInternalNote: false }, // Only show non-internal comments for public view
        populate: {
            path: 'sender',
            select: 'firstName lastName' // Populate sender for internal comments
        }
    })
    .populate({
        path: 'assignedTo',
        select: 'firstName lastName email name contactPerson', // Can be User or Vendor
    });

    if (!request) {
        throw new AppError('Public link invalid, expired, or request not found.', 404);
    }

    // Sanitize the assignedTo field for public view
    let assignedToName = null;
    if (request.assignedTo) {
        if (request.assignedTo.firstName && request.assignedTo.lastName) {
            assignedToName = `${request.assignedTo.firstName} ${request.assignedTo.lastName}`;
        } else if (request.assignedTo.name) { // For Vendors
            assignedToName = request.assignedTo.name;
        } else if (request.assignedTo.contactPerson) { // For Vendors with contactPerson
            assignedToName = request.assignedTo.contactPerson;
        }
    }

    // Sanitize comments for public view
    const sanitizedComments = request.comments.map(comment => ({
        _id: comment._id,
        message: comment.message,
        createdAt: comment.createdAt,
        isExternal: comment.isExternal,
        externalUserName: comment.isExternal ? comment.externalUserName : null,
        // For internal users, only show their first and last name, not full email/ID
        senderName: !comment.isExternal && comment.sender ? `${comment.sender.firstName} ${comment.sender.lastName}`.trim() : null,
    }));

    // Construct the public view object, explicitly selecting allowed fields
    const publicRequestView = {
        _id: request._id,
        title: request.title,
        description: request.description,
        status: request.status,
        category: request.category,
        priority: request.priority,
        property: request.property ? { name: request.property.name, address: request.property.address } : null,
        unit: request.unit ? { unitName: request.unit.unitName } : null,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        assignedToName: assignedToName,
        comments: sanitizedComments,
        // Add other fields you deem safe for public viewing.
        // DO NOT include createdBy, media direct URLs (if you want to control access), etc.
    };

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ,
        user: null, // No authenticated user for public access
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        resourceId: request._id,
        ipAddress: ipAddress,
        userAgent: userAgent,
        externalUserIdentifier: publicToken, // Identify by public token
        description: `Public request "${request.title}" viewed via public link.`,
        status: 'success',
        metadata: { publicToken }
    });

    logger.info(`PublicService: Public request "${request.title}" viewed via token ${publicToken}.`);
    return publicRequestView;
};

/**
 * Adds a comment to a request via its public link.
 * @param {string} publicToken - The unique public token for the request.
 * @param {object} commentData - Data for the new comment (message, externalUserName, externalUserEmail).
 * @param {string} ipAddress - IP address of the request.
 * @param {string} userAgent - User-Agent string of the client.
 * @returns {Promise<Comment>} The created comment document.
 * @throws {AppError} If public link is invalid/expired, request not found, or validation fails.
 */
const addPublicCommentToRequest = async (publicToken, commentData, ipAddress, userAgent) => {
    const { message, externalUserName, externalUserEmail } = commentData;

    const request = await Request.findOne({
        publicToken: publicToken,
        publicLinkEnabled: true,
        publicLinkExpiresAt: { $gt: new Date() } // Link must not be expired
    });

    if (!request) {
        throw new AppError('Public link invalid, expired, or request not found.', 404);
    }

    const newComment = new Comment({
        contextType: AUDIT_RESOURCE_TYPE_ENUM.Request,
        contextId: request._id,
        sender: null, // No internal sender for external comments
        message: message,
        isExternal: true,
        externalUserName: externalUserName,
        externalUserEmail: externalUserEmail,
        isInternalNote: false, // Public comments are never internal notes
    });

    const createdComment = await newComment.save();

    // Notify relevant internal users about the new public comment
    const relevantUserIds = new Set();

    // 1. Notify the creator of the request
    if (request.createdBy) {
        relevantUserIds.add(request.createdBy.toString());
    }
    // 2. Notify the assigned user/vendor
    if (request.assignedTo) {
        relevantUserIds.add(request.assignedTo.toString());
    }

    // 3. Notify Landlords and Property Managers associated with this property
    // Find PropertyUsers for the property with relevant roles
    const propertyManagementUsers = await PropertyUser.find({
        property: request.property,
        isActive: true,
        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
    }).distinct('user');

    propertyManagementUsers.forEach(userId => relevantUserIds.add(userId.toString()));

    // Send notifications to unique recipients
    for (const recipientId of Array.from(relevantUserIds)) {
        await createInAppNotification(
            recipientId,
            NOTIFICATION_TYPE_ENUM.find(t => t === 'new_comment'),
            `New public comment on request "${request.title}" from ${externalUserName}.`,
            { kind: AUDIT_RESOURCE_TYPE_ENUM.Request, item: request._id },
            `${FRONTEND_URL}/requests/${request._id}`, // Link to internal view of the request
            { commentId: createdComment._id, externalUserName: externalUserName },
            null // No internal sender
        );
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE,
        user: null, // No authenticated user for public access
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
        resourceId: createdComment._id,
        newValue: createdComment.toObject(),
        ipAddress: ipAddress,
        userAgent: userAgent,
        externalUserIdentifier: `${externalUserName} (${externalUserEmail})`,
        description: `Public comment added to request "${request.title}" by ${externalUserName}.`,
        status: 'success',
        metadata: { requestId: request._id, requestTitle: request.title }
    });

    logger.info(`PublicService: Public comment added to request "${request.title}" by ${externalUserName}.`);
    return createdComment;
};

/**
 * Fetches a scheduled maintenance task via its public link token.
 * @param {string} publicToken - The unique public token for the scheduled maintenance.
 * @param {string} ipAddress - IP address of the request for audit logging.
 * @param {string} userAgent - User-Agent string of the client for audit logging.
 * @returns {Promise<object>} Sanitized public view of the scheduled maintenance.
 * @throws {AppError} If public link is invalid, expired, or task not found.
 */
const getPublicScheduledMaintenance = async (publicToken, ipAddress, userAgent) => {
    const maintenance = await ScheduledMaintenance.findOne({
        publicLinkToken: publicToken, // Note: Schema uses publicLinkToken
        publicLinkEnabled: true,
        publicLinkExpires: { $gt: new Date() } // Note: Schema uses publicLinkExpires
    })
    .populate('property', 'name address')
    .populate('unit', 'unitName')
    .populate({
        path: 'comments',
        match: { isInternalNote: false }, // Only show non-internal comments for public view
        populate: {
            path: 'sender',
            select: 'firstName lastName' // Populate sender for internal comments
        }
    })
    .populate({
        path: 'assignedTo', // Can be User or Vendor
        select: 'firstName lastName email name contactPerson',
    });

    if (!maintenance) {
        throw new AppError('Public link invalid, expired, or scheduled maintenance not found.', 404);
    }

    // Sanitize the assignedTo field for public view
    let assignedToName = null;
    if (maintenance.assignedTo) {
        if (maintenance.assignedTo.firstName && maintenance.assignedTo.lastName) {
            assignedToName = `${maintenance.assignedTo.firstName} ${maintenance.assignedTo.lastName}`;
        } else if (maintenance.assignedTo.name) { // For Vendors
            assignedToName = maintenance.assignedTo.name;
        } else if (maintenance.assignedTo.contactPerson) { // For Vendors with contactPerson
            assignedToName = maintenance.assignedTo.contactPerson;
        }
    }

    // Sanitize comments for public view
    const sanitizedComments = maintenance.comments.map(comment => ({
        _id: comment._id,
        message: comment.message,
        createdAt: comment.createdAt,
        isExternal: comment.isExternal,
        externalUserName: comment.isExternal ? comment.externalUserName : null,
        senderName: !comment.isExternal && comment.sender ? `${comment.sender.firstName} ${comment.sender.lastName}`.trim() : null,
    }));

    const publicMaintenanceView = {
        _id: maintenance._id,
        title: maintenance.title,
        description: maintenance.description,
        category: maintenance.category,
        status: maintenance.status,
        scheduledDate: maintenance.scheduledDate,
        recurring: maintenance.recurring,
        frequency: maintenance.frequency,
        property: maintenance.property ? { name: maintenance.property.name, address: maintenance.property.address } : null,
        unit: maintenance.unit ? { unitName: maintenance.unit.unitName } : null,
        createdAt: maintenance.createdAt,
        updatedAt: maintenance.updatedAt,
        assignedToName: assignedToName,
        comments: sanitizedComments,
        // Add other fields deemed safe for public viewing
    };

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ,
        user: null,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
        resourceId: maintenance._id,
        ipAddress: ipAddress,
        userAgent: userAgent,
        externalUserIdentifier: publicToken,
        description: `Public scheduled maintenance "${maintenance.title}" viewed via public link.`,
        status: 'success',
        metadata: { publicToken }
    });

    logger.info(`PublicService: Public scheduled maintenance "${maintenance.title}" viewed via token ${publicToken}.`);
    return publicMaintenanceView;
};

/**
 * Adds a comment to a scheduled maintenance task via its public link.
 * @param {string} publicToken - The unique public token for the scheduled maintenance.
 * @param {object} commentData - Data for the new comment (message, externalUserName, externalUserEmail).
 * @param {string} ipAddress - IP address of the request.
 * @param {string} userAgent - User-Agent string of the client.
 * @returns {Promise<Comment>} The created comment document.
 * @throws {AppError} If public link is invalid/expired, task not found, or validation fails.
 */
const addPublicCommentToScheduledMaintenance = async (publicToken, commentData, ipAddress, userAgent) => {
    const { message, externalUserName, externalUserEmail } = commentData;

    const maintenance = await ScheduledMaintenance.findOne({
        publicLinkToken: publicToken,
        publicLinkEnabled: true,
        publicLinkExpires: { $gt: new Date() }
    });

    if (!maintenance) {
        throw new AppError('Public link invalid, expired, or scheduled maintenance not found.', 404);
    }

    const newComment = new Comment({
        contextType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
        contextId: maintenance._id,
        sender: null,
        message: message,
        isExternal: true,
        externalUserName: externalUserName,
        externalUserEmail: externalUserEmail,
        isInternalNote: false,
    });

    const createdComment = await newComment.save();

    // Notify relevant internal users about the new public comment
    const relevantUserIds = new Set();
    if (maintenance.createdBy) {
        relevantUserIds.add(maintenance.createdBy.toString());
    }
    if (maintenance.assignedTo) {
        relevantUserIds.add(maintenance.assignedTo.toString());
    }

    const propertyManagementUsers = await PropertyUser.find({
        property: maintenance.property,
        isActive: true,
        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
    }).distinct('user');

    propertyManagementUsers.forEach(userId => relevantUserIds.add(userId.toString()));

    for (const recipientId of Array.from(relevantUserIds)) {
        await createInAppNotification(
            recipientId,
            NOTIFICATION_TYPE_ENUM.find(t => t === 'new_comment'),
            `New public comment on scheduled task "${maintenance.title}" from ${externalUserName}.`,
            { kind: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance, item: maintenance._id },
            `${FRONTEND_URL}/scheduled-maintenance/${maintenance._id}`,
            { commentId: createdComment._id, externalUserName: externalUserName },
            null
        );
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE,
        user: null,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
        resourceId: createdComment._id,
        newValue: createdComment.toObject(),
        ipAddress: ipAddress,
        userAgent: userAgent,
        externalUserIdentifier: `${externalUserName} (${externalUserEmail})`,
        description: `Public comment added to scheduled maintenance "${maintenance.title}" by ${externalUserName}.`,
        status: 'success',
        metadata: { maintenanceId: maintenance._id, maintenanceTitle: maintenance.title }
    });

    logger.info(`PublicService: Public comment added to scheduled maintenance "${maintenance.title}" by ${externalUserName}.`);
    return createdComment;
};


module.exports = {
    getPublicRequest,
    addPublicCommentToRequest,
    getPublicScheduledMaintenance,
    addPublicCommentToScheduledMaintenance,
};
