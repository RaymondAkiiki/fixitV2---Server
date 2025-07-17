// src/routes/authRoutes.js

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const {
    validateUserRegistration,
    validateResult,
    emailValidator,
    passwordValidator
} = require('../utils/validationUtils');

/**
 * @route POST /api/auth/register
 * @desc Register a new user
 * @access Public
 */
router.post('/register', validateUserRegistration, authController.registerUser);

/**
 * @route POST /api/auth/login
 * @desc Authenticate user & get token
 * @access Public
 */
router.post('/login', [
    ...emailValidator,
    ...passwordValidator,
    validateResult
], authController.loginUser);

/**
 * @route POST /api/auth/logout
 * @desc Logout user / clear cookie
 * @access Private
 */
router.post('/logout', protect, authController.logoutUser);

/**
 * @route PUT /api/auth/change-password
 * @desc Change password for currently authenticated user.
 * @access Private
 */
router.put('/change-password', [
    passwordValidator[0],
    validateResult
], protect, authController.changePassword);

/**
 * @route POST /api/auth/forgot-password
 * @desc Request password reset (send email with token)
 * @access Public
 */
router.post('/forgot-password', [
    ...emailValidator,
    validateResult
], authController.forgotPassword);

/**
 * @route PUT /api/auth/reset-password/:token
 * @desc Reset password using token
 * @access Public
 */
router.put('/reset-password/:token', [
    passwordValidator[0],
    validateResult
], authController.resetPassword);

/**
 * @route POST /api/auth/send-verification-email
 * @desc Request email verification (send email with token)
 * @access Public (should not leak user existence)
 */
router.post('/send-verification-email', authController.sendVerificationEmail); // CHANGED: Removed protect, now public

/**
 * @route GET /api/auth/verify-email/:token
 * @desc Verify user email using token
 * @access Public
 */
router.get('/verify-email/:token', authController.verifyEmail);

module.exports = router;