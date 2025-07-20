// src/routes/inviteRoutes.js

const express = require('express');
const router = express.Router();
const inviteController = require('../controllers/inviteController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { validateMongoId, validateResult } = require('../utils/validationUtils');
const { body, query, param } = require('express-validator');
const { ROLE_ENUM, PROPERTY_USER_ROLES_ENUM, INVITE_STATUS_ENUM } = require('../utils/constants/enums');

// --- Private routes (authenticated) ---

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
        body('email')
            .notEmpty().withMessage('Email is required.')
            .isEmail().withMessage('Invalid email format.')
            .normalizeEmail(),
        body('roles')
            .isArray({ min: 1 }).withMessage('At least one role is required.')
            .custom(roles => {
                if (!roles || !Array.isArray(roles)) return false;
                return roles.every(role => PROPERTY_USER_ROLES_ENUM.includes(role));
            }).withMessage(`Roles must be one of: ${PROPERTY_USER_ROLES_ENUM.join(', ')}`),
        body('propertyId')
            .optional({ nullable: true })
            .isMongoId().withMessage('Invalid property ID format.'),
        body('unitId')
            .optional({ nullable: true })
            .isMongoId().withMessage('Invalid unit ID format.'),
        body('phone')
            .optional()
            .isMobilePhone('any').withMessage('Invalid phone number format.'),
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
        query('status')
            .optional()
            .isIn(INVITE_STATUS_ENUM).withMessage(`Invalid status. Must be one of: ${INVITE_STATUS_ENUM.join(', ')}`),
        query('propertyId')
            .optional()
            .isMongoId().withMessage('Invalid property ID format.'),
        query('email')
            .optional()
            .isString().withMessage('Email filter must be a string.'),
        query('page')
            .optional()
            .isInt({ min: 1 }).withMessage('Page must be a positive integer.')
            .toInt(),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.')
            .toInt(),
        validateResult
    ],
    inviteController.getInvites
);

/**
 * @route GET /api/invites/:id
 * @desc Get a specific invitation by ID
 * @access Private (Admin or invite creator)
 */
router.get(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    inviteController.getInviteById
);

/**
 * @route PATCH /api/invites/:id/cancel
 * @desc Cancel an invitation
 * @access Private (Admin or invite creator)
 */
router.patch(
    '/:id/cancel',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    inviteController.cancelInvite
);

/**
 * @route PATCH /api/invites/:id/resend
 * @desc Resend an invitation
 * @access Private (Admin or invite creator)
 */
router.patch(
    '/:id/resend',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    inviteController.resendInvite
);

// --- Public invitation routes ---

/**
 * @route GET /api/public/invites/:token/verify
 * @desc Verify an invitation token
 * @access Public
 */
router.get(
    '/public/:token/verify',
    [
        param('token')
            .notEmpty().withMessage('Token is required.')
            .isString().withMessage('Token must be a string.'),
        validateResult
    ],
    inviteController.verifyInviteToken
);

/**
 * @route POST /api/public/invites/:token/accept
 * @desc Accept an invitation and create/update user account
 * @access Public
 */
router.post(
    '/public/:token/accept',
    [
        param('token')
            .notEmpty().withMessage('Token is required.')
            .isString().withMessage('Token must be a string.'),
        body('email')
            .notEmpty().withMessage('Email is required.')
            .isEmail().withMessage('Invalid email format.')
            .normalizeEmail(),
        body('firstName')
            .optional()
            .isString().withMessage('First name must be a string.')
            .isLength({ min: 1, max: 50 }).withMessage('First name must be between 1 and 50 characters.'),
        body('lastName')
            .optional()
            .isString().withMessage('Last name must be a string.')
            .isLength({ min: 1, max: 50 }).withMessage('Last name must be between 1 and 50 characters.'),
        body('password')
            .optional()
            .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/)
            .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.'),
        body('confirmPassword')
            .optional()
            .custom((value, { req }) => {
                return value === req.body.password;
            }).withMessage('Passwords do not match.'),
        body('phone')
            .optional()
            .isMobilePhone('any').withMessage('Invalid phone number format.'),
        validateResult
    ],
    inviteController.acceptInvite
);

/**
 * @route POST /api/public/invites/:token/decline
 * @desc Decline an invitation
 * @access Public
 */
router.post(
    '/public/:token/decline',
    [
        param('token')
            .notEmpty().withMessage('Token is required.')
            .isString().withMessage('Token must be a string.'),
        body('reason')
            .optional()
            .isString().withMessage('Reason must be a string.')
            .isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters.'),
        validateResult
    ],
    inviteController.declineInvite
);

module.exports = router;