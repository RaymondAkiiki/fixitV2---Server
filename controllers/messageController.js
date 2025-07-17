// src/controllers/messageController.js

const asyncHandler = require('../utils/asyncHandler'); // For handling async errors
const messageService = require('../services/messageService'); // Import the new message service
const logger = require('../utils/logger'); // Import logger
const AppError = require('../utils/AppError'); // Import custom AppError

/**
 * @desc Send a new message
 * @route POST /api/messages
 * @access Private
 * @body {string} recipientId - The ID of the user who will receive the message
 * @body {string} content - The message content
 * @body {string} [propertyId] - Optional. The ID of the property related to the message context
 * @body {string} [unitId] - Optional. The ID of the unit related to the message context
 * @body {string} [category='general'] - Optional. Category of the message (e.g., 'general', 'support', 'billing')
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
 * @desc Get messages for the logged-in user (inbox or sent)
 * @route GET /api/messages
 * @access Private
 * @query {string} [type='inbox'] - 'inbox' or 'sent'
 * @query {string} [propertyId] - Filter messages by property ID
 * @query {string} [unitId] - Filter messages by unit ID
 * @query {string} [otherUserId] - Filter messages by conversation with a specific user ID
 */
const getMessages = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;

    const messages = await messageService.getMessages(currentUser, filters);

    res.status(200).json({
        success: true,
        count: messages.length,
        data: messages
    });
});

/**
 * @desc Get a single message by ID
 * @route GET /api/messages/:id
 * @access Private (Accessible if sender, recipient, or admin)
 * @param {string} id - Message ID from URL params
 */
const getMessageById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    const message = await messageService.getMessageById(id, currentUser);

    res.status(200).json({
        success: true,
        data: message
    });
});

/**
 * @desc Mark a message as read
 * @route PATCH /api/messages/:id/read
 * @access Private (Recipient only)
 * @param {string} id - Message ID from URL params
 */
const markMessageAsRead = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    const updatedMessage = await messageService.markMessageAsRead(id, currentUser);

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
 * @param {string} id - Message ID from URL params
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

module.exports = {
    sendMessage,
    getMessages,
    getMessageById,
    markMessageAsRead,
    deleteMessage,
};
