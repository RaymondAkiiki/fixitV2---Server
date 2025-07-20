// src/controllers/requestController.js

const asyncHandler = require('../utils/asyncHandler');
const requestService = require('../services/requestService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Create a new maintenance request
 * @route POST /api/requests
 * @access Private (Tenant, PropertyManager, Landlord, Admin)
 */
const createRequest = asyncHandler(async (req, res) => {
    try {
        const requestData = {
            ...req.body,
            files: req.files || []
        };
        
        const currentUser = req.user;
        const ipAddress = req.ip;

        const newRequest = await requestService.createRequest(requestData, currentUser, ipAddress);

        res.status(201).json({
            success: true,
            message: 'Maintenance request created successfully.',
            data: newRequest
        });
    } catch (error) {
        logger.error(`RequestController - Error creating request: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Get all requests with filtering, search, and pagination
 * @route GET /api/requests
 * @access Private (with access control)
 */
const getAllRequests = asyncHandler(async (req, res) => {
    try {
        const currentUser = req.user;
        const filters = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const result = await requestService.getAllRequests(currentUser, filters, page, limit);

        res.status(200).json({
            success: true,
            count: result.requests.length,
            total: result.total,
            page: result.page,
            limit: result.limit,
            pages: result.pages,
            data: result.requests
        });
    } catch (error) {
        logger.error(`RequestController - Error getting requests: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Get specific request details by ID
 * @route GET /api/requests/:id
 * @access Private (with access control)
 */
const getRequestById = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;

        const request = await requestService.getRequestById(id, currentUser);

        res.status(200).json({
            success: true,
            data: request
        });
    } catch (error) {
        logger.error(`RequestController - Error getting request: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Update a maintenance request (status, priority, description by authorized users)
 * @route PUT /api/requests/:id
 * @access Private (Admin, PropertyManager, Landlord - with access control; Tenant for limited fields)
 */
const updateRequest = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip;

        const updatedRequest = await requestService.updateRequest(id, updateData, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Maintenance request updated successfully.',
            data: updatedRequest
        });
    } catch (error) {
        logger.error(`RequestController - Error updating request: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Delete a maintenance request
 * @route DELETE /api/requests/:id
 * @access Private (Admin, PropertyManager, Landlord)
 */
const deleteRequest = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;
        const ipAddress = req.ip;

        await requestService.deleteRequest(id, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Maintenance request deleted successfully.'
        });
    } catch (error) {
        logger.error(`RequestController - Error deleting request: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Assign request to vendor or internal staff
 * @route POST /api/requests/:id/assign
 * @access Private (PropertyManager, Landlord, Admin)
 */
const assignRequest = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const { assignedToId, assignedToModel } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip;

        const updatedRequest = await requestService.assignRequest(id, assignedToId, assignedToModel, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Request assigned successfully.',
            data: updatedRequest
        });
    } catch (error) {
        logger.error(`RequestController - Error assigning request: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Upload media file(s) for a request
 * @route POST /api/requests/:id/media
 * @access Private (Tenant, PropertyManager, Landlord, Admin, Assigned Vendor/User)
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

        const updatedRequest = await requestService.uploadMediaToRequest(id, files, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Media uploaded successfully.',
            data: updatedRequest
        });
    } catch (error) {
        logger.error(`RequestController - Error uploading media: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Delete a media file from a request
 * @route DELETE /api/requests/:id/media
 * @access Private (Admin, PropertyManager, Landlord, Creator, Assigned Vendor/User)
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

        const updatedRequest = await requestService.deleteMediaFromRequest(id, mediaUrl, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Media deleted successfully.',
            data: updatedRequest
        });
    } catch (error) {
        logger.error(`RequestController - Error deleting media: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Submit feedback for a completed request (Tenant only)
 * @route POST /api/requests/:id/feedback
 * @access Private (Tenant)
 */
const submitFeedback = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const { rating, comment } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip;

        const updatedRequest = await requestService.submitFeedback(id, rating, comment, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Feedback submitted successfully.',
            data: updatedRequest
        });
    } catch (error) {
        logger.error(`RequestController - Error submitting feedback: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Enable public link for a request
 * @route POST /api/requests/:id/enable-public-link
 * @access Private (PropertyManager, Landlord, Admin)
 */
const enablePublicLink = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const { expiresInDays } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip;

        const publicLink = await requestService.enablePublicLink(id, expiresInDays, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Public link enabled successfully.',
            publicLink
        });
    } catch (error) {
        logger.error(`RequestController - Error enabling public link: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Disable public link for a request
 * @route POST /api/requests/:id/disable-public-link
 * @access Private (PropertyManager, Landlord, Admin)
 */
const disablePublicLink = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;
        const ipAddress = req.ip;

        await requestService.disablePublicLink(id, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Public link disabled successfully.'
        });
    } catch (error) {
        logger.error(`RequestController - Error disabling public link: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Get external vendor view of a request
 * @route GET /api/requests/public/:publicToken
 * @access Public
 */
const getPublicRequestView = asyncHandler(async (req, res) => {
    try {
        const { publicToken } = req.params;

        const publicViewData = await requestService.getPublicRequestView(publicToken);

        res.status(200).json({
            success: true,
            data: publicViewData
        });
    } catch (error) {
        logger.error(`RequestController - Error getting public request view: ${error.message}`);
        throw error;
    }
});

/**
 * @desc External vendor updates status/comments for a request
 * @route POST /api/requests/public/:publicToken/update
 * @access Public (limited functionality)
 */
const publicRequestUpdate = asyncHandler(async (req, res) => {
    try {
        const { publicToken } = req.params;
        const updateData = req.body;
        const ipAddress = req.ip;

        const updatedRequest = await requestService.publicRequestUpdate(publicToken, updateData, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Request updated successfully via public link.',
            data: updatedRequest
        });
    } catch (error) {
        logger.error(`RequestController - Error updating request via public link: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Verify a completed request (PM/Landlord/Admin)
 * @route PUT /api/requests/:id/verify
 * @access Private (PropertyManager, Landlord, Admin)
 */
const verifyRequest = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;
        const ipAddress = req.ip;

        const updatedRequest = await requestService.verifyRequest(id, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Request verified successfully.',
            data: updatedRequest
        });
    } catch (error) {
        logger.error(`RequestController - Error verifying request: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Reopen a request (PM/Landlord/Admin)
 * @route PUT /api/requests/:id/reopen
 * @access Private (PropertyManager, Landlord, Admin)
 */
const reopenRequest = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;
        const ipAddress = req.ip;

        const updatedRequest = await requestService.reopenRequest(id, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Request reopened successfully.',
            data: updatedRequest
        });
    } catch (error) {
        logger.error(`RequestController - Error reopening request: ${error.message}`);
        throw error;
    }
});

/**
 * @desc Archive a request (PM/Landlord/Admin)
 * @route PUT /api/requests/:id/archive
 * @access Private (PropertyManager, Landlord, Admin)
 */
const archiveRequest = asyncHandler(async (req, res) => {
    try {
        const { id } = req.params;
        const currentUser = req.user;
        const ipAddress = req.ip;

        const updatedRequest = await requestService.archiveRequest(id, currentUser, ipAddress);

        res.status(200).json({
            success: true,
            message: 'Request archived successfully.',
            data: updatedRequest
        });
    } catch (error) {
        logger.error(`RequestController - Error archiving request: ${error.message}`);
        throw error;
    }
});

module.exports = {
    createRequest,
    getAllRequests,
    getRequestById,
    updateRequest,
    deleteRequest,
    assignRequest,
    uploadMedia,
    deleteMedia,
    submitFeedback,
    enablePublicLink,
    disablePublicLink,
    getPublicRequestView,
    publicRequestUpdate,
    verifyRequest,
    reopenRequest,
    archiveRequest
};