// src/services/messageService.js

const Message = require('../models/message');
const User = require('../models/user');
const Property = require('../models/property');
const Unit = require('../models/unit');
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
 * Helper to check if two users (sender and recipient) are authorized to message each other
 * within a given property/unit context.
 * @param {object} senderUser - The user sending the message.
 * @param {object} recipientUser - The user receiving the message.
 * @param {string} [propertyId] - Optional property ID for context.
 * @param {string} [unitId] - Optional unit ID for context.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkMessageAuthorization = async (senderUser, recipientUser, propertyId = null, unitId = null) => {
    // Admin can message anyone
    if (senderUser.role === ROLE_ENUM.ADMIN) {
        return true;
    }

    // Check if sender and recipient are the same user (self-messaging allowed, though might not be common)
    if (senderUser._id.equals(recipientUser._id)) {
        return true;
    }

    // Get all property associations for both sender and recipient
    const senderAssociations = await PropertyUser.find({ user: senderUser._id, isActive: true });
    const recipientAssociations = await PropertyUser.find({ user: recipientUser._id, isActive: true });

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
            const senderUnitAssoc = senderAssociations.find(assoc => assoc.unit && assoc.unit.equals(unitId));
            const recipientUnitAssoc = recipientAssociations.find(assoc => assoc.unit && assoc.unit.equals(unitId));
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
            .filter(assoc => [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER].some(role => assoc.roles.includes(role)))
            .map(assoc => assoc.property.toString());

        // Check if the recipient is associated with any of the sender's managed properties
        const canMessageViaManagedProperty = recipientPropertyIds.some(recPropId => senderManagedProperties.includes(recPropId));
        if (canMessageViaManagedProperty) {
            // If a specific propertyId is provided, ensure the sender manages it and recipient is in it
            if (propertyId) {
                const senderManagesContextProperty = senderManagedProperties.includes(propertyId.toString());
                const recipientIsInContextProperty = recipientPropertyIds.includes(propertyId.toString());
                if (senderManagesContextProperty && recipientIsInContextProperty) {
                    return true;
                }
            } else {
                return true; // No specific property context, so if they share any managed property, it's okay
            }
        }
    }

    return false; // No authorization rule matched
};

/**
 * Sends a new message between users.
 * @param {object} messageData - Data for the new message (recipientId, propertyId, unitId, content, category).
 * @param {object} currentUser - The user sending the message.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Message>} The created message document.
 * @throws {AppError} If recipient not found, not authorized, or validation fails.
 */
const sendMessage = async (messageData, currentUser, ipAddress) => {
    const { recipientId, propertyId, unitId, content, category = 'general' } = messageData;

    const recipient = await User.findById(recipientId);
    if (!recipient) {
        throw new AppError('Recipient user not found.', 404);
    }

    // Authorization check
    const isAuthorized = await checkMessageAuthorization(currentUser, recipient, propertyId, unitId);
    if (!isAuthorized) {
        throw new AppError('Not authorized to send messages to this recipient or for this property/unit context.', 403);
    }

    const newMessage = new Message({
        sender: currentUser._id,
        recipient: recipientId,
        property: propertyId || null,
        unit: unitId || null,
        content,
        category: category.toLowerCase()
    });

    const createdMessage = await newMessage.save();

    // Send in-app notification to the recipient
    const messageLink = `${FRONTEND_URL}/messages?otherUserId=${currentUser._id}`; // Link to conversation with sender
    await createInAppNotification(
        recipient._id,
        NOTIFICATION_TYPE_ENUM.find(t => t === 'new_message'),
        `New message from ${currentUser.firstName} ${currentUser.lastName}: "${content.substring(0, 100)}..."`,
        { kind: AUDIT_RESOURCE_TYPE_ENUM.Message, item: createdMessage._id },
        messageLink,
        { senderName: currentUser.firstName || currentUser.email },
        currentUser._id
    );

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Message,
        resourceId: createdMessage._id,
        newValue: createdMessage.toObject(),
        ipAddress: ipAddress,
        description: `Message sent from ${currentUser.email} to ${recipient.email}.`,
        status: 'success'
    });

    logger.info(`MessageService: Message sent from ${currentUser.email} to ${recipient.email}.`);
    return createdMessage;
};

/**
 * Gets messages for the logged-in user (inbox or sent).
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Filters (type, propertyId, unitId, otherUserId).
 * @returns {Promise<Array<Message>>} Array of message documents.
 * @throws {AppError} If invalid message type or user not authorized.
 */
