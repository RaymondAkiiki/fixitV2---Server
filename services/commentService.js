// src/services/commentService.js

const Comment = require('../models/comment');
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Property = require('../models/property');
const Unit = require('../models/unit');
const User = require('../models/user');
const PropertyUser = require('../models/propertyUser');
const { createAuditLog } = require('./auditService');
const { createInAppNotification } = require('./notificationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM
} = require('../utils/constants/enums');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Helper to determine if a user has access to a given resource context for commenting.
 * This function centralizes the complex authorization logic.
 * @param {object} user - The authenticated user object (from req.user).
 * @param {string} contextType - The type of resource (e.g., 'Request', 'ScheduledMaintenance', 'Property', 'Unit').
 * @param {string} contextId - The ID of the resource.
 * @param {string} accessType - 'read' or 'write' (for adding/editing comments).
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 * @throws {AppError} If context not found.
 */
const checkCommentAccess = async (user, contextType, contextId, accessType = 'read') => {
    if (user.role === ROLE_ENUM.ADMIN) {
        return true; // Admin has global access
    }

    let contextDocument;
    let resourcePropertyId;
    let resourceUnitId;

    const lowercaseContextType = contextType.toLowerCase();

    // Fetch the context document and determine its associated property/unit
    switch (lowercaseContextType) {
        case AUDIT_RESOURCE_TYPE_ENUM.find(t => t === 'request'):
            contextDocument = await Request.findById(contextId).populate('property unit');
            if (contextDocument) {
                resourcePropertyId = contextDocument.property?._id;
                resourceUnitId = contextDocument.unit?._id;
            }
            break;
        case AUDIT_RESOURCE_TYPE_ENUM.find(t => t === 'scheduledmaintenance'):
            contextDocument = await ScheduledMaintenance.findById(contextId).populate('property unit');
            if (contextDocument) {
                resourcePropertyId = contextDocument.property?._id;
                resourceUnitId = contextDocument.unit?._id;
            }
            break;
        case AUDIT_RESOURCE_TYPE_ENUM.find(t => t === 'property'):
            contextDocument = await Property.findById(contextId);
            if (contextDocument) {
                resourcePropertyId = contextDocument._id;
                resourceUnitId = null; // Property-level comment
            }
            break;
        case AUDIT_RESOURCE_TYPE_ENUM.find(t => t === 'unit'):
            contextDocument = await Unit.findById(contextId).populate('property');
            if (contextDocument) {
                resourcePropertyId = contextDocument.property?._id;
                resourceUnitId = contextDocument._id;
            }
            break;
        default:
            throw new AppError('Invalid context type for comment operations.', 400);
    }

    if (!contextDocument) {
        throw new AppError(`${contextType} not found.`, 404);
    }

    // Check if user is the creator or assigned to the context (for Request/ScheduledMaintenance)
    if (['request', 'scheduledmaintenance'].includes(lowercaseContextType)) {
        if (contextDocument.createdBy && contextDocument.createdBy.equals(user._id)) {
            return true;
        }
        if (contextDocument.assignedTo && contextDocument.assignedTo.equals(user._id)) {
            return true;
        }
    }

    // Check user's PropertyUser associations
    const userAssociations = await PropertyUser.find({
        user: user._id,
        property: resourcePropertyId,
        isActive: true
    });

    // Landlord or Property Manager for the property
    if (userAssociations.some(assoc => [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS].some(role => assoc.roles.includes(role)))) {
        return true;
    }

    // Tenant of the specific unit (if context is unit-specific or tenant-created request)
    if (resourceUnitId && userAssociations.some(assoc => assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && assoc.unit && assoc.unit.equals(resourceUnitId))) {
        return true;
    }

    // Tenant of any unit within the property (for property-level comments, or if their request is property-level)
    if (!resourceUnitId && userAssociations.some(assoc => assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT))) {
        return true;
    }

    return false;
};

/**
 * Adds a comment to a specific resource context.
 * @param {object} commentData - Data for the new comment (contextType, contextId, message, isExternal, externalUserName, externalUserEmail, isInternalNote, media).
 * @param {object} currentUser - The user adding the comment.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Comment>} The created comment document.
 * @throws {AppError} If context not found, user not authorized, or validation fails.
 */
