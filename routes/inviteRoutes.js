// src/routes/inviteRoutes.js

const express = require('express');
const router = express.Router();
const inviteController = require('../controllers/inviteController'); // Import controller
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Import auth middleware
const { validateMongoId, validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { ROLE_ENUM, PROPERTY_USER_ROLES_ENUM, INVITE_STATUS_ENUM } = require('../utils/constants/enums'); // Import enums
const { body, query, param } = require('express-validator'); // For specific body/query/param validation

// Private routes (require authentication)

/**
 * @route POST /api/invites
 * @desc Create and send a new invitation
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    [
        body('email').notEmpty().withMessage('Email is required.').isEmail().withMessage('Please provide a valid email address.').normalizeEmail(),
        body('roles').notEmpty().withMessage('Roles are required.').isArray({ min: 1 }).withMessage('At least one role is required.')
            .custom(roles => roles.every(role => PROPERTY_USER_ROLES_ENUM.includes(role.toLowerCase()))).withMessage(`Invalid role(s) provided. Must be one of: ${PROPERTY_USER_ROLES_ENUM.join(', ')}`),
        body('propertyId').notEmpty().withMessage('Property ID is required.').isMongoId().withMessage('Invalid Property ID format.'),
        body('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        validateResult
    ],
    inviteController.createInvite
);

/**
 * @route GET /api/invites
 * @desc Get all invitations accessible by the logged-in user
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.get(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    [
        query('status').optional().isIn(INVITE_STATUS_ENUM).withMessage(`Invalid status filter. Must be one of: ${INVITE_STATUS_ENUM.join(', ')}`),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('email').optional().isEmail().withMessage('Invalid email format for filter.'),
        validateResult
    ],
    inviteController.getInvites
);

/**
 * @route PATCH /api/invites/:id/cancel
 * @desc Cancel an invitation
 * @access Private (Admin, or the user who generated the invite)
 */
router.patch(
    '/:id/cancel',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER), // Added PM/Landlord as they can generate invites
    validateMongoId('id'),
    inviteController.cancelInvite
);

// --- Public Invitation Acceptance Routes (No Authentication Required) ---

/**
 * @route GET /public/invites/:token/verify
 * @desc Verify an invitation token
 * @access Public
 */
router.get(
    '/public/invites/:token/verify',
    [
        param('token').notEmpty().withMessage('Token is required.').isString().isLength({ min: 64, max: 64 }).withMessage('Invalid token format.'), // Assuming 32-byte hex token
        validateResult
    ],
    inviteController.verifyInviteToken
);

/**
 * @route POST /public/invites/:token/accept
 * @desc Accept an invitation and create/update user account
 * @access Public
 */
router.post(
    '/public/invites/:token/accept',
    [
        param('token').notEmpty().withMessage('Token is required.').isString().isLength({ min: 64, max: 64 }).withMessage('Invalid token format.'),
        body('email').notEmpty().withMessage('Email is required.').isEmail().withMessage('Please provide a valid email address.').normalizeEmail(),
        body('firstName').optional().isString().trim().isLength({ min: 1, max: 50 }).withMessage('First name is required for new users and must be 1-50 characters.'),
        body('lastName').optional().isString().trim().isLength({ min: 1, max: 50 }).withMessage('Last name is required for new users and must be 1-50 characters.'),
        body('password').optional().isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.')
            .matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+])[A-Za-z\d!@#$%^&*()_+]{8,}/).withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.'),
        body('confirmPassword').optional().custom((confirmPassword, { req }) => {
            if (confirmPassword !== req.body.password) {
                throw new Error('Passwords do not match.');
            }
            return true;
        }),
        validateResult
    ],
    inviteController.acceptInvite
);

/**
 * @route POST /public/invites/:token/decline
 * @desc Decline an invitation
 * @access Public
 */
router.post(
    '/public/invites/:token/decline',
    [
        param('token').notEmpty().withMessage('Token is required.').isString().isLength({ min: 64, max: 64 }).withMessage('Invalid token format.'),
        body('reason').optional().isString().trim().isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters.'),
        validateResult
    ],
    inviteController.declineInvite
);

module.exports = router;
