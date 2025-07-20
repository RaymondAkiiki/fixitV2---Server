// src/routes/authRoutes.js

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { 
    emailValidator, 
    passwordValidator, 
    validateResult 
} = require('../utils/validationUtils');
const { body, param } = require('express-validator');

/**
 * @route POST /api/auth/register
 * @desc Register a new user
 * @access Public
 */
router.post(
    '/register',
    [
        body('firstName').notEmpty().withMessage('First name is required').trim(),
        body('lastName').notEmpty().withMessage('Last name is required').trim(),
        ...emailValidator,
        body('phone').notEmpty().withMessage('Phone number is required').trim(),
        ...passwordValidator,
        body('role').optional().isIn(['user', 'tenant', 'vendor']).withMessage('Invalid role'),
        validateResult
    ],
    authController.registerUser
);

/**
 * @route POST /api/auth/login
 * @desc Log in and get auth token
 * @access Public
 */
router.post(
    '/login',
    [
        ...emailValidator,
        body('password').notEmpty().withMessage('Password is required'),
        validateResult
    ],
    authController.loginUser
);

/**
 * @route GET /api/auth/me
 * @desc Get current user profile
 * @access Private
 */
router.get('/me', protect, authController.getMe);

/**
 * @route POST /api/auth/google
 * @desc Authenticate with Google
 * @access Public
 */
router.post(
    '/google',
    [
        body('idToken').notEmpty().withMessage('Google ID token is required'),
        validateResult
    ],
    authController.loginWithGoogle
);

/**
 * @route POST /api/auth/logout
 * @desc Logout user
 * @access Private
 */
router.post('/logout', protect, authController.logoutUser);

/**
 * @route PUT /api/auth/change-password
 * @desc Change password (authenticated users)
 * @access Private
 */
router.put(
    '/change-password',
    protect,
    [
        body('currentPassword').notEmpty().withMessage('Current password is required'),
        body('newPassword').notEmpty().withMessage('New password is required')
            .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/)
            .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.'),
        validateResult
    ],
    authController.changePassword
);

/**
 * @route POST /api/auth/forgot-password
 * @desc Request password reset email
 * @access Public
 */
router.post(
    '/forgot-password',
    [
        ...emailValidator,
        validateResult
    ],
    authController.forgotPassword
);

/**
 * @route PUT /api/auth/reset-password/:token
 * @desc Reset password with token
 * @access Public
 */
router.put(
    '/reset-password/:token',
    [
        param('token').notEmpty().withMessage('Token is required'),
        body('newPassword').notEmpty().withMessage('New password is required')
            .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/)
            .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.'),
        validateResult
    ],
    authController.resetPassword
);

/**
 * @route GET /api/auth/verify-email/:token
 * @desc Verify email with token
 * @access Public
 */
router.get(
    '/verify-email/:token',
    [
        param('token').notEmpty().withMessage('Token is required'),
        validateResult
    ],
    authController.verifyEmail
);

/**
 * @route POST /api/auth/send-verification-email
 * @desc Send verification email (works for both logged in and logged out users)
 * @access Public/Private
 */
router.post(
    '/send-verification-email',
    [
        body('email').optional().isEmail().withMessage('Valid email is required if not logged in'),
        validateResult
    ],
    // No protect middleware - handles both authenticated and unauthenticated requests
    authController.sendVerificationEmail
);

module.exports = router;