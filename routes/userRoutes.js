// backend/routes/userRoutes.js

const express = require('express');
const { body, param, query } = require('express-validator'); // Import validation functions
const router = express.Router();
const userController = require('../controllers/userController'); // Corrected import path
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Corrected import path

// --- Validation Schemas ---

const userIdParamValidation = [
    param('id').isMongoId().withMessage('Invalid user ID in URL.'),
];

const updateUserProfileValidation = [
    body('name').optional().notEmpty().withMessage('Name cannot be empty.'),
    body('phone').optional().notEmpty().withMessage('Phone number cannot be empty.'),
    // Do NOT allow direct email or role changes here for security; handle separately
];

const updateUserValidation = [
    param('id').isMongoId().withMessage('Invalid user ID.'),
    body('name').optional().notEmpty().withMessage('Name cannot be empty.'),
    body('phone').optional().notEmpty().withMessage('Phone number cannot be empty.'),
    body('email').optional().isEmail().withMessage('Valid email is required.').normalizeEmail(), // Email change might require verification
    body('role').optional().isIn(['tenant', 'landlord', 'admin', 'propertymanager', 'vendor']).withMessage('Invalid role provided.'),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean.'),
    body('approved').optional().isBoolean().withMessage('approved must be a boolean.'),
    // body('propertyAssociations').optional().isArray().withMessage('Property associations must be an array.'), // For complex updates
];

const updateUserRoleValidation = [
    param('id').isMongoId().withMessage('Invalid user ID.'),
    body('role').notEmpty().withMessage('Role is required.').isIn(['tenant', 'landlord', 'admin', 'propertymanager', 'vendor']).withMessage('Invalid role provided.'),
];


const createUserValidation = [
    body('name').notEmpty().withMessage('Name is required.'),
    body('email').isEmail().withMessage('Valid email is required.'),
    body('role').notEmpty().isIn(['tenant', 'landlord', 'propertymanager', 'vendor', 'admin']).withMessage('Role is invalid'),
    body('phone').optional().isString(),
    body('propertyId').optional().isMongoId().withMessage('Invalid propertyId'),
    body('unitId').optional().isMongoId().withMessage('Invalid unitId'),
];



// --- ROUTES ---

// GET /api/users/me - Get current logged-in user's profile
router.get('/me', protect, userController.getProfile); // This is `getProfile` from userController, not authController

// PUT /api/users/me - Update current logged-in user's profile
router.put('/me', protect, updateUserProfileValidation, userController.updateMyProfile);


// GET /api/users - List all users (with filtering based on user role)
router.get('/', protect, authorizeRoles('admin', 'landlord', 'propertymanager'), userController.listUsers);

// Add this route after router.get('/', ...) and before router.get('/:id', ...)
router.post(
    '/',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    createUserValidation,
    userController.createUser
);
// GET /api/users/:id - Get specific user details
router.get('/:id', protect, userIdParamValidation, userController.getUserById);

// PUT /api/users/:id - Update a user's profile (Admin only for full update, or limited by PM/Landlord)
router.put('/:id', protect, authorizeRoles('admin', 'landlord', 'propertymanager'), updateUserValidation, userController.updateUser);

// DELETE /api/users/:id - Delete a user by ID
router.delete('/:id', protect, authorizeRoles('admin','landlord', 'propertymanager'), userIdParamValidation, userController.deleteUser);

// PATCH /api/users/:id/approve - Approve a user (if signup requires approval)
router.patch('/:id/approve', protect, authorizeRoles('admin', 'landlord', 'propertymanager'), userIdParamValidation, userController.approveUser);

// PATCH /api/users/:id/role - Update a user's role (Admin only)
router.patch('/:id/role', protect, authorizeRoles('admin'), updateUserRoleValidation, userController.updateUserRole);


module.exports = router;
