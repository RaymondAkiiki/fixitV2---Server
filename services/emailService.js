// src/services/emailService.js

const { createOAuth2Transporter } = require('../lib/nodemailerClient');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const emailTemplates = require('../utils/emailTemplates');
const jwt = require('../utils/jwt');
const crypto = require('crypto');

// Environment variables with defaults
const {
    OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET,
    OAUTH_REFRESH_TOKEN,
    GMAIL_USER,
    APP_NAME = 'Fix It by Threalty',
    FRONTEND_URL = 'http://localhost:5173',
    EMAIL_RETRY_ATTEMPTS = 3,
    EMAIL_RETRY_DELAY = 1000, // ms
} = process.env;

// Cached transporter for performance
let cachedTransporter = null;
let transporterLastCreated = null;

/**
 * Gets a nodemailer transporter, creating a new one if needed or if the cache has expired
 * @returns {Promise<object>} Nodemailer transporter
 * @throws {AppError} If transporter creation fails
 */
const getTransporter = async () => {
    // Check required configuration
    if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET || !OAUTH_REFRESH_TOKEN || !GMAIL_USER) {
        logger.error("CRITICAL ERROR: Missing one or more required OAuth2 .env variables for Gmail.");
        throw new AppError("Email service configuration incomplete. Check OAuth2 .env variables.", 500);
    }
    
    // Cache expiration: 50 minutes (Google access tokens last 60 minutes)
    const CACHE_EXPIRATION = 50 * 60 * 1000; 
    const now = Date.now();
    
    // Create a new transporter if none exists or cache has expired
    if (!cachedTransporter || !transporterLastCreated || (now - transporterLastCreated > CACHE_EXPIRATION)) {
        try {
            cachedTransporter = await createOAuth2Transporter();
            transporterLastCreated = now;
            logger.info('EmailService: Nodemailer transporter successfully created.');
        } catch (error) {
            logger.error('EmailService: Failed to create transporter:', error.message);
            throw error;
        }
    }
    
    return cachedTransporter;
};

/**
 * Sends an email with retry logic
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text email body
 * @param {string} options.html - HTML email body
 * @param {string} [options.fromName=APP_NAME] - Sender name
 * @param {number} [options.retryAttempt=0] - Current retry attempt (internal use)
 * @returns {Promise<Object>} Nodemailer send info
 * @throws {AppError} If sending fails after all retries
 */
const sendEmail = async ({ to, subject, text, html, fromName = APP_NAME, retryAttempt = 0 }) => {
    try {
        const transporter = await getTransporter();
        const mailOptions = {
            from: `${fromName} <${GMAIL_USER}>`,
            to,
            subject,
            text,
            html,
        };
        
        const info = await transporter.sendMail(mailOptions);
        logger.info(`EmailService: Email sent to: ${to}, Message ID: ${info.messageId}`);
        return info;
    } catch (error) {
        // Log the error with detailed information
        logger.error(`EmailService: Failed to send email to ${to}: ${error.message}`, {
            code: error.code,
            response: error.response,
            responseCode: error.responseCode,
            command: error.command,
            stack: error.stack,
            retryAttempt,
        });

        // Check if we should retry
        const maxRetries = parseInt(EMAIL_RETRY_ATTEMPTS, 10) || 3;
        if (retryAttempt < maxRetries) {
            // Invalidate transporter cache if it's an auth error
            if (error.code === 'EAUTH' || error.responseCode === 401 || 
                (error instanceof AppError && error.message.includes('access token'))) {
                logger.warn('EmailService: Authentication error detected, invalidating cached transporter.');
                cachedTransporter = null;
                transporterLastCreated = null;
            }
            
            // Exponential backoff delay
            const delay = parseInt(EMAIL_RETRY_DELAY, 10) * Math.pow(2, retryAttempt) || 1000 * Math.pow(2, retryAttempt);
            logger.info(`EmailService: Retrying send to ${to} in ${delay}ms (attempt ${retryAttempt + 1}/${maxRetries})`);
            
            // Wait then retry
            await new Promise(resolve => setTimeout(resolve, delay));
            return sendEmail({ to, subject, text, html, fromName, retryAttempt: retryAttempt + 1 });
        }
        
        // We've exhausted retries, throw error
        throw new AppError(`Failed to send email after ${maxRetries} attempts: ${error.message}`, 500);
    }
};

/**
 * Generates a verification token for email verification
 * @param {string} userId - User ID to encode in the token
 * @param {string} email - User's email address
 * @returns {Object} Token and expiry date
 */
const generateVerificationToken = (userId, email) => {
    // Create a random token using crypto
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    // Hash the token for storage in the database
    const hashedToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
    
    // Set expiry (24 hours from now)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    return {
        token: verificationToken, // Plain token for the URL
        hashedToken,              // Hashed token to store in DB
        expiresAt                 // Expiry date
    };
};

/**
 * Generates a password reset token
 * @param {string} userId - User ID to encode in the token
 * @returns {Object} Token and expiry date
 */
const generatePasswordResetToken = (userId) => {
    // Create a random token
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Hash the token for storage
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    
    // Set expiry (1 hour from now)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    
    return {
        token: resetToken,    // Plain token for the URL
        hashedToken,          // Hashed token to store in DB
        expiresAt             // Expiry date
    };
};

/**
 * Generates an invitation token with JWT
 * @param {Object} payload - Data to encode in the token
 * @param {string} [expiresIn='7d'] - Token expiry time
 * @returns {string} JWT token
 */
const generateInvitationToken = (payload, expiresIn = '7d') => {
    return jwt.generateToken(payload, expiresIn);
};

