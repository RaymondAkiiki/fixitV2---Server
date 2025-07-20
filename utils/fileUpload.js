// src/utils/fileUpload.js

const cloudinary = require('cloudinary').v2;
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const AppError = require('./AppError');
const { promisify } = require('util');

// Configure cloudinary based on environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload a file buffer to Cloudinary
 * @param {Buffer} buffer - File buffer to upload
 * @param {string} mimeType - The MIME type of the file
 * @param {string} originalname - Original filename
 * @param {string} folder - The folder in Cloudinary to store the file (e.g., 'requests', 'scheduled-maintenance')
 * @returns {Promise<object>} Result object with URL and thumbnail URL (if image)
 */
const uploadFileBuffer = async (buffer, mimeType, originalname, folder = 'general') => {
  try {
    // Ensure folder is valid
    const safeFolder = folder ? folder.replace(/[^a-zA-Z0-9_-]/g, '_') : 'general';
    
    // Check if file is valid
    if (!buffer || buffer.length === 0) {
      throw new AppError('Empty file buffer provided', 400);
    }

    // Determine if this is an image based on mime type
    const isImage = mimeType && mimeType.startsWith('image/');
    
    // Create unique filename to avoid collisions
    const timestamp = Date.now();
    const fileExtension = path.extname(originalname) || '.bin';
    const safeName = path.basename(originalname, fileExtension).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueFilename = `${safeName}_${timestamp}${fileExtension}`;
    
    // Prepare upload options
    const uploadOptions = {
      resource_type: isImage ? 'image' : 'raw',
      public_id: `${safeFolder}/${uniqueFilename}`,
      folder: safeFolder,
      tags: [safeFolder],
      overwrite: true
    };

    // Upload to Cloudinary
    const uploadPromise = promisify(cloudinary.uploader.upload_stream);
    
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
        if (error) {
          logger.error(`Failed to upload file: ${error.message}`, { mimeType, folder: safeFolder });
          return reject(new AppError(`Failed to upload file: ${error.message}`, 500));
        }
        
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          thumbnailUrl: isImage ? cloudinary.url(result.public_id, { 
            secure: true, 
            width: 200, 
            crop: 'fill' 
          }) : null
        });
      });
      
      // Write buffer to stream
      uploadStream.write(buffer);
      uploadStream.end();
    });
  } catch (error) {
    logger.error(`Error in uploadFileBuffer: ${error.message}`);
    throw error instanceof AppError ? error : new AppError(`Failed to upload file: ${error.message}`, 500);
  }
};

/**
 * Upload a file from a path to Cloudinary
 * @param {string} filePath - Path to the file to upload
 * @param {string} mimeType - The MIME type of the file
 * @param {string} originalname - Original filename (if not provided, extracted from path)
 * @param {string} folder - The folder in Cloudinary to store the file
 * @returns {Promise<object>} Result object with URL and thumbnail URL (if image)
 */
const uploadFile = async (filePath, mimeType, originalname, folder = 'general') => {
  try {
    // Read file from disk
    const buffer = await fs.promises.readFile(filePath);
    const filename = originalname || path.basename(filePath);
    
    // Use the buffer upload function
    return await uploadFileBuffer(buffer, mimeType, filename, folder);
  } catch (error) {
    logger.error(`Error in uploadFile: ${error.message}`, { filePath });
    throw error instanceof AppError ? error : new AppError(`Failed to upload file: ${error.message}`, 500);
  }
};

/**
 * Delete a file from Cloudinary
 * @param {string} publicId - The public ID of the file to delete
 * @returns {Promise<object>} Result of the deletion operation
 */
const deleteFile = async (publicId) => {
  try {
    const deleteResult = await cloudinary.uploader.destroy(publicId);
    return deleteResult;
  } catch (error) {
    logger.error(`Error deleting file from storage: ${error.message}`, { publicId });
    throw new AppError(`Failed to delete file: ${error.message}`, 500);
  }
};

/**
 * Legacy function to maintain compatibility with existing code
 */
const uploadFileToCloudinary = (buffer, mimeType, originalname, folder) => {
  return uploadFileBuffer(buffer, mimeType, originalname, folder);
};

module.exports = {
  uploadFile,
  uploadFileBuffer,
  deleteFile,
  // Export legacy functions for backward compatibility
  uploadFileToCloudinary
};