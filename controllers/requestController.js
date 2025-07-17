// src/controllers/requestController.js

const asyncHandler = require('../utils/asyncHandler'); // For handling async errors
const requestService = require('../services/requestService'); // Import the new request service
const logger = require('../utils/logger'); // Import logger
const AppError = require('../utils/AppError'); // Import custom AppError

/**
 * @desc Create a new maintenance request
 * @route POST /api/requests
 * @access Private (Tenant, PropertyManager, Landlord, Admin)
 * @body {string} title, {string} description, {string} category, {string} priority,
 * {string} propertyId, {string} [unitId], {Array<object>} [media] - Array of uploaded files from multer
 */
const createRequest = asyncHandler(async (req, res) => {
    const requestData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    // If files are uploaded via multer, they will be in req.files
    // The service will handle uploading these to Cloudinary
    requestData.media = req.files || []; // Pass multer files to service

    const newRequest = await requestService.createRequest(requestData, currentUser, ipAddress);

    res.status(201).json({
        success: true,
        message: 'Maintenance request created successfully.',
        request: newRequest
    });
});

/**
 * @desc Get all requests with filtering, search, and pagination
 * @route GET /api/requests
 * @access Private (with access control)
 * @query {string} [status] - Filter by request status
 * @query {string} [category] - Filter by category
 * @query {string} [priority] - Filter by priority
 * @query {string} [propertyId] - Filter by associated property
 * @query {string} [unitId] - Filter by associated unit
 * @query {string} [search] - Search by title or description
 * @query {Date} [startDate] - Filter requests created on or after this date
 * @query {Date} [endDate] - Filter requests created on or before this date
 * @query {string} [assignedToId] - Filter by assigned user/vendor ID
 * @query {string} [assignedToType] - Filter by assigned type ('User' or 'Vendor')
 * @query {number} [page=1] - Page number
 * @query {number} [limit=10] - Items per page
 */
const getAllRequests = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;

    const { requests, total, page: currentPage, limit: currentLimit } = await requestService.getAllRequests(currentUser, filters, page, limit);

    res.status(200).json({
        success: true,
        count: requests.length,
        total,
        page: currentPage,
        limit: currentLimit,
        data: requests
    });
});

/**
 * @desc Get specific request details by ID
 * @route GET /api/requests/:id
 * @access Private (with access control)
 * @param {string} id - Request ID from URL params
 */
const getRequestById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    const request = await requestService.getRequestById(id, currentUser);

    res.status(200).json({
        success: true,
        request: request
    });
});

/**
 * @desc Update a maintenance request (status, priority, description by authorized users)
 * @route PUT /api/requests/:id
 * @access Private (Admin, PropertyManager, Landlord - with access control; Tenant for limited fields)
 * @param {string} id - Request ID from URL params
 * @body {string} [title], {string} [description], {string} [category], {string} [priority], {string} [status]
 */
const updateRequest = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedRequest = await requestService.updateRequest(id, updateData, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Maintenance request updated successfully.',
        request: updatedRequest
    });
});

/**
 * @desc Delete a maintenance request
 * @route DELETE /api/requests/:id
 * @access Private (Admin, PropertyManager, Landlord)
 * @param {string} id - Request ID from URL params
 */
const deleteRequest = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await requestService.deleteRequest(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Maintenance request deleted successfully.'
    });
});

/**
 * @desc Assign request to vendor or internal staff
 * @route POST /api/requests/:id/assign
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} id - Request ID from URL params
 * @body {string} assignedToId - ID of the user/vendor to assign
 * @body {string} assignedToModel - 'User' or 'Vendor'
 */
const assignRequest = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { assignedToId, assignedToModel } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedRequest = await requestService.assignRequest(id, assignedToId, assignedToModel, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Request assigned successfully.',
        request: updatedRequest
    });
});


/**
 * @desc Upload media file(s) for a request
 * @route POST /api/requests/:id/media
 * @access Private (Tenant, PropertyManager, Landlord, Admin, Assigned Vendor/User)
 * @param {string} id - Request ID from URL params
 * @body {Array<object>} files - Array of uploaded files from multer (from req.files)
 */
