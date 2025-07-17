// src/controllers/commentController.js

const asyncHandler = require('../utils/asyncHandler'); // For handling async errors
const commentService = require('../services/commentService'); // Import the new comment service
const logger = require('../utils/logger'); // Import logger
const AppError = require('../utils/AppError'); // Import custom AppError

/**
 * @desc Add a comment to a specific resource context
 * @route POST /api/comments
 * @access Private (Authenticated users with context-specific authorization)
 * @body {string} contextType - The type of resource (e.g., 'Request', 'ScheduledMaintenance', 'Property', 'Unit')
 * @body {string} contextId - The ID of the resource
 * @body {string} message - The comment message
 * @body {boolean} [isExternal=false] - True if the comment is from an external user (e.g., public link)
 * @body {string} [externalUserName] - Name of the external user if isExternal is true
 * @body {string} [externalUserEmail] - Email of the external user if isExternal is true
 * @body {boolean} [isInternalNote=false] - True if the comment is an internal note (only visible to internal users)
 * @body {Array<string>} [media=[]] - Array of Media ObjectIds associated with the comment
 */
const addComment = asyncHandler(async (req, res) => {
    const commentData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const newComment = await commentService.addComment(commentData, currentUser, ipAddress);

    res.status(201).json({
        success: true,
        message: 'Comment added successfully.',
        data: newComment
    });
});

/**
 * @desc List comments for a specific resource context
 * @route GET /api/comments
 * @access Private (Authenticated users with context-specific authorization)
 * @query {string} contextType - The type of resource
 * @query {string} contextId - The ID of the resource
 */
const listComments = asyncHandler(async (req, res) => {
    const { contextType, contextId } = req.query;
    const currentUser = req.user;

    const comments = await commentService.listComments(contextType, contextId, currentUser);

    res.status(200).json({
        success: true,
        count: comments.length,
        data: comments
    });
});

/**
 * @desc Update a specific comment
 * @route PUT /api/comments/:id
 * @access Private (Only the sender of the comment or Admin)
 * @param {string} id - The ID of the comment to update
 * @body {string} [message] - New message for the comment
 * @body {boolean} [isInternalNote] - New value for internal note status
 * @body {Array<string>} [media] - New array of Media ObjectIds associated with the comment
 */
const updateComment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedComment = await commentService.updateComment(id, updateData, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Comment updated successfully.',
        data: updatedComment
    });
});

/**
 * @desc Delete a specific comment
 * @route DELETE /api/comments/:id
 * @access Private (Only the sender of the comment or Admin)
 * @param {string} id - The ID of the comment to delete
 */
const deleteComment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await commentService.deleteComment(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Comment deleted successfully.'
    });
});

module.exports = {
    addComment,
    listComments,
    updateComment,
    deleteComment,
};
