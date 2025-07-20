// src/services/publicService.js

const { Request, ScheduledMaintenance, Comment, User, PropertyUser } = require('../models');
const { createAuditLog } = require('./auditService');
const notificationService = require('./notificationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { 
  AUDIT_ACTION_ENUM, 
  AUDIT_RESOURCE_TYPE_ENUM, 
  PROPERTY_USER_ROLES_ENUM,
  ROLE_ENUM
} = require('../utils/constants/enums');
const crypto = require('crypto');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Sanitize request data for public view
 * @param {Object} request - Request document
 * @returns {Object} Sanitized request data for public consumption
 */
const sanitizeRequestForPublic = (request) => {
  // Get assignee name in a safe way
  let assignedToName = null;
  if (request.assignedTo) {
    if (request.assignedToModel === 'User' && request.assignedTo.firstName) {
      assignedToName = `${request.assignedTo.firstName} ${request.assignedTo.lastName || ''}`.trim();
    } else if (request.assignedToModel === 'Vendor') {
      assignedToName = request.assignedTo.name || request.assignedTo.contactPerson || 'Assigned Vendor';
    }
  }

  // Sanitize comments to show only what's necessary
  const sanitizedComments = request.comments.map(comment => ({
    _id: comment._id,
    message: comment.message,
    createdAt: comment.createdAt,
    isExternal: comment.isExternal,
    externalUserName: comment.isExternal ? comment.externalUserName : null,
    senderName: !comment.isExternal && comment.sender ? 
      `${comment.sender.firstName || ''} ${comment.sender.lastName || ''}`.trim() : null,
  }));

  // Sanitize media to only include necessary fields
  const sanitizedMedia = request.media ? request.media.map(media => ({
    _id: media._id,
    url: media.url,
    thumbnailUrl: media.thumbnailUrl,
    filename: media.filename,
    mimeType: media.mimeType,
    description: media.description
  })) : [];

  // Return only fields necessary for public view
  return {
    _id: request._id,
    title: request.title,
    description: request.description,
    status: request.status,
    category: request.category,
    priority: request.priority,
    property: request.property ? {
      name: request.property.name,
      address: {
        street: request.property.address.street,
        city: request.property.address.city,
        state: request.property.address.state,
        zipCode: request.property.address.zipCode,
        country: request.property.address.country
      }
    } : null,
    unit: request.unit ? { unitName: request.unit.unitName } : null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    assignedToName,
    comments: sanitizedComments,
    media: sanitizedMedia,
    publicLinkExpiresAt: request.publicLinkExpiresAt
  };
};

/**
 * Sanitize scheduled maintenance data for public view
 * @param {Object} maintenance - Scheduled maintenance document
 * @returns {Object} Sanitized maintenance data for public consumption
 */
const sanitizeMaintenanceForPublic = (maintenance) => {
  // Get assignee name in a safe way
  let assignedToName = null;
  if (maintenance.assignedTo) {
    if (maintenance.assignedToModel === 'User' && maintenance.assignedTo.firstName) {
      assignedToName = `${maintenance.assignedTo.firstName} ${maintenance.assignedTo.lastName || ''}`.trim();
    } else if (maintenance.assignedToModel === 'Vendor') {
      assignedToName = maintenance.assignedTo.name || maintenance.assignedTo.contactPerson || 'Assigned Vendor';
    }
  }

  // Sanitize comments to show only what's necessary
  const sanitizedComments = maintenance.comments.map(comment => ({
    _id: comment._id,
    message: comment.message,
    createdAt: comment.createdAt,
    isExternal: comment.isExternal,
    externalUserName: comment.isExternal ? comment.externalUserName : null,
    senderName: !comment.isExternal && comment.sender ? 
      `${comment.sender.firstName || ''} ${comment.sender.lastName || ''}`.trim() : null,
  }));

  // Sanitize media to only include necessary fields
  const sanitizedMedia = maintenance.media ? maintenance.media.map(media => ({
    _id: media._id,
    url: media.url,
    thumbnailUrl: media.thumbnailUrl,
    filename: media.filename,
    mimeType: media.mimeType,
    description: media.description
  })) : [];

  return {
    _id: maintenance._id,
    title: maintenance.title,
    description: maintenance.description,
    category: maintenance.category,
    status: maintenance.status,
    scheduledDate: maintenance.scheduledDate,
    completedDate: maintenance.completedDate,
    property: maintenance.property ? {
      name: maintenance.property.name,
      address: {
        street: maintenance.property.address.street,
        city: maintenance.property.address.city,
        state: maintenance.property.address.state,
        zipCode: maintenance.property.address.zipCode,
        country: maintenance.property.address.country
      }
    } : null,
    unit: maintenance.unit ? { unitName: maintenance.unit.unitName } : null,
    createdAt: maintenance.createdAt,
    updatedAt: maintenance.updatedAt,
    assignedToName,
    comments: sanitizedComments,
    media: sanitizedMedia,
    publicLinkExpires: maintenance.publicLinkExpires
  };
};

