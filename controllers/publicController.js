// src/controllers/publicController.js

const asyncHandler = require('../utils/asyncHandler');
const publicService = require('../services/publicService'); // Import the new public service
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Get a request via public link
 * @route GET /public/requests/:publicToken
 * @access Public
 * @param {string} publicToken - The public token from URL params
 */
const getPublicRequest = asyncHandler(async (req, res) => {
    const { publicToken } = req.params;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    const publicRequestView = await publicService.getPublicRequest(publicToken, ipAddress, userAgent);

    res.status(200).json({
        success: true,
        data: publicRequestView
    });
});

/**
 * @desc Add a comment to a request via public link
 * @route POST /public/requests/:publicToken/comments
 * @access Public
 * @param {string} publicToken - The public token from URL params
 * @body {string} message - The comment message
 * @body {string} externalUserName - Name of the external user
 * @body {string} externalUserEmail - Email of the external user
 */
const addPublicCommentToRequest = asyncHandler(async (req, res) => {
    const { publicToken } = req.params;
    const commentData = req.body; // Contains message, externalUserName, externalUserEmail
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    const newComment = await publicService.addPublicCommentToRequest(publicToken, commentData, ipAddress, userAgent);

    res.status(201).json({
        success: true,
        message: 'Comment added successfully.',
        commentId: newComment._id
    });
});

/**
 * @desc Get a scheduled maintenance task via public link
 * @route GET /public/scheduled-maintenance/:publicToken
 * @access Public
 * @param {string} publicToken - The public token from URL params
 */
const getPublicScheduledMaintenance = asyncHandler(async (req, res) => {
    const { publicToken } = req.params;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    const publicMaintenanceView = await publicService.getPublicScheduledMaintenance(publicToken, ipAddress, userAgent);

    res.status(200).json({
        success: true,
        data: publicMaintenanceView
    });
});

/**
 * @desc Add a comment to a scheduled maintenance task via public link
 * @route POST /public/scheduled-maintenance/:publicToken/comments
 * @access Public
 * @param {string} publicToken - The public token from URL params
 * @body {string} message - The comment message
 * @body {string} externalUserName - Name of the external user
 * @body {string} externalUserEmail - Email of the external user
 */
const addPublicCommentToScheduledMaintenance = asyncHandler(async (req, res) => {
    const { publicToken } = req.params;
    const commentData = req.body; // Contains message, externalUserName, externalUserEmail
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    const newComment = await publicService.addPublicCommentToScheduledMaintenance(publicToken, commentData, ipAddress, userAgent);

    res.status(201).json({
        success: true,
        message: 'Comment added successfully.',
        commentId: newComment._id
    });
});


module.exports = {
    getPublicRequest,
    addPublicCommentToRequest,
    getPublicScheduledMaintenance,
    addPublicCommentToScheduledMaintenance,
};
