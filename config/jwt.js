const jwtConfig = {
    secret: process.env.JWT_SECRET, // MUST be set in .env
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
};

if (!jwtConfig.secret) {
    if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
        console.error("CRITICAL ERROR: JWT_SECRET is not defined in environment variables for production/staging!");
        process.exit(1);
    } else {
        console.warn("WARNING: JWT_SECRET is not defined in environment variables. Using a fallback for development. DO NOT USE IN PRODUCTION.");
        // jwtConfig.secret = 'a_very_insecure_development_secret';
    }
}

module.exports = jwtConfig;