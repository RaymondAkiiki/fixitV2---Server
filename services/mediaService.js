// src/services/mediaService.js
const Media = require('../models/media');
const cloudinaryClient = require('../lib/cloudinaryClient');
const auditService = require('./auditService');
const PropertyUser = require('../models/propertyUser');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { 
  ROLE_ENUM, 
  AUDIT_ACTION_ENUM, 
  AUDIT_RESOURCE_TYPE_ENUM,
  MEDIA_RELATED_TO_ENUM
} = require('../utils/constants/enums');

/**
 * Checks if user has permission to access or modify a media record.
 * @param {Object} user - The user requesting access
 * @param {Object} mediaDoc - The media document
 * @returns {Promise<boolean>} - True if user has permission
 */
const checkMediaPermission = async (user, mediaDoc) => {
  // Admin has full access
  if (user.role === ROLE_ENUM.ADMIN) return true;
  
  // Creator has access
  if (mediaDoc.uploadedBy && mediaDoc.uploadedBy.equals(user._id)) return true;
  
  // Public media is accessible
  if (mediaDoc.isPublic) return true;
  
  // Check resource-based permissions
  if (mediaDoc.relatedTo && mediaDoc.relatedId) {
    // Different permission logic based on the resource type
    switch (mediaDoc.relatedTo) {
      case 'Property':
        // Check if user is associated with the property
        const propertyUser = await PropertyUser.findOne({
          user: user._id,
          property: mediaDoc.relatedId,
          isActive: true
        });
        return !!propertyUser;
        
      case 'Unit':
        // Find the unit's property and check access
        const unit = await mongoose.model('Unit').findById(mediaDoc.relatedId);
        if (unit) {
          const propertyUserForUnit = await PropertyUser.findOne({
            user: user._id,
            property: unit.property,
            isActive: true
          });
          return !!propertyUserForUnit;
        }
        return false;
        
      case 'Request':
        // Check if user created the request or is assigned to it
        const request = await mongoose.model('Request').findById(mediaDoc.relatedId);
        if (request) {
          return (
            (request.createdByPropertyUser && user._id.equals(request.createdByPropertyUser.user)) ||
            (request.assignedTo && request.assignedToModel === 'User' && user._id.equals(request.assignedTo))
          );
        }
        return false;
        
      // Add cases for other resource types as needed
        
      default:
        return false;
    }
  }
  
  return false;
};

/**
 * Gets all media records with filtering and pagination.
 * @param {Object} currentUser - The authenticated user
 * @param {Object} filters - Query filters
 * @param {string} [filters.relatedTo] - Filter by resource type
 * @param {string} [filters.relatedId] - Filter by resource ID
 * @param {string} [filters.uploadedBy] - Filter by uploader
 * @param {string} [filters.mimeType] - Filter by MIME type
 * @param {string} [filters.isPublic] - Filter by public status
 * @param {string} [filters.search] - Search term
 * @param {number} [filters.page=1] - Page number
 * @param {number} [filters.limit=10] - Results per page
 * @param {string} [filters.sortBy='createdAt'] - Field to sort by
 * @param {string} [filters.sortOrder='desc'] - Sort order
 * @param {string} [ipAddress] - Client IP address for audit logging
 * @returns {Promise<Object>} Object with media records and pagination info
 * @throws {AppError} If validation fails or permission denied
 */
