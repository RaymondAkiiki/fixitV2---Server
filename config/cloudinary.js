// server/config/cloudinary.js

// This file configures Cloudinary for media storage.
// All credentials must be loaded from environment variables for security.

const cloudinary = require('cloudinary').v2;

// Check if environment variables are set before configuring Cloudinary
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.warn("Cloudinary credentials are not fully configured in environment variables. Media uploads might fail.");
    // In a production environment, you might want to throw an error here to prevent startup.
    // throw new Error("Cloudinary credentials missing in environment variables.");
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true, // Use HTTPS for all requests
});

module.exports = cloudinary;