// backend/utils/inviteGenerator.js

// This utility generates unique invitation tokens for the invite-only onboarding system.

const crypto = require('crypto');

/**
 * Generates a unique, random string suitable for an invitation token.
 * @param {number} length - The desired length of the token (default: 32 characters).
 * @returns {string} A cryptographically secure random string.
 */
const generateUniqueToken = (length = 32) => {
    // Generate a random string using Node.js crypto module.
    // This ensures a strong, unpredictable token.
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
};

/**
 * Generates an expiration date for an invite token.
 * @param {number} expiresInHours - The number of hours until the token expires (default: 24).
 * @returns {Date} The expiration date.
 */
const generateExpirationDate = (expiresInHours = 24) => {
    const expirationDate = new Date();
    expirationDate.setHours(expirationDate.getHours() + expiresInHours);
    return expirationDate;
};

module.exports = {
    generateUniqueToken,
    generateExpirationDate,
};