const getAllMedia = async (currentUser, filters, ipAddress) => {
  // Build query
  let query = {};
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const skip = (page - 1) * limit;

  // Base filtering for non-admin users
  if (currentUser.role !== ROLE_ENUM.ADMIN) {
    // Start with media uploaded by the current user or public media
    query.$or = [
      { uploadedBy: currentUser._id },
      { isPublic: true }
    ];
    
    // If filtering by relatedTo/relatedId, add resource-specific access checks
    if (filters.relatedTo && filters.relatedId) {
      if (filters.relatedTo === 'Property') {
        // Add user's accessible properties
        const accessiblePropertyIds = await PropertyUser.find({
          user: currentUser._id,
          isActive: true
        }).distinct('property');
        
        if (accessiblePropertyIds.length > 0) {
          query.$or.push({
            relatedTo: 'Property',
            relatedId: { $in: accessiblePropertyIds }
          });
        }
      }
      // Add other resource-specific rules as needed
    }
  }

  // Apply additional filters
  if (filters.relatedTo) {
    if (!MEDIA_RELATED_TO_ENUM.includes(filters.relatedTo)) {
      throw new AppError(`Invalid relatedTo type: ${filters.relatedTo}`, 400);
    }
    
    // Add a $and condition to not overwrite previous $or conditions
    query = {
      ...query,
      $and: [...(query.$and || []), { relatedTo: filters.relatedTo }]
    };
  }
  
  if (filters.relatedId) {
    const $and = query.$and || [];
    $and.push({ relatedId: filters.relatedId });
    query.$and = $and;
  }
  
  if (filters.uploadedBy) {
    const $and = query.$and || [];
    $and.push({ uploadedBy: filters.uploadedBy });
    query.$and = $and;
  }
  
  if (filters.mimeType) {
    const $and = query.$and || [];
    $and.push({ mimeType: { $regex: filters.mimeType, $options: 'i' } });
    query.$and = $and;
  }
  
  if (filters.isPublic !== undefined) {
    const $and = query.$and || [];
    $and.push({ isPublic: filters.isPublic === 'true' });
    query.$and = $and;
  }
  
  if (filters.search) {
    const searchQuery = {
      $or: [
        { originalname: { $regex: filters.search, $options: 'i' } },
        { description: { $regex: filters.search, $options: 'i' } },
        { tags: { $regex: filters.search, $options: 'i' } }
      ]
    };
    
    if (query.$or) {
      // If we already have an $or, we need to combine using $and
      query = {
        ...query,
        $and: [...(query.$and || []), searchQuery]
      };
    } else {
      // Otherwise, we can just add the $or directly
      query.$or = searchQuery.$or;
    }
  }

  // Sorting
  const sortBy = filters.sortBy || 'createdAt';
  const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
  const sortOptions = { [sortBy]: sortOrder };

  // Execute query
  const media = await Media.find(query)
    .populate('uploadedBy', 'firstName lastName email')
    .populate({
      path: 'relatedId',
      select: 'name title', // Commonly used fields
      options: { lean: true }
    })
    .sort(sortOptions)
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Media.countDocuments(query);
  const totalPages = Math.ceil(total / limit);

  // Log the action
  await auditService.logActivity(
    AUDIT_ACTION_ENUM.FETCH_ALL,
    AUDIT_RESOURCE_TYPE_ENUM[7], // 'Media'
    null,
    {
      userId: currentUser._id,
      ipAddress,
      description: `User ${currentUser.email || currentUser._id} fetched list of media.`,
      metadata: { filters, total, page, limit }
    }
  );

  return { 
    media, 
    total, 
    page, 
    limit,
    totalPages
  };
};

/**
 * Gets a single media record by ID.
 * @param {string} mediaId - The ID of the media record
 * @param {Object} currentUser - The authenticated user
 * @param {string} [ipAddress] - Client IP address for audit logging
 * @returns {Promise<Object>} The media document
 * @throws {AppError} If media not found or permission denied
 */
const getMediaById = async (mediaId, currentUser, ipAddress) => {
  const mediaDoc = await Media.findById(mediaId)
    .populate('uploadedBy', 'firstName lastName email')
    .populate({
      path: 'relatedId',
      select: 'name title description', // Common fields to include
      options: { lean: true }
    });

  if (!mediaDoc) {
    throw new AppError('Media not found.', 404);
  }

  // Authorization check
  const isAuthorized = await checkMediaPermission(currentUser, mediaDoc);
  if (!isAuthorized) {
    throw new AppError('Not authorized to view this media.', 403);
  }

  // Log the action
  await auditService.logActivity(
    AUDIT_ACTION_ENUM.FETCH_ONE,
    AUDIT_RESOURCE_TYPE_ENUM[7], // 'Media'
    mediaDoc._id,
    {
      userId: currentUser._id,
      ipAddress,
      description: `User ${currentUser.email || currentUser._id} viewed media ${mediaDoc.filename}.`
    }
  );

  return mediaDoc;
};

/**
 * Updates a media record's metadata.
 * @param {string} mediaId - The ID of the media record to update
 * @param {Object} updateData - Data to update
 * @param {string} [updateData.description] - New description
 * @param {string[]} [updateData.tags] - New tags array
 * @param {boolean} [updateData.isPublic] - New public status
 * @param {string} [updateData.relatedTo] - New related resource type
 * @param {string} [updateData.relatedId] - New related resource ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} [ipAddress] - Client IP address for audit logging
 * @returns {Promise<Object>} The updated media document
 * @throws {AppError} If media not found, validation fails, or permission denied
 */
