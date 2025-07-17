const crypto = require('crypto');
const User = require('../models/user');
const { hashPassword, comparePasswords } = require('../utils/passwordHash');
const { generateToken } = require('../utils/jwt');
const { verifyGoogleIdToken } = require('../lib/googleAuthClient');
const { sendEmail } = require('./emailService'); // Assuming this is your configured email sender
const logger = require('../utils/logger');
const { createAuditLog } = require('./auditService');
const AppError = require('../utils/AppError');
const { userToDto } = require('../utils/userDto');
const { REGISTRATION_STATUS_ENUM } = require('../utils/constants/enums');

/**
 * Registers a new user via classic email/password signup.
 * @param {object} userData - User registration data.
 * @returns {Promise<object>} The user DTO.
 */
const registerUser = async (userData) => {
    const { firstName, lastName, email, phone, password, role } = userData;
    const normalizedEmail = email.toLowerCase();

    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
        throw new AppError('An account with this email address already exists.', 409); // 409 Conflict
    }

    const passwordHash = await hashPassword(password);

    const registrationStatus = role === 'tenant'
        ? 'pending_invite_acceptance'
        : 'pending_email_verification';

    const user = new User({
        firstName,
        lastName,
        email: normalizedEmail,
        phone,
        passwordHash,
        role,
        registrationStatus,
        isEmailVerified: false,
        isActive: true,
    });

    await user.save();
    logger.info(`AuthService: New user registered: ${user.email} with role ${user.role}.`);
    await createAuditLog({
        action: 'USER_REGISTERED',
        user: user._id,
        resourceType: 'User',
        resourceId: user._id,
        newValue: { email: user.email, role: user.role },
        description: `New user ${user.email} registered.`
    });

    // Automatically trigger verification email if the role requires it.
    if (registrationStatus === 'pending_email_verification') {
        await sendEmailVerification(user._id, process.env.FRONTEND_URL);
    }

    return userToDto(user);
};

/**
 * Logs in a user with email and password.
 * @param {string} email - User's email.
 * @param {string} password - User's plain text password.
 * @param {string} ipAddress - IP address of the user.
 * @returns {Promise<object>} Object containing the user DTO and access token.
 */
const loginUser = async (email, password, ipAddress) => {
    const normalizedEmail = email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

    if (!user || !user.passwordHash) {
        logger.warn(`Failed login attempt for email: ${email}. Reason: User not found or has no password.`);
        throw new AppError('Invalid credentials.', 401);
    }

    if (!user.isActive) {
        logger.warn(`Failed login attempt for deactivated user: ${email}.`);
        throw new AppError('Your account has been deactivated. Please contact support.', 403);
    }

    if (!user.isEmailVerified) {
        logger.warn(`Failed login attempt for unverified email: ${email}.`);
        throw new AppError('Please verify your email address before logging in.', 403);
    }

    const passwordsMatch = await comparePasswords(password, user.passwordHash);
    if (!passwordsMatch) {
        logger.warn(`Failed login attempt for user: ${email}. Reason: Incorrect password.`);
        await createAuditLog({ action: 'LOGIN_ATTEMPT_FAILED', user: user._id, ipAddress, description: 'Incorrect password.' });
        throw new AppError('Invalid credentials.', 401);
    }

    const accessToken = generateToken(user._id);

    // Update last login timestamp and save
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    logger.info(`AuthService: User logged in successfully: ${user.email}`);
    await createAuditLog({ action: 'USER_LOGIN', user: user._id, ipAddress, description: 'Login successful.' });

    return { user: userToDto(user), accessToken };
};

/**
 * Authenticates or registers a user via a Google ID token.
 * @param {string} idToken - The Google ID token from the client.
 * @param {string} ipAddress - IP address of the user.
 * @returns {Promise<object>} Object containing the user DTO and access token.
 */
const loginOrRegisterWithGoogle = async (idToken, ipAddress) => {
    const payload = await verifyGoogleIdToken(idToken);
    const email = payload.email?.toLowerCase();

    if (!email) {
        throw new AppError('Google account does not have a valid email address.', 400);
    }

    let user = await User.findOne({ email });

    if (!user) {
        user = new User({
            firstName: payload.given_name,
            lastName: payload.family_name,
            email,
            isEmailVerified: true,
            registrationStatus: 'active',
            isActive: true,
            avatar: payload.picture,
            googleId: payload.sub,
        });
        await user.save();
        logger.info(`AuthService: Registered new user via Google: ${user.email}`);
        await createAuditLog({ action: 'USER_REGISTERED', user: user._id, resourceType: 'User', resourceId: user._id, description: 'Registered via Google.' });
    } else {
        // Ensure existing user is updated for Google login
        let needsSave = false;
        if (!user.isEmailVerified) { user.isEmailVerified = true; needsSave = true; }
        if (user.registrationStatus !== 'active') { user.registrationStatus = 'active'; needsSave = true; }
        if (!user.googleId) { user.googleId = payload.sub; needsSave = true; }
        if (needsSave) await user.save();
    }

    const accessToken = generateToken(user._id);
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    logger.info(`AuthService: User logged in via Google: ${user.email}`);
    await createAuditLog({ action: 'USER_LOGIN', user: user._id, ipAddress, description: 'Logged in via Google.' });

    return { user: userToDto(user), accessToken };
};

