// src/controllers/mediaController.js

const asyncHandler = require('../utils/asyncHandler');
const mediaService = require('../services/mediaService'); // Import the new media service
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Get all media records
 * @route GET /api/media
 * @access Private (Admin, Uploader, or user with access to related resource)
 * @query {string} [relatedTo] - Filter by type of related resource (e.g., 'Request', 'Property')
 * @query {string} [relatedId] - Filter by ID of related resource
 * @query {string} [uploadedBy] - Filter by uploader's ID
 * @query {string} [mimeType] - Filter by MIME type (partial match)
 * @query {boolean} [isPublic] - Filter by public status
 * @query {string} [search] - Search by original filename, description, or tags
 * @query {number} [page=1] - Page number
 * @query {number} [limit=10] - Items per page
 */
const getAllMedia = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;

    const { media, total, page, limit } = await mediaService.getAllMedia(currentUser, filters);

    res.status(200).json({
        success: true,
        count: media.length,
        total,
        page,
        limit,
        data: media
    });
});

/**
 * @desc Get a single media record by ID
 * @route GET /api/media/:id
 * @access Private (Admin, Uploader, or user with access to related resource)
 * @param {string} id - Media ID from URL params
 */
const getMediaById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    const mediaDoc = await mediaService.getMediaById(id, currentUser);

    res.status(200).json({
        success: true,
        data: mediaDoc
    });
});

/**
 * @desc Update a media record's metadata
 * @route PUT /api/media/:id
 * @access Private (Admin, Uploader)
 * @param {string} id - Media ID from URL params
 * @body {string} [description] - New description for the media
 * @body {Array<string>} [tags] - New array of tags
 * @body {boolean} [isPublic] - New public status
 */
const updateMedia = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body; // description, tags, isPublic
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedMedia = await mediaService.updateMedia(id, updateData, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Media metadata updated successfully.',
        data: updatedMedia
    });
});

/**
 * @desc Delete a media record and its file from storage
 * @route DELETE /api/media/:id
 * @access Private (Admin, Uploader)
 * @param {string} id - Media ID from URL params
 */
const deleteMedia = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await mediaService.deleteMedia(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Media record and associated file deleted successfully.'
    });
});

module.exports = {
    getAllMedia,
    getMediaById,
    updateMedia,
    deleteMedia,
};
