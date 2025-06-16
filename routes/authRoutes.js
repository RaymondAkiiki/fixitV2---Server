// backend/routes/authRoutes.js

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Corrected import

// Validation chains for various auth routes
const registerValidation = [
    body('name').trim().notEmpty().withMessage('Name is required.'),
    body('email').isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('phone').notEmpty().withMessage('Phone number is required.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('role').optional().isIn(['tenant', 'landlord', 'admin', 'propertymanager', 'vendor']).withMessage('Invalid role provided.'),
];

const loginValidation = [
    body('email').isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required.'),
    
];

const forgotPasswordValidation = [
    body('email').isEmail().withMessage('Valid email is required.').normalizeEmail(),
];

const resetPasswordValidation = [
    body('token').notEmpty().withMessage('Reset token is required.'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters.'),
];

// Auth routes
router.post('/register', registerValidation, authController.registerUser); // Updated to registerUser
router.post('/login', loginValidation, authController.loginUser);       // Updated to loginUser

router.post('/forgot-password', forgotPasswordValidation, authController.forgotPassword);
router.post('/reset-password', resetPasswordValidation, authController.resetPassword);

router.get('/validate-token', authController.validateToken); // Publicly accessible for token validation

router.get('/profile', protect, authController.getMe); // Protected route to get current user profile

// Change password (must be authenticated)
router.post('/change-password', protect, authController.changePassword);

router.post('/set-password', authController.setPassword);

module.exports = router;
