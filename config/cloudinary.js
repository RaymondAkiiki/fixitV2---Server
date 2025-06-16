// backend/config/cloudinary.js

// This file configures Cloudinary for media storage.
// All credentials must be loaded from environment variables for security.

const cloudinary = require('cloudinary').v2;

// Configure Cloudinary with credentials from environment variables.
// These variables are typically:
// CLOUDINARY_CLOUD_NAME: Your Cloudinary cloud name.
// CLOUDINARY_API_KEY: Your Cloudinary API Key.
// CLOUDINARY_API_SECRET: Your Cloudinary API Secret.

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'your_cloud_name', // Replace with your Cloudinary cloud name
    api_key: process.env.CLOUDINARY_API_KEY || 'your_api_key',           // Replace with your Cloudinary API key
    api_secret: process.env.CLOUDINARY_API_SECRET || 'your_api_secret',   // Replace with your Cloudinary API secret
    secure: true, // Use HTTPS for all requests
});

module.exports = cloudinary;

