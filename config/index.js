// server/config/index.js
// This file acts as an aggregator for all configuration modules.

const connectDB = require('./db');
const cloudinary = require('./cloudinary');
const jwtConfig = require('./jwt');

module.exports = {
    connectDB,         // Function to connect to the database
    cloudinary,        // Cloudinary configuration object/instance
    jwtConfig,         // JWT configuration details (secret, expiresIn)
    
    // Add any other configuration exports here if they exist
};