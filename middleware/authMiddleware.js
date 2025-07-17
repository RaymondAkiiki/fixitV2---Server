// src/middleware/authMiddleware.js

const jwt = require("jsonwebtoken");
const asyncHandler = require('../utils/asyncHandler');
const User = require("../models/user");
const PropertyUser = require("../models/propertyUser");
const Property = require("../models/property"); // Ensure Property model is imported for unit checks
const jwtConfig = require('../config/jwt');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { ROLE_ENUM, PROPERTY_USER_ROLES_ENUM } = require('../utils/constants/enums');

/**
 * Middleware to protect routes by verifying a JWT.
 * It ensures the user is authenticated, their account is active, and their email is verified.
 */
const protect = asyncHandler(async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
        try {
            // Extract token from "Bearer <token>"
            token = req.headers.authorization.split(" ")[1];

            // Verify the token and decode its payload
            const decoded = jwt.verify(token, jwtConfig.secret);

            // Find the user from the database, excluding the password hash
            const user = await User.findById(decoded.id).select('-passwordHash');

            // --- User Validation Checks ---

            // 1. Check if user still exists
            if (!user) {
                return next(new AppError('The user belonging to this token no longer exists.', 401));
            }

            // 2. Check if the account is active
            if (!user.isActive || user.registrationStatus !== 'active') {
                return next(new AppError('Your account is inactive or not yet activated. Please contact support.', 403));
            }

            // 3. Check if the email has been verified (crucial for most actions)
            if (!user.isEmailVerified) {
                return next(new AppError('Please verify your email address before accessing this resource.', 403));
            }

            // Attach user to the request object for downstream use
            req.user = user;
            next();
        } catch (error) {
            // Handle specific JWT errors with user-friendly messages
            if (error.name === 'TokenExpiredError') {
                return next(new AppError('Your session has expired. Please log in again.', 401));
            }
            if (error.name === 'JsonWebTokenError') {
                return next(new AppError('Invalid token. Please log in again.', 401));
            }
            // Log unexpected errors and return a generic failure message
            logger.error(`Error verifying token: ${error.message}`, { stack: error.stack });
            return next(new AppError('Not authorized, token validation failed.', 401));
        }
    }

    if (!token) {
        return next(new AppError('Not authorized, no token provided.', 401));
    }
});

/**
 * Middleware to authorize access based on a list of allowed user roles.
 * @param {...string} allowedRoles - Roles that can access the route (e.g., 'admin', 'landlord').
 */
const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return next(new AppError('Authentication error: User role not found.', 403));
        }

        if (!allowedRoles.includes(req.user.role)) {
            return next(new AppError(`Access denied. Your role ('${req.user.role}') is not authorized for this resource.`, 403));
        }
        next();
    };
};

/**
 * Middleware to authorize access to a specific property or unit.
 * Grants access if the user is an Admin, or is associated with the resource as a Landlord, PM, or Tenant.
 * @param {string} [idParamName='propertyId'] - The name of the route parameter holding the property or unit ID.
 * @param {boolean} [isUnitCheck=false] - Set to true to validate access to a specific unit.
 */
const authorizePropertyAccess = (idParamName = 'propertyId', isUnitCheck = false) => asyncHandler(async (req, res, next) => {
    if (!req.user) {
        return next(new AppError('User not authenticated for property access check.', 401));
    }

    // Admins and SuperAdmins have universal access
    if ([ROLE_ENUM.ADMIN, ROLE_ENUM.SUPER_ADMIN].includes(req.user.role)) {
        return next();
    }

    const targetId = req.params[idParamName];
    if (!targetId) {
        return next(new AppError(`Request parameter '${idParamName}' is missing.`, 400));
    }

    let propertyIdForCheck = targetId;
    const queryConditions = {
        user: req.user._id,
    };

    if (isUnitCheck) {
        // Find the property that contains the unit to get its ID
        const propertyContainingUnit = await Property.findOne({ 'units._id': targetId }, { _id: 1 });
        if (!propertyContainingUnit) {
            return next(new AppError(`Resource not found. No property contains a unit with ID ${targetId}.`, 404));
        }
        propertyIdForCheck = propertyContainingUnit._id;

        // Build query to find if user is LL/PM of the property OR a tenant of that specific unit
        queryConditions.property = propertyIdForCheck;
        queryConditions.$or = [
            { role: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER] } },
            { $and: [{ role: PROPERTY_USER_ROLES_ENUM.TENANT }, { 'unit.unitId': targetId }] }
        ];
    } else {
        // For property-level checks, just verify the user is associated with the property
        queryConditions.property = propertyIdForCheck;
        queryConditions.role = { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.TENANT] };
    }
    
    // Execute the query to find the association
    const propertyUserAssociation = await PropertyUser.findOne(queryConditions);

    if (!propertyUserAssociation) {
        return next(new AppError(`You are not authorized to access this ${isUnitCheck ? 'unit' : 'property'}.`, 403));
    }

    // Attach useful context to the request for subsequent middleware or controllers
    req.propertyId = propertyIdForCheck;
    req.propertyUserAssociation = propertyUserAssociation;

    next();
});

module.exports = {
    protect,
    authorizeRoles,
    authorizePropertyAccess,
};