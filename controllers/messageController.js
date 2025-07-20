// src/controllers/messageController.js

const asyncHandler = require('../utils/asyncHandler');
const messageService = require('../services/messageService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Send a new message
 * @route POST /api/messages
 * @access Private
 */
const sendMessage = asyncHandler(async (req, res) => {
    const messageData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const newMessage = await messageService.sendMessage(messageData, currentUser, ipAddress);

    res.status(201).json({
        success: true,
        message: 'Message sent successfully.',
        data: newMessage
    });
});

/**
 * @desc Get messages for the logged-in user (inbox, sent, or conversation)
 * @route GET /api/messages
 * @access Private
 */
const getMessages = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = {
        type: req.query.type,
        propertyId: req.query.propertyId,
        unitId: req.query.unitId,
        otherUserId: req.query.otherUserId,
        category: req.query.category,
        unreadOnly: req.query.unreadOnly === 'true',
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50
    };

    const result = await messageService.getMessages(currentUser, filters);

    res.status(200).json({
        success: true,
        count: result.messages.length,
        pagination: result.pagination,
        data: result.messages
    });
});

/**
 * @desc Get a single message by ID
 * @route GET /api/messages/:id
 * @access Private (Accessible if sender, recipient, or admin)
 */
const getMessageById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const message = await messageService.getMessageById(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        data: message
    });
});

/**
 * @desc Mark a message as read
 * @route PATCH /api/messages/:id/read
 * @access Private (Recipient only)
 */
const markMessageAsRead = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedMessage = await messageService.markMessageAsRead(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: updatedMessage.isRead ? 'Message marked as read successfully.' : 'Message is already marked as read.',
        data: updatedMessage
    });
});

/**
 * @desc Delete a message
 * @route DELETE /api/messages/:id
 * @access Private (Sender, Recipient, or Admin)
 */
const deleteMessage = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await messageService.deleteMessage(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Message deleted successfully.'
    });
});

/**
 * @desc Get unread message count
 * @route GET /api/messages/unread/count
 * @access Private
 */
const getUnreadMessageCount = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const filters = {
        propertyId: req.query.propertyId,
        category: req.query.category
    };
    
    const count = await messageService.getUnreadMessageCount(userId, filters);
    
    res.status(200).json({
        success: true,
        count
    });
});

/**
 * @desc Mark all messages in a conversation as read
 * @route POST /api/messages/mark-conversation-read
 * @access Private
 */
const markConversationAsRead = asyncHandler(async (req, res) => {
    const { otherUserId, propertyId } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;
    
    if (!otherUserId) {
        throw new AppError('Other user ID is required.', 400);
    }
    
    const count = await messageService.markAllConversationAsRead(otherUserId, currentUser, {
        propertyId,
        ipAddress
    });
    
    res.status(200).json({
        success: true,
        message: `${count} messages marked as read.`,
        count
    });
});

module.exports = {
    sendMessage,
    getMessages,
    getMessageById,
    markMessageAsRead,
    deleteMessage,
    getUnreadMessageCount,
    markConversationAsRead
};