// src/services/mediaService.js
const Media = require('../models/media');
const { deleteFile } = require('../lib/cloudinaryClient');
const { createAuditLog } = require('./auditService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { ROLE_ENUM, AUDIT_ACTION_ENUM, AUDIT_RESOURCE_TYPE_ENUM } = require('../utils/constants/enums');

const checkMediaPermission = async (user, mediaDoc) => {
    if (user.role === ROLE_ENUM.ADMIN) return true;
    if (mediaDoc.uploadedBy && mediaDoc.uploadedBy.equals(user._id)) return true;
    if (mediaDoc.isPublic) return true;
    return false;
};

/**
 * Gets all media records with filtering and pagination.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Query filters (relatedTo, relatedId, uploadedBy, mimeType, isPublic, search, page, limit).
 * @returns {Promise<object>} Object containing media array, total count, page, and limit.
 * @throws {AppError} If user not authorized or filter values are invalid.
 */
const getAllMedia = async (currentUser, filters) => {
    let query = {};
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 10;
    const skip = (page - 1) * limit;

    // Base filtering: Admins see all. Other roles only see media they uploaded or media related to resources they have access to.
    if (currentUser.role !== ROLE_ENUM.ADMIN) {
        // Start with media uploaded by the current user
        query.$or = [{ uploadedBy: currentUser._id }];

        // If filtering by relatedTo/relatedId, we need to ensure the user has access to that related resource.
        // This part can be complex and depends on how granular your resource access is.
        // For now, we'll allow users to see public media or their own.
        // A more robust solution would involve checking PropertyUser roles for related properties/units/leases etc.
        if (filters.isPublic === 'true') {
            query.$or.push({ isPublic: true });
        }
    }

    // Apply additional filters
    if (filters.relatedTo) {
        if (!MEDIA_RELATED_TO_ENUM.includes(filters.relatedTo)) {
            throw new AppError(`Invalid relatedTo type: ${filters.relatedTo}`, 400);
        }
        query.relatedTo = filters.relatedTo;
    }
    if (filters.relatedId) {
        query.relatedId = filters.relatedId;
    }
    if (filters.uploadedBy) {
        query.uploadedBy = filters.uploadedBy;
    }
    if (filters.mimeType) {
        query.mimeType = { $regex: filters.mimeType, $options: 'i' }; // Partial match for mime type
    }
    if (filters.isPublic !== undefined) {
        query.isPublic = filters.isPublic === 'true';
    }
    if (filters.search) {
        query.$or = query.$or || []; // Ensure $or exists for combined search
        query.$or.push(
            { originalname: { $regex: filters.search, $options: 'i' } },
            { description: { $regex: filters.search, $options: 'i' } },
            { tags: { $regex: filters.search, $options: 'i' } }
        );
    }

    const sortBy = filters.sortBy || 'createdAt';
    const sortOrder = filters.sortOrder === 'desc' ? -1 : 1;
    const sortOptions = { [sortBy]: sortOrder };

    const media = await Media.find(query)
        .populate('uploadedBy', 'firstName lastName email')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit);

    const total = await Media.countDocuments(query);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ_ALL,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Media,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched list of media.`,
        status: 'success',
        metadata: { filters }
    });

    return { media, total, page, limit };
};

/**
 * Gets a single media record by ID.
 * @param {string} mediaId - The ID of the media record.
 * @param {object} currentUser - The authenticated user.
 * @returns {Promise<Media>} The media document.
 * @throws {AppError} If media not found or user not authorized.
 */
const getMediaById = async (mediaId, currentUser) => {
    const mediaDoc = await Media.findById(mediaId)
        .populate('uploadedBy', 'firstName lastName email');

    if (!mediaDoc) {
        throw new AppError('Media not found.', 404);
    }

    // Authorization check
    const isAuthorized = await checkMediaPermission(currentUser, mediaDoc);
    if (!isAuthorized) {
        throw new AppError('Not authorized to view this media.', 403);
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Media,
        resourceId: mediaDoc._id,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched media ${mediaDoc.filename}.`,
        status: 'success'
    });

    return mediaDoc;
};

/**
 * Updates a media record's metadata (description, tags, isPublic).
 * Note: This service does NOT handle re-uploading or replacing the file itself.
 * File replacement should be a separate process (delete old, upload new).
 * @param {string} mediaId - The ID of the media record to update.
 * @param {object} updateData - Data to update (description, tags, isPublic).
 * @param {object} currentUser - The user performing the update.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Media>} The updated media document.
 * @throws {AppError} If media not found, user not authorized, or validation fails.
 */
const updateMedia = async (mediaId, updateData, currentUser, ipAddress) => {
    let mediaDoc = await Media.findById(mediaId);
    if (!mediaDoc) {
        throw new AppError('Media not found.', 404);
    }

    // Authorization check: Only uploader or admin can update metadata
    const isAuthorized = await checkMediaPermission(currentUser, mediaDoc);
    if (!isAuthorized) {
        throw new AppError('Not authorized to update this media.', 403);
    }

    const oldMedia = mediaDoc.toObject(); // Capture old state for audit log

    // Apply updates to allowed fields
    if (updateData.description !== undefined) mediaDoc.description = updateData.description;
    if (updateData.tags !== undefined) mediaDoc.tags = updateData.tags;
    if (updateData.isPublic !== undefined) mediaDoc.isPublic = updateData.isPublic;

    const updatedMedia = await mediaDoc.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Media,
        resourceId: updatedMedia._id,
        oldValue: oldMedia,
        newValue: updatedMedia.toObject(),
        ipAddress: ipAddress,
        description: `Media ${updatedMedia.filename} metadata updated by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`MediaService: Media ${updatedMedia.filename} metadata updated by ${currentUser.email}.`);
    return updatedMedia;
};

/**
 * Deletes a media record from the database and its corresponding file from cloud storage.
 * @param {string} mediaId - The ID of the media record to delete.
 * @param {object} currentUser - The user performing the deletion.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If media not found or user not authorized.
 */

const deleteMedia = async (mediaId, currentUser, ipAddress) => {
    const mediaDoc = await Media.findById(mediaId);
    if (!mediaDoc) throw new AppError('Media not found.', 404);
    const isAuthorized = await checkMediaPermission(currentUser, mediaDoc);
    if (!isAuthorized) throw new AppError('Not authorized to delete this media.', 403);
    const oldMedia = mediaDoc.toObject();
    try {
        await deleteFile(mediaDoc.publicId, mediaDoc.resourceType || 'image');
        logger.info(`MediaService: Deleted file ${mediaDoc.publicId} from Cloudinary for media record ${mediaId}.`);
    } catch (error) {
        logger.error(`MediaService: Failed to delete file from Cloudinary for media record ${mediaId}: ${error.message}`, error);
    }
    await mediaDoc.deleteOne();
    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Media,
        resourceId: mediaId,
        oldValue: oldMedia,
        newValue: null,
        ipAddress: ipAddress,
        description: `Media record "${oldMedia.filename}" deleted by ${currentUser.email}.`,
        status: 'success'
    });
    logger.info(`MediaService: Media record "${oldMedia.filename}" deleted by ${currentUser.email}.`);
};

module.exports = {
    getAllMedia,
    getMediaById,
    updateMedia,
    deleteMedia,
};