const getMessages = async (currentUser, filters) => {
    const { type = 'inbox', propertyId, unitId, otherUserId } = filters;
    const userId = currentUser._id;

    let query = {};
    if (type === 'inbox') {
        query.recipient = userId;
    } else if (type === 'sent') {
        query.sender = userId;
    } else {
        throw new AppError('Invalid message type. Must be "inbox" or "sent".', 400);
    }

    // If filtering by another user, ensure authorization for that conversation
    if (otherUserId) {
        const otherUser = await User.findById(otherUserId);
        if (!otherUser) {
            throw new AppError('Other user not found for conversation filter.', 404);
        }
        const isAuthorized = await checkMessageAuthorization(currentUser, otherUser, propertyId, unitId);
        if (!isAuthorized) {
            throw new AppError('Not authorized to view conversation with this user.', 403);
        }

        if (type === 'inbox') {
            query.sender = otherUserId;
        } else { // type === 'sent'
            query.recipient = otherUserId;
        }
    }

    // Apply property and unit filters, with authorization checks
    if (propertyId) {
        const isAssociated = await PropertyUser.exists({ user: userId, property: propertyId, isActive: true });
        if (!isAssociated && currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Not authorized to view messages for this property.', 403);
        }
        query.property = propertyId;
    }

    if (unitId) {
        const unit = await Unit.findById(unitId);
        if (!unit) {
            throw new AppError('Unit not found.', 404);
        }
        // Ensure the user has access to the unit's property
        const isAssociatedWithUnitProperty = await PropertyUser.exists({
            user: userId,
            property: unit.property._id,
            isActive: true
        });
        if (!isAssociatedWithUnitProperty && currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Not authorized to view messages for this unit.', 403);
        }
        query.unit = unitId;
    }

    const messages = await Message.find(query)
        .populate('sender', 'firstName lastName email role')
        .populate('recipient', 'firstName lastName email role')
        .populate('property', 'name') // Use 'name' instead of 'propertyName'
        .populate('unit', 'unitName') // Use 'unitName' instead of 'unitNumber'
        .sort({ createdAt: 1 }); // Oldest first for conversation thread

    // Mark messages as read if they are in the inbox and unread
    if (type === 'inbox' && otherUserId) {
        // Mark all messages from 'otherUserId' to 'currentUser' as read
        await Message.updateMany(
            { sender: otherUserId, recipient: currentUser._id, isRead: false },
            { $set: { isRead: true } }
        );
        logger.info(`MessageService: Messages from ${otherUserId} to ${currentUser._id} marked as read.`);
    }


    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ_ALL,
        user: userId,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Message,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched ${type} messages.`,
        status: 'success',
        metadata: { filters }
    });

    return messages;
};

/**
 * Gets a single message by ID.
 * @param {string} messageId - The ID of the message.
 * @param {object} currentUser - The authenticated user.
 * @returns {Promise<Message>} The message document.
 * @throws {AppError} If message not found or user not authorized.
 */
const getMessageById = async (messageId, currentUser) => {
    const message = await Message.findById(messageId)
        .populate('sender', 'firstName lastName email role')
        .populate('recipient', 'firstName lastName email role')
        .populate('property', 'name')
        .populate('unit', 'unitName');

    if (!message) {
        throw new AppError('Message not found.', 404);
    }

    // Authorization: Only sender, recipient, or admin can view
    const isSender = message.sender.equals(currentUser._id);
    const isRecipient = message.recipient.equals(currentUser._id);
    const isAdmin = currentUser.role === ROLE_ENUM.ADMIN;

    if (!isSender && !isRecipient && !isAdmin) {
        throw new AppError('Not authorized to view this message.', 403);
    }

    // Mark as read if the current user is the recipient and it's unread
    if (isRecipient && !message.isRead) {
        message.isRead = true;
        await message.save();
        logger.info(`MessageService: Message ${messageId} marked as read by ${currentUser.email}.`);
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Message,
        resourceId: message._id,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched message ${message._id}.`,
        status: 'success'
    });

    return message;
};

/**
 * Marks a message as read.
 * @param {string} messageId - The ID of the message to mark as read.
 * @param {object} currentUser - The user marking the message as read.
 * @returns {Promise<Message>} The updated message document.
 * @throws {AppError} If message not found or user not authorized.
 */
const markMessageAsRead = async (messageId, currentUser) => {
    const message = await Message.findById(messageId);

    if (!message) {
        throw new AppError('Message not found.', 404);
    }

    // Only the recipient can mark a message as read
    if (!message.recipient.equals(currentUser._id)) {
        throw new AppError('Not authorized to mark this message as read.', 403);
    }

    if (message.isRead) {
        // Already read, no action needed, but return success
        return message;
    }

    const oldMessage = message.toObject(); // Capture old state for audit log

    message.isRead = true;
    const updatedMessage = await message.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Message,
        resourceId: updatedMessage._id,
        oldValue: { isRead: oldMessage.isRead },
        newValue: { isRead: updatedMessage.isRead },
        ipAddress: currentUser.ip,
        description: `Message ${updatedMessage._id} marked as read by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`MessageService: Message ${updatedMessage._id} marked as read by ${currentUser.email}.`);
    return updatedMessage;
};

/**
 * Deletes a message.
 * @param {string} messageId - The ID of the message to delete.
 * @param {object} currentUser - The user deleting the message.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If message not found or user not authorized.
 */
const deleteMessage = async (messageId, currentUser, ipAddress) => {
    const messageToDelete = await Message.findById(messageId);

    if (!messageToDelete) {
        throw new AppError('Message not found.', 404);
    }

    // Authorization: Only sender, recipient, or admin can delete
    const isSender = messageToDelete.sender.equals(currentUser._id);
    const isRecipient = messageToDelete.recipient.equals(currentUser._id);
    const isAdmin = currentUser.role === ROLE_ENUM.ADMIN;

    if (!isSender && !isRecipient && !isAdmin) {
        throw new AppError('Not authorized to delete this message.', 403);
    }

    const oldMessage = messageToDelete.toObject(); // Capture old state for audit log

    await messageToDelete.deleteOne();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Message,
        resourceId: messageId,
        oldValue: oldMessage,
        newValue: null,
        ipAddress: ipAddress,
        description: `Message ${oldMessage._id} (from ${oldMessage.sender} to ${oldMessage.recipient}) deleted by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`MessageService: Message ${oldMessage._id} deleted by ${currentUser.email}.`);
};

module.exports = {
    sendMessage,
    getMessages,
    getMessageById,
    markMessageAsRead,
    deleteMessage,
};
