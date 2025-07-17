// src/controllers/scheduledMaintenanceController.js

const asyncHandler = require('../utils/asyncHandler'); // For handling async errors
const scheduledMaintenanceService = require('../services/scheduledMaintenanceService'); // Import the new service
const logger = require('../utils/logger'); // Import logger
const AppError = require('../utils/AppError'); // Import custom AppError

/**
 * @desc Create a new scheduled maintenance task
 * @route POST /api/scheduled-maintenance
 * @access Private (PropertyManager, Landlord, Admin)
 * @body {string} title, {string} description, {string} category, {string} property, {string} [unit],
 * {Date} scheduledDate, {boolean} recurring, {object} [frequency], {string} [assignedToId], {string} [assignedToModel],
 * {string[]} [media] - Array of media URLs/IDs
 */
const createScheduledMaintenance = asyncHandler(async (req, res) => {
    const taskData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    // Media handling: assuming media is already uploaded and URLs/IDs are in req.body.media
    // If files are uploaded via multer, they would be processed by uploadMiddleware
    // and then their Cloudinary URLs would be added to taskData.media before calling the service.

    const newTask = await scheduledMaintenanceService.createScheduledMaintenance(taskData, currentUser, ipAddress);

    res.status(201).json({
        success: true,
        message: 'Scheduled maintenance task created successfully.',
        task: newTask
    });
});

/**
 * @desc Get all scheduled maintenance tasks with filtering, search, and pagination
 * @route GET /api/scheduled-maintenance
 * @access Private (with access control)
 * @query {string} [status] - Filter by task status
 * @query {boolean} [recurring] - Filter by recurrence (true/false)
 * @query {string} [propertyId] - Filter by associated property
 * @query {string} [unitId] - Filter by associated unit
 * @query {string} [category] - Filter by category
 * @query {string} [search] - Search by title or description
 * @query {Date} [startDate] - Filter tasks scheduled on or after this date
 * @query {Date} [endDate] - Filter tasks scheduled on or before this date
 * @query {number} [page=1] - Page number
 * @query {number} [limit=10] - Items per page
 */
const getAllScheduledMaintenance = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;

    const { tasks, total, page: currentPage, limit: currentLimit } = await scheduledMaintenanceService.getAllScheduledMaintenance(currentUser, filters, page, limit);

    res.status(200).json({
        success: true,
        count: tasks.length,
        total,
        page: currentPage,
        limit: currentLimit,
        data: tasks
    });
});

/**
 * @desc Get a single scheduled maintenance task by ID
 * @route GET /api/scheduled-maintenance/:id
 * @access Private (with access control)
 * @param {string} id - Task ID from URL params
 */
const getScheduledMaintenanceById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    const task = await scheduledMaintenanceService.getScheduledMaintenanceById(id, currentUser);

    res.status(200).json({
        success: true,
        task: task
    });
});

/**
 * @desc Update a scheduled maintenance task
 * @route PUT /api/scheduled-maintenance/:id
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} id - Task ID from URL params
 * @body {string} [title], {string} [description], {string} [category], {Date} [scheduledDate],
 * {boolean} [recurring], {object} [frequency], {string} [assignedToId], {string} [assignedToModel],
 * {string} [status], {string[]} [media]
 */
const updateScheduledMaintenance = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedTask = await scheduledMaintenanceService.updateScheduledMaintenance(id, updateData, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Scheduled maintenance task updated successfully.',
        task: updatedTask
    });
});

/**
 * @desc Delete a scheduled maintenance task
 * @route DELETE /api/scheduled-maintenance/:id
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} id - Task ID from URL params
 */
const deleteScheduledMaintenance = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await scheduledMaintenanceService.deleteScheduledMaintenance(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Scheduled maintenance task deleted successfully.'
    });
});

/**
 * @desc Enable public link for a scheduled maintenance task
 * @route POST /api/scheduled-maintenance/:id/enable-public-link
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} id - Task ID from URL params
 * @body {number} [expiresInDays] - Optional: duration in days for the link to be valid.
 */
const enableScheduledMaintenancePublicLink = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { expiresInDays } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const publicLink = await scheduledMaintenanceService.enableScheduledMaintenancePublicLink(id, expiresInDays, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Public link enabled successfully.',
        publicLink: publicLink
    });
});

/**
 * @desc Disable public link for a scheduled maintenance task
 * @route POST /api/scheduled-maintenance/:id/disable-public-link
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} id - Task ID from URL params
 */
const disableScheduledMaintenancePublicLink = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await scheduledMaintenanceService.disableScheduledMaintenancePublicLink(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Public link disabled successfully.'
    });
});

/**
 * @desc Get external vendor view of a scheduled maintenance task
 * @route GET /api/scheduled-maintenance/public/:publicToken
 * @access Public
 * @param {string} publicToken - Public token from URL params
 */
const getPublicScheduledMaintenanceView = asyncHandler(async (req, res) => {
    const { publicToken } = req.params;

    const publicViewData = await scheduledMaintenanceService.getPublicScheduledMaintenanceView(publicToken);

    res.status(200).json({
        success: true,
        data: publicViewData
    });
});

/**
 * @desc External vendor updates status/comments for a scheduled maintenance task
 * @route POST /api/scheduled-maintenance/public/:publicToken/update
 * @access Public (limited functionality)
 * @param {string} publicToken - Public token from URL params
 * @body {string} [status] - New status (e.g., 'in_progress', 'completed')
 * @body {string} [commentMessage] - New comment message
 * @body {string} name - Name of the external updater (required)
 * @body {string} phone - Phone of the external updater (required)
 */
const publicScheduledMaintenanceUpdate = asyncHandler(async (req, res) => {
    const { publicToken } = req.params;
    const updateData = req.body; // Includes status, commentMessage, name, phone
    const ipAddress = req.ip;

    await scheduledMaintenanceService.publicScheduledMaintenanceUpdate(publicToken, updateData, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Scheduled maintenance task updated successfully via public link.'
    });
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
};
