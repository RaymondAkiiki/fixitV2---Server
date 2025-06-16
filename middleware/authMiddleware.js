// backend/middleware/authMiddleware.js
 

const jwt = require("jsonwebtoken");
const asyncHandler = require('express-async-handler'); // For simplifying async middleware
const User = require("../models/user"); // Corrected model import
const jwtConfig = require('../config/jwt'); // Import JWT configuration

/**
 * Middleware to protect routes (JWT auth required)
 */


const protect = asyncHandler(async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer ")
    ) {
        try {
            // Get token from header
            token = req.headers.authorization.split(" ")[1];

            // Verify token using the secret from jwtConfig
            const decoded = jwt.verify(token, jwtConfig.secret);

            // Find user by ID from the decoded token, excluding the passwordHash
            // Use .select('+passwordHash') if you need the password for comparison here,
            // but for setting req.user, it's usually excluded.
            const user = await User.findById(decoded.id).select("-passwordHash"); 

            if (!user) {
                res.status(401);
                throw new Error("User not found.");
            }

            req.user = user; // Attach user to the request object
            next();
        } catch (error) {
            console.error("JWT Error:", error);
            res.status(401);
            throw new Error("Not authorized, token failed or expired.");
        }
    }

    if (!token) {
        res.status(401);
        throw new Error("Not authorized, no token provided.");
    }
});

/**
 * Middleware to restrict access by user role
 * Usage: authorizeRoles('admin', 'landlord')
 */
const authorizeRoles = (...roles) => {
    return (req, res, next) => {
        // Ensure req.user is set by the 'protect' middleware
        if (!req.user || !roles.includes(req.user.role)) {
            res.status(403); // Forbidden
            throw new Error(`Role '${req.user?.role}' is not authorized to access this route.`);
        }
        next();
    };
};

module.exports = {
    protect,
    authorizeRoles,
};
