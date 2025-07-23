// src/controllers/mediaController.js

const asyncHandler = require('../utils/asyncHandler');
const mediaService = require('../services/mediaService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Get all media records with filtering and pagination
 * @route GET /api/media
 * @access Private
 */
const getAllMedia = asyncHandler(async (req, res) => {
  const currentUser = req.user;
  const filters = req.query;
  const ipAddress = req.ip;

  const { media, total, page, limit, totalPages } = await mediaService.getAllMedia(
    currentUser, 
    filters,
    ipAddress
  );

  res.status(200).json({
    success: true,
    count: media.length,
    total,
    page,
    limit,
    totalPages,
    data: media
  });
});

/**
 * @desc Get a single media record by ID
 * @route GET /api/media/:id
 * @access Private
 */
const getMediaById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const currentUser = req.user;
  const ipAddress = req.ip;

  const mediaDoc = await mediaService.getMediaById(id, currentUser, ipAddress);

  res.status(200).json({
    success: true,
    data: mediaDoc
  });
});

/**
 * @desc Update a media record's metadata
 * @route PUT /api/media/:id
 * @access Private
 */
const updateMedia = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
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
 * @access Private
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

/**
 * @desc Get media usage statistics
 * @route GET /api/media/stats
 * @access Private
 */
const getMediaStats = asyncHandler(async (req, res) => {
  const currentUser = req.user;
  const ipAddress = req.ip;

  const stats = await mediaService.getMediaStats(currentUser, ipAddress);

  res.status(200).json({
    success: true,
    data: stats
  });
});

/**
 * @desc Get all media related to a specific resource
 * @route GET /api/media/by-resource/:resourceType/:resourceId
 * @access Private
 */
const getMediaByResource = asyncHandler(async (req, res) => {
  const { resourceType, resourceId } = req.params;
  const currentUser = req.user;
  const ipAddress = req.ip;

  const filters = {
    ...req.query,
    relatedTo: resourceType,
    relatedId: resourceId
  };

  const { media, total, page, limit, totalPages } = await mediaService.getAllMedia(
    currentUser, 
    filters,
    ipAddress
  );

  res.status(200).json({
    success: true,
    count: media.length,
    total,
    page,
    limit,
    totalPages,
    data: media
  });
});

module.exports = {
  getAllMedia,
  getMediaById,
  updateMedia,
  deleteMedia,
  getMediaStats,
  getMediaByResource
};