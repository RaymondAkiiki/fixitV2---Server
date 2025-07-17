// backend/routes/frontendLogRoutes.js
const express = require('express');
const router = express.Router();
const backendLogger = require('../utils/logger'); // Your existing backend Winston logger

router.post('/frontend-logs', (req, res) => {
    const { level, message, meta, clientUrl, userAgent, timestamp } = req.body;

    // Validate and sanitize incoming log data as needed
    if (!level || !message) {
        return res.status(400).json({ success: false, message: 'Log level and message are required.' });
    }

    // Ensure the level is one your backend Winston logger understands
    const validLevels = ['error', 'warn', 'info', 'http', 'debug'];
    const finalLevel = validLevels.includes(level) ? level : 'info'; // Default to 'info' if unknown level

    // Parse meta if it was stringified
    let parsedMeta = {};
    try {
        if (meta) {
            parsedMeta = JSON.parse(meta);
        }
    } catch (e) {
        backendLogger.error(`[FRONTEND] Failed to parse meta for log: ${message}`, { error: e });
    }

    // Log the frontend message using your backend Winston logger
    // This will write to your console and files as configured in backend/utils/logger.js
    backendLogger[finalLevel](`[FRONTEND] ${message}`, {
        clientUrl,
        userAgent,
        frontendMeta: parsedMeta,
        ip: req.ip, // IP from backend request
        frontendTimestamp: timestamp, // Use original frontend timestamp
        // Add user ID if available from auth middleware
        userId: req.user ? req.user.id : 'N/A'
    });

    res.status(200).json({ success: true, message: 'Log received by backend' });
});

module.exports = router;