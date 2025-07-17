const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET,
    OAUTH_REFRESH_TOKEN,
    OAUTH_REDIRECT_URI,
    GMAIL_USER,
} = process.env;

const oAuth2Client = new google.auth.OAuth2(
    OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET,
    OAUTH_REDIRECT_URI
);

// This line is crucial for setting the refresh token for the client
oAuth2Client.setCredentials({ refresh_token: OAUTH_REFRESH_TOKEN });

const createOAuth2Transporter = async () => {
    try {
        // Attempt to get a new access token using the refresh token
        // The error 'invalid_grant' would typically originate from this call
        const accessTokenResponse = await oAuth2Client.getAccessToken();
        const accessToken = accessTokenResponse.token;

        if (!accessToken) {
            // This is a safeguard, though getAccessToken usually throws on failure
            logger.error('NodemailerClient: Failed to retrieve access token - token was null or undefined.');
            throw new AppError('Failed to retrieve access token for Nodemailer.', 500);
        }

        logger.info('NodemailerClient: Successfully obtained new access token.');

        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: GMAIL_USER,
                clientId: OAUTH_CLIENT_ID,
                clientSecret: OAUTH_CLIENT_SECRET,
                refreshToken: OAUTH_REFRESH_TOKEN,
                accessToken,
            },
        });
    } catch (error) {
        // Log the full error object for detailed debugging
        logger.error('NodemailerClient: Error creating OAuth2 transporter:', error.message, error);
        // Specifically check for 'invalid_grant' and log a more actionable message
        if (error.message && error.message.includes('invalid_grant')) {
            logger.error('NodemailerClient: Authentication failed with invalid_grant. This usually means the OAUTH_REFRESH_TOKEN is expired or revoked. Please obtain a new refresh token from Google OAuth Playground.');
        }
        throw new AppError(`Nodemailer client setup failed: ${error.message}`, 500);
    }
};

module.exports = {
    createOAuth2Transporter,
};