const addComment = async (commentData, currentUser, ipAddress) => {
    const { contextType, contextId, message, isExternal, externalUserName, externalUserEmail, isInternalNote, media } = commentData;

    // Authorization check for 'write' access
    const isAuthorized = await checkCommentAccess(currentUser, contextType, contextId, 'write');
    if (!isAuthorized) {
        throw new AppError('Not authorized to add comments to this resource.', 403);
    }

    const newComment = new Comment({
        contextType: contextType.toLowerCase(),
        contextId,
        sender: isExternal ? null : currentUser._id, // Sender is null if external
        message,
        isExternal: isExternal || false,
        externalUserName: isExternal ? externalUserName : null,
        externalUserEmail: isExternal ? externalUserEmail : null,
        isInternalNote: isInternalNote || false,
        media: media || [] // Array of Media ObjectIds
    });

    const createdComment = await newComment.save();

    // Notify relevant parties about the new comment
    // This logic can be expanded based on specific notification requirements
    let contextDocument;
    let relevantUsers = []; // Users to notify

    switch (contextType.toLowerCase()) {
        case AUDIT_RESOURCE_TYPE_ENUM.find(t => t === 'request'):
            contextDocument = await Request.findById(contextId).populate('createdBy assignedTo');
            if (contextDocument.createdBy && !contextDocument.createdBy.equals(currentUser._id)) {
                relevantUsers.push(contextDocument.createdBy); // Notify creator if not the sender
            }
            if (contextDocument.assignedTo && !contextDocument.assignedTo.equals(currentUser._id)) {
                relevantUsers.push(contextDocument.assignedTo); // Notify assigned if not the sender
            }
            break;
        case AUDIT_RESOURCE_TYPE_ENUM.find(t => t === 'scheduledmaintenance'):
            contextDocument = await ScheduledMaintenance.findById(contextId).populate('createdBy assignedTo');
            if (contextDocument.createdBy && !contextDocument.createdBy.equals(currentUser._id)) {
                relevantUsers.push(contextDocument.createdBy);
            }
            if (contextDocument.assignedTo && !contextDocument.assignedTo.equals(currentUser._id)) {
                relevantUsers.push(contextDocument.assignedTo);
            }
            break;
        case AUDIT_RESOURCE_TYPE_ENUM.find(t => t === 'property'):
            contextDocument = await Property.findById(contextId);
            // Notify all landlords/PMs/tenants associated with this property
            const propertyUsers = await PropertyUser.find({ property: contextId, isActive: true }).distinct('user');
            const users = await User.find({ _id: { $in: propertyUsers } });
            relevantUsers.push(...users.filter(u => !u._id.equals(currentUser._id)));
            break;
        case AUDIT_RESOURCE_TYPE_ENUM.find(t => t === 'unit'):
            contextDocument = await Unit.findById(contextId).populate('property');
            // Notify all landlords/PMs/tenants associated with this unit/property
            const unitPropertyUsers = await PropertyUser.find({ $or: [{ unit: contextId }, { property: contextDocument.property }], isActive: true }).distinct('user');
            const unitUsers = await User.find({ _id: { $in: unitPropertyUsers } });
            relevantUsers.push(...unitUsers.filter(u => !u._id.equals(currentUser._id)));
            break;
    }

    const commentLink = `${FRONTEND_URL}/${contextType.toLowerCase()}s/${contextId}`; // Generic link

    for (const userToNotify of relevantUsers) {
        await createInAppNotification(
            userToNotify._id,
            NOTIFICATION_TYPE_ENUM.find(t => t === 'new_comment'),
            `New comment on ${contextType} "${contextDocument.title || contextDocument.name || contextDocument.unitName}". Message: "${message.substring(0, 100)}..."`,
            { kind: contextType, item: contextId },
            commentLink,
            { commentId: createdComment._id, senderName: currentUser.firstName || currentUser.email },
            currentUser._id
        );
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
        resourceId: createdComment._id,
        newValue: createdComment.toObject(),
        ipAddress: ipAddress,
        description: `Comment added to ${contextType} ${contextId} by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`CommentService: Comment added to ${contextType} ${contextId} by ${currentUser.email}.`);
    return createdComment;
};

/**
 * Lists comments for a specific resource context.
 * @param {string} contextType - The type of resource.
 * @param {string} contextId - The ID of the resource.
 * @param {object} currentUser - The user requesting the comments.
 * @returns {Promise<Array<Comment>>} Array of comment documents.
 * @throws {AppError} If context not found or user not authorized.
 */
const listComments = async (contextType, contextId, currentUser) => {
    // Authorization check for 'read' access
    const isAuthorized = await checkCommentAccess(currentUser, contextType, contextId, 'read');
    if (!isAuthorized) {
        throw new AppError('Not authorized to view comments for this resource.', 403);
    }

    const lowercaseContextType = contextType.toLowerCase();

    const comments = await Comment.find({
        contextType: lowercaseContextType,
        contextId
    })
        .populate('sender', 'firstName lastName email role') // Populate sender details
        .populate('media') // Populate associated media documents
        .sort({ createdAt: 1 }); // Oldest comments first

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ_ALL,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} listed comments for ${contextType} ${contextId}.`,
        status: 'success',
        metadata: { contextType, contextId }
    });

    return comments;
};

