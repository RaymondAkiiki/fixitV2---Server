const cloudinary = require('../config/cloudinary');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * Uploads a file buffer to Cloudinary.
 */
const uploadFileBuffer = async (fileBuffer, mimeType, originalname, folder = 'lease_logix/general', options = {}) => {
    try {
        const base64File = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
        const publicIdBase = originalname.split('.')[0].replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
        const uploadOptions = {
            folder,
            resource_type: mimeType.startsWith('image/') || mimeType.startsWith('video/') ? 'auto' : 'raw',
            public_id: `${folder.replace(/\//g, '_')}_${Date.now()}_${publicIdBase}`,
            quality: mimeType.startsWith('image/') ? 'auto:best' : undefined,
            ...options,
        };
        const result = await cloudinary.uploader.upload(base64File, uploadOptions);
        logger.info(`CloudinaryClient: File uploaded - URL: ${result.secure_url}, Public ID: ${result.public_id}`);
        return {
            publicId: result.public_id,
            url: result.secure_url,
            resourceType: result.resource_type,
            format: result.format,
            bytes: result.bytes,
            thumbnailUrl: (result.eager && result.eager[0] && result.eager[0].secure_url) || null,
            original_filename: originalname,
        };
    } catch (error) {
        logger.error(`CloudinaryClient: Error uploading file: ${error.message}`, error);
        throw new AppError(`Failed to upload file to Cloudinary: ${error.message}`, 500);
    }
};

/**
 * Deletes a file from Cloudinary by its publicId and resourceType.
 */
const deleteFile = async (publicId, resourceType = 'image') => {
    if (!publicId) throw new AppError("Public ID is required to delete a file.", 400);
    const validResourceTypes = ['image', 'video', 'raw'];
    if (!validResourceTypes.includes(resourceType)) resourceType = 'image';
    try {
        const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        if (result.result !== 'ok' && result.result !== 'not found') {
            throw new AppError(`Cloudinary deletion failed: ${result.result}`, 500);
        }
        logger.info(`CloudinaryClient: deleteFile: ${publicId} (${resourceType}) result: ${result.result}`);
        return result;
    } catch (error) {
        logger.error(`CloudinaryClient: Error deleting file (publicId: ${publicId}, type: ${resourceType}): ${error.message}`, error);
        throw new AppError(`Failed to delete file from Cloudinary: ${error.message}`, 500);
    }
};

module.exports = {
    uploadFileBuffer,
    deleteFile,
};