const uploadMedia = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const files = req.files; // Files from multer middleware (upload.any() will populate this)
    const currentUser = req.user;
    const ipAddress = req.ip;

    // The service will handle iterating through files, uploading to Cloudinary,
    // and saving Media model entries, then updating the request.
    const updatedRequest = await requestService.uploadMediaToRequest(id, files, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Media uploaded successfully.',
        media: updatedRequest.media // Assuming service returns updated request with media
    });
});

/**
 * @desc Delete a media file from a request
 * @route DELETE /api/requests/:id/media
 * @access Private (Admin, PropertyManager, Landlord, Creator, Assigned Vendor/User)
 * @param {string} id - Request ID from URL params
 * @body {string} mediaUrl - The URL of the media to delete
 */
const deleteMedia = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { mediaUrl } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedRequest = await requestService.deleteMediaFromRequest(id, mediaUrl, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Media deleted successfully.',
        remainingMedia: updatedRequest.media
    });
});

/**
 * @desc Submit feedback for a completed request (Tenant only)
 * @route POST /api/requests/:id/feedback
 * @access Private (Tenant)
 * @param {string} id - Request ID from URL params
 * @body {number} rating - Rating (1-5)
 * @body {string} [comment] - Feedback comment
 */
const submitFeedback = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedRequest = await requestService.submitFeedback(id, rating, comment, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Feedback submitted successfully.',
        request: updatedRequest
    });
});

/**
 * @desc Enable public link for a request
 * @route POST /api/requests/:id/enable-public-link
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} id - Request ID from URL params
 * @body {number} [expiresInDays] - Optional: duration in days for the link to be valid.
 */
const enablePublicLink = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { expiresInDays } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const publicLink = await requestService.enablePublicLink(id, expiresInDays, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Public link enabled successfully.',
        publicLink: publicLink
    });
});

/**
 * @desc Disable public link for a request
 * @route POST /api/requests/:id/disable-public-link
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} id - Request ID from URL params
 */
const disablePublicLink = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await requestService.disablePublicLink(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Public link disabled successfully.'
    });
});

/**
 * @desc Get external vendor view of a request
 * @route GET /api/requests/public/:publicToken
 * @access Public
 * @param {string} publicToken - Public token from URL params
 */
const getPublicRequestView = asyncHandler(async (req, res) => {
    const { publicToken } = req.params;

    const publicViewData = await requestService.getPublicRequestView(publicToken);

    res.status(200).json({
        success: true,
        data: publicViewData
    });
});

/**
 * @desc External vendor updates status/comments for a request
 * @route POST /api/requests/public/:publicToken/update
 * @access Public (limited functionality)
 * @param {string} publicToken - Public token from URL params
 * @body {string} [status] - New status (e.g., 'in_progress', 'completed')
 * @body {string} [commentMessage] - New comment message
 * @body {string} name - Name of the external updater (required)
 * @body {string} phone - Phone of the external updater (required)
 */
const publicRequestUpdate = asyncHandler(async (req, res) => {
    const { publicToken } = req.params;
    const updateData = req.body; // Includes status, commentMessage, name, phone
    const ipAddress = req.ip;

    await requestService.publicRequestUpdate(publicToken, updateData, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Request updated successfully via public link.'
    });
});

/**
 * @desc Verify a completed request (PM/Landlord/Admin)
 * @route PUT /api/requests/:id/verify
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} id - Request ID from URL params
 */
const verifyRequest = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedRequest = await requestService.verifyRequest(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Request verified successfully.',
        request: updatedRequest
    });
});

/**
 * @desc Reopen a request (PM/Landlord/Admin)
 * @route PUT /api/requests/:id/reopen
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} id - Request ID from URL params
 */
const reopenRequest = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedRequest = await requestService.reopenRequest(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Request reopened successfully.',
        request: updatedRequest
    });
});

/**
 * @desc Archive a request (PM/Landlord/Admin)
 * @route PUT /api/requests/:id/archive
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} id - Request ID from URL params
 */
const archiveRequest = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedRequest = await requestService.archiveRequest(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Request archived successfully.',
        request: updatedRequest
    });
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
    archiveRequest,
};
