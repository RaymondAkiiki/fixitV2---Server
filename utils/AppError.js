// src/utils/AppError.js

/**
 * Custom error class for application-specific errors.
 * This allows for standardized error handling and clearer error messages.
 *
 * @extends Error
 */
class AppError extends Error {
    /**
     * Creates an instance of AppError.
     * @param {string} message - The error message.
     * @param {number} statusCode - The HTTP status code associated with the error (e.g., 400, 401, 404, 500).
     * @param {Array<Object>} [errors=null] - Optional array of detailed error objects (e.g., from validation).
     */
    constructor(message, statusCode, errors = null) {
        super(message); // Call the parent Error constructor
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true; // Indicates if this is an error we can anticipate and handle gracefully
        this.errors = errors; // Store detailed errors if provided

        // Capture the stack trace, excluding the constructor call
        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = AppError;