/**
 * Updates the password for an authenticated user.
 * @param {string} userId - The ID of the user.
 * @param {string} currentPassword - The user's current password.
 * @param {string} newPassword - The desired new password.
 * @returns {Promise<object>} The updated user DTO.
 */
const updatePassword = async (userId, currentPassword, newPassword) => {
    const user = await User.findById(userId).select('+passwordHash');
    if (!user) throw new AppError('User not found.', 404);

    if (!user.passwordHash) {
        throw new AppError('Password cannot be changed for accounts registered with Google.', 400);
    }

    const match = await comparePasswords(currentPassword, user.passwordHash);
    if (!match) throw new AppError('The current password you entered is incorrect.', 401);

    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    logger.info(`AuthService: Password updated for user: ${user.email}`);
    await createAuditLog({ action: 'USER_PASSWORD_UPDATED', user: user._id, resourceType: 'User', resourceId: user._id });

    return userToDto(user);
};


/**
 * Initiates the password reset process.
 * @param {string} email - The email for the account to reset.
 * @param {string} frontendUrl - The base URL of the frontend application.
 */
const initiatePasswordReset = async (email, frontendUrl) => {
    const normalizedEmail = email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    // To prevent user enumeration, do not throw an error. Silently exit if user not found or has no password.
    if (!user || !user.passwordHash) {
        logger.warn(`AuthService: Password reset requested for non-existent or Google-only email: ${email}`);
        return; // Exit gracefully
    }

    const resetToken = user.generateResetToken(); // Using instance method from model
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
    const { subject, text, html } = require('../utils/emailTemplates').generatePasswordResetEmail({ resetUrl, appName: process.env.APP_NAME });

    try {
        await sendEmail({ to: user.email, subject, text, html });
        logger.info(`AuthService: Password reset email sent to: ${user.email}`);
    } catch (emailError) {
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save({ validateBeforeSave: false });
        logger.error(`AuthService: Failed to send password reset email to ${user.email}: ${emailError.message}`, emailError);
        throw new AppError('Failed to send password reset email. Please try again later.', 500);
    }
};

/**
 * Resets a user's password using a valid token.
 * @param {string} token - The unhashed password reset token.
 * @param {string} newPassword - The new password.
 */
const resetPassword = async (token, newPassword) => {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) throw new AppError('This password reset link is invalid or has expired.', 400);

    user.passwordHash = await hashPassword(newPassword);
    // The pre-save hook on the User model will clear the reset token fields.
    await user.save();

    logger.info(`AuthService: Password successfully reset for user: ${user.email}`);
    await createAuditLog({ action: 'PASSWORD_RESET_COMPLETED', user: user._id, status: 'success' });
};

/**
 * Sends a verification email to a user.
 * @param {string} userId - The ID of the user to verify.
 * @param {string} frontendUrl - The base URL of the frontend application.
 */
const sendEmailVerification = async (userId, frontendUrl) => {
    const user = await User.findById(userId);

    // Silently exit if user does not exist or is already verified to prevent info leaks.
    if (!user || user.isEmailVerified) {
        logger.info(`AuthService: Skipped sending verification email to ${user ? user.email : 'unknown user'} (not found or already verified).`);
        return;
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
    user.emailVerificationExpires = Date.now() + 24 * 3600000; // 24 hours
    await user.save({ validateBeforeSave: false });

    const verificationUrl = `${frontendUrl}/verify-email/${verificationToken}`;
    const { subject, text, html } = require('../utils/emailTemplates').generateEmailVerificationEmail({ verificationUrl, appName: process.env.APP_NAME });

    try {
        await sendEmail({ to: user.email, subject, text, html });
        logger.info(`AuthService: Verification email sent to: ${user.email}`);
    } catch (emailError) {
        user.emailVerificationToken = undefined;
        user.emailVerificationExpires = undefined;
        await user.save({ validateBeforeSave: false });
        logger.error(`AuthService: Failed to send verification email to ${user.email}: ${emailError.message}`, emailError);
        throw new AppError('Failed to send verification email. Please try again later.', 500);
    }
};

/**
 * Verifies a user's email using a valid token.
 * @param {string} token - The unhashed email verification token.
 * @returns {Promise<object>} A success message object.
 */
const verifyEmail = async (token) => {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
        emailVerificationToken: hashedToken,
        emailVerificationExpires: { $gt: Date.now() },
    });

    if (!user) throw new AppError('This email verification link is invalid or has expired.', 400);

    user.isEmailVerified = true;
    if (user.registrationStatus === 'pending_email_verification') {
        user.registrationStatus = 'active';
    }
    // The pre-save hook will clear the verification token fields.
    await user.save();

    logger.info(`AuthService: Email successfully verified for user: ${user.email}`);
    await createAuditLog({ action: 'EMAIL_VERIFIED', user: user._id, status: 'success' });

    return { message: 'Email verified successfully!' };
};

module.exports = {
    registerUser,
    loginUser,
    loginOrRegisterWithGoogle,
    updatePassword,
    initiatePasswordReset,
    resetPassword,
    sendEmailVerification,
    verifyEmail,
};