const updateMedia = async (mediaId, updateData, currentUser, ipAddress) => {
  // Find the media record
  let mediaDoc = await Media.findById(mediaId);
  if (!mediaDoc) {
    throw new AppError('Media not found.', 404);
  }

  // Authorization check
  const isAuthorized = await checkMediaPermission(currentUser, mediaDoc);
  if (!isAuthorized) {
    throw new AppError('Not authorized to update this media.', 403);
  }

  // If changing relatedTo/relatedId, validate the new values
  if (
    (updateData.relatedTo && updateData.relatedTo !== mediaDoc.relatedTo) || 
    (updateData.relatedId && !mediaDoc.relatedId.equals(updateData.relatedId))
  ) {
    // Only admin can change the relation
    if (currentUser.role !== ROLE_ENUM.ADMIN) {
      throw new AppError('Only administrators can change media relationships.', 403);
    }
    
    // Validate relatedTo is a valid enum value
    if (updateData.relatedTo && !MEDIA_RELATED_TO_ENUM.includes(updateData.relatedTo)) {
      throw new AppError(`Invalid relatedTo type: ${updateData.relatedTo}`, 400);
    }
    
    // Validate that relatedId exists if provided
    if (updateData.relatedId) {
      const relatedModel = updateData.relatedTo || mediaDoc.relatedTo;
      const exists = await mongoose.model(relatedModel).exists({ _id: updateData.relatedId });
      if (!exists) {
        throw new AppError(`Related ${relatedModel} with ID ${updateData.relatedId} not found.`, 404);
      }
    }
  }
  
  // Store old state for audit log
  const oldMedia = mediaDoc.toObject();

  // Apply updates to allowed fields
  if (updateData.description !== undefined) {
    mediaDoc.description = updateData.description;
  }
  
  if (updateData.tags !== undefined) {
    // Sanitize tags: remove duplicates, trim whitespace, remove empty tags
    mediaDoc.tags = [...new Set(updateData.tags)]
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);
  }
  
  if (updateData.isPublic !== undefined) {
    mediaDoc.isPublic = !!updateData.isPublic;
  }
  
  // Only admin can update these fields
  if (currentUser.role === ROLE_ENUM.ADMIN) {
    if (updateData.relatedTo) {
      mediaDoc.relatedTo = updateData.relatedTo;
    }
    
    if (updateData.relatedId) {
      mediaDoc.relatedId = updateData.relatedId;
    }
  }

  // Save the updated media record
  const updatedMedia = await mediaDoc.save();

  // Log the action
  await auditService.logActivity(
    AUDIT_ACTION_ENUM.UPDATE,
    AUDIT_RESOURCE_TYPE_ENUM[7], // 'Media'
    updatedMedia._id,
    {
      userId: currentUser._id,
      ipAddress,
      oldValue: oldMedia,
      newValue: updatedMedia.toObject(),
      description: `Media ${updatedMedia.filename} metadata updated by ${currentUser.email || currentUser._id}.`
    }
  );

  logger.info(`MediaService: Media ${updatedMedia.filename} metadata updated by ${currentUser.email || currentUser._id}.`);
  return updatedMedia;
};

/**
 * Deletes a media record and its corresponding file from storage.
 * @param {string} mediaId - The ID of the media record to delete
 * @param {Object} currentUser - The authenticated user
 * @param {string} [ipAddress] - Client IP address for audit logging
 * @returns {Promise<void>}
 * @throws {AppError} If media not found or permission denied
 */
const deleteMedia = async (mediaId, currentUser, ipAddress) => {
  // Start a transaction to ensure consistency
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Find the media record
    const mediaDoc = await Media.findById(mediaId).session(session);
    if (!mediaDoc) {
      throw new AppError('Media not found.', 404);
    }

    // Authorization check
    const isAuthorized = await checkMediaPermission(currentUser, mediaDoc);
    if (!isAuthorized) {
      throw new AppError('Not authorized to delete this media.', 403);
    }

    // Store old state for audit log
    const oldMedia = mediaDoc.toObject();

    // Delete the file from Cloudinary
    try {
      await cloudinaryClient.deleteFile(mediaDoc.publicId, mediaDoc.resourceType || 'image');
      logger.info(`MediaService: Deleted file ${mediaDoc.publicId} from Cloudinary for media record ${mediaId}.`);
    } catch (error) {
      // Don't fail the transaction if Cloudinary deletion fails, just log the error
      logger.error(`MediaService: Failed to delete file from Cloudinary for media record ${mediaId}: ${error.message}`, error);
    }

    // Delete the media record from the database
    await mediaDoc.deleteOne({ session });

    // Commit the transaction
    await session.commitTransaction();
    
    // Log the action
    await auditService.logActivity(
      AUDIT_ACTION_ENUM.DELETE,
      AUDIT_RESOURCE_TYPE_ENUM[7], // 'Media'
      mediaId,
      {
        userId: currentUser._id,
        ipAddress,
        oldValue: oldMedia,
        description: `Media record "${oldMedia.filename}" deleted by ${currentUser.email || currentUser._id}.`
      }
    );

    logger.info(`MediaService: Media record "${oldMedia.filename}" deleted by ${currentUser.email || currentUser._id}.`);
  } catch (error) {
    // Abort the transaction on error
    await session.abortTransaction();
    throw error;
  } finally {
    // End the session
    session.endSession();
  }
};

