// src/controllers/publicController.js

const asyncHandler = require('../utils/asyncHandler');
const publicService = require('../services/publicService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { validationResult } = require('express-validator');

/**
 * @desc Get a request via public link
 * @route GET /api/public/requests/:publicToken
 * @access Public
 * @param {string} publicToken - The public token from URL params
 */
const getPublicRequest = asyncHandler(async (req, res) => {
  // Extract request information
  const { publicToken } = req.params;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  // Call service method
  const publicRequestView = await publicService.getPublicRequest(publicToken, ipAddress, userAgent);

  // Send response
  return res.status(200).json({
    success: true,
    data: publicRequestView
  });
});

/**
 * @desc Add a comment to a request via public link
 * @route POST /api/public/requests/:publicToken/comments
 * @access Public
 * @param {string} publicToken - The public token from URL params
 * @body {string} message - The comment message
 * @body {string} externalUserName - Name of the external user
 * @body {string} externalUserEmail - Email of the external user
 */
const addPublicCommentToRequest = asyncHandler(async (req, res) => {
  // Extract request information
  const { publicToken } = req.params;
  const commentData = req.body;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  // Call service method
  const newComment = await publicService.addPublicCommentToRequest(publicToken, commentData, ipAddress, userAgent);

  // Send response
  return res.status(201).json({
    success: true,
    message: 'Comment added successfully',
    data: newComment
  });
});

/**
 * @desc Get a scheduled maintenance task via public link
 * @route GET /api/public/scheduled-maintenances/:publicToken
 * @access Public
 * @param {string} publicToken - The public token from URL params
 */
const getPublicScheduledMaintenance = asyncHandler(async (req, res) => {
  // Extract request information
  const { publicToken } = req.params;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  // Call service method
  const publicMaintenanceView = await publicService.getPublicScheduledMaintenance(publicToken, ipAddress, userAgent);

  // Send response
  return res.status(200).json({
    success: true,
    data: publicMaintenanceView
  });
});

/**
 * @desc Add a comment to a scheduled maintenance task via public link
 * @route POST /api/public/scheduled-maintenances/:publicToken/comments
 * @access Public
 * @param {string} publicToken - The public token from URL params
 * @body {string} message - The comment message
 * @body {string} externalUserName - Name of the external user
 * @body {string} externalUserEmail - Email of the external user
 */
const addPublicCommentToScheduledMaintenance = asyncHandler(async (req, res) => {
  // Extract request information
  const { publicToken } = req.params;
  const commentData = req.body;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  // Call service method
  const newComment = await publicService.addPublicCommentToScheduledMaintenance(publicToken, commentData, ipAddress, userAgent);

  // Send response
  return res.status(201).json({
    success: true,
    message: 'Comment added successfully',
    data: newComment
  });
});

module.exports = {
  getPublicRequest,
  addPublicCommentToRequest,
  getPublicScheduledMaintenance,
  addPublicCommentToScheduledMaintenance
};