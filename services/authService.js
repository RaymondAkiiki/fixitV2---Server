// src/services/authService.js

const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/user');
const { hashPassword, comparePasswords } = require('../utils/passwordHash');
const { generateToken } = require('../utils/jwt');
const { verifyGoogleIdToken } = require('../lib/googleAuthClient');
const emailService = require('./emailService');
const userService = require('./userService');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { userToDto } = require('../utils/userDto');
const { 
    ROLE_ENUM,
    REGISTRATION_STATUS_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM
} = require('../utils/constants/enums');

/**
 * Registers a new user via classic email/password signup
 * @param {Object} userData - User registration data
 * @param {string} userData.firstName - First name
 * @param {string} userData.lastName - Last name
 * @param {string} userData.email - Email address
 * @param {string} userData.phone - Phone number
 * @param {string} userData.password - Password
 * @param {string} [userData.role=ROLE_ENUM.USER] - User role
 * @param {Object} [options={}] - Additional options
 * @param {import('mongoose').ClientSession} [options.session] - MongoDB session for transactions
 * @returns {Promise<Object>} The user DTO
 * @throws {AppError} If registration fails
 */
const registerUser = async (userData, options = {}) => {
    const session = options.session || await mongoose.startSession();
    const startedTransaction = !options.session;
    
    if (startedTransaction) {
        session.startTransaction();
    }
    
    try {
        const { 
            firstName, 
            lastName, 
            email, 
            phone, 
            password, 
            role = ROLE_ENUM.USER
        } = userData;
        
        const normalizedEmail = email.toLowerCase();
        
        // Check if user already exists
        const userExists = await User.findOne({ email: normalizedEmail }).session(session);
        if (userExists) {
            throw new AppError('An account with this email address already exists.', 409);
        }
        
        // Hash password
        const passwordHash = await hashPassword(password);
        
        // Determine registration status based on role
        const registrationStatus = role === ROLE_ENUM.TENANT
            ? REGISTRATION_STATUS_ENUM.PENDING_INVITE_ACCEPTANCE
            : REGISTRATION_STATUS_ENUM.PENDING_EMAIL_VERIFICATION;
        
        // Create new user
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
        
        await user.save({ session });
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.USER_REGISTERED,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            user._id,
            {
                userId: user._id,
                description: `New user ${user.email} registered with ${role} role.`,
                status: 'success',
                newValue: { 
                    email: user.email, 
                    role: user.role,
                    registrationStatus: user.registrationStatus
                }
            },
            { session }
        );
        
        logger.info(`AuthService: New user registered: ${user.email} with role ${user.role}.`);
        
        // Automatically send verification email for appropriate roles
        if (registrationStatus === REGISTRATION_STATUS_ENUM.PENDING_EMAIL_VERIFICATION) {
            try {
                await sendEmailVerification(user._id, process.env.FRONTEND_URL, null, { session });
            } catch (emailError) {
                logger.error(`Failed to send verification email during registration: ${emailError.message}`);
                // Continue with registration even if email fails
            }
        }
        
        if (startedTransaction) {
            await session.commitTransaction();
        }
        
        return userToDto(user);
    } catch (error) {
        if (startedTransaction) {
            await session.abortTransaction();
        }
        
        logger.error(`AuthService - Registration failed: ${error.message}`);
        throw error instanceof AppError ? error : new AppError(`Registration failed: ${error.message}`, 500);
    } finally {
        if (startedTransaction) {
            session.endSession();
        }
    }
};

/**
 * Logs in a user with email and password
 * @param {string} email - User's email
 * @param {string} password - User's password
 * @param {string} ipAddress - IP address for audit logging
 * @returns {Promise<Object>} Object with user DTO and access token
 * @throws {AppError} If login fails
 */
