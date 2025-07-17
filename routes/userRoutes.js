// src/routes/userRoutes.js

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController'); // Import user controller
const { protect, authorizeRoles, authorizePropertyAccess } = require('../middleware/authMiddleware'); // Import auth middleware
const {
    validateMongoId,
    validateUserRegistration, // For createUser
    validateResult,
    emailValidator,
    passwordValidator // For manual user creation (temp password)
} = require('../utils/validationUtils'); // Import validation utilities
const { ROLE_ENUM, PROPERTY_USER_ROLES_ENUM , REGISTRATION_STATUS_ENUM} = require('../utils/constants/enums'); // Import enums for roles
const { body, query } = require('express-validator');

// Routes for the authenticated user's own profile
router.route('/profile')
    .get(protect, userController.getUserProfile) // Get own profile
    .put(
        protect,
        // Validation for updating own profile (e.g., name, phone, preferences)
        [
            body('firstName').optional().trim().isLength({ max: 50 }).withMessage('First name cannot exceed 50 characters.'),
            body('lastName').optional().trim().isLength({ max: 50 }).withMessage('Last name cannot exceed 50 characters.'),
            body('phone').optional().trim().isMobilePhone('any', { strictMode: false }).withMessage('Please provide a valid phone number.'),
            body('avatar').optional().isURL().withMessage('Avatar must be a valid URL.'), // Assuming avatar is a URL
            body('preferences').optional().isObject().withMessage('Preferences must be an object.'),
            validateResult
        ],
        userController.updateUserProfile
    );

// Routes for managing other users (requires higher privileges)

/**
 * @route GET /api/users
 * @desc Get all users with filtering and pagination
 * @access Private (Admin, Landlord, Property Manager)
 */
router.get(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    userController.getAllUsers
);

/**
 * @route POST /api/users
 * @desc Create a new user manually (Admin, Landlord, or PM can add tenants/vendors)
 * @access Private (Admin, Landlord, Property Manager)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    [
        body('firstName').notEmpty().withMessage('First name is required').trim().isLength({ max: 50 }),
        body('lastName').notEmpty().withMessage('Last name is required').trim().isLength({ max: 50 }),
        ...emailValidator, // Use shared email validation
        body('phone').notEmpty().withMessage('Phone number is required').trim().isMobilePhone('any', { strictMode: false }),
        body('role').notEmpty().withMessage('Role is required').isIn(Object.values(ROLE_ENUM)).withMessage(`Invalid role. Must be one of: ${Object.values(ROLE_ENUM).join(', ')}`),
        body('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        body('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        validateResult
    ],
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
    validateMongoId('id'), // Validate ID in params
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
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER), // Only these roles can update other users
    validateMongoId('id'), // Validate ID in params
    // Add specific body validations for update here. Example:
    [
        body('firstName').optional().trim().isLength({ max: 50 }).withMessage('First name cannot exceed 50 characters.'),
        body('lastName').optional().trim().isLength({ max: 50 }).withMessage('Last name cannot exceed 50 characters.'),
        body('phone').optional().trim().isMobilePhone('any', { strictMode: false }).withMessage('Please provide a valid phone number.'),
        body('avatar').optional().isURL().withMessage('Avatar must be a valid URL.'),
        body('preferences').optional().isObject().withMessage('Preferences must be an object.'),
        body('role').optional().isIn(Object.values(ROLE_ENUM)).withMessage(`Invalid role. Must be one of: ${Object.values(ROLE_ENUM).join(', ')}`),
        body('status').optional().isIn(Object.values(REGISTRATION_STATUS_ENUM)).withMessage(`Invalid status. Must be one of: ${Object.values(REGISTRATION_STATUS_ENUM).join(', ')}`),
        validateResult
    ],
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
    authorizeRoles(ROLE_ENUM.ADMIN), // Only global admin can delete users
    validateMongoId('id'), // Validate ID in params
    userController.deleteUserById
);

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
 * @desc Update a user's global role (Admin only)
 * @access Private (Admin only)
 */
router.put(
    '/:id/role',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN),
    validateMongoId('id'),
    [
        body('role').notEmpty().withMessage('Role is required').isIn(Object.values(ROLE_ENUM)).withMessage(`Invalid role. Must be one of: ${Object.values(ROLE_ENUM).join(', ')}`),
        validateResult
    ],
    userController.updateUserRole
);


module.exports = router;
