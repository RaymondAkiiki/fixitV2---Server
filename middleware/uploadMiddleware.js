const multer = require('multer');
const asyncHandler = require('express-async-handler');
const cloudinaryClient = require('../lib/cloudinaryClient');
const AppError = require('../utils/AppError');
const Media = require('../models/media');

const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'
    ];
    if (allowedMimeTypes.includes(file.mimetype)) cb(null, true);
    else cb(new AppError('Invalid file type. Only JPEG, PNG, GIF, WEBP images, and PDF files are allowed.', 400), false);
};
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: fileFilter
});

/**
 * Middleware to upload a file to Cloudinary and save its info in the Media model.
 */
const uploadToCloudinary = (relatedToType, idParamName) => asyncHandler(async (req, res, next) => {
    if (!req.file) return next(new AppError('No file provided for upload.', 400));
    if (!req.user) return next(new AppError('User not authenticated for file upload context.', 401));
    const relatedId = req.params[idParamName];
    if (!relatedId) return next(new AppError(`Missing ${idParamName} in request parameters. Cannot link media.`, 400));
    const folderPath = `${relatedToType.toLowerCase()}s/${relatedId}`;
    try {
        const uploadResult = await cloudinaryClient.uploadFileBuffer(req.file.buffer, req.file.mimetype, req.file.originalname, folderPath);
        const media = new Media({
            publicId: uploadResult.publicId,
            filename: uploadResult.original_filename,
            originalname: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            url: uploadResult.url,
            resourceType: uploadResult.resourceType,
            thumbnailUrl: uploadResult.thumbnailUrl,
            uploadedBy: req.user._id,
            relatedTo: relatedToType,
            relatedId: relatedId
        });
        await media.save();
        req.media = media;
        next();
    } catch (error) {
        console.error("Cloudinary Upload Error:", error);
        return next(new AppError(`Failed to upload file to Cloudinary: ${error.message}`, 500));
    }
});

module.exports = {
    upload,
    uploadToCloudinary
};