/**
 * Get relevant property management users to notify about new comments
 * @param {string} propertyId - Property ID to find managers for
 * @returns {Promise<string[]>} Array of user IDs
 */
const getPropertyManagementUsers = async (propertyId) => {
  const managementRoles = [
    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
  ];
  
  try {
    const propertyManagementUsers = await PropertyUser.find({
      property: propertyId,
      isActive: true,
      roles: { $in: managementRoles }
    }).distinct('user');
    
    return propertyManagementUsers;
  } catch (error) {
    logger.error(`PublicService - Error getting property management users: ${error.message}`, { propertyId });
    return [];
  }
};

/**
 * Create or get pseudo-user for external comments
 * @param {string} name - External user name
 * @param {string} phone - External user phone number
 * @returns {Promise<Object>} User document
 */
const getOrCreatePseudoUser = async (name, phone) => {
  try {
    // Sanitize inputs
    const sanitizedName = (name || 'External User').trim();
    const sanitizedPhone = (phone || '').replace(/\D/g, '');
    
    if (!sanitizedPhone) {
      throw new AppError('Phone number is required', 400);
    }
    
    const pseudoEmail = `${sanitizedPhone}@external.vendor`;
    
    // Try to find existing user
    let pseudoUser = await User.findOne({ 
      email: pseudoEmail, 
      role: ROLE_ENUM.VENDOR 
    });
    
    if (!pseudoUser) {
      // Create new pseudo-user
      const firstName = sanitizedName.split(' ')[0] || 'External';
      const lastName = sanitizedName.split(' ').slice(1).join(' ') || 'User';
      
      pseudoUser = new User({
        firstName,
        lastName,
        email: pseudoEmail,
        phone: sanitizedPhone,
        role: ROLE_ENUM.VENDOR,
        isActive: true,
        passwordHash: crypto.randomBytes(16).toString('hex') // Random password
      });
      
      await pseudoUser.save();
      logger.info(`PublicService: Created pseudo-user for external interaction: ${pseudoEmail}`);
    }
    
    return pseudoUser;
  } catch (error) {
    logger.error(`PublicService - Error creating pseudo-user: ${error.message}`);
    throw error;
  }
};

/**
 * Fetches a maintenance request via its public link token.
 * @param {string} publicToken - The unique public token for the request.
 * @param {string} ipAddress - IP address of the request for audit logging.
 * @param {string} userAgent - User-Agent string of the client for audit logging.
 * @returns {Promise<object>} Sanitized public view of the request.
 * @throws {AppError} If public link is invalid, expired, or request not found.
 */
const getPublicRequest = async (publicToken, ipAddress, userAgent) => {
  try {
    // Validate token format
    if (!publicToken || typeof publicToken !== 'string') {
      throw new AppError('Invalid public token format', 400);
    }
    
    // Find request with valid public token
    const request = await Request.findOne({
      publicToken,
      publicLinkEnabled: true,
      publicLinkExpiresAt: { $gt: new Date() }
    })
    .populate('property', 'name address')
    .populate('unit', 'unitName')
    .populate({
      path: 'comments',
      match: { isInternalNote: false },
      populate: {
        path: 'sender',
        select: 'firstName lastName'
      }
    })
    .populate({
      path: 'assignedTo',
      refPath: 'assignedToModel',
      select: 'firstName lastName email name contactPerson'
    })
    .populate({
      path: 'media',
      match: { isPublic: true },
      select: 'url filename mimeType thumbnailUrl description'
    });

    if (!request) {
      throw new AppError('Public link invalid, expired, or request not found', 404);
    }

    // Create sanitized view for public consumption
    const publicRequestView = sanitizeRequestForPublic(request);
    
    // Log the access
    await createAuditLog({
      action: AUDIT_ACTION_ENUM.READ,
      user: null,
      resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
      resourceId: request._id,
      ipAddress,
      userAgent,
      externalUserIdentifier: publicToken,
      description: `Public request "${request.title}" viewed via public link`,
      status: 'success',
      metadata: { publicToken }
    });

    logger.info(`PublicService: Public request "${request.title}" viewed via token ${publicToken}`);
    
    return publicRequestView;
  } catch (error) {
    logger.error(`PublicService - Error getting public request: ${error.message}`, { publicToken });
    throw error instanceof AppError ? error : new AppError(`Failed to get public request: ${error.message}`, error.statusCode || 500);
  }
};

