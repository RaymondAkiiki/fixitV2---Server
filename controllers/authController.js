const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/authService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { getUserProfile } = require('./userController'); // Import getUserProfile

/**
 * @desc Register a new user (classic)
 * @route POST /api/auth/register
 * @access Public
 */
const registerUser = asyncHandler(async (req, res) => {
    const { firstName, lastName, email, phone, password, role } = req.body;
    const user = await authService.registerUser({ firstName, lastName, email, phone, password, role });
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

    res.cookie('jwt', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
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
    // This function will now handle the GET /api/auth/me route
    // It reuses the logic from userController.getUserProfile
    await getUserProfile(req, res);
});


/**
 * @desc Authenticate or register a user via Google OAuth
 * @route POST /api/auth/google
 * @access Public
 * @body {string} idToken
 */
const loginWithGoogle = asyncHandler(async (req, res) => {
    const { idToken } = req.body;
    const ipAddress = req.ip;
    if (!idToken) throw new AppError('Google ID token is required.', 400);

    const { user, accessToken } = await authService.loginOrRegisterWithGoogle(idToken, ipAddress);

    res.cookie('jwt', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
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
    res.cookie('jwt', '', {
        httpOnly: true,
        expires: new Date(0)
    });

    logger.info(`Auth: User ${req.user ? req.user.email : 'unknown'} logged out.`);
    res.status(200).json({ success: true, message: 'Logged out successfully.' });
});

/**
 * @desc Change password for currently authenticated user
 * @route PUT /api/auth/change-password
 * @access Private
 */
const changePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    await authService.updatePassword(userId, currentPassword, newPassword);

    res.status(200).json({ success: true, message: 'Password updated successfully.' });
});

/**
 * @desc Request password reset (send email)
 * @route POST /api/auth/forgot-password
 * @access Public
 */
const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    const frontendUrl = process.env.FRONTEND_URL;

    if (!email) throw new AppError('Email is required for password reset.', 400);

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

    if (!newPassword) throw new AppError('New password is required.', 400);

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
const verifyEmail = asyncHandler(async (req, res, next) => { // Added 'next' for consistency
    const { token } = req.params;

    // ✨ KEY CHANGE: Call the service and send a JSON response
    const result = await authService.verifyEmail(token);
    res.status(200).json({
        success: true,
        message: result.message // Use the message from the service
    });
    // NO res.redirect() here! Frontend will handle navigation.
});

// Locate the `sendVerificationEmail` controller function and modify it
// to handle both authenticated (req.user._id) and unauthenticated (req.body.email) requests.
/**
 * @desc Request email verification (send email with token)
 * @route POST /api/auth/send-verification-email
 * @access Public (Can be called by unauthenticated users providing email, or authenticated users without email in body)
 */
const sendVerificationEmail = asyncHandler(async (req, res) => {
    const { email } = req.body; // Expect email in body for public resend
    const userId = req.user ? req.user._id : null; // Get userId if authenticated

    const frontendUrl = process.env.FRONTEND_URL;

    if (!userId && !email) {
        throw new AppError('Email address is required to resend verification link if not logged in.', 400);
    }

    // Pass userId if authenticated, otherwise pass the email from the body
    const result = await authService.sendEmailVerification(userId, frontendUrl, email);

    res.status(200).json({
        success: true,
        message: result.message || 'Verification email sent. Please check your inbox.'
    });
});

module.exports = {
    registerUser,
    loginUser,
    getMe, // Export the new function
    loginWithGoogle,
    logoutUser,
    changePassword,
    forgotPassword,
    resetPassword,
    sendVerificationEmail,
    verifyEmail,
};