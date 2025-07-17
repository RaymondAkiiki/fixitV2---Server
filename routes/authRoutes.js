const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const {
    validateUserRegistration,
    emailValidator,
    passwordValidator,
    validateResult
} = require('../utils/validationUtils');
const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler'); // Import asyncHandler

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', validateUserRegistration, asyncHandler(authController.registerUser));

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post(
    '/login',
    [
        ...emailValidator,
        body('password', 'Password is required').notEmpty(),
        validateResult,
    ],
    asyncHandler(authController.loginUser) // Wrap controller in asyncHandler
);

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', protect, asyncHandler(authController.logoutUser));

// @route   GET /api/auth/me
// @desc    Get current user's profile from token
// @access  Private
router.get('/me', protect, asyncHandler(authController.getMe));

// @route   POST /api/auth/forgot-password
// @desc    Request password reset link
// @access  Public
router.post('/forgot-password', [emailValidator, validateResult], asyncHandler(authController.forgotPassword));

// @route   PUT /api/auth/reset-password/:token
// @desc    Reset password using token
// @access  Public
router.put('/reset-password/:token', [passwordValidator, validateResult], asyncHandler(authController.resetPassword));

// @route   GET /api/auth/verify-email/:token
// @desc    Verify user's email address
// @access  Public
router.get('/verify-email/:token', asyncHandler(authController.verifyEmail));

// @route   POST /api/auth/send-verification-email
// @desc    Resend email verification link
// @access  Private
router.post('/send-verification-email', protect, asyncHandler(authController.sendVerificationEmail));

// @route   PUT /api/auth/change-password
// @desc    Change authenticated user's password
// @access  Private
router.put(
    '/change-password',
    protect,
    [
        body('currentPassword', 'Current password is required').notEmpty(),
        body('newPassword', 'New password is required').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
        validateResult
    ],
    asyncHandler(authController.changePassword)
);

module.exports = router;