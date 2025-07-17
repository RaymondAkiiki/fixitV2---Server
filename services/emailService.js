const { createOAuth2Transporter } = require('../lib/nodemailerClient');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const emailTemplates = require('../utils/emailTemplates');

const {
    OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET,
    OAUTH_REFRESH_TOKEN,
    GMAIL_USER,
    APP_NAME = 'Fix It by Threalty',
    FRONTEND_URL = 'http://localhost:5173',
} = process.env;

let cachedTransporter = null;

const getTransporter = async () => {
    if (
        !OAUTH_CLIENT_ID ||
        !OAUTH_CLIENT_SECRET ||
        !OAUTH_REFRESH_TOKEN ||
        !GMAIL_USER
    ) {
        logger.error("CRITICAL ERROR: Missing one or more required OAuth2 .env variables for Gmail.");
        throw new AppError("Email service configuration incomplete. Check OAuth2 .env variables.", 500);
    }
    if (!cachedTransporter) {
        try {
            cachedTransporter = await createOAuth2Transporter();
            logger.info('EmailService: Nodemailer transporter successfully created.');
        } catch (error) {
            logger.error('EmailService: Failed to create transporter:', error.message);
            throw error;
        }
    }
    return cachedTransporter;
};

/**
 * Sends an email using the basic options.
 */
const sendEmail = async ({ to, subject, text, html, fromName = APP_NAME }) => {
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
        // Log the full error object, including common Nodemailer/SMTP properties
        logger.error(`EmailService: Failed to send email to ${to}: ${error.message}`, {
            code: error.code,
            response: error.response,
            responseCode: error.responseCode,
            command: error.command,
            stack: error.stack, // Include stack trace for more context
            originalError: error // Log the entire error object
        });

        if (error.code === 'EAUTH' || error.responseCode === 401 || (error instanceof AppError && error.message.includes('access token'))) {
            logger.warn('EmailService: Authentication error detected, invalidating cached transporter. Will attempt to re-authenticate on next send.');
            cachedTransporter = null;
        } else {
             // For other types of errors, just log and rethrow
            logger.error(`EmailService: Non-authentication error occurred for ${to}.`);
        }
        throw new AppError(`Failed to send email: ${error.message}`, 500);
    }
};


// === HIGH-LEVEL HELPERS (use templates) ===

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

const sendRequestNotificationEmail = async ({ to, requestTitle, status, requestLink }) => {
    const { subject, text, html } = emailTemplates.generateRequestUpdateEmail({
        requestTitle,
        status,
        requestLink,
        appName: APP_NAME,
    });
    return sendEmail({ to, subject, text, html });
};

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

module.exports = {
    sendEmail,
    sendInvitationEmail,
    sendRequestNotificationEmail,
    sendLeaseExpiryReminderEmail,
    sendRentReminderEmail,
    sendUserApprovalRequestEmail,
};