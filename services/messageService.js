// src/services/messageService.js

const mongoose = require('mongoose');
const Message = require('../models/message');
const User = require('../models/user');
const Property = require('../models/property');
const Unit = require('../models/unit');
const PropertyUser = require('../models/propertyUser');
const Media = require('../models/media');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM,
    MESSAGE_CATEGORY_ENUM
} = require('../utils/constants/enums');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Helper to check if two users (sender and recipient) are authorized to message each other
 * within a given property/unit context.
 * @param {Object} senderUser - The user sending the message
 * @param {Object} recipientUser - The user receiving the message
 * @param {string} [propertyId] - Optional property ID for context
 * @param {string} [unitId] - Optional unit ID for context
 * @returns {Promise<boolean>} True if authorized, false otherwise
 */
const checkMessageAuthorization = async (senderUser, recipientUser, propertyId = null, unitId = null) => {
    try {
        // Admin can message anyone
        if (senderUser.role === ROLE_ENUM.ADMIN) {
            return true;
        }

        // Check if sender and recipient are the same user (self-messaging allowed, though might not be common)
        if (senderUser._id.toString() === recipientUser._id.toString()) {
            return true;
        }

        // Get all property associations for both sender and recipient
        const senderAssociations = await PropertyUser.find({
            user: senderUser._id,
            isActive: true
        });
        
        const recipientAssociations = await PropertyUser.find({
            user: recipientUser._id,
            isActive: true
        });

        // Extract property IDs and roles for easier comparison
        const senderPropertyIds = senderAssociations.map(assoc => assoc.property.toString());
        const recipientPropertyIds = recipientAssociations.map(assoc => assoc.property.toString());

        // Rule 1: If they share any common property, they can message each other.
        const commonProperties = senderPropertyIds.filter(propId => recipientPropertyIds.includes(propId));
        if (commonProperties.length > 0) {
            // If a specific propertyId is provided, ensure it's one of the common ones
            if (propertyId && !commonProperties.includes(propertyId.toString())) {
                return false; // Contextual property is not common to both
            }
            
            // If a specific unitId is provided, check if both are associated with that unit
            if (unitId) {
                const senderUnitAssoc = senderAssociations.find(
                    assoc => assoc.unit && assoc.unit.toString() === unitId.toString()
                );
                
                const recipientUnitAssoc = recipientAssociations.find(
                    assoc => assoc.unit && assoc.unit.toString() === unitId.toString()
                );
                
                if (!senderUnitAssoc || !recipientUnitAssoc) {
                    return false; // One or both are not associated with the specific unit
                }
            }
            
            return true;
        }

        // Rule 2: Landlord/Property Manager can message any user (tenant, other PMs) on properties they manage.
        const senderIsManager = [ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(senderUser.role);
        if (senderIsManager) {
            const senderManagedProperties = senderAssociations
                .filter(assoc => 
                    [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER].some(
                        role => assoc.roles.includes(role)
                    )
                )
                .map(assoc => assoc.property.toString());

            // Check if the recipient is associated with any of the sender's managed properties
            const recipientInManagedProperty = recipientPropertyIds.some(
                recPropId => senderManagedProperties.includes(recPropId)
            );
            
            if (recipientInManagedProperty) {
                // If a specific propertyId is provided, ensure the sender manages it and recipient is in it
                if (propertyId) {
                    const senderManagesContextProperty = senderManagedProperties.includes(propertyId.toString());
                    const recipientIsInContextProperty = recipientPropertyIds.includes(propertyId.toString());
                    
                    return senderManagesContextProperty && recipientIsInContextProperty;
                } else {
                    return true; // No specific property context, so if they share any managed property, it's okay
                }
            }
        }

        return false; // No authorization rule matched
    } catch (error) {
        logger.error(`MessageService - Error checking authorization: ${error.message}`, {
            senderId: senderUser?._id, 
            recipientId: recipientUser?._id
        });
        return false; // Fail safely
    }
};

/**
 * Sends a new message between users
 * @param {Object} messageData - Message data
 * @param {string} messageData.recipientId - Recipient user ID
 * @param {string} messageData.content - Message content
 * @param {string} [messageData.propertyId] - Optional property context
 * @param {string} [messageData.unitId] - Optional unit context
 * @param {string} [messageData.category='general'] - Message category
 * @param {string[]} [messageData.attachments] - Optional array of media IDs
 * @param {string} [messageData.parentMessage] - Optional parent message ID for replies
 * @param {Object} currentUser - The authenticated user sending the message
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} The created message
 * @throws {AppError} On validation failure or authorization error
 */
const sendMessage = async (messageData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { 
            recipientId, 
            propertyId, 
            unitId, 
            content, 
            category = 'general',
            attachments = [],
            parentMessage = null
        } = messageData;

        // Validate recipient
        const recipient = await User.findById(recipientId).session(session);
        if (!recipient) {
            throw new AppError('Recipient user not found.', 404);
        }

        // Authorization check
        const isAuthorized = await checkMessageAuthorization(currentUser, recipient, propertyId, unitId);
        if (!isAuthorized) {
            throw new AppError('Not authorized to send messages to this recipient or for this property/unit context.', 403);
        }
        
        // Validate parent message if provided
        if (parentMessage) {
            const parent = await Message.findById(parentMessage).session(session);
            if (!parent) {
                throw new AppError('Parent message not found.', 404);
            }
            
            // Ensure current user is either the sender or recipient of the parent message
            const isParticipant = parent.sender.toString() === currentUser._id.toString() || 
                                 parent.recipient.toString() === currentUser._id.toString();
            if (!isParticipant && currentUser.role !== ROLE_ENUM.ADMIN) {
                throw new AppError('Not authorized to reply to this message.', 403);
            }
        }
        
        // Validate attachments if provided
        if (attachments && attachments.length > 0) {
            const mediaCount = await Media.countDocuments({
                _id: { $in: attachments }
            }).session(session);
            
            if (mediaCount !== attachments.length) {
                throw new AppError('One or more attachment IDs are invalid.', 400);
            }
        }

        // Create new message
        const newMessage = new Message({
            sender: currentUser._id,
            recipient: recipientId,
            property: propertyId || null,
            unit: unitId || null,
            content,
            category: category.toLowerCase(),
            attachments,
            parentMessage
        });

        const createdMessage = await newMessage.save({ session });

        // Get property and unit names for notification
        let propertyName = '';
        let unitName = '';
        
        if (propertyId) {
            const property = await Property.findById(propertyId).session(session);
            propertyName = property ? property.name : '';
        }
        
        if (unitId) {
            const unit = await Unit.findById(unitId).session(session);
            unitName = unit ? unit.unitName : '';
        }

        // Send notification to recipient
        const messageLink = `${FRONTEND_URL}/messages?otherUserId=${currentUser._id}`;
        const contextSuffix = propertyName ? ` regarding ${propertyName}${unitName ? ` - Unit ${unitName}` : ''}` : '';
        
        try {
            await notificationService.sendNotification({
                recipientId: recipient._id,
                type: NOTIFICATION_TYPE_ENUM.NEW_MESSAGE,
                message: `New message from ${currentUser.firstName} ${currentUser.lastName}${contextSuffix}: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
                link: messageLink,
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Message,
                relatedResourceId: createdMessage._id,
                emailDetails: {
                    subject: `New Message from ${currentUser.firstName} ${currentUser.lastName}`,
                    html: `
                        <p>Hello ${recipient.firstName || 'there'},</p>
                        <p>You have received a new message from <strong>${currentUser.firstName} ${currentUser.lastName}</strong>${contextSuffix}:</p>
                        <blockquote style="border-left: 3px solid #ccc; padding-left: 15px; margin-left: 0;">
                            ${content}
                        </blockquote>
                        <p><a href="${messageLink}">Click here to view and respond</a></p>
                    `,
                    text: `Hello ${recipient.firstName || 'there'}, You have received a new message from ${currentUser.firstName} ${currentUser.lastName}${contextSuffix}: "${content}". View and respond here: ${messageLink}`
                },
                senderId: currentUser._id
            }, { session });
        } catch (notificationError) {
            logger.warn(`Failed to send message notification: ${notificationError.message}`);
            // Continue with message creation even if notification fails
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.Message,
            createdMessage._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Message sent from ${currentUser.email} to ${recipient.email}${contextSuffix}.`,
                status: 'success',
                metadata: {
                    propertyId,
                    unitId,
                    category,
                    hasAttachments: attachments.length > 0,
                    isReply: !!parentMessage
                },
                newValue: createdMessage.toObject()
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`MessageService: Message sent from ${currentUser.email} to ${recipient.email}${contextSuffix}.`);
        
        // Return populated message
        return Message.findById(createdMessage._id)
            .populate('sender', 'firstName lastName email role avatar')
            .populate('recipient', 'firstName lastName email role avatar')
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('attachments');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`MessageService - Error sending message: ${error.message}`, {
            userId: currentUser?._id,
            recipientId: messageData?.recipientId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to send message: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets messages for the logged-in user
 * @param {Object} currentUser - The authenticated user
 * @param {Object} filters - Query filters
 * @param {string} [filters.type='inbox'] - 'inbox' or 'sent'
 * @param {string} [filters.propertyId] - Filter by property
 * @param {string} [filters.unitId] - Filter by unit
 * @param {string} [filters.otherUserId] - Filter by conversation partner
 * @param {string} [filters.category] - Filter by category
 * @param {boolean} [filters.unreadOnly=false] - Filter to unread messages only
 * @param {number} [filters.page=1] - Page number
 * @param {number} [filters.limit=50] - Results per page
 * @returns {Promise<Object>} Paginated messages with metadata
 * @throws {AppError} On validation or authorization error
 */
const getMessages = async (currentUser, filters) => {
    try {
        const { 
            type = 'inbox', 
            propertyId, 
            unitId, 
            otherUserId,
            category,
            unreadOnly = false,
            page = 1,
            limit = 50
        } = filters;
        
        const userId = currentUser._id;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let query = { isDeleted: false };
        
        // Base query by message type
        if (type === 'inbox') {
            query.recipient = userId;
        } else if (type === 'sent') {
            query.sender = userId;
        } else {
            throw new AppError('Invalid message type. Must be "inbox" or "sent".', 400);
        }
        
        // Filter by read status if requested
        if (unreadOnly === true || unreadOnly === 'true') {
            query.isRead = false;
        }
        
        // Filter by category if provided
        if (category) {
            if (!MESSAGE_CATEGORY_ENUM.includes(category.toLowerCase())) {
                throw new AppError(`Invalid category. Must be one of: ${MESSAGE_CATEGORY_ENUM.join(', ')}.`, 400);
            }
            query.category = category.toLowerCase();
        }

        // If filtering by another user for conversation view
        if (otherUserId) {
            const otherUser = await User.findById(otherUserId);
            if (!otherUser) {
                throw new AppError('Conversation partner not found.', 404);
            }
            
            // Check authorization
            const isAuthorized = await checkMessageAuthorization(currentUser, otherUser, propertyId, unitId);
            if (!isAuthorized) {
                throw new AppError('Not authorized to view conversation with this user.', 403);
            }

            // For conversation view, get both sent and received messages between the two users
            delete query.sender;
            delete query.recipient;
            query.$or = [
                { sender: userId, recipient: otherUserId },
                { sender: otherUserId, recipient: userId }
            ];
        }

        // Apply property filter with authorization check
        if (propertyId) {
            // Verify property exists
            const property = await Property.findById(propertyId);
            if (!property) {
                throw new AppError('Property not found.', 404);
            }
            
            // Verify user has access to this property
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const isAssociated = await PropertyUser.exists({ 
                    user: userId, 
                    property: propertyId, 
                    isActive: true 
                });
                
                if (!isAssociated) {
                    throw new AppError('Not authorized to view messages for this property.', 403);
                }
            }
            
            query.property = propertyId;
        }

        // Apply unit filter with authorization check
        if (unitId) {
            // Verify unit exists
            const unit = await Unit.findById(unitId).populate('property');
            if (!unit) {
                throw new AppError('Unit not found.', 404);
            }
            
            // Verify user has access to this unit's property
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const isAssociatedWithUnitProperty = await PropertyUser.exists({
                    user: userId,
                    property: unit.property,
                    isActive: true
                });
                
                if (!isAssociatedWithUnitProperty) {
                    throw new AppError('Not authorized to view messages for this unit.', 403);
                }
            }
            
            query.unit = unitId;
        }

        // Count total messages matching query for pagination
        const totalMessages = await Message.countDocuments(query);
        
        // Get messages with pagination and sorting
        const messages = await Message.find(query)
            .populate('sender', 'firstName lastName email role avatar')
            .populate('recipient', 'firstName lastName email role avatar')
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('attachments')
            .sort({ createdAt: otherUserId ? 1 : -1 }) // Oldest first for conversations, newest first otherwise
            .skip(skip)
            .limit(parseInt(limit));

        // Mark messages as read if viewing a conversation
        if (type === 'inbox' && otherUserId) {
            // Mark all messages from otherUserId to currentUser as read
            const unreadMessageIds = messages
                .filter(msg => 
                    msg.sender._id.toString() === otherUserId.toString() && 
                    msg.recipient._id.toString() === currentUser._id.toString() && 
                    !msg.isRead
                )
                .map(msg => msg._id);
                
            if (unreadMessageIds.length > 0) {
                await Message.updateMany(
                    { _id: { $in: unreadMessageIds } },
                    { 
                        $set: { 
                            isRead: true,
                            readAt: new Date()
                        } 
                    }
                );
                
                logger.info(`MessageService: ${unreadMessageIds.length} messages from ${otherUserId} to ${currentUser._id} marked as read.`);
            }
        }

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Message,
            null,
            {
                userId: userId,
                description: `User ${currentUser.email} fetched ${type} messages.`,
                status: 'success',
                metadata: { filters, resultCount: messages.length }
            }
        );

        return {
            messages,
            pagination: {
                total: totalMessages,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(totalMessages / parseInt(limit))
            }
        };
    } catch (error) {
        logger.error(`MessageService - Error getting messages: ${error.message}`, {
            userId: currentUser?._id,
            filters
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get messages: ${error.message}`, 500);
    }
};

/**
 * Gets a single message by ID
 * @param {string} messageId - Message ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} [ipAddress] - Request IP address
 * @returns {Promise<Object>} The message
 * @throws {AppError} If message not found or unauthorized
 */
const getMessageById = async (messageId, currentUser, ipAddress) => {
    try {
        const message = await Message.findOne({ 
            _id: messageId,
            isDeleted: false
        })
            .populate('sender', 'firstName lastName email role avatar')
            .populate('recipient', 'firstName lastName email role avatar')
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('attachments');

        if (!message) {
            throw new AppError('Message not found.', 404);
        }

        // Authorization: Only sender, recipient, or admin can view
        const isSender = message.sender._id.toString() === currentUser._id.toString();
        const isRecipient = message.recipient._id.toString() === currentUser._id.toString();
        const isAdmin = currentUser.role === ROLE_ENUM.ADMIN;

        if (!isSender && !isRecipient && !isAdmin) {
            throw new AppError('Not authorized to view this message.', 403);
        }

        // Mark as read if the current user is the recipient and it's unread
        if (isRecipient && !message.isRead) {
            message.isRead = true;
            message.readAt = new Date();
            await message.save();
            logger.info(`MessageService: Message ${messageId} marked as read by ${currentUser.email}.`);
        }

        // Log access
        if (ipAddress) {
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.READ,
                AUDIT_RESOURCE_TYPE_ENUM.Message,
                message._id,
                {
                    userId: currentUser._id,
                    ipAddress,
                    description: `User ${currentUser.email} viewed message ${message._id}.`,
                    status: 'success'
                }
            );
        }

        return message;
    } catch (error) {
        logger.error(`MessageService - Error getting message: ${error.message}`, {
            userId: currentUser?._id,
            messageId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get message: ${error.message}`, 500);
    }
};

/**
 * Marks a message as read
 * @param {string} messageId - Message ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} [ipAddress] - Request IP address
 * @returns {Promise<Object>} Updated message
 * @throws {AppError} If message not found or unauthorized
 */
const markMessageAsRead = async (messageId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const message = await Message.findOne({
            _id: messageId,
            isDeleted: false
        }).session(session);

        if (!message) {
            throw new AppError('Message not found.', 404);
        }

        // Only the recipient can mark a message as read
        if (message.recipient.toString() !== currentUser._id.toString() && currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Not authorized to mark this message as read.', 403);
        }

        if (message.isRead) {
            // Already read, no action needed
            await session.commitTransaction();
            return message;
        }

        // Capture old state for audit log
        const oldMessage = message.toObject();

        // Update message
        message.isRead = true;
        message.readAt = new Date();
        const updatedMessage = await message.save({ session });

        // Log action
        if (ipAddress) {
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.UPDATE,
                AUDIT_RESOURCE_TYPE_ENUM.Message,
                updatedMessage._id,
                {
                    userId: currentUser._id,
                    ipAddress,
                    description: `Message ${updatedMessage._id} marked as read by ${currentUser.email}.`,
                    status: 'success',
                    oldValue: { isRead: oldMessage.isRead, readAt: oldMessage.readAt },
                    newValue: { isRead: updatedMessage.isRead, readAt: updatedMessage.readAt }
                },
                { session }
            );
        }

        await session.commitTransaction();
        
        logger.info(`MessageService: Message ${updatedMessage._id} marked as read by ${currentUser.email}.`);
        
        return Message.findById(updatedMessage._id)
            .populate('sender', 'firstName lastName email role avatar')
            .populate('recipient', 'firstName lastName email role avatar')
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('attachments');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`MessageService - Error marking message as read: ${error.message}`, {
            userId: currentUser?._id,
            messageId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to mark message as read: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Deletes a message (soft delete)
 * @param {string} messageId - Message ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<void>}
 * @throws {AppError} If message not found or unauthorized
 */
const deleteMessage = async (messageId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const messageToDelete = await Message.findOne({
            _id: messageId,
            isDeleted: false
        }).session(session);

        if (!messageToDelete) {
            throw new AppError('Message not found.', 404);
        }

        // Authorization: Only sender, recipient, or admin can delete
        const isSender = messageToDelete.sender.toString() === currentUser._id.toString();
        const isRecipient = messageToDelete.recipient.toString() === currentUser._id.toString();
        const isAdmin = currentUser.role === ROLE_ENUM.ADMIN;

        if (!isSender && !isRecipient && !isAdmin) {
            throw new AppError('Not authorized to delete this message.', 403);
        }

        // Capture old state for audit log
        const oldMessage = messageToDelete.toObject();

        // Soft delete - Update isDeleted flag instead of removing
        messageToDelete.isDeleted = true;
        messageToDelete.deletedAt = new Date();
        messageToDelete.deletedBy = currentUser._id;
        await messageToDelete.save({ session });

        // Log action
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.Message,
            messageId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Message ${messageId} deleted by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldMessage,
                newValue: { isDeleted: true, deletedAt: new Date(), deletedBy: currentUser._id }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`MessageService: Message ${messageId} deleted by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`MessageService - Error deleting message: ${error.message}`, {
            userId: currentUser?._id,
            messageId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete message: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets unread message count for the current user
 * @param {string} userId - User ID
 * @param {Object} [filters={}] - Optional filters
 * @param {string} [filters.propertyId] - Filter by property
 * @param {string} [filters.category] - Filter by category
 * @returns {Promise<number>} Unread message count
 */
const getUnreadMessageCount = async (userId, filters = {}) => {
    try {
        const { propertyId, category } = filters;
        
        const query = {
            recipient: userId,
            isRead: false,
            isDeleted: false
        };
        
        if (propertyId) {
            query.property = propertyId;
        }
        
        if (category) {
            if (!MESSAGE_CATEGORY_ENUM.includes(category.toLowerCase())) {
                return 0;
            }
            query.category = category.toLowerCase();
        }
        
        const count = await Message.countDocuments(query);
        return count;
    } catch (error) {
        logger.error(`MessageService - Error getting unread count: ${error.message}`, { userId });
        return 0; // Return 0 on error to prevent UI disruption
    }
};

/**
 * Mark all messages as read for a conversation
 * @param {string} otherUserId - Other user in the conversation
 * @param {Object} currentUser - The authenticated user
 * @param {Object} [options={}] - Additional options
 * @param {string} [options.propertyId] - Limit to specific property
 * @param {string} [options.ipAddress] - Request IP address
 * @returns {Promise<number>} Number of messages marked as read
 */
const markAllConversationAsRead = async (otherUserId, currentUser, options = {}) => {
    const { propertyId, ipAddress } = options;
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Verify other user exists
        const otherUser = await User.findById(otherUserId).session(session);
        if (!otherUser) {
            throw new AppError('User not found.', 404);
        }
        
        // Build query
        const query = {
            sender: otherUserId,
            recipient: currentUser._id,
            isRead: false,
            isDeleted: false
        };
        
        // Add property filter if provided
        if (propertyId) {
            query.property = propertyId;
        }
        
        // Update messages
        const result = await Message.updateMany(
            query,
            { 
                $set: { 
                    isRead: true,
                    readAt: new Date()
                } 
            },
            { session }
        );
        
        if (result.nModified > 0 && ipAddress) {
            // Log the action
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.UPDATE,
                AUDIT_RESOURCE_TYPE_ENUM.Message,
                null,
                {
                    userId: currentUser._id,
                    ipAddress,
                    description: `${result.nModified} messages from ${otherUser.email} marked as read by ${currentUser.email}.`,
                    status: 'success',
                    metadata: { propertyId }
                },
                { session }
            );
        }
        
        await session.commitTransaction();
        
        if (result.nModified > 0) {
            logger.info(`MessageService: ${result.nModified} messages from ${otherUserId} to ${currentUser._id} marked as read.`);
        }
        
        return result.nModified || 0;
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`MessageService - Error marking conversation as read: ${error.message}`, {
            userId: currentUser?._id,
            otherUserId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to mark conversation as read: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

module.exports = {
    sendMessage,
    getMessages,
    getMessageById,
    markMessageAsRead,
    deleteMessage,
    getUnreadMessageCount,
    markAllConversationAsRead
};