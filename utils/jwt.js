const jwt = require('jsonwebtoken');
const jwtConfig = require('../config/jwt');
const AppError = require('./AppError');

/**
 * Generates a JSON Web Token (JWT) for a given user ID.
 * @param {string} id - The user ID to embed in the token payload.
 * @returns {string} The generated JWT.
 */
const generateToken = (id) => {
    if (!jwtConfig.secret || !jwtConfig.expiresIn) {
        throw new AppError('JWT configuration (secret or expiresIn) is missing.', 500);
    }
    return jwt.sign({ id }, jwtConfig.secret, {
        expiresIn: jwtConfig.expiresIn,
    });
};

/**
 * Verifies a given JWT.
 * @param {string} token - The JWT to verify.
 * @returns {object} The decoded token payload if verification is successful.
 */
const verifyToken = (token) => {
    if (!jwtConfig.secret) {
        throw new AppError('JWT secret is not configured for verification.', 500);
    }
    try {
        return jwt.verify(token, jwtConfig.secret);
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            throw new AppError('Token has expired. Please log in again.', 401);
        }
        if (error.name === 'JsonWebTokenError') {
            throw new AppError('Invalid token. Please log in again.', 401);
        }
        throw new AppError(`Token verification failed: ${error.message}`, 401);
    }
};

module.exports = {
    generateToken,
    verifyToken,
};