// src/controllers/commentController.js

const asyncHandler = require('../utils/asyncHandler');
const commentService = require('../services/commentService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Add a comment to a specific resource context
 * @route POST /api/comments
 * @access Private (Authenticated users with context-specific authorization)
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
 */
const listComments = asyncHandler(async (req, res) => {
    const { contextType, contextId } = req.query;
    const { includeInternal, limit, sort, order } = req.query;
    const currentUser = req.user;
    
    // Parse options
    const options = {
        includeInternal: includeInternal === 'false' ? false : true,
        limit: limit ? parseInt(limit) : undefined,
        sort: sort || undefined,
        order: order || undefined
    };

    const comments = await commentService.listComments(contextType, contextId, currentUser, options);

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

/**
 * @desc Get unread mention count for current user
 * @route GET /api/comments/mentions/count
 * @access Private
 */
const getUnreadMentionCount = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    
    const count = await commentService.getUnreadMentionCount(userId);
    
    res.status(200).json({
        success: true,
        count
    });
});

/**
 * @desc Mark mentions as read for current user in a specific context
 * @route POST /api/comments/mentions/mark-read
 * @access Private
 */
const markMentionsAsRead = asyncHandler(async (req, res) => {
    const { contextType, contextId } = req.body;
    const userId = req.user._id;
    
    if (!contextType || !contextId) {
        throw new AppError('Context type and context ID are required.', 400);
    }
    
    const updatedCount = await commentService.markMentionsAsRead(userId, contextType, contextId);
    
    res.status(200).json({
        success: true,
        message: `Marked ${updatedCount} mentions as read.`,
        count: updatedCount
    });
});

module.exports = {
    addComment,
    listComments,
    updateComment,
    deleteComment,
    getUnreadMentionCount,
    markMentionsAsRead
};