const loginUser = async (email, password, ipAddress) => {
    try {
        const normalizedEmail = email.toLowerCase();
        const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
        
        if (!user || !user.passwordHash) {
            logger.warn(`Failed login attempt for email: ${email}. Reason: User not found or has no password.`);
            throw new AppError('Invalid credentials.', 401);
        }
        
        // Check if user is active
        if (!user.isActive) {
            logger.warn(`Failed login attempt for deactivated user: ${email}.`);
            throw new AppError('Your account has been deactivated. Please contact support.', 403);
        }
        
        // Check if email is verified
        if (user.registrationStatus === REGISTRATION_STATUS_ENUM.PENDING_EMAIL_VERIFICATION || !user.isEmailVerified) {
            logger.warn(`Failed login attempt for unverified email: ${email}.`);
            throw new AppError('Please verify your email address before logging in.', 403);
        }
        
        // Check password
        const passwordsMatch = await comparePasswords(password, user.passwordHash);
        if (!passwordsMatch) {
            logger.warn(`Failed login attempt for user: ${email}. Reason: Incorrect password.`);
            
            // Log failed login attempt
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.LOGIN_ATTEMPT_FAILED,
                AUDIT_RESOURCE_TYPE_ENUM.User,
                user._id,
                {
                    userId: user._id,
                    ipAddress,
                    description: 'Login failed: Incorrect password.',
                    status: 'failed'
                }
            );
            
            throw new AppError('Invalid credentials.', 401);
        }
        
        // Generate token
        const accessToken = generateToken({ id: user._id });
        
        // Update last login
        user.lastLogin = new Date();
        await user.save({ validateBeforeSave: false });
        
        // Log successful login
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.USER_LOGIN,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            user._id,
            {
                userId: user._id,
                ipAddress,
                description: 'Login successful.',
                status: 'success'
            }
        );
        
        logger.info(`AuthService: User logged in successfully: ${user.email}`);
        
        return { user: userToDto(user), accessToken };
    } catch (error) {
        logger.error(`AuthService - Login failed: ${error.message}`);
        throw error instanceof AppError ? error : new AppError(`Login failed: ${error.message}`, 500);
    }
};

/**
 * Authenticates or registers a user via Google ID token
 * @param {string} idToken - Google ID token
 * @param {string} ipAddress - IP address for audit logging
 * @returns {Promise<Object>} Object with user DTO and access token
 * @throws {AppError} If Google authentication fails
 */
