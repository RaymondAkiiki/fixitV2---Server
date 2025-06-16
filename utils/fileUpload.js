// backend/utils/fileUpload.js

// This utility handles file uploads, using Multer for local temporary storage
// and Cloudinary for permanent cloud storage.

const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

// Configure Multer for local temporary storage.
// This is typically used when you need to process the file (e.g., resize, validate)
// before uploading it to a cloud service.
const localStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Specify the directory where files will be temporarily stored.
        // Make sure this directory exists or create it.
        cb(null, 'backend/uploads/');
    },
    filename: (req, file, cb) => {
        // Generate a unique filename to prevent conflicts.
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});

// Create a Multer instance for local storage.
const uploadLocal = multer({
    storage: localStorage,
    limits: {
        fileSize: 1024 * 1024 * 10 // 10 MB file size limit
    },
    fileFilter: (req, file, cb) => {
        // Only allow image and video file types.
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb('Error: Images and videos only!');
        }
    }
});

// Configure Multer to directly upload to Cloudinary.
// This is often more efficient as it bypasses local disk storage.
const cloudinaryStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'fix-it-by-threalty', // Optional: folder in Cloudinary to store files
        format: async (req, file) => {
            // Determine format based on file mimetype.
            // For images, usually 'jpg', 'png', etc. For videos, 'mp4'.
            const ext = path.extname(file.originalname).toLowerCase();
            if (file.mimetype.startsWith('image/')) {
                return ext.substring(1); // e.g., 'jpg', 'png'
            } else if (file.mimetype.startsWith('video/')) {
                return 'mp4'; // Standardize video format
            }
            return ''; // Default to no specific format if not image/video
        },
        public_id: (req, file) => `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1E9)}`, // Unique public ID
    },
});

//Create a Multer instance for direct Cloudinary upload.
const uploadCloudinary = multer({
    storage: cloudinaryStorage,
    limits: {
        fileSize: 1024 * 1024 * 50 // Increased limit to 50 MB for videos
    },
    fileFilter: (req, file, cb) => {
        // Only allow image and video file types.
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|wmv/; // Added more video formats
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb('Error: Only image and video files are allowed!');
        }
    }
});

module.exports = {
    uploadLocal,        // For processing files locally before upload (if needed)
    uploadCloudinary    // For direct upload to Cloudinary (recommended for simplicity)
};

