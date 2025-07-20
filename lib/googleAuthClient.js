// src/lib/googleAuthClient.js

const { OAuth2Client } = require('google-auth-library');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// Environment variables
const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    NODE_ENV
} = process.env;

/**
 * Checks if Google Auth is properly configured
 * @returns {boolean} True if configured, false otherwise
 */
const isGoogleAuthConfigured = () => {
    return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
};

// Initialize client
let client = null;

/**
 * Initializes the Google OAuth2 client if not already initialized
 * @returns {OAuth2Client} The Google OAuth2 client
 * @throws {AppError} If Google credentials are missing
 */
const getClient = () => {
    if (client) {
        return client;
    }
    
    if (!isGoogleAuthConfigured()) {
        if (NODE_ENV === 'production') {
            logger.error("GoogleAuthClient: Google OAuth credentials are not configured!");
            throw new AppError('Google Sign-In is not configured on this server', 503);
        } else {
            logger.warn("GoogleAuthClient: Google OAuth credentials are not configured. Using mock mode for development.");
            // In development, create a mock client that doesn't do real verification
            return {
                verifyIdToken: async ({ idToken }) => {
                    logger.info('MOCK GoogleAuthClient: Simulating ID token verification in development mode');
                    // Parse the fake token (in development, frontend can send JSON as base64)
                    try {
                        // This is unsafe and only for development - assumes token is in format "MOCK.base64payload.signature"
                        const parts = idToken.split('.');
                        if (parts.length !== 3 || !parts[0].startsWith('MOCK')) {
                            throw new Error('Invalid mock token format');
                        }
                        
                        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                        return { getPayload: () => payload };
                    } catch (err) {
                        logger.error('MOCK GoogleAuthClient: Failed to parse mock token', err);
                        throw new AppError('Invalid mock Google token', 401);
                    }
                }
            };
        }
    }
    
    client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    logger.info('GoogleAuthClient: OAuth2Client initialized successfully');
    return client;
};

/**
 * Verifies a Google ID token
 * @param {string} idToken - The ID token from Google Sign-In
 * @returns {Promise<Object>} The decoded token payload
 * @throws {AppError} If verification fails
 */
const verifyGoogleIdToken = async (idToken) => {
    try {
        const oAuth2Client = getClient();
        
        // In production, actually verify the token
        const ticket = await oAuth2Client.verifyIdToken({
            idToken,
            audience: GOOGLE_CLIENT_ID,
        });
        
        const payload = ticket.getPayload();
        logger.info(`GoogleAuthClient: Successfully verified Google ID token for user: ${payload.email}`);
        
        return payload;
    } catch (error) {
        logger.error(`GoogleAuthClient: Error verifying Google ID token: ${error.message}`, error);
        throw new AppError(`Google ID token verification failed: ${error.message}`, 401);
    }
};

/**
 * Generates a Google OAuth authorization URL
 * @param {string[]} scopes - OAuth scopes to request
 * @returns {string} The authorization URL
 * @throws {AppError} If Google credentials are missing
 */
const getGoogleAuthUrl = (scopes) => {
    const oAuth2Client = getClient();
    
    return oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes.join(' '),
        prompt: 'consent',
    });
};

/**
 * Exchanges an authorization code for access and refresh tokens
 * @param {string} code - The authorization code from Google
 * @returns {Promise<Object>} Object containing tokens
 * @throws {AppError} If token exchange fails
 */
const getGoogleTokens = async (code) => {
    try {
        const oAuth2Client = getClient();
        const { tokens } = await oAuth2Client.getToken(code);
        
        logger.info('GoogleAuthClient: Successfully exchanged authorization code for tokens');
        return tokens;
    } catch (error) {
        logger.error(`GoogleAuthClient: Error exchanging authorization code for tokens: ${error.message}`, error);
        throw new AppError(`Failed to exchange Google auth code for tokens: ${error.message}`, 500);
    }
};

module.exports = {
    verifyGoogleIdToken,
    getGoogleAuthUrl,
    getGoogleTokens,
    isGoogleAuthConfigured
};