const loginOrRegisterWithGoogle = async (idToken, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Verify the Google ID token
        const payload = await verifyGoogleIdToken(idToken);
        const email = payload.email?.toLowerCase();
        
        if (!email) {
            throw new AppError('Google account does not have a valid email address.', 400);
        }
        
        // Check if user exists
        let user = await User.findOne({ email }).session(session);
        
        if (!user) {
            // Create new user with Google credentials
            user = new User({
                firstName: payload.given_name || 'User',
                lastName: payload.family_name || '',
                email,
                phone: '',  // Google doesn't provide phone
                isEmailVerified: true,  // Google emails are pre-verified
                registrationStatus: REGISTRATION_STATUS_ENUM.ACTIVE,
                isActive: true,
                avatar: payload.picture,
                googleId: payload.sub,
                // No passwordHash for Google users
            });
            
            await user.save({ session });
            
            // Log user registration via Google
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.USER_REGISTERED,
                AUDIT_RESOURCE_TYPE_ENUM.User,
                user._id,
                {
                    userId: user._id,
                    ipAddress,
                    description: `User registered via Google: ${user.email}`,
                    status: 'success',
                    newValue: { 
                        email: user.email, 
                        googleId: payload.sub,
                        isEmailVerified: true
                    }
                },
                { session }
            );
            
            logger.info(`AuthService: Registered new user via Google: ${user.email}`);
        } else {
            // Update existing user with Google information if needed
            let needsSave = false;
            
            if (!user.isEmailVerified) { 
                user.isEmailVerified = true; 
                needsSave = true; 
            }
            
            if (user.registrationStatus !== REGISTRATION_STATUS_ENUM.ACTIVE) { 
                user.registrationStatus = REGISTRATION_STATUS_ENUM.ACTIVE; 
                needsSave = true; 
            }
            
            if (!user.googleId) { 
                user.googleId = payload.sub; 
                needsSave = true; 
            }
            
            if (!user.avatar && payload.picture) {
                user.avatar = payload.picture;
                needsSave = true;
            }
            
            if (needsSave) {
                await user.save({ session });
                logger.info(`AuthService: Updated existing user with Google data: ${user.email}`);
            }
        }
        
        // Generate token
        const accessToken = generateToken({ id: user._id });
        
        // Update last login
        user.lastLogin = new Date();
        await user.save({ session, validateBeforeSave: false });
        
        // Log successful login
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.USER_LOGIN,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            user._id,
            {
                userId: user._id,
                ipAddress,
                description: 'Logged in via Google.',
                status: 'success'
            },
            { session }
        );
        
        logger.info(`AuthService: User logged in via Google: ${user.email}`);
        
        await session.commitTransaction();
        
        return { user: userToDto(user), accessToken };
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`AuthService - Google authentication failed: ${error.message}`);
        throw error instanceof AppError ? error : new AppError(`Google authentication failed: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Updates password for an authenticated user
 * @param {string} userId - User ID
 * @param {string} currentPassword - Current password
 * @param {string} newPassword - New password
 * @param {string} [ipAddress] - IP address for audit logging
 * @returns {Promise<Object>} Updated user DTO
 * @throws {AppError} If password update fails
 */
const updatePassword = async (userId, currentPassword, newPassword, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const user = await User.findById(userId).select('+passwordHash').session(session);
        
        if (!user) {
            throw new AppError('User not found.', 404);
        }
        
        // Check if user has a password (not Google-only account)
        if (!user.passwordHash) {
            throw new AppError('Password cannot be changed for accounts registered with Google. Please use Google to sign in.', 400);
        }
        
        // Verify current password
        const match = await comparePasswords(currentPassword, user.passwordHash);
        if (!match) {
            // Log failed password change attempt
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.PASSWORD_CHANGE_FAILED,
                AUDIT_RESOURCE_TYPE_ENUM.User,
                user._id,
                {
                    userId,
                    ipAddress,
                    description: 'Password change failed: Incorrect current password.',
                    status: 'failed'
                },
                { session }
            );
            
            throw new AppError('The current password you entered is incorrect.', 401);
        }
        
        // Hash and save new password
        user.passwordHash = await hashPassword(newPassword);
        await user.save({ session });
        
        // Log successful password change
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.USER_PASSWORD_UPDATED,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            user._id,
            {
                userId,
                ipAddress,
                description: 'Password updated successfully.',
                status: 'success'
            },
            { session }
        );
        
        logger.info(`AuthService: Password updated for user: ${user.email}`);
        
        await session.commitTransaction();
        
        return userToDto(user);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`AuthService - Password update failed: ${error.message}`);
        throw error instanceof AppError ? error : new AppError(`Password update failed: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Initiates password reset process
 * @param {string} email - User's email
 * @param {string} frontendUrl - Frontend URL for reset link
 * @returns {Promise<void>}
 * @throws {AppError} If email sending fails
 */
const initiatePasswordReset = async (email, frontendUrl) => {
    try {
        const normalizedEmail = email.toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });
        
        // To prevent user enumeration, silently exit if user not found or has no password
        if (!user || !user.passwordHash) {
            logger.info(`AuthService: Password reset requested for non-existent or Google-only email: ${email}`);
            return;
        }
        
        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
        
        await user.save({ validateBeforeSave: false });
        
        // Generate reset URL
        const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
        
        // Get email template
        const emailTemplate = require('../utils/emailTemplates').generatePasswordResetEmail({ 
            resetUrl, 
            appName: process.env.APP_NAME || 'Fix It by Threalty'
        });
        
        // Send email
        await emailService.sendPasswordResetEmail({
            to: user.email,
            resetUrl
        });
        
        logger.info(`AuthService: Password reset email sent to: ${user.email}`);
        
        // Log password reset request
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.PASSWORD_RESET_REQUESTED,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            user._id,
            {
                userId: user._id,
                description: 'Password reset requested.',
                status: 'success'
            }
        );
    } catch (error) {
        logger.error(`AuthService - Password reset initiation failed: ${error.message}`);
        throw error instanceof AppError ? error : new AppError(`Failed to send password reset email: ${error.message}`, 500);
    }
};

