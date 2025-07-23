// src/routes/userRoutes.js
// STANDARDIZED USER ROUTES - Example Template for All Routes

const express = require('express');
const router = express.Router();

// Controller import
const userController = require('../controllers/userController');

// Middleware imports
const { protect, authorizeRoles, authorizePropertyAccess } = require('../middleware/authMiddleware');

// Validation imports
const {
    validateMongoId,
    validateResult,
    emailValidator,
    passwordValidator
} = require('../utils/validationUtils');

// Constants and enums
const { ROLE_ENUM, PROPERTY_USER_ROLES_ENUM, REGISTRATION_STATUS_ENUM } = require('../utils/constants/enums');

// Express validator
const { body, query, param } = require('express-validator');

// =====================================================
// CUSTOM VALIDATION MIDDLEWARE
// =====================================================

const validateUserProfileData = [
    body('firstName').optional().trim().isLength({ max: 50 })
        .withMessage('First name cannot exceed 50 characters.'),
    body('lastName').optional().trim().isLength({ max: 50 })
        .withMessage('Last name cannot exceed 50 characters.'),
    body('phone').optional().trim().isMobilePhone('any', { strictMode: false })
        .withMessage('Please provide a valid phone number.'),
    body('avatar').optional().isURL()
        .withMessage('Avatar must be a valid URL.'),
    body('preferences').optional().isObject()
        .withMessage('Preferences must be an object.'),
    validateResult
];

const validateCreateUserData = [
    body('firstName').notEmpty().withMessage('First name is required')
        .trim().isLength({ max: 50 }),
    body('lastName').notEmpty().withMessage('Last name is required')
        .trim().isLength({ max: 50 }),
    ...emailValidator,
    body('phone').notEmpty().withMessage('Phone number is required')
        .trim().isMobilePhone('any', { strictMode: false }),
    body('role').notEmpty().withMessage('Role is required')
        .isIn(Object.values(ROLE_ENUM))
        .withMessage(`Invalid role. Must be one of: ${Object.values(ROLE_ENUM).join(', ')}`),
    body('propertyId').optional().isMongoId()
        .withMessage('Invalid Property ID format.'),
    body('unitId').optional().isMongoId()
        .withMessage('Invalid Unit ID format.'),
    validateResult
];

const validateUpdateUserData = [
    body('firstName').optional().trim().isLength({ max: 50 })
        .withMessage('First name cannot exceed 50 characters.'),
    body('lastName').optional().trim().isLength({ max: 50 })
        .withMessage('Last name cannot exceed 50 characters.'),
    body('phone').optional().trim().isMobilePhone('any', { strictMode: false })
        .withMessage('Please provide a valid phone number.'),
    body('avatar').optional().isURL()
        .withMessage('Avatar must be a valid URL.'),
    body('preferences').optional().isObject()
        .withMessage('Preferences must be an object.'),
    body('role').optional().isIn(Object.values(ROLE_ENUM))
        .withMessage(`Invalid role. Must be one of: ${Object.values(ROLE_ENUM).join(', ')}`),
    body('status').optional().isIn(Object.values(REGISTRATION_STATUS_ENUM))
        .withMessage(`Invalid status. Must be one of: ${Object.values(REGISTRATION_STATUS_ENUM).join(', ')}`),
    validateResult
];

// =====================================================
// AUTHENTICATED USER'S OWN PROFILE ROUTES
// =====================================================

/**
 * @route GET /api/users/profile
 * @desc Get authenticated user's own profile
 * @access Private
 */
router.get('/profile', protect, userController.getUserProfile);

/**
 * @route PUT /api/users/profile
 * @desc Update authenticated user's own profile
 * @access Private
 */
router.put('/profile', protect, validateUserProfileData, userController.updateUserProfile);

// =====================================================
// USER MANAGEMENT ROUTES (Admin/Manager level)
// =====================================================

/**
 * @route GET /api/users
 * @desc Get all users with filtering and pagination
 * @access Private (Admin, Landlord, Property Manager)
 */
router.get(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    [
        query('role').optional().isIn(Object.values(ROLE_ENUM))
            .withMessage('Invalid role filter'),
        query('status').optional().isIn(Object.values(REGISTRATION_STATUS_ENUM))
            .withMessage('Invalid status filter'),
        query('search').optional().isString().trim(),
        query('propertyId').optional().isMongoId()
            .withMessage('Invalid Property ID format'),
        query('unitId').optional().isMongoId()
            .withMessage('Invalid Unit ID format'),
        query('page').optional().isInt({ min: 1 })
            .withMessage('Page must be a positive integer'),
        query('limit').optional().isInt({ min: 1, max: 100 })
            .withMessage('Limit must be between 1 and 100'),
        validateResult
    ],
    userController.getAllUsers
);

/**
 * @route POST /api/users
 * @desc Create a new user manually
 * @access Private (Admin, Landlord, Property Manager)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateCreateUserData,
    userController.createUser
);

/**
 * @route GET /api/users/:id
 * @desc Get specific user details by ID
 * @access Private (Admin, Landlord, Property Manager - with access control)
 */
router.get(
    '/:id',
    protect,
    validateMongoId('id'),
    userController.getUserById
);

/**
 * @route PUT /api/users/:id
 * @desc Update a user's profile by ID
 * @access Private (Admin for full update; Landlord/PM for limited fields on associated users)
 */
router.put(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    validateUpdateUserData,
    userController.updateUserById
);

/**
 * @route DELETE /api/users/:id
 * @desc Delete user by ID
 * @access Private (Admin only)
 */
router.delete(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN),
    validateMongoId('id'),
    userController.deleteUserById
);

// =====================================================
// USER ACTION ROUTES
// =====================================================

/**
 * @route PUT /api/users/:id/approve
 * @desc Approve a pending user
 * @access Private (Admin, Landlord, Property Manager)
 */
router.put(
    '/:id/approve',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    userController.approveUser
);

/**
 * @route PUT /api/users/:id/role
 * @desc Update a user's global role
 * @access Private (Admin only)
 */
router.put(
    '/:id/role',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN),
    validateMongoId('id'),
    [
        body('role').notEmpty().withMessage('Role is required')
            .isIn(Object.values(ROLE_ENUM))
            .withMessage(`Invalid role. Must be one of: ${Object.values(ROLE_ENUM).join(', ')}`),
        validateResult
    ],
    userController.updateUserRole
);

module.exports = router;
