// src/lib/googleAuthClient.js

const { OAuth2Client } = require('google-auth-library');
const logger = require('../utils/logger'); // Import the logger utility
const AppError = require('../utils/AppError'); // For consistent error handling

// Environment variables for Google Sign-In
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID; // Your Google OAuth Client ID for web application
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET; // Your Google OAuth Client Secret
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI; // The redirect URI configured in Google Cloud Console

// Check if credentials are configured
const isGoogleAuthConfigured = () => {
    return GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI;
};

// Initialize client only if credentials are available
let client = null;
if (isGoogleAuthConfigured()) {
    client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
} else {
    logger.warn("GoogleAuthClient: Google OAuth credentials are not configured. Google Sign-In will be disabled.");
}

/**
 * Verifies a Google ID token received from the frontend.
 * This is used for "Sign in with Google" functionality.
 * @param {string} idToken - The ID token received from the Google Sign-In client on the frontend.
 * @returns {Promise<object>} The decoded payload (user information) from the ID token.
 * @throws {AppError} If the token is invalid or verification fails.
 */
const verifyGoogleIdToken = async (idToken) => {
    if (!client) {
        throw new AppError('Google Sign-In is not configured on this server', 503);
    }
    
    try {
        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: GOOGLE_CLIENT_ID, // Specify the CLIENT_ID of the app that accesses the backend
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
 * Generates an authorization URL for Google OAuth2 (for web server flow, if needed).
 * This is typically used for obtaining refresh tokens or for server-side initiated OAuth flows.
 * For most "Sign in with Google" scenarios, the frontend handles the initial token acquisition.
 * @param {string[]} scopes - An array of Google API scopes (e.g., ['profile', 'email']).
 * @returns {string} The Google authorization URL.
 */
const getGoogleAuthUrl = (scopes) => {
    if (!client) {
        throw new AppError('Google Sign-In is not configured on this server', 503);
    }
    
    return client.generateAuthUrl({
        access_type: 'offline', // To get a refresh token
        scope: scopes.join(' '), // Space-delimited string of scopes
        prompt: 'consent', // To ensure refresh token is always granted on first login
    });
};

/**
 * Exchanges an authorization code for access and refresh tokens.
 * This is typically used after the user grants consent via the `getGoogleAuthUrl`.
 * @param {string} code - The authorization code received from Google.
 * @returns {Promise<object>} An object containing access_token, refresh_token, etc.
 * @throws {AppError} If token exchange fails.
 */
const getGoogleTokens = async (code) => {
    if (!client) {
        throw new AppError('Google Sign-In is not configured on this server', 503);
    }
    
    try {
        const { tokens } = await client.getToken(code);
        logger.info('GoogleAuthClient: Successfully exchanged authorization code for tokens.');
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
    isGoogleAuthConfigured,
};