/**
 * Gets statistics about media usage.
 * @param {Object} currentUser - The authenticated user
 * @param {string} [ipAddress] - Client IP address for audit logging
 * @returns {Promise<Object>} Media statistics
 */
const getMediaStats = async (currentUser, ipAddress) => {
  // Build base query depending on user role
  let baseQuery = {};
  if (currentUser.role !== ROLE_ENUM.ADMIN) {
    // For non-admins, limit to media they uploaded or have access to
    baseQuery.$or = [
      { uploadedBy: currentUser._id },
      { isPublic: true }
    ];
    
    // Add accessible properties
    const accessiblePropertyIds = await PropertyUser.find({
      user: currentUser._id,
      isActive: true
    }).distinct('property');
    
    if (accessiblePropertyIds.length > 0) {
      baseQuery.$or.push({
        relatedTo: 'Property',
        relatedId: { $in: accessiblePropertyIds }
      });
    }
  }

  // Run aggregations in parallel for better performance
  const [
    totalMediaCount,
    totalStorageUsed,
    mediaByType,
    mediaByRelatedTo,
    recentUploads
  ] = await Promise.all([
    // Total media count
    Media.countDocuments(baseQuery),
    
    // Total storage used (bytes)
    Media.aggregate([
      { $match: baseQuery },
      { $group: { _id: null, totalSize: { $sum: '$size' } } }
    ]),
    
    // Media grouped by MIME type
    Media.aggregate([
      { $match: baseQuery },
      { 
        $group: { 
          _id: { 
            $cond: {
              if: { $regexMatch: { input: '$mimeType', regex: /^image\// } },
              then: 'image',
              else: {
                $cond: {
                  if: { $regexMatch: { input: '$mimeType', regex: /^video\// } },
                  then: 'video',
                  else: {
                    $cond: {
                      if: { $regexMatch: { input: '$mimeType', regex: /^application\/pdf/ } },
                      then: 'pdf',
                      else: 'other'
                    }
                  }
                }
              }
            }
          },
          count: { $sum: 1 },
          totalSize: { $sum: '$size' }
        }
      },
      { $sort: { count: -1 } }
    ]),
    
    // Media grouped by related resource type
    Media.aggregate([
      { $match: baseQuery },
      { $group: { _id: '$relatedTo', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    
    // Recent uploads (last 5)
    Media.find(baseQuery)
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('uploadedBy', 'firstName lastName email')
      .lean()
  ]);

  // Format the stats
  const stats = {
    totalCount: totalMediaCount,
    totalStorageUsed: totalStorageUsed.length > 0 ? totalStorageUsed[0].totalSize : 0,
    totalStorageUsedFormatted: formatBytes(totalStorageUsed.length > 0 ? totalStorageUsed[0].totalSize : 0),
    mediaByType: mediaByType.map(item => ({
      type: item._id,
      count: item.count,
      percentage: (item.count / totalMediaCount * 100).toFixed(2) + '%',
      totalSize: item.totalSize,
      totalSizeFormatted: formatBytes(item.totalSize)
    })),
    mediaByRelatedTo: mediaByRelatedTo,
    recentUploads: recentUploads
  };

  // Log the action
  await auditService.logActivity(
    AUDIT_ACTION_ENUM.READ,
    AUDIT_RESOURCE_TYPE_ENUM[7], // 'Media'
    null,
    {
      userId: currentUser._id,
      ipAddress,
      description: `User ${currentUser.email || currentUser._id} retrieved media statistics.`,
      metadata: { stats: { totalCount: stats.totalCount, totalStorageUsed: stats.totalStorageUsed } }
    }
  );

  return stats;
};

/**
 * Helper function to format bytes into human-readable format.
 * @param {number} bytes - Number of bytes
 * @param {number} [decimals=2] - Decimal places to show
 * @returns {string} Formatted size string
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = {
  getAllMedia,
  getMediaById,
  updateMedia,
  deleteMedia,
  getMediaStats,
  checkMediaPermission
};