// backend/utils/emailService.js

const nodemailer = require('nodemailer');
const { google } = require('googleapis');

// Destructure environment variables for Google OAuth2
const {
    OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET,
    OAUTH_REFRESH_TOKEN,
    GMAIL_USER,
    OAUTH_REDIRECT_URI
} = process.env;

const REDIRECT_URI = OAUTH_REDIRECT_URI || "https://developers.google.com/oauthplayground";

// Check for required env variables
if (
    !OAUTH_CLIENT_ID ||
    !OAUTH_CLIENT_SECRET ||
    !OAUTH_REFRESH_TOKEN ||
    !GMAIL_USER ||
    !REDIRECT_URI
) {
    throw new Error(
        "Missing one or more required OAuth2 .env variables for Gmail: " +
        [
            'OAUTH_CLIENT_ID',
            'OAUTH_CLIENT_SECRET',
            'OAUTH_REFRESH_TOKEN',
            'GMAIL_USER',
            'OAUTH_REDIRECT_URI (or REDIRECT_URI)'
        ].filter((key) => !process.env[key] && key !== "OAUTH_REDIRECT_URI (or REDIRECT_URI)").join(', ')
    );
}

// Initialize Google OAuth2 client
const oAuth2Client = new google.auth.OAuth2(
    OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET,
    REDIRECT_URI
);

// Set the refresh token for the OAuth2 client
oAuth2Client.setCredentials({ refresh_token: OAUTH_REFRESH_TOKEN });

/**
 * Creates and returns a reusable Nodemailer transporter instance configured with OAuth2.
 * This function handles fetching a new access token using the refresh token.
 */
const createTransporter = async () => {
    try {
        const accessTokenResponse = await oAuth2Client.getAccessToken();
        const accessToken = accessTokenResponse && accessTokenResponse.token
            ? accessTokenResponse.token
            : (typeof accessTokenResponse === "string" ? accessTokenResponse : null);

        if (!accessToken) {
            console.error('Failed to obtain access token from refresh token.');
            throw new Error('Authentication failed for email service.');
        }

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                type: "OAuth2",
                user: GMAIL_USER,
                clientId: OAUTH_CLIENT_ID,
                clientSecret: OAUTH_CLIENT_SECRET,
                refreshToken: OAUTH_REFRESH_TOKEN,
                accessToken: accessToken,
            },
        });
        return transporter;
    } catch (error) {
        console.error('Error creating email transporter with OAuth2:', error);
        throw new Error('Failed to configure email service.');
    }
};

let cachedTransporter = null;

/**
 * Ensures a transporter is ready. Creates one if it doesn't exist or re-authenticates if needed.
 */
const getTransporter = async () => {
    if (cachedTransporter) {
        return cachedTransporter;
    }
    cachedTransporter = await createTransporter();
    return cachedTransporter;
};

/**
 * Sends an email to a specified recipient.
 * @param {string} to - The recipient's email address.
 * @param {string} subject - The subject line of the email.
 * @param {string} text - The plain text content of the email.
 * @param {string} html - The HTML content of the email.
 */
const sendEmail = async ({ to, subject, text, html }) => {
    try {
        const transporter = await getTransporter();

        const mailOptions = {
            from: `FixIt by Threalty <${GMAIL_USER}>`,
            to,
            subject,
            text,
            html,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: %s', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw new Error('Failed to send email.');
    }
};

/**
 * Sends an invitation email.
 * @param {string} to - The email address of the invited user.
 * @param {string} inviteLink - The unique link for the invite.
 * @param {string} role - The role the user is being invited as.
 * @param {string} [invitedByUserName='A user'] - The name of the user who sent the invite.
 */
const sendInvitationEmail = async (to, inviteLink, role, invitedByUserName = 'A user') => {
    const subject = `You're invited to Fix It by Threalty as a ${role}!`;
    const text = `Hello,

${invitedByUserName} has invited you to join Fix It by Threalty as a ${role}.

Please click on the following link to accept the invitation and set up your account:
${inviteLink}

This link will expire in 24 hours.

If you did not expect this invitation, you can ignore this email.

Best regards,
The Fix It by Threalty Team`;

    const html = `
        <p>Hello,</p>
        <p>${invitedByUserName} has invited you to join <strong>Fix It by Threalty</strong> as a <strong>${role}</strong>.</p>
        <p>Please click on the following link to accept the invitation and set up your account:</p>
        <p><a href="${inviteLink}">${inviteLink}</a></p>
        <p>This link will expire in 24 hours.</p>
        <p>If you did not expect this invitation, you can ignore this email.</p>
        <p>Best regards,<br/>The Fix It by Threalty Team</p>
    `;

    await sendEmail({ to, subject, text, html });
};

/**
 * Sends a notification email for a new request or status update.
 * @param {string} to - The recipient's email address.
 * @param {string} requestTitle - The title of the maintenance request.
 * @param {string} status - The new status of the request.
 * @param {string} requestLink - Link to the request details.
 */
const sendRequestNotificationEmail = async (to, requestTitle, status, requestLink) => {
    const subject = `Maintenance Request Update: "${requestTitle}" is now ${status}`;
    const text = `Hello,

The maintenance request "${requestTitle}" has been updated. Its new status is: ${status}.

You can view the details here:
${requestLink}

Best regards,
The Fix It by Threalty Team`;

    const html = `
        <p>Hello,</p>
        <p>The maintenance request "<strong>${requestTitle}</strong>" has been updated. Its new status is: <strong>${status}</strong>.</p>
        <p>You can view the details here: <a href="${requestLink}">${requestLink}</a></p>
        <p>Best regards,<br/>The Fix It by Threalty Team</p>
    `;

    await sendEmail({ to, subject, text, html });
};

module.exports = {
    sendEmail,
    sendInvitationEmail,
    sendRequestNotificationEmail,
};