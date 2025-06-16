// backend/utils/generateToken.js

// This utility generates a JSON Web Token (JWT) for user authentication.

const jwt = require('jsonwebtoken');
const jwtConfig = require('../config/jwt'); // Import JWT configuration

/**
 * Generates a JWT for a given user ID.
 * @param {string} id - The user ID to include in the token payload.
 * @returns {string} The generated JWT.
 */
const generateToken = (id) => {
    // The payload typically contains the user ID.
    // The secret is used to sign the token, ensuring its authenticity.
    // The expiresIn option determines how long the token is valid.
    return jwt.sign({ id }, jwtConfig.secret, {
        expiresIn: jwtConfig.expiresIn,
    });
};

module.exports = generateToken;