/**
 * Adds a comment to a request via its public link.
 * @param {string} publicToken - The unique public token for the request.
 * @param {object} commentData - Data for the new comment (message, externalUserName, externalUserEmail).
 * @param {string} ipAddress - IP address of the request.
 * @param {string} userAgent - User-Agent string of the client.
 * @returns {Promise<object>} The created comment document.
 * @throws {AppError} If public link is invalid/expired, request not found, or validation fails.
 */
const addPublicCommentToRequest = async (publicToken, commentData, ipAddress, userAgent) => {
  try {
    // Validate required fields
    const { message, externalUserName, externalUserEmail } = commentData;
    
    if (!message || !message.trim()) {
      throw new AppError('Comment message is required', 400);
    }
    if (!externalUserName || !externalUserName.trim()) {
      throw new AppError('Your name is required', 400);
    }
    
    const sanitizedName = externalUserName.trim();
    const sanitizedMessage = message.trim();
    
    // Find request with valid public token
    const request = await Request.findOne({
      publicToken,
      publicLinkEnabled: true,
      publicLinkExpiresAt: { $gt: new Date() }
    });

    if (!request) {
      throw new AppError('Public link invalid, expired, or request not found', 404);
    }

    // Get or create pseudo-user for external commenter
    const pseudoUser = await getOrCreatePseudoUser(sanitizedName, externalUserEmail || '0000000000');

    // Create the comment
    const newComment = new Comment({
      contextType: AUDIT_RESOURCE_TYPE_ENUM.Request,
      contextId: request._id,
      sender: pseudoUser._id,
      message: sanitizedMessage,
      isExternal: true,
      externalUserName: sanitizedName,
      externalUserEmail: pseudoUser.email,
      isInternalNote: false
    });

    const createdComment = await newComment.save();

    // Add comment to request's comments array
    if (!request.comments) {
      request.comments = [];
    }
    request.comments.push(createdComment._id);
    await request.save();

    // Get users to notify
    const relevantUserIds = new Set();

    // Add request creator if available
    if (request.createdByPropertyUser) {
      const creator = await PropertyUser.findById(request.createdByPropertyUser).populate('user');
      if (creator && creator.user) {
        relevantUserIds.add(creator.user._id.toString());
      }
    }

    // Add assigned user if available
    if (request.assignedTo && request.assignedToModel === 'User') {
      relevantUserIds.add(request.assignedTo.toString());
    }

    // Add property managers and landlords
    const propertyManagementUsers = await getPropertyManagementUsers(request.property);
    propertyManagementUsers.forEach(id => relevantUserIds.add(id.toString()));

    // Send notifications to all relevant users
    for (const recipientId of Array.from(relevantUserIds)) {
      try {
        const recipient = await User.findById(recipientId);
        if (!recipient) continue;
        
        await notificationService.sendNotification({
          recipientId,
          type: 'new_comment',
          message: `New public comment on request "${request.title}" from ${sanitizedName}`,
          link: `/requests/${request._id}`,
          relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
          relatedResourceId: request._id,
          emailDetails: {
            subject: `New Public Comment on Request: ${request.title}`,
            html: `
              <p>A new public comment has been added to request "${request.title}" by ${sanitizedName}:</p>
              <blockquote style="border-left: 4px solid #ccc; padding-left: 16px; margin-left: 0;">
                <p><em>${sanitizedMessage}</em></p>
              </blockquote>
              <p>You can view and respond to this comment by clicking <a href="${FRONTEND_URL}/requests/${request._id}">here</a>.</p>
            `
          }
        });
      } catch (error) {
        logger.warn(`Failed to send notification about public comment to user ${recipientId}: ${error.message}`);
        // Continue with other notifications
      }
    }

    // Log the comment for auditing
    await createAuditLog({
      action: AUDIT_ACTION_ENUM.CREATE,
      user: null,
      resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
      resourceId: createdComment._id,
      newValue: createdComment.toObject(),
      ipAddress,
      userAgent,
      externalUserIdentifier: `${sanitizedName} (${pseudoUser.email})`,
      description: `Public comment added to request "${request.title}" by ${sanitizedName}`,
      status: 'success',
      metadata: { requestId: request._id, requestTitle: request.title }
    });

    logger.info(`PublicService: Public comment added to request "${request.title}" by ${sanitizedName}`);

    // Return a simplified version of the comment
    return {
      _id: createdComment._id,
      message: createdComment.message,
      createdAt: createdComment.createdAt,
      externalUserName: createdComment.externalUserName
    };
  } catch (error) {
    logger.error(`PublicService - Error adding public comment to request: ${error.message}`, { 
      publicToken,
      externalUserName: commentData?.externalUserName 
    });
    throw error instanceof AppError ? error : new AppError(`Failed to add comment: ${error.message}`, error.statusCode || 500);
  }
};

