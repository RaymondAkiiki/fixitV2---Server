// src/middleware/errorMiddleware.js

const AppError = require('../utils/AppError');
const logger = require('../utils/logger'); // Ensure logger is imported

const errorMiddleware = (err, req, res, next) => {
    // Set default status code and message
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Something went wrong on the server.';
    let errors = err.errors || null; // For structured validation errors

    // Log the error (full stack trace for 500 errors in dev, or AppError with specific details)
    if (statusCode === 500) {
        logger.error(`Server Error: ${err.message}`, { stack: err.stack, url: req.originalUrl, method: req.method, ip: req.ip });
    } else {
        logger.warn(`AppError (Status ${statusCode}): ${err.message}`, { url: req.originalUrl, method: req.method, ip: req.ip });
    }

    // Mongoose specific error handling
    // CastError for bad ObjectIds (e.g., /api/users/123 -> 123 is not a valid ObjectId)
    if (err.name === 'CastError' && err.kind === 'ObjectId') {
        statusCode = 404;
        message = `Resource not found with ID of ${err.value}`;
        errors = [{ field: err.path, message: `Invalid ID: ${err.value}` }];
    }

    // Duplicate key error (e.g., unique email constraint in MongoDB)
    if (err.code === 11000) {
        statusCode = 400;
        const field = Object.keys(err.keyValue)[0];
        message = `Duplicate field value: '${err.keyValue[field]}' for ${field}. Please use another value.`;
        errors = [{ field: field, message: `Value '${err.keyValue[field]}' already exists.` }];
    }

    // Mongoose validation errors (e.g., required field missing, enum mismatch)
    if (err.name === 'ValidationError') {
        statusCode = 400;
        // Extract messages and values from Mongoose validation errors
        const validationErrors = Object.values(err.errors).map(val => ({
            field: val.path,
            message: val.message,
            value: val.value
        }));
        message = validationErrors.map(val => val.message).join(', ');
        errors = validationErrors;
    }

    // JSON web token error
    if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid token. Please log in again.';
    }

    // Token expired error
    if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token has expired. Please log in again.';
    }

    // Multer errors (file upload errors)
    if (err.name === 'MulterError') {
        statusCode = 400;
        switch (err.code) {
            case 'LIMIT_FILE_SIZE':
                message = 'File size too large. Max 10MB allowed.';
                break;
            case 'LIMIT_UNEXPECTED_FILE':
                message = `Too many files uploaded.`;
                break;
            default:
                message = `File upload error: ${err.message}`;
        }
        errors = [{ field: 'file', message: message }];
    }

    // If it's a generic AppError, use its properties
    if (err instanceof AppError) {
        message = err.message;
        statusCode = err.statusCode;
        errors = err.errors || null; // AppError can carry structured errors
    }

    // For production, don't leak stack trace
    const responseStack = process.env.NODE_ENV === 'development' ? err.stack : undefined;

    // Response structure
    res.status(statusCode).json({
        success: false,
        message: message,
        errors: errors, // Include structured errors if available
        stack: responseStack, // Only in development
    });
};

module.exports = errorMiddleware;