// backend/config/jwt.js
// This file defines the JWT secret and token expiration settings.
// These values should be loaded from environment variables for security.

const jwtConfig = {
    // JWT_SECRET: A secret key used to sign and verify JWTs.
    // It should be a strong, random string and kept absolutely confidential.
    // Recommended to be at least 32 characters long.
    secret: process.env.JWT_SECRET || '6gM3a8cP9rXyVb1qKz7sT4wJfD0nL2oU', // Fallback for development, MUST be set in .env for production

    // JWT_EXPIRES_IN: Specifies how long the JWT remains valid.
    // This can be a string like '1d' (1 day), '1h' (1 hour), '60s' (60 seconds), etc.
    // Shorter expiration times increase security but require more frequent token refreshes.
    expiresIn: process.env.JWT_EXPIRES_IN || '1d', // Token expires in 1 day by default
};

module.exports = jwtConfig;