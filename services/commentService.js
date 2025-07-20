// src/services/commentService.js

const mongoose = require('mongoose');
const Comment = require('../models/comment');
const Media = require('../models/media');
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Property = require('../models/property');
const Unit = require('../models/unit');
const User = require('../models/user');
const PropertyUser = require('../models/propertyUser');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const mediaService = require('./mediaService');
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
 * Helper to determine if a user has access to a given resource context for commenting
 * @param {Object} user - The authenticated user
 * @param {string} contextType - Resource type (e.g., 'Request', 'Property')
 * @param {string} contextId - Resource ID
 * @param {string} accessType - 'read' or 'write' permission
 * @returns {Promise<boolean>} True if authorized
 * @throws {AppError} If context not found or invalid
 */
const checkCommentAccess = async (user, contextType, contextId, accessType = 'read') => {
    if (!user) {
        return false;
    }
    
    if (user.role === ROLE_ENUM.ADMIN) {
        return true; // Admin has global access
    }

    let contextDocument;
    let resourcePropertyId;
    let resourceUnitId;

    const lowercaseContextType = contextType.toLowerCase();

    // Fetch the context document and determine its associated property/unit
    switch (lowercaseContextType) {
        case 'request':
            contextDocument = await Request.findById(contextId).populate('property unit');
            if (contextDocument) {
                resourcePropertyId = contextDocument.property?._id || contextDocument.property;
                resourceUnitId = contextDocument.unit?._id || contextDocument.unit;
            }
            break;
            
        case 'scheduledmaintenance':
            contextDocument = await ScheduledMaintenance.findById(contextId).populate('property unit');
            if (contextDocument) {
                resourcePropertyId = contextDocument.property?._id || contextDocument.property;
                resourceUnitId = contextDocument.unit?._id || contextDocument.unit;
            }
            break;
            
        case 'property':
            contextDocument = await Property.findById(contextId);
            if (contextDocument) {
                resourcePropertyId = contextDocument._id;
                resourceUnitId = null; // Property-level comment
            }
            break;
            
        case 'unit':
            contextDocument = await Unit.findById(contextId).populate('property');
            if (contextDocument) {
                resourcePropertyId = contextDocument.property?._id || contextDocument.property;
                resourceUnitId = contextDocument._id;
            }
            break;
            
        default:
            throw new AppError(`Invalid context type for comment operations: ${contextType}`, 400);
    }

    if (!contextDocument) {
        throw new AppError(`${contextType} with ID ${contextId} not found.`, 404);
    }

    // Check if user is the creator or assigned to the context (for Request/ScheduledMaintenance)
    if (['request', 'scheduledmaintenance'].includes(lowercaseContextType)) {
        if (contextDocument.createdBy && contextDocument.createdBy.toString() === user._id.toString()) {
            return true;
        }
        if (contextDocument.assignedTo && contextDocument.assignedToModel === 'User' && 
            contextDocument.assignedTo.toString() === user._id.toString()) {
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
    if (userAssociations.some(assoc => 
        assoc.roles.some(role => 
            [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS].includes(role)
        )
    )) {
        return true;
    }

    // Tenant of the specific unit (if context is unit-specific)
    if (resourceUnitId && userAssociations.some(assoc => 
        assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && 
        assoc.unit && assoc.unit.toString() === resourceUnitId.toString()
    )) {
        return true;
    }

    // Tenant of any unit within the property (for property-level comments)
    if (!resourceUnitId && userAssociations.some(assoc => 
        assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT)
    )) {
        return true;
    }

    return false;
};

/**
 * Process mentions in comment text and extract mentioned users
 * @param {string} message - Comment message
 * @returns {Promise<Array<Object>>} Array of user mentions
 */
const processMentions = async (message) => {
    // Parse @mentions format: @username or @user-id
    const mentionRegex = /@([a-zA-Z0-9_.-]+)/g;
    const mentions = [];
    const mentionMatches = [...message.matchAll(mentionRegex)];
    
    if (mentionMatches.length === 0) {
        return [];
    }
    
    // Extract usernames or IDs from matches
    const mentionIds = mentionMatches.map(match => match[1]);
    
    // Find users by username or ID
    const mentionedUsers = await User.find({
        $or: [
            { _id: { $in: mentionIds.filter(id => mongoose.isValidObjectId(id)) } },
            { username: { $in: mentionIds } },
            { email: { $in: mentionIds.map(id => `${id}@gmail.com`) } } // In case email is mentioned without domain
        ]
    }).select('_id');
    
    return mentionedUsers.map(user => ({
        user: user._id,
        readAt: null
    }));
};

/**
 * Adds a comment to a specific resource context
 * @param {Object} commentData - Comment data
 * @param {string} commentData.contextType - Resource type
 * @param {string} commentData.contextId - Resource ID
 * @param {string} commentData.message - Comment message
 * @param {boolean} [commentData.isExternal=false] - External comment flag
 * @param {string} [commentData.externalUserName] - External user name
 * @param {string} [commentData.externalUserEmail] - External user email
 * @param {boolean} [commentData.isInternalNote=false] - Internal note flag
 * @param {Array<string>} [commentData.media=[]] - Media IDs
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Created comment
 * @throws {AppError} On validation failure or authorization error
 */
const addComment = async (commentData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { 
            contextType, 
            contextId, 
            message, 
            isExternal = false, 
            externalUserName, 
            externalUserEmail, 
            isInternalNote = false, 
            media = [] 
        } = commentData;

        // Normalize contextType to lowercase
        const normalizedContextType = contextType.toLowerCase();
        
        // Check if media IDs exist and are valid
        if (media && media.length > 0) {
            const mediaCount = await Media.countDocuments({ 
                _id: { $in: media } 
            }).session(session);
            
            if (mediaCount !== media.length) {
                throw new AppError('One or more media IDs are invalid.', 400);
            }
        }

        // Authorization check
        const isAuthorized = await checkCommentAccess(currentUser, normalizedContextType, contextId, 'write');
        if (!isAuthorized) {
            throw new AppError(`Not authorized to add comments to this ${normalizedContextType}.`, 403);
        }

        // Process @mentions in the message
        const mentions = await processMentions(message);

        // Create comment
        const newComment = new Comment({
            contextType: normalizedContextType,
            contextId,
            sender: isExternal ? null : currentUser._id,
            message,
            isExternal,
            externalUserName: isExternal ? externalUserName : null,
            externalUserEmail: isExternal ? externalUserEmail : null,
            isInternalNote,
            media,
            mentions
        });

        const createdComment = await newComment.save({ session });

        // Get users to notify about the new comment
        let contextDocument;
        let relevantUsers = [];
        let contextTitle = '';

        switch (normalizedContextType) {
            case 'request':
                contextDocument = await Request.findById(contextId)
                    .populate('createdBy', '_id firstName lastName email')
                    .populate('assignedTo', '_id firstName lastName email')
                    .session(session);
                    
                contextTitle = contextDocument.title || `Request #${contextDocument.requestNumber || contextId}`;
                
                if (contextDocument.createdBy && 
                    contextDocument.createdBy._id.toString() !== currentUser._id.toString()) {
                    relevantUsers.push(contextDocument.createdBy);
                }
                
                if (contextDocument.assignedTo && contextDocument.assignedToModel === 'User' && 
                    contextDocument.assignedTo._id.toString() !== currentUser._id.toString()) {
                    relevantUsers.push(contextDocument.assignedTo);
                }
                
                // Also notify property managers/landlords
                if (contextDocument.property) {
                    const propertyManagers = await PropertyUser.find({
                        property: contextDocument.property,
                        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER] },
                        isActive: true
                    }).populate('user', '_id firstName lastName email').session(session);
                    
                    propertyManagers.forEach(pm => {
                        if (pm.user && pm.user._id.toString() !== currentUser._id.toString()) {
                            relevantUsers.push(pm.user);
                        }
                    });
                }
                break;
                
            case 'scheduledmaintenance':
                contextDocument = await ScheduledMaintenance.findById(contextId)
                    .populate('createdBy', '_id firstName lastName email')
                    .populate('assignedTo', '_id firstName lastName email')
                    .session(session);
                    
                contextTitle = contextDocument.title || `Scheduled Maintenance #${contextId}`;
                
                if (contextDocument.createdBy && 
                    contextDocument.createdBy._id.toString() !== currentUser._id.toString()) {
                    relevantUsers.push(contextDocument.createdBy);
                }
                
                if (contextDocument.assignedTo && contextDocument.assignedToModel === 'User' && 
                    contextDocument.assignedTo._id.toString() !== currentUser._id.toString()) {
                    relevantUsers.push(contextDocument.assignedTo);
                }
                break;
                
            case 'property':
                contextDocument = await Property.findById(contextId).session(session);
                contextTitle = contextDocument.name || `Property #${contextId}`;
                
                // Notify property owners/managers except current user
                const propertyUsers = await PropertyUser.find({
                    property: contextId,
                    roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER] },
                    isActive: true,
                    user: { $ne: currentUser._id }
                }).populate('user', '_id firstName lastName email').session(session);
                
                propertyUsers.forEach(pu => {
                    if (pu.user) {
                        relevantUsers.push(pu.user);
                    }
                });
                break;
                
            case 'unit':
                contextDocument = await Unit.findById(contextId)
                    .populate('property', 'name _id')
                    .session(session);
                    
                contextTitle = contextDocument.unitName || `Unit #${contextId}`;
                
                // Get tenants of this unit
                const unitTenants = await PropertyUser.find({
                    unit: contextId,
                    roles: PROPERTY_USER_ROLES_ENUM.TENANT,
                    isActive: true,
                    user: { $ne: currentUser._id }
                }).populate('user', '_id firstName lastName email').session(session);
                
                unitTenants.forEach(tenant => {
                    if (tenant.user) {
                        relevantUsers.push(tenant.user);
                    }
                });
                
                // Get property managers/landlords
                if (contextDocument.property && contextDocument.property._id) {
                    const propertyManagers = await PropertyUser.find({
                        property: contextDocument.property._id,
                        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER] },
                        isActive: true,
                        user: { $ne: currentUser._id }
                    }).populate('user', '_id firstName lastName email').session(session);
                    
                    propertyManagers.forEach(pm => {
                        if (pm.user) {
                            relevantUsers.push(pm.user);
                        }
                    });
                }
                break;
        }

        // Add mentioned users to relevant users (if not already included)
        if (mentions.length > 0) {
            const mentionedUserIds = mentions.map(mention => mention.user.toString());
            const mentionedUsers = await User.find({
                _id: { $in: mentionedUserIds },
                _id: { $ne: currentUser._id }
            }).session(session);
            
            mentionedUsers.forEach(user => {
                if (!relevantUsers.some(u => u._id.toString() === user._id.toString())) {
                    relevantUsers.push(user);
                }
            });
        }

        // Deduplicate relevant users
        relevantUsers = relevantUsers.filter((user, index, self) => 
            self.findIndex(u => u._id.toString() === user._id.toString()) === index
        );

        // Generate appropriate link based on context type
        const commentLink = `${FRONTEND_URL}/${normalizedContextType}s/${contextId}`;

        // Send notifications
        const notificationPromises = relevantUsers.map(async user => {
            try {
                return notificationService.sendNotification({
                    recipientId: user._id,
                    type: NOTIFICATION_TYPE_ENUM.NEW_COMMENT,
                    message: `New comment on ${normalizedContextType} "${contextTitle}": ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
                    link: commentLink,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
                    relatedResourceId: createdComment._id,
                    emailDetails: {
                        subject: `New Comment on ${contextTitle}`,
                        html: `
                            <p>Hello ${user.firstName || 'there'},</p>
                            <p><strong>${currentUser.firstName} ${currentUser.lastName}</strong> commented on ${normalizedContextType} "${contextTitle}":</p>
                            <blockquote style="border-left: 3px solid #ccc; padding-left: 15px; margin-left: 0;">
                                ${message}
                            </blockquote>
                            <p><a href="${commentLink}">Click here to view and respond</a></p>
                        `,
                        text: `Hello ${user.firstName || 'there'}, ${currentUser.firstName} ${currentUser.lastName} commented on ${normalizedContextType} "${contextTitle}": "${message}". View and respond here: ${commentLink}`
                    },
                    senderId: currentUser._id
                });
            } catch (notificationError) {
                logger.warn(`Failed to send comment notification to ${user.email}: ${notificationError.message}`);
                // Don't fail the transaction for notification errors
                return null;
            }
        });

        // Wait for all notifications to be sent
        await Promise.allSettled(notificationPromises);

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.Comment,
            createdComment._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Comment added to ${normalizedContextType} ${contextId} by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    contextType: normalizedContextType,
                    contextId,
                    hasMedia: media.length > 0,
                    isInternal: isInternalNote
                },
                newValue: createdComment.toObject()
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`CommentService: Comment added to ${normalizedContextType} ${contextId} by ${currentUser.email}.`);
        
        // Return populated comment
        return Comment.findById(createdComment._id)
            .populate('sender', 'firstName lastName email role')
            .populate('media')
            .populate('mentions.user', 'firstName lastName email');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`CommentService - Error adding comment: ${error.message}`, {
            userId: currentUser?._id,
            contextType: commentData?.contextType,
            contextId: commentData?.contextId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to add comment: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Lists comments for a specific resource context
 * @param {string} contextType - Resource type
 * @param {string} contextId - Resource ID
 * @param {Object} currentUser - The authenticated user
 * @param {Object} [options={}] - Query options
 * @param {boolean} [options.includeInternal=true] - Include internal notes
 * @param {number} [options.limit=100] - Maximum comments to return
 * @param {string} [options.sort='createdAt'] - Sort field
 * @param {string} [options.order='asc'] - Sort order
 * @returns {Promise<Array<Object>>} Array of comments
 * @throws {AppError} On authorization error
 */
const listComments = async (contextType, contextId, currentUser, options = {}) => {
    try {
        const {
            includeInternal = true,
            limit = 100,
            sort = 'createdAt',
            order = 'asc'
        } = options;

        // Normalize contextType to lowercase
        const normalizedContextType = contextType.toLowerCase();

        // Authorization check
        const isAuthorized = await checkCommentAccess(currentUser, normalizedContextType, contextId, 'read');
        if (!isAuthorized) {
            throw new AppError(`Not authorized to view comments for this ${normalizedContextType}.`, 403);
        }

        // Build query
        const query = {
            contextType: normalizedContextType,
            contextId
        };

        // If user is not admin, filter out internal notes unless they created them
        if (!includeInternal && currentUser.role !== ROLE_ENUM.ADMIN) {
            query.$or = [
                { isInternalNote: false },
                { isInternalNote: true, sender: currentUser._id }
            ];
        }

        // Execute query with sorting and limit
        const sortOrder = order.toLowerCase() === 'desc' ? -1 : 1;
        const comments = await Comment.find(query)
            .populate('sender', 'firstName lastName email role')
            .populate('media')
            .populate('mentions.user', 'firstName lastName email')
            .sort({ [sort]: sortOrder })
            .limit(limit);

        // Mark mentioned user as read if current user is mentioned
        if (comments.length > 0) {
            const updatePromises = comments.map(async comment => {
                const currentUserMention = comment.mentions?.find(
                    mention => mention.user?._id?.toString() === currentUser._id.toString() && !mention.readAt
                );
                
                if (currentUserMention) {
                    await Comment.updateOne(
                        { _id: comment._id, 'mentions.user': currentUser._id },
                        { $set: { 'mentions.$.readAt': new Date() } }
                    );
                }
            });
            
            await Promise.all(updatePromises);
        }

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Comment,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} listed comments for ${normalizedContextType} ${contextId}.`,
                status: 'success',
                metadata: { contextType: normalizedContextType, contextId, options }
            }
        );

        return comments;
    } catch (error) {
        logger.error(`CommentService - Error listing comments: ${error.message}`, {
            userId: currentUser?._id,
            contextType,
            contextId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to list comments: ${error.message}`, 500);
    }
};

/**
 * Updates a specific comment
 * @param {string} commentId - Comment ID
 * @param {Object} updateData - Update data
 * @param {string} [updateData.message] - New message
 * @param {boolean} [updateData.isInternalNote] - Internal note flag
 * @param {Array<string>} [updateData.media] - Updated media IDs
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated comment
 * @throws {AppError} On authorization error
 */
const updateComment = async (commentId, updateData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const comment = await Comment.findById(commentId).session(session);
        
        if (!comment) {
            throw new AppError('Comment not found.', 404);
        }

        // Authorization: Only the sender or an Admin can update
        const isSender = comment.sender && comment.sender.toString() === currentUser._id.toString();
        const isAdmin = currentUser.role === ROLE_ENUM.ADMIN;
        
        if (!isSender && !isAdmin) {
            throw new AppError('Not authorized to update this comment.', 403);
        }

        // Store old state for audit log
        const oldComment = comment.toObject();
        
        // Check if media IDs exist and are valid
        if (updateData.media && updateData.media.length > 0) {
            const mediaCount = await Media.countDocuments({ 
                _id: { $in: updateData.media } 
            }).session(session);
            
            if (mediaCount !== updateData.media.length) {
                throw new AppError('One or more media IDs are invalid.', 400);
            }
        }
        
        // Process new @mentions if message is updated
        let newMentions = [];
        if (updateData.message !== undefined && updateData.message !== comment.message) {
            newMentions = await processMentions(updateData.message);
            
            // Preserve existing mention read status
            if (comment.mentions && comment.mentions.length > 0) {
                const existingMentionMap = new Map(
                    comment.mentions.map(m => [m.user.toString(), m.readAt])
                );
                
                newMentions = newMentions.map(mention => {
                    const userId = mention.user.toString();
                    return {
                        user: mention.user,
                        readAt: existingMentionMap.has(userId) ? existingMentionMap.get(userId) : null
                    };
                });
            }
        }

        // Apply updates
        if (updateData.message !== undefined) {
            comment.message = updateData.message;
            comment.mentions = newMentions.length > 0 ? newMentions : comment.mentions;
        }
        
        if (updateData.isInternalNote !== undefined) {
            comment.isInternalNote = updateData.isInternalNote;
        }
        
        if (updateData.media !== undefined) {
            comment.media = updateData.media;
        }

        // Save changes
        const updatedComment = await comment.save({ session });

        // Notify mentioned users (if message was updated with new mentions)
        if (newMentions.length > 0 && updateData.message !== undefined) {
            const contextDocument = await mongoose.model(comment.contextType.charAt(0).toUpperCase() + comment.contextType.slice(1))
                .findById(comment.contextId)
                .session(session);
                
            const contextTitle = contextDocument?.title || contextDocument?.name || contextDocument?.unitName || `${comment.contextType} #${comment.contextId}`;
            const commentLink = `${FRONTEND_URL}/${comment.contextType}s/${comment.contextId}`;
            
            // Get users to notify (only newly mentioned users)
            const oldMentionedUserIds = oldComment.mentions?.map(m => m.user.toString()) || [];
            const newMentionedUserIds = newMentions.map(m => m.user.toString());
            const usersToNotify = newMentionedUserIds.filter(id => !oldMentionedUserIds.includes(id));
            
            if (usersToNotify.length > 0) {
                const mentionedUsers = await User.find({
                    _id: { $in: usersToNotify },
                    _id: { $ne: currentUser._id }
                }).session(session);
                
                const notificationPromises = mentionedUsers.map(async user => {
                    try {
                        return notificationService.sendNotification({
                            recipientId: user._id,
                            type: NOTIFICATION_TYPE_ENUM.MENTION,
                            message: `${currentUser.firstName} ${currentUser.lastName} mentioned you in a comment on ${comment.contextType} "${contextTitle}"`,
                            link: commentLink,
                            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
                            relatedResourceId: updatedComment._id,
                            emailDetails: {
                                subject: `You were mentioned in a comment on ${contextTitle}`,
                                html: `
                                    <p>Hello ${user.firstName || 'there'},</p>
                                    <p><strong>${currentUser.firstName} ${currentUser.lastName}</strong> mentioned you in a comment on ${comment.contextType} "${contextTitle}":</p>
                                    <blockquote style="border-left: 3px solid #ccc; padding-left: 15px; margin-left: 0;">
                                        ${updateData.message}
                                    </blockquote>
                                    <p><a href="${commentLink}">Click here to view and respond</a></p>
                                `,
                                text: `Hello ${user.firstName || 'there'}, ${currentUser.firstName} ${currentUser.lastName} mentioned you in a comment on ${comment.contextType} "${contextTitle}": "${updateData.message}". View and respond here: ${commentLink}`
                            },
                            senderId: currentUser._id
                        });
                    } catch (notificationError) {
                        logger.warn(`Failed to send mention notification to ${user.email}: ${notificationError.message}`);
                        return null;
                    }
                });
                
                await Promise.allSettled(notificationPromises);
            }
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Comment,
            updatedComment._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Comment ${updatedComment._id} updated by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldComment,
                newValue: updatedComment.toObject()
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`CommentService: Comment ${updatedComment._id} updated by ${currentUser.email}.`);
        
        // Return populated comment
        return Comment.findById(updatedComment._id)
            .populate('sender', 'firstName lastName email role')
            .populate('media')
            .populate('mentions.user', 'firstName lastName email');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`CommentService - Error updating comment: ${error.message}`, {
            userId: currentUser?._id,
            commentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to update comment: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Deletes a specific comment
 * @param {string} commentId - Comment ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<void>}
 * @throws {AppError} On authorization error
 */
const deleteComment = async (commentId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const commentToDelete = await Comment.findById(commentId).session(session);
        
        if (!commentToDelete) {
            throw new AppError('Comment not found.', 404);
        }

        // Authorization: Only the sender or an Admin can delete
        const isSender = commentToDelete.sender && commentToDelete.sender.toString() === currentUser._id.toString();
        const isAdmin = currentUser.role === ROLE_ENUM.ADMIN;
        
        if (!isSender && !isAdmin) {
            throw new AppError('Not authorized to delete this comment.', 403);
        }

        // Store old state for audit log
        const oldComment = commentToDelete.toObject();

        // Delete associated media files
        if (commentToDelete.media && commentToDelete.media.length > 0) {
            for (const mediaId of commentToDelete.media) {
                try {
                    await mediaService.deleteMedia(mediaId, currentUser._id, { session });
                    logger.info(`CommentService: Deleted media ${mediaId} for comment ${commentId}.`);
                } catch (mediaError) {
                    logger.warn(`CommentService: Failed to delete media ${mediaId} for comment ${commentId}: ${mediaError.message}`);
                    // Continue with deletion even if media deletion fails
                }
            }
        }

        // Delete the comment
        await commentToDelete.deleteOne({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.Comment,
            commentId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Comment ${commentId} deleted by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldComment,
                newValue: null
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`CommentService: Comment ${commentId} deleted by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`CommentService - Error deleting comment: ${error.message}`, {
            userId: currentUser?._id,
            commentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete comment: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets unread mention count for a user
 * @param {string} userId - User ID
 * @returns {Promise<number>} Count of unread mentions
 */
const getUnreadMentionCount = async (userId) => {
    try {
        const count = await Comment.countDocuments({
            'mentions.user': userId,
            'mentions.readAt': null
        });
        
        return count;
    } catch (error) {
        logger.error(`CommentService - Error getting unread mention count: ${error.message}`, { userId });
        return 0;
    }
};

/**
 * Marks mentions as read for a user in a specific context
 * @param {string} userId - User ID
 * @param {string} contextType - Resource type
 * @param {string} contextId - Resource ID
 * @returns {Promise<number>} Number of updated mentions
 */
const markMentionsAsRead = async (userId, contextType, contextId) => {
    try {
        const normalizedContextType = contextType.toLowerCase();
        
        const result = await Comment.updateMany(
            {
                contextType: normalizedContextType,
                contextId,
                'mentions.user': userId,
                'mentions.readAt': null
            },
            {
                $set: { 'mentions.$[elem].readAt': new Date() }
            },
            {
                arrayFilters: [{ 'elem.user': userId, 'elem.readAt': null }],
                multi: true
            }
        );
        
        return result.nModified || 0;
    } catch (error) {
        logger.error(`CommentService - Error marking mentions as read: ${error.message}`, {
            userId,
            contextType,
            contextId
        });
        return 0;
    }
};

module.exports = {
    addComment,
    listComments,
    updateComment,
    deleteComment,
    getUnreadMentionCount,
    markMentionsAsRead
};