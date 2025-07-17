// src/utils/asyncHandler.js

/**
 * A higher-order function that wraps asynchronous Express route handlers.
 * It catches any errors that occur during the execution of the handler and
 * passes them to the next() middleware, centralizing error handling.
 *
 * @param {Function} fn - The asynchronous Express route handler function (req, res, next).
 * @returns {Function} A new function that executes the handler and catches errors.
 */
const asyncHandler = (fn) => (req, res, next) => {
    // Promise.resolve() ensures that the function `fn` (which might be sync or async)
    // is treated as a promise, allowing .catch() to work uniformly.
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;