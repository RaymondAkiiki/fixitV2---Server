// src/services/cloudStorageService.js

const cloudinary = require('../config/cloudinary'); // Import the pre-configured cloudinary instance
const logger = require('../utils/logger'); // Import the logger utility
const AppError = require('../utils/AppError'); // For consistent error handling

// Validate Cloudinary configuration at this level as a safeguard,
// though the primary validation should be in config/cloudinary.js
if (!cloudinary.config().cloud_name || !cloudinary.config().api_key || !cloudinary.config().api_secret) {
    logger.error("CloudStorageService: CRITICAL ERROR: Cloudinary is not configured. Check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env variables.");
    throw new AppError("Cloudinary configuration incomplete. Cannot proceed with file operations.", 500);
}

/**
 * Uploads a file buffer to Cloudinary. This is suitable when files are processed
 * by Multer with `memoryStorage`.
 *
 * @param {Buffer} fileBuffer - The buffer of the file to upload.
 * @param {string} mimeType - The MIME type of the file (e.g., 'image/jpeg', 'application/pdf').
 * @param {string} originalname - The original filename, used for public_id generation.
 * @param {string} folder - The specific folder in Cloudinary to upload to (e.g., 'property_images', 'payment_proofs').
 * @param {object} [options={}] - Additional Cloudinary upload options.
 * @returns {Promise<object>} - A promise that resolves with the Cloudinary upload result,
 * containing secure_url, public_id, resource_type, format, bytes.
 * @throws {AppError} If the upload fails.
 */
const uploadFileBuffer = async (fileBuffer, mimeType, originalname, folder = 'lease_logix/general', options = {}) => {
    try {
        // Convert buffer to base64 string for Cloudinary upload
        const base64File = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
        
        // Sanitize originalname to create a clean base for public_id
        const publicIdBase = originalname.split('.')[0].replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50); 
        
        const uploadOptions = {
            folder: folder,
            // Automatically detect resource type for images/videos, otherwise treat as raw (e.g., PDFs)
            resource_type: mimeType.startsWith('image/') || mimeType.startsWith('video/') ? 'auto' : 'raw',
            // Generate a unique public ID to prevent conflicts
            public_id: `${folder.replace(/\//g, '_')}_${Date.now()}_${publicIdBase}`,
            // Apply quality optimization only for images
            quality: mimeType.startsWith('image/') ? 'auto:low' : undefined, 
            ...options,
        };

        const result = await cloudinary.uploader.upload(base64File, uploadOptions);
        logger.info(`CloudStorageService: File uploaded - URL: ${result.secure_url}, Public ID: ${result.public_id}`);
        return {
            public_id: result.public_id,
            url: result.secure_url, // Use secure URL (HTTPS)
            resource_type: result.resource_type,
            format: result.format,
            bytes: result.bytes,
            original_filename: originalname // Keep original filename for reference
        };
    } catch (error) {
        logger.error(`CloudStorageService: Error uploading file: ${error.message}`, error);
        throw new AppError(`Failed to upload file to Cloudinary: ${error.message}`, 500);
    }
};

/**
 * Deletes a file from Cloudinary by its public ID.
 * @param {string} publicId - The public ID of the file to delete.
 * @param {string} [resourceType='image'] - The resource type ('image', 'video', 'raw').
 * Crucial for correct deletion if not an image.
 * @returns {Promise<object>} - A promise that resolves with the Cloudinary deletion result.
 * @throws {AppError} If deletion fails.
 */
const deleteFile = async (publicId, resourceType = 'image') => {
    if (!publicId) {
        throw new AppError("Public ID is required to delete a file.", 400);
    }
    // Validate resourceType to prevent invalid API calls
    const validResourceTypes = ['image', 'video', 'raw'];
    if (!validResourceTypes.includes(resourceType)) {
        logger.warn(`CloudStorageService: Invalid resourceType "${resourceType}" for deletion of public ID ${publicId}. Defaulting to 'image'.`);
        resourceType = 'image'; 
    }

    try {
        const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        if (result.result === 'not found') {
            logger.warn(`CloudStorageService: File with public ID ${publicId} and type ${resourceType} not found.`);
        } else if (result.result === 'ok') {
            logger.info(`CloudStorageService: Successfully deleted file with public ID ${publicId} (type: ${resourceType}).`);
        } else {
            logger.error(`CloudStorageService: Deletion for ${publicId} (type: ${resourceType}) returned unexpected result: ${result.result}`);
            throw new AppError(`Cloudinary deletion failed: ${result.result}`, 500);
        }
        return result;
    } catch (error) {
        logger.error(`CloudStorageService: Error deleting file (publicId: ${publicId}, type: ${resourceType}): ${error.message}`, error);
        throw new AppError(`Failed to delete file from Cloudinary: ${error.message}`, 500);
    }
};

/**
 * Gets the URL for a file from Cloudinary. Useful for generating transformed URLs
 * or retrieving a URL if only the public ID is stored.
 * @param {string} publicId - The public ID of the file.
 * @param {object} [options={}] - Cloudinary URL generation options (e.g., transformations like { width: 100, height: 100, crop: 'fill' }).
 * @returns {string} The URL of the file.
 * @throws {AppError} If publicId is missing.
 */
const getFileUrl = (publicId, options = {}) => {
    if (!publicId) {
        throw new AppError("Public ID is required to get file URL.", 400);
    }
    return cloudinary.url(publicId, { secure: true, ...options });
};

module.exports = {
    uploadFileBuffer,
    deleteFile,
    getFileUrl
};