// === HIGH-LEVEL EMAIL SENDING FUNCTIONS ===

/**
 * Sends an invitation email
 * @param {Object} options - Invitation options
 * @param {string} options.to - Recipient email
 * @param {string} options.inviteLink - Full invitation URL
 * @param {string} options.role - Role being invited to
 * @param {string} [options.invitedByUserName] - Name of inviter
 * @param {string} [options.propertyDisplayName] - Property name
 * @returns {Promise<Object>} Email send info
 */
const sendInvitationEmail = async ({ to, inviteLink, role, invitedByUserName = 'A user', propertyDisplayName }) => {
    const { subject, text, html } = emailTemplates.generateInvitationEmail({
        inviteLink,
        role,
        invitedByUserName,
        propertyDisplayName,
        appName: APP_NAME,
    });
    return sendEmail({ to, subject, text, html });
};

/**
 * Sends a request notification email
 * @param {Object} options - Notification options
 * @param {string} options.to - Recipient email
 * @param {string} options.requestTitle - Request title
 * @param {string} options.status - Request status
 * @param {string} options.requestLink - Link to request
 * @returns {Promise<Object>} Email send info
 */
const sendRequestNotificationEmail = async ({ to, requestTitle, status, requestLink }) => {
    const { subject, text, html } = emailTemplates.generateRequestUpdateEmail({
        requestTitle,
        status,
        requestLink,
        appName: APP_NAME,
    });
    return sendEmail({ to, subject, text, html });
};

/**
 * Sends a lease expiry reminder email
 * @param {Object} options - Reminder options
 * @param {string} options.to - Recipient email
 * @param {string} options.tenantName - Tenant name
 * @param {string} options.propertyName - Property name
 * @param {string} options.unitNumber - Unit number/name
 * @param {Date} options.leaseEndDate - Lease end date
 * @param {string} options.leaseLink - Link to lease details
 * @returns {Promise<Object>} Email send info
 */
const sendLeaseExpiryReminderEmail = async ({ to, tenantName, propertyName, unitNumber, leaseEndDate, leaseLink }) => {
    const { subject, text, html } = emailTemplates.generateLeaseExpiryReminderEmail({
        tenantName,
        propertyName,
        unitNumber,
        leaseEndDate,
        leaseLink,
        appName: APP_NAME,
    });
    return sendEmail({ to, subject, text, html });
};

/**
 * Sends a rent reminder email
 * @param {Object} options - Reminder options
 * @param {string} options.to - Recipient email
 * @param {string} options.tenantName - Tenant name
 * @param {string} options.propertyName - Property name
 * @param {string} options.unitNumber - Unit number/name
 * @param {string} options.billingPeriod - Billing period description
 * @param {number} options.amountDue - Amount due
 * @param {Date} options.dueDate - Due date
 * @param {string} options.rentLink - Link to rent details
 * @param {string} options.type - 'due' or 'overdue'
 * @returns {Promise<Object>} Email send info
 */
const sendRentReminderEmail = async ({ to, tenantName, propertyName, unitNumber, billingPeriod, amountDue, dueDate, rentLink, type }) => {
    const { subject, text, html } = emailTemplates.generateRentReminderEmail({
        tenantName,
        propertyName,
        unitNumber,
        billingPeriod,
        amountDue,
        dueDate,
        rentLink,
        type,
        appName: APP_NAME,
    });
    return sendEmail({ to, subject, text, html });
};

/**
 * Sends a user approval request email
 * @param {Object} options - Approval request options
 * @param {string} options.to - Recipient email
 * @param {string} options.landlordFirstName - Landlord's first name
 * @param {string} options.newUserRole - New user's role
 * @param {string} options.newUserEmail - New user's email
 * @param {string} options.approvalLink - Approval link
 * @returns {Promise<Object>} Email send info
 */
const sendUserApprovalRequestEmail = async ({ to, landlordFirstName, newUserRole, newUserEmail, approvalLink }) => {
    const { subject, text, html } = emailTemplates.generateUserApprovalRequestEmail({
        landlordFirstName,
        newUserRole,
        newUserEmail,
        approvalLink,
        appName: APP_NAME,
    });
    return sendEmail({ to, subject, text, html });
};

/**
 * Sends an email verification email
 * @param {Object} options - Verification options
 * @param {string} options.to - Recipient email
 * @param {string} options.verificationUrl - Verification URL
 * @returns {Promise<Object>} Email send info
 */
const sendVerificationEmail = async ({ to, verificationUrl }) => {
    const { subject, text, html } = emailTemplates.generateEmailVerificationEmail({
        verificationUrl,
        appName: APP_NAME,
    });
    return sendEmail({ to, subject, text, html });
};

/**
 * Sends a password reset email
 * @param {Object} options - Reset options
 * @param {string} options.to - Recipient email
 * @param {string} options.resetUrl - Reset URL
 * @returns {Promise<Object>} Email send info
 */
const sendPasswordResetEmail = async ({ to, resetUrl }) => {
    const { subject, text, html } = emailTemplates.generatePasswordResetEmail({
        resetUrl,
        appName: APP_NAME,
    });
    return sendEmail({ to, subject, text, html });
};

module.exports = {
    sendEmail,
    sendInvitationEmail,
    sendRequestNotificationEmail,
    sendLeaseExpiryReminderEmail,
    sendRentReminderEmail,
    sendUserApprovalRequestEmail,
    sendVerificationEmail,
    sendPasswordResetEmail,
    generateVerificationToken,
    generatePasswordResetToken,
    generateInvitationToken
};