/**
 * Fetches a scheduled maintenance task via its public link token.
 * @param {string} publicToken - The unique public token for the scheduled maintenance.
 * @param {string} ipAddress - IP address of the request for audit logging.
 * @param {string} userAgent - User-Agent string of the client for audit logging.
 * @returns {Promise<object>} Sanitized public view of the scheduled maintenance.
 * @throws {AppError} If public link is invalid, expired, or task not found.
 */
const getPublicScheduledMaintenance = async (publicToken, ipAddress, userAgent) => {
  try {
    // Validate token format
    if (!publicToken || typeof publicToken !== 'string') {
      throw new AppError('Invalid public token format', 400);
    }
    
    // Find scheduled maintenance with valid public token
    const maintenance = await ScheduledMaintenance.findOne({
      publicLinkToken: publicToken,
      publicLinkEnabled: true,
      publicLinkExpires: { $gt: new Date() }
    })
    .populate('property', 'name address')
    .populate('unit', 'unitName')
    .populate({
      path: 'comments',
      match: { isInternalNote: false },
      populate: {
        path: 'sender',
        select: 'firstName lastName'
      }
    })
    .populate({
      path: 'assignedTo',
      refPath: 'assignedToModel',
      select: 'firstName lastName email name contactPerson'
    })
    .populate({
      path: 'media',
      match: { isPublic: true },
      select: 'url filename mimeType thumbnailUrl description'
    });

    if (!maintenance) {
      throw new AppError('Public link invalid, expired, or scheduled maintenance not found', 404);
    }

    // Create sanitized view for public consumption
    const publicMaintenanceView = sanitizeMaintenanceForPublic(maintenance);
    
    // Log the access
    await createAuditLog({
      action: AUDIT_ACTION_ENUM.READ,
      user: null,
      resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
      resourceId: maintenance._id,
      ipAddress,
      userAgent,
      externalUserIdentifier: publicToken,
      description: `Public scheduled maintenance "${maintenance.title}" viewed via public link`,
      status: 'success',
      metadata: { publicToken }
    });

    logger.info(`PublicService: Public scheduled maintenance "${maintenance.title}" viewed via token ${publicToken}`);
    
    return publicMaintenanceView;
  } catch (error) {
    logger.error(`PublicService - Error getting public scheduled maintenance: ${error.message}`, { publicToken });
    throw error instanceof AppError ? error : new AppError(`Failed to get public scheduled maintenance: ${error.message}`, error.statusCode || 500);
  }
};

/**
 * Adds a comment to a scheduled maintenance task via its public link.
 * @param {string} publicToken - The unique public token for the scheduled maintenance.
 * @param {object} commentData - Data for the new comment (message, externalUserName, externalUserEmail).
 * @param {string} ipAddress - IP address of the request.
 * @param {string} userAgent - User-Agent string of the client.
 * @returns {Promise<object>} The created comment document.
 * @throws {AppError} If public link is invalid/expired, task not found, or validation fails.
 */