/**
 * Resets password using a valid token
 * @param {string} token - Reset token
 * @param {string} newPassword - New password
 * @returns {Promise<void>}
 * @throws {AppError} If token is invalid or expired
 */
const resetPassword = async (token, newPassword) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Hash the token to compare with stored hash
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        
        // Find user with valid token
        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: Date.now() }
        }).session(session);
        
        if (!user) {
            throw new AppError('This password reset link is invalid or has expired.', 400);
        }
        
        // Update password and clear reset token
        user.passwordHash = await hashPassword(newPassword);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        
        await user.save({ session });
        
        // Log password reset completion
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.PASSWORD_RESET_COMPLETED,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            user._id,
            {
                userId: user._id,
                description: 'Password reset completed successfully.',
                status: 'success'
            },
            { session }
        );
        
        logger.info(`AuthService: Password successfully reset for user: ${user.email}`);
        
        // Send notification about password change
        try {
            await notificationService.sendNotification({
                recipientId: user._id,
                type: NOTIFICATION_TYPE_ENUM.PASSWORD_RESET,
                message: 'Your password has been reset successfully.',
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
                relatedResourceId: user._id,
                emailDetails: {
                    subject: 'Your Password Has Been Reset',
                    html: `
                        <p>Hello ${user.firstName},</p>
                        <p>Your password has been reset successfully.</p>
                        <p>If you did not request this password reset, please contact support immediately.</p>
                        <p>Best regards,<br>The ${process.env.APP_NAME || 'Fix It by Threalty'} Team</p>
                    `,
                    text: `Hello ${user.firstName}, Your password has been reset successfully. If you did not request this password reset, please contact support immediately.`
                }
            });
        } catch (notificationError) {
            logger.warn(`Failed to send password reset notification: ${notificationError.message}`);
            // Continue even if notification fails
        }
        
        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`AuthService - Password reset failed: ${error.message}`);
        throw error instanceof AppError ? error : new AppError(`Password reset failed: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Sends email verification to a user
 * @param {string} userId - User ID (if authenticated)
 * @param {string} frontendUrl - Frontend URL for verification link
 * @param {string} [email] - Email address (if not authenticated)
 * @param {Object} [options={}] - Additional options
 * @param {import('mongoose').ClientSession} [options.session] - MongoDB session for transactions
 * @returns {Promise<Object>} Result with message
 * @throws {AppError} If email sending fails
 */
const sendEmailVerification = async (userId, frontendUrl, email = null, options = {}) => {
    const session = options.session || await mongoose.startSession();
    const startedTransaction = !options.session;
    
    if (startedTransaction) {
        session.startTransaction();
    }
    
    try {
        let user;
        
        // Find user either by ID or email
        if (userId) {
            user = await User.findById(userId).session(session);
        } else if (email) {
            user = await User.findOne({ email: email.toLowerCase() }).session(session);
        } else {
            throw new AppError('Either userId or email must be provided.', 400);
        }
        
        // Silently exit if user not found or already verified
        if (!user) {
            logger.info(`AuthService: Skipped sending verification email (user not found)`);
            return { message: 'If an account with that email exists, a verification email has been sent.' };
        }
        
        if (user.isEmailVerified) {
            logger.info(`AuthService: Skipped sending verification email to ${user.email} (already verified).`);
            return { message: 'Your email is already verified.' };
        }
        
        // Generate verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        user.emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
        user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
        
        await user.save({ session, validateBeforeSave: false });
        
        // Generate verification URL
        const verificationUrl = `${frontendUrl}/verify-email/${verificationToken}`;
        
        // Send verification email
        await emailService.sendVerificationEmail({
            to: user.email,
            verificationUrl
        });
        
        logger.info(`AuthService: Verification email sent to: ${user.email}`);
        
        // Log email verification request
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.EMAIL_VERIFICATION_SENT,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            user._id,
            {
                userId: user._id,
                description: 'Email verification link sent.',
                status: 'success'
            },
            { session }
        );
        
        if (startedTransaction) {
            await session.commitTransaction();
        }
        
        return { message: 'Verification email sent. Please check your inbox.' };
    } catch (error) {
        if (startedTransaction) {
            await session.abortTransaction();
        }
        
        logger.error(`AuthService - Email verification sending failed: ${error.message}`);
        throw error instanceof AppError ? error : new AppError(`Failed to send verification email: ${error.message}`, 500);
    } finally {
        if (startedTransaction) {
            session.endSession();
        }
    }
};

/**
 * Verifies user email using token
 * @param {string} token - Verification token
 * @returns {Promise<Object>} Result with message
 * @throws {AppError} If token is invalid or expired
 */
const verifyEmail = async (token) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Hash the token to compare with stored hash
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        
        // Find user with valid token
        const user = await User.findOne({
            emailVerificationToken: hashedToken,
            emailVerificationExpires: { $gt: Date.now() }
        }).session(session);
        
        if (!user) {
            throw new AppError('This email verification link is invalid or has expired.', 400);
        }
        
        // Update user status
        user.isEmailVerified = true;
        if (user.registrationStatus === REGISTRATION_STATUS_ENUM.PENDING_EMAIL_VERIFICATION) {
            user.registrationStatus = REGISTRATION_STATUS_ENUM.ACTIVE;
        }
        
        user.emailVerificationToken = undefined;
        user.emailVerificationExpires = undefined;
        
        await user.save({ session });
        
        // Log email verification success
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.EMAIL_VERIFIED,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            user._id,
            {
                userId: user._id,
                description: 'Email verified successfully.',
                status: 'success'
            },
            { session }
        );
        
        logger.info(`AuthService: Email successfully verified for user: ${user.email}`);
        
        // Send welcome notification
        try {
            await notificationService.sendNotification({
                recipientId: user._id,
                type: NOTIFICATION_TYPE_ENUM.WELCOME,
                message: 'Welcome to our platform! Your email has been verified.',
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
                relatedResourceId: user._id,
                emailDetails: {
                    subject: `Welcome to ${process.env.APP_NAME || 'Fix It by Threalty'}`,
                    html: `
                        <p>Hello ${user.firstName},</p>
                        <p>Your email has been verified successfully. Welcome to our platform!</p>
                        <p>You can now log in and start using all features.</p>
                        <p>Best regards,<br>The ${process.env.APP_NAME || 'Fix It by Threalty'} Team</p>
                    `,
                    text: `Hello ${user.firstName}, Your email has been verified successfully. Welcome to our platform! You can now log in and start using all features.`
                }
            });
        } catch (notificationError) {
            logger.warn(`Failed to send welcome notification: ${notificationError.message}`);
            // Continue even if notification fails
        }
        
        await session.commitTransaction();
        
        return { message: 'Email verified successfully!' };
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`AuthService - Email verification failed: ${error.message}`);
        throw error instanceof AppError ? error : new AppError(`Email verification failed: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

module.exports = {
    registerUser,
    loginUser,
    loginOrRegisterWithGoogle,
    updatePassword,
    initiatePasswordReset,
    resetPassword,
    sendEmailVerification,
    verifyEmail
};