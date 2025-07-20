// src/controllers/authController.js

const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/authService');
const userService = require('../services/userService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Register a new user (classic)
 * @route POST /api/auth/register
 * @access Public
 */
const registerUser = asyncHandler(async (req, res) => {
    const { firstName, lastName, email, phone, password, role } = req.body;
    
    const user = await authService.registerUser({ 
        firstName, 
        lastName, 
        email, 
        phone, 
        password, 
        role 
    });
    
    res.status(201).json({
        success: true,
        message: 'User registered successfully. Please check your email for verification if applicable.',
        user
    });
});

/**
 * @desc Authenticate user & get token (classic)
 * @route POST /api/auth/login
 * @access Public
 */
const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const ipAddress = req.ip;
    
    const { user, accessToken } = await authService.loginUser(email, password, ipAddress);

    // Set HTTP-only cookie with token
    res.cookie('jwt', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.status(200).json({
        success: true,
        message: 'Logged in successfully.',
        user,
        accessToken
    });
});

/**
 * @desc Get current authenticated user
 * @route GET /api/auth/me
 * @access Private
 */
const getMe = asyncHandler(async (req, res) => {
    const userProfile = await userService.getUserProfile(req.user._id);
    
    res.status(200).json({
        success: true,
        user: userProfile
    });
});

/**
 * @desc Authenticate or register a user via Google OAuth
 * @route POST /api/auth/google
 * @access Public
 */
const loginWithGoogle = asyncHandler(async (req, res) => {
    const { idToken } = req.body;
    const ipAddress = req.ip;
    
    if (!idToken) {
        throw new AppError('Google ID token is required.', 400);
    }

    const { user, accessToken } = await authService.loginOrRegisterWithGoogle(idToken, ipAddress);

    // Set HTTP-only cookie with token
    res.cookie('jwt', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.status(200).json({
        success: true,
        message: 'Logged in with Google successfully.',
        user,
        accessToken
    });
});

/**
 * @desc Logout user / clear cookie
 * @route POST /api/auth/logout
 * @access Private
 */
const logoutUser = asyncHandler(async (req, res) => {
    // Clear JWT cookie
    res.cookie('jwt', '', {
        httpOnly: true,
        expires: new Date(0)
    });

    logger.info(`Auth: User ${req.user ? req.user.email : 'unknown'} logged out.`);
    
    res.status(200).json({ 
        success: true, 
        message: 'Logged out successfully.' 
    });
});

/**
 * @desc Change password for currently authenticated user
 * @route PUT /api/auth/change-password
 * @access Private
 */
const changePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;
    const ipAddress = req.ip;

    await authService.updatePassword(userId, currentPassword, newPassword, ipAddress);

    res.status(200).json({ 
        success: true, 
        message: 'Password updated successfully.' 
    });
});

/**
 * @desc Request password reset (send email)
 * @route POST /api/auth/forgot-password
 * @access Public
 */
const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    const frontendUrl = process.env.FRONTEND_URL;

    if (!email) {
        throw new AppError('Email is required for password reset.', 400);
    }

    await authService.initiatePasswordReset(email, frontendUrl);

    res.status(200).json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
    });
});

/**
 * @desc Reset password using token
 * @route PUT /api/auth/reset-password/:token
 * @access Public
 */
const resetPassword = asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
        throw new AppError('New password is required.', 400);
    }

    await authService.resetPassword(token, newPassword);

    res.status(200).json({
        success: true,
        message: 'Password has been reset successfully.'
    });
});

/**
 * @desc Verify user email using token
 * @route GET /api/auth/verify-email/:token
 * @access Public
 */
const verifyEmail = asyncHandler(async (req, res) => {
    const { token } = req.params;

    const result = await authService.verifyEmail(token);
    
    res.status(200).json({
        success: true,
        message: result.message
    });
});

/**
 * @desc Request email verification (send email with token)
 * @route POST /api/auth/send-verification-email
 * @access Public/Private
 */
const sendVerificationEmail = asyncHandler(async (req, res) => {
    const { email } = req.body; // For public route
    const userId = req.user ? req.user._id : null; // For authenticated route
    const frontendUrl = process.env.FRONTEND_URL;

    if (!userId && !email) {
        throw new AppError('Email address is required if not logged in.', 400);
    }

    const result = await authService.sendEmailVerification(userId, frontendUrl, email);

    res.status(200).json({
        success: true,
        message: result.message
    });
});

module.exports = {
    registerUser,
    loginUser,
    getMe,
    loginWithGoogle,
    logoutUser,
    changePassword,
    forgotPassword,
    resetPassword,
    verifyEmail,
    sendVerificationEmail
};