const addPublicCommentToScheduledMaintenance = async (publicToken, commentData, ipAddress, userAgent) => {
  try {
    // Validate required fields
    const { message, externalUserName, externalUserEmail } = commentData;
    
    if (!message || !message.trim()) {
      throw new AppError('Comment message is required', 400);
    }
    if (!externalUserName || !externalUserName.trim()) {
      throw new AppError('Your name is required', 400);
    }
    
    const sanitizedName = externalUserName.trim();
    const sanitizedMessage = message.trim();
    
    // Find scheduled maintenance with valid public token
    const maintenance = await ScheduledMaintenance.findOne({
      publicLinkToken: publicToken,
      publicLinkEnabled: true,
      publicLinkExpires: { $gt: new Date() }
    });

    if (!maintenance) {
      throw new AppError('Public link invalid, expired, or scheduled maintenance not found', 404);
    }

    // Get or create pseudo-user for external commenter
    const pseudoUser = await getOrCreatePseudoUser(sanitizedName, externalUserEmail || '0000000000');

    // Create the comment
    const newComment = new Comment({
      contextType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
      contextId: maintenance._id,
      sender: pseudoUser._id,
      message: sanitizedMessage,
      isExternal: true,
      externalUserName: sanitizedName,
      externalUserEmail: pseudoUser.email,
      isInternalNote: false
    });

    const createdComment = await newComment.save();

    // Add comment to maintenance's comments array
    if (!maintenance.comments) {
      maintenance.comments = [];
    }
    maintenance.comments.push(createdComment._id);
    await maintenance.save();

    // Get users to notify
    const relevantUserIds = new Set();

    // Add maintenance creator if available
    if (maintenance.createdByPropertyUser) {
      const creator = await PropertyUser.findById(maintenance.createdByPropertyUser).populate('user');
      if (creator && creator.user) {
        relevantUserIds.add(creator.user._id.toString());
      }
    }

    // Add assigned user if available
    if (maintenance.assignedTo && maintenance.assignedToModel === 'User') {
      relevantUserIds.add(maintenance.assignedTo.toString());
    }

    // Add property managers and landlords
    const propertyManagementUsers = await getPropertyManagementUsers(maintenance.property);
    propertyManagementUsers.forEach(id => relevantUserIds.add(id.toString()));

    // Send notifications to all relevant users
    for (const recipientId of Array.from(relevantUserIds)) {
      try {
        const recipient = await User.findById(recipientId);
        if (!recipient) continue;
        
        await notificationService.sendNotification({
          recipientId,
          type: 'new_comment',
          message: `New public comment on scheduled maintenance "${maintenance.title}" from ${sanitizedName}`,
          link: `/scheduled-maintenances/${maintenance._id}`,
          relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
          relatedResourceId: maintenance._id,
          emailDetails: {
            subject: `New Public Comment on Scheduled Maintenance: ${maintenance.title}`,
            html: `
              <p>A new public comment has been added to scheduled maintenance "${maintenance.title}" by ${sanitizedName}:</p>
              <blockquote style="border-left: 4px solid #ccc; padding-left: 16px; margin-left: 0;">
                <p><em>${sanitizedMessage}</em></p>
              </blockquote>
              <p>You can view and respond to this comment by clicking <a href="${FRONTEND_URL}/scheduled-maintenances/${maintenance._id}">here</a>.</p>
            `
          }
        });
      } catch (error) {
        logger.warn(`Failed to send notification about public comment to user ${recipientId}: ${error.message}`);
        // Continue with other notifications
      }
    }

    // Log the comment for auditing
    await createAuditLog({
      action: AUDIT_ACTION_ENUM.CREATE,
      user: null,
      resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
      resourceId: createdComment._id,
      newValue: createdComment.toObject(),
      ipAddress,
      userAgent,
      externalUserIdentifier: `${sanitizedName} (${pseudoUser.email})`,
      description: `Public comment added to scheduled maintenance "${maintenance.title}" by ${sanitizedName}`,
      status: 'success',
      metadata: { maintenanceId: maintenance._id, maintenanceTitle: maintenance.title }
    });

    logger.info(`PublicService: Public comment added to scheduled maintenance "${maintenance.title}" by ${sanitizedName}`);

    // Return a simplified version of the comment
    return {
      _id: createdComment._id,
      message: createdComment.message,
      createdAt: createdComment.createdAt,
      externalUserName: createdComment.externalUserName
    };
  } catch (error) {
    logger.error(`PublicService - Error adding public comment to scheduled maintenance: ${error.message}`, { 
      publicToken,
      externalUserName: commentData?.externalUserName 
    });
    throw error instanceof AppError ? error : new AppError(`Failed to add comment: ${error.message}`, error.statusCode || 500);
  }
};

module.exports = {
  getPublicRequest,
  addPublicCommentToRequest,
  getPublicScheduledMaintenance,
  addPublicCommentToScheduledMaintenance
};