/**
 * Updates a specific comment.
 * @param {string} commentId - The ID of the comment to update.
 * @param {object} updateData - Data to update the comment with (message, isInternalNote, media).
 * @param {object} currentUser - The user updating the comment.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Comment>} The updated comment document.
 * @throws {AppError} If comment not found, user not authorized, or validation fails.
 */
const updateComment = async (commentId, updateData, currentUser, ipAddress) => {
    const comment = await Comment.findById(commentId);
    if (!comment) {
        throw new AppError('Comment not found.', 404);
    }

    // Authorization: Only the sender of the comment or an Admin can update
    if (!comment.sender || !comment.sender.equals(currentUser._id) && currentUser.role !== ROLE_ENUM.ADMIN) {
        throw new AppError('Not authorized to update this comment.', 403);
    }

    const oldComment = comment.toObject(); // Capture old state for audit log

    // Apply updates
    if (updateData.message !== undefined) comment.message = updateData.message;
    if (updateData.isInternalNote !== undefined) comment.isInternalNote = updateData.isInternalNote;
    if (updateData.media !== undefined) comment.media = updateData.media; // Assuming media is an array of IDs

    const updatedComment = await comment.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
        resourceId: updatedComment._id,
        oldValue: oldComment,
        newValue: updatedComment.toObject(),
        ipAddress: ipAddress,
        description: `Comment ${updatedComment._id} updated by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`CommentService: Comment ${updatedComment._id} updated by ${currentUser.email}.`);
    return updatedComment;
};

/**
 * Deletes a specific comment.
 * @param {string} commentId - The ID of the comment to delete.
 * @param {object} currentUser - The user deleting the comment.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If comment not found, user not authorized.
 */
const deleteComment = async (commentId, currentUser, ipAddress) => {
    const commentToDelete = await Comment.findById(commentId);
    if (!commentToDelete) {
        throw new AppError('Comment not found.', 404);
    }

    // Authorization: Only the sender of the comment or an Admin can delete
    if (!commentToDelete.sender || !commentToDelete.sender.equals(currentUser._id) && currentUser.role !== ROLE_ENUM.ADMIN) {
        throw new AppError('Not authorized to delete this comment.', 403);
    }

    const oldComment = commentToDelete.toObject(); // Capture old state for audit log

    // Delete associated media files if any
    if (commentToDelete.media && commentToDelete.media.length > 0) {
        for (const mediaId of commentToDelete.media) {
            try {
                const mediaDoc = await Media.findById(mediaId);
                if (mediaDoc) {
                    const publicIdMatch = mediaDoc.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
                    if (publicIdMatch && publicIdMatch[1]) {
                        const publicId = publicIdMatch[1];
                        await deleteFile(publicId); // Delete from Cloudinary
                        logger.info(`CommentService: Deleted media ${publicId} from Cloudinary for comment ${commentId}.`);
                    }
                    await mediaDoc.deleteOne(); // Delete Media document
                    logger.info(`CommentService: Deleted Media document for comment media ${mediaDoc._id}.`);
                }
            } catch (error) {
                logger.error(`CommentService: Failed to delete media for comment ${commentId}, media ${mediaId}: ${error.message}`);
                // Log error but don't block the main operation
            }
        }
    }

    await commentToDelete.deleteOne();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
        resourceId: commentId,
        oldValue: oldComment,
        newValue: null,
        ipAddress: ipAddress,
        description: `Comment ${oldComment._id} deleted by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`CommentService: Comment ${oldComment._id} deleted by ${currentUser.email}.`);
};

module.exports = {
    addComment,
    listComments,
    updateComment,
    deleteComment,
};
