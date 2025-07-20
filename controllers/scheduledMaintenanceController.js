// src/controllers/scheduledMaintenanceController.js

const asyncHandler = require('../utils/asyncHandler');
const scheduledMaintenanceService = require('../services/scheduledMaintenanceService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Create a new scheduled maintenance task
 * @route POST /api/scheduled-maintenance
 * @access Private (PropertyManager, Landlord, Admin)
 */
const createScheduledMaintenance = asyncHandler(async (req, res) => {
    try {
        const taskData = {
            ...req.body,
            files: req.files || []
        };
        
        // Parse frequency JSON if it's a string
        if (taskData.frequency && typeof taskData.frequency === 'string') {
            try {
                taskData.frequency = JSON.parse(taskData.frequency);
            } catch (e) {
                throw new AppError('Invalid frequency format. Must be a valid JSON object.', 400);
            }
        }
        
        const currentUser = req.user;
        const ipAddress = req.ip;

        const newTask = await scheduledMaintenanceService.createScheduledMaintenance(taskData, currentUser, ipAddress);

        res.status(201).json({
            success: true,
            message: 'Scheduled maintenance task created successfully.',
            data: newTask
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error creating task: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Get all scheduled maintenance tasks with filtering, search, and pagination
 * @route GET /api/scheduled-maintenance
 * @access Private (with access control)
 */
const getAllScheduledMaintenance = asyncHandler(async (req, res) => {
    try {
        const currentUser = req.user;
        const filters = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const result = await scheduledMaintenanceService.getAllScheduledMaintenance(currentUser, filters, page, limit);

        res.status(200).json({
            success: true,
            count: result.tasks.length,
            total: result.total,
            page: result.page,
            limit: result.limit,
            pages: result.pages,
            data: result.tasks
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error getting tasks: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Get a single scheduled maintenance task by ID
 * @route GET /api/scheduled-maintenance/:id
 * @access Private (with access control)
 */
const getScheduledMaintenanceById = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;

        const task = await scheduledMaintenanceService.getScheduledMaintenanceById(id, currentUser);

        res.status(200).json({
            success: true,
            data: task
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error getting task: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Update a scheduled maintenance task
 * @route PUT /api/scheduled-maintenance/:id
 * @access Private (PropertyManager, Landlord, Admin)
 */
const updateScheduledMaintenance = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip;
        
        // Parse frequency JSON if it's a string
        if (updateData.frequency && typeof updateData.frequency === 'string') {
            try {
                updateData.frequency = JSON.parse(updateData.frequency);
            } catch (e) {
                throw new AppError('Invalid frequency format. Must be a valid JSON object.', 400);
            }
        }

        const updatedTask = await scheduledMaintenanceService.updateScheduledMaintenance(id, updateData, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Scheduled maintenance task updated successfully.',
            data: updatedTask
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error updating task: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Delete a scheduled maintenance task
 * @route DELETE /api/scheduled-maintenance/:id
 * @access Private (PropertyManager, Landlord, Admin)
 */
const deleteScheduledMaintenance = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;
        const ipAddress = req.ip;

        await scheduledMaintenanceService.deleteScheduledMaintenance(id, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Scheduled maintenance task deleted successfully.'
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error deleting task: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Enable public link for a scheduled maintenance task
 * @route POST /api/scheduled-maintenance/:id/enable-public-link
 * @access Private (PropertyManager, Landlord, Admin)
 */
const enableScheduledMaintenancePublicLink = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const { expiresInDays } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip;

        const publicLink = await scheduledMaintenanceService.enableScheduledMaintenancePublicLink(id, expiresInDays, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Public link enabled successfully.',
            publicLink
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error enabling public link: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Disable public link for a scheduled maintenance task
 * @route POST /api/scheduled-maintenance/:id/disable-public-link
 * @access Private (PropertyManager, Landlord, Admin)
 */
const disableScheduledMaintenancePublicLink = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;
        const ipAddress = req.ip;

        await scheduledMaintenanceService.disableScheduledMaintenancePublicLink(id, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Public link disabled successfully.'
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error disabling public link: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Get external vendor view of a scheduled maintenance task
 * @route GET /api/scheduled-maintenance/public/:publicToken
 * @access Public
 */
const getPublicScheduledMaintenanceView = asyncHandler(async (req, res) => {
    try {
        const { publicToken } = req.params;

        const publicViewData = await scheduledMaintenanceService.getPublicScheduledMaintenanceView(publicToken);

        res.status(200).json({
            success: true,
            data: publicViewData
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error getting public view: ${error.message}`);
        throw error;
    }
});

/**
 * @desc External vendor updates status/comments for a scheduled maintenance task
 * @route POST /api/scheduled-maintenance/public/:publicToken/update
 * @access Public (limited functionality)
 */
const publicScheduledMaintenanceUpdate = asyncHandler(async (req, res) => {
    try {
        const { publicToken } = req.params;
        const updateData = req.body; // Includes status, commentMessage, name, phone
        const ipAddress = req.ip;

        const updatedTask = await scheduledMaintenanceService.publicScheduledMaintenanceUpdate(publicToken, updateData, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Scheduled maintenance task updated successfully via public link.',
            data: updatedTask
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error processing public update: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Upload media files to a scheduled maintenance task
 * @route POST /api/scheduled-maintenance/:id/media
 * @access Private (PropertyManager, Landlord, Admin)
 */
const uploadMedia = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const files = req.files;
        const currentUser = req.user;
        const ipAddress = req.ip;

        if (!files || files.length === 0) {
            throw new AppError('No files provided for upload.', 400);
        }

        const updatedTask = await scheduledMaintenanceService.uploadMediaToScheduledMaintenance(id, files, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Media uploaded successfully.',
            data: updatedTask
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error uploading media: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Delete a media file from a scheduled maintenance task
 * @route DELETE /api/scheduled-maintenance/:id/media
 * @access Private (PropertyManager, Landlord, Admin)
 */
const deleteMedia = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const { mediaUrl } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip;

        if (!mediaUrl) {
            throw new AppError('Media URL is required to delete a file.', 400);
        }

        const updatedTask = await scheduledMaintenanceService.deleteMediaFromScheduledMaintenance(id, mediaUrl, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Media deleted successfully.',
            data: updatedTask
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error deleting media: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Add a comment to a scheduled maintenance task
 * @route POST /api/scheduled-maintenance/:id/comments
 * @access Private (with access control)
 */
const addComment = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const { message, isInternalNote } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip;

        if (!message || message.trim() === '') {
            throw new AppError('Comment message cannot be empty.', 400);
        }

        const newComment = await scheduledMaintenanceService.addCommentToScheduledMaintenance(
            id, 
            message, 
            !!isInternalNote, 
            currentUser, 
            ipAddress
        );

        res.status(201).json({
            success: true,
            message: `${isInternalNote ? 'Internal note' : 'Comment'} added successfully.`,
            data: newComment
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error adding comment: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Create a maintenance request from a scheduled maintenance task
 * @route POST /api/scheduled-maintenance/:id/create-request
 * @access Private (PropertyManager, Landlord, Admin)
 */
const createRequest = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;
        const ipAddress = req.ip;

        const result = await scheduledMaintenanceService.createRequestFromScheduledMaintenance(id, currentUser, ipAddress);

        res.status(201).json({
            success: true,
            message: 'Maintenance request created successfully from scheduled maintenance task.',
            data: result
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error creating request: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Pause a scheduled maintenance task
 * @route PUT /api/scheduled-maintenance/:id/pause
 * @access Private (PropertyManager, Landlord, Admin)
 */
const pauseScheduledMaintenance = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;
        const ipAddress = req.ip;

        // Create update data for pausing
        const updateData = {
            status: 'paused',
            statusNotes: 'Task paused by user'
        };

        const updatedTask = await scheduledMaintenanceService.updateScheduledMaintenance(id, updateData, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Scheduled maintenance task paused successfully.',
            data: updatedTask
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error pausing task: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Resume a paused scheduled maintenance task
 * @route PUT /api/scheduled-maintenance/:id/resume
 * @access Private (PropertyManager, Landlord, Admin)
 */
const resumeScheduledMaintenance = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;
        const ipAddress = req.ip;

        // Create update data for resuming
        const updateData = {
            status: 'scheduled',
            statusNotes: 'Task resumed by user'
        };

        const updatedTask = await scheduledMaintenanceService.updateScheduledMaintenance(id, updateData, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Scheduled maintenance task resumed successfully.',
            data: updatedTask
        });
    } catch (error) {
        logger.error(`ScheduledMaintenanceController - Error resuming task: ${error.message}`);
        throw error;
    }
});

module.exports = {
    createScheduledMaintenance,
    getAllScheduledMaintenance,
    getScheduledMaintenanceById,
    updateScheduledMaintenance,
    deleteScheduledMaintenance,
    enableScheduledMaintenancePublicLink,
    disableScheduledMaintenancePublicLink,
    getPublicScheduledMaintenanceView,
    publicScheduledMaintenanceUpdate,
    uploadMedia,
    deleteMedia,
    addComment,
    createRequest,
    pauseScheduledMaintenance,
    resumeScheduledMaintenance
};