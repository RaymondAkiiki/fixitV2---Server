// src/lib/nodemailerClient.js

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
    NODE_ENV = 'development'
} = process.env;

// Create OAuth2Client
const createOAuth2Client = () => {
    if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
        throw new AppError('Missing required OAuth2 credentials in environment variables', 500);
    }
    
    return new google.auth.OAuth2(
        OAUTH_CLIENT_ID,
        OAUTH_CLIENT_SECRET,
        OAUTH_REDIRECT_URI
    );
};

/**
 * Creates a nodemailer transport using OAuth2 authentication
 * @returns {Promise<Object>} Configured nodemailer transport
 * @throws {AppError} If transport creation fails
 */
const createOAuth2Transporter = async () => {
    try {
        // Use ethereal mail for testing/development if OAuth not configured
        if (NODE_ENV === 'development' && (!OAUTH_CLIENT_ID || !OAUTH_REFRESH_TOKEN)) {
            logger.warn('NodemailerClient: OAuth credentials not found, creating test account with Ethereal...');
            const testAccount = await nodemailer.createTestAccount();
            logger.info(`NodemailerClient: Created test account: ${testAccount.user}`);
            
            return nodemailer.createTransport({
                host: 'smtp.ethereal.email',
                port: 587,
                secure: false, // TLS
                auth: {
                    user: testAccount.user,
                    pass: testAccount.pass,
                },
            });
        }
        
        // Create OAuth2 client for production/configured environments
        const oAuth2Client = createOAuth2Client();
        
        // Set refresh token
        if (!OAUTH_REFRESH_TOKEN) {
            throw new AppError('OAuth2 refresh token is missing from environment variables', 500);
        }
        oAuth2Client.setCredentials({ refresh_token: OAUTH_REFRESH_TOKEN });
        
        // Get new access token
        const accessTokenResponse = await oAuth2Client.getAccessToken();
        const accessToken = accessTokenResponse.token;
        
        if (!accessToken) {
            throw new AppError('Failed to retrieve access token - token was null or undefined', 500);
        }
        
        logger.info('NodemailerClient: Successfully obtained new access token');
        
        // Create and return the transport
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
        // Log detailed error information
        logger.error('NodemailerClient: Error creating OAuth2 transporter:', {
            message: error.message,
            name: error.name,
            stack: error.stack,
            code: error.code
        });
        
        // Special handling for invalid_grant error
        if (error.message && error.message.includes('invalid_grant')) {
            logger.error('NodemailerClient: Authentication failed with invalid_grant. This usually means the OAUTH_REFRESH_TOKEN is expired or revoked. Please obtain a new refresh token from Google OAuth Playground.');
        }
        
        throw new AppError(`Nodemailer client setup failed: ${error.message}`, 500);
    }
};

module.exports = {
    createOAuth2Transporter,
};