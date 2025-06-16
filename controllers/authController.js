const asyncHandler = require('express-async-handler');
const { validationResult } = require('express-validator');
const User = require('../models/user');
const Invite = require('../models/invite');
const Property = require('../models/property');
const Unit = require('../models/unit');
const jwt = require('jsonwebtoken');
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { sendEmail } = require("../utils/emailService");
const generateToken = require('../utils/generateToken');
const jwtConfig = require('../config/jwt');

// Helper to send validation errors
const handleValidationErrors = (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }
    return null; // No errors
};

// @desc    Register a new user (for direct sign-ups only)
// @route   POST /api/auth/register
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    const { name, email, password, role, phone } = req.body;

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
        res.status(400);
        throw new Error('User with this email already exists.');
    }

    // Create user
    const user = new User({
        name,
        email,
        phone,
        role: role?.toLowerCase(),
        passwordHash: password // triggers pre-save hash hook
    });
    await user.save();

    if (user) {
        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            token: generateToken(user._id),
        });
    } else {
        res.status(400);
        throw new Error('Invalid user data provided.');
    }
});

// @desc    Authenticate a user
// @route   POST /api/auth/login
// @access  Public
const loginUser = asyncHandler(async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+passwordHash');

    if (user && (await user.matchPassword(password))) {
        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            approved: user.approved,
            token: generateToken(user._id),
        });
    } else {
        res.status(401);
        throw new Error('Invalid credentials.');
    }
});

// @desc    Request a password reset link
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
        res.status(404);
        throw new Error("User not found with this email.");
    }

    // Generate reset token using the method defined on the User model
    const resetToken = user.generateResetToken();
    await user.save();

    // Construct the reset URL for the frontend (use FRONTEND_URL and /reset-password/:token route)
    const resetUrl = `${process.env.FRONTEND_URL || process.env.VITE_API_URL}/reset-password/${resetToken}`;
    const message = `You requested a password reset. Click the following link to reset your password: ${resetUrl}`;

    try { 
        await sendEmail({
            to: user.email,
            subject: "Password Reset for Fix It by Threalty",
            text: message,
            html: `<p>${message}</p>`
        });
        res.status(200).json({ message: "Password reset email sent." });
    } catch (err) {
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        console.error('Error sending reset email:', err);
        res.status(500);
        throw new Error("Failed to send password reset email. Please try again later.");
    }
});

// @desc    Reset user password
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    const { token, newPassword } = req.body;

    // Hash the token from the request to compare with the stored hashed token
    const resetTokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
        resetPasswordToken: resetTokenHash,
        resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
        res.status(400);
        throw new Error("Invalid or expired reset token.");
    }

    user.passwordHash = newPassword; // triggers pre-save hash hook
    await user.save();

    res.status(200).json({ message: "Password reset successful. You can now log in." });
});

// @desc    Validate a JWT token (e.g., for persistent login check)
// @route   GET /api/auth/validate-token
// @access  Public (client can send token for validation)
const validateToken = asyncHandler(async (req, res) => {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
        res.status(401);
        throw new Error("No token provided. Authorization denied.");
    }

    try {
        const decoded = jwt.verify(token, jwtConfig.secret);
        const user = await User.findById(decoded.id).select("-passwordHash");

        if (!user) {
            res.status(401);
            throw new Error("Invalid token. User not found.");
        }

        res.status(200).json({
            message: "Token is valid.",
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                propertiesManaged: user.propertiesManaged,
                propertiesOwned: user.propertiesOwned,
                tenancies: user.tenancies
            }
        });
    } catch (err) {
        console.error('Validate Token Error:', err);
        res.status(401);
        throw new Error("Invalid or expired token.");
    }
});

// @desc    Get current logged-in user's profile
// @route   GET /api/auth/profile
// @access  Private (requires JWT)
const getMe = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select("-passwordHash");

    if (!user) {
        res.status(404);
        throw new Error("User not found.");
    }

    res.status(200).json({
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        propertiesManaged: user.propertiesManaged,
        propertiesOwned: user.propertiesOwned,
        tenancies: user.tenancies
    });
});

/**
 * @desc    Change password for the currently authenticated user.
 * @route   POST /api/auth/change-password
 * @access  Private (requires JWT)
 * @param   {string} currentPassword - The user's current password.
 * @param   {string} newPassword - The desired new password.
 */
const changePassword = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        res.status(400);
        throw new Error('Both current and new passwords are required.');
    }
    if (newPassword.length < 8) {
        res.status(400);
        throw new Error('New password must be at least 8 characters long.');
    }

    const user = await User.findById(userId).select('+passwordHash');
    if (!user) {
        res.status(404);
        throw new Error('User not found.');
    }

    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
        res.status(401);
        throw new Error('Current password is incorrect.');
    }

    // Set and save new password (triggers pre-save hash)
    user.passwordHash = newPassword;
    await user.save();

    res.json({ message: 'Password updated successfully.' });
});

/**
 * @desc    Set password for a user via a token (e.g., from invite or reset flow)
 * @route   POST /api/auth/set-password
 * @access  Public (token is required)
 * @param   {string} email
 * @param   {string} token
 * @param   {string} password
 */
const setPassword = asyncHandler(async (req, res) => {
    const { email, token, password } = req.body;
    if (!email || !token || !password) {
        res.status(400);
        throw new Error('Email, token, and new password are required.');
    }
    const user = await User.findOne({
        email: email.toLowerCase(),
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) {
        res.status(400);
        throw new Error('Invalid or expired token.');
    }
    user.passwordHash = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.status(200).json({ message: "Password set successfully. You can now log in." });
});

const authController = {
    registerUser,
    loginUser,
    forgotPassword,
    resetPassword,
    validateToken,
    getMe,
    changePassword,
    setPassword,
};

module.exports = authController;