const bcrypt = require('bcryptjs');
const AppError = require('./AppError');

const SALT_ROUNDS = 12;

/**
 * Hashes a plain text password.
 * @param {string} password - The plain text password to hash.
 * @returns {Promise<string>} The hashed password.
 */
const hashPassword = async (password) => {
    try {
        const salt = await bcrypt.genSalt(SALT_ROUNDS);
        return await bcrypt.hash(password, salt);
    } catch (error) {
        throw new AppError(`Failed to hash password: ${error.message}`, 500);
    }
};

/**
 * Compares a plain text password with a hashed password.
 * @param {string} plainPassword - The plain text password to compare.
 * @param {string} hashedPassword - The hashed password from the database.
 * @returns {Promise<boolean>} True if passwords match, false otherwise.
 */
const comparePasswords = async (plainPassword, hashedPassword) => {
    if (!plainPassword || !hashedPassword) {
        throw new AppError('Both plain password and hashed password are required for comparison.', 400);
    }
    try {
        return await bcrypt.compare(plainPassword, hashedPassword);
    } catch (error) {
        throw new AppError(`Failed to compare passwords: ${error.message}`, 500);
    }
};

module.exports = {
    hashPassword,
    comparePasswords,
};