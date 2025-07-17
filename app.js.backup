// app.js (Example Structure)
const express = require('express');
const morgan = require('morgan'); // For request logging
const helmet = require('helmet'); // For security headers
const cors = require('cors'); // For CORS
const cookieParser = require('cookie-parser'); // For parsing cookies
const mongoSanitize = require('express-mongo-sanitize'); // For NoSQL injection prevention
const xss = require('xss-clean'); // For XSS prevention
const hpp = require('hpp'); // For HTTP Parameter Pollution prevention
const rateLimit = require('express-rate-limit'); // For rate limiting
const compression = require('compression'); // For GZIP compression

const AppError = require('./utils/AppError');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

// Import all your routes from the central index file
const routes = require('./routes'); // Assuming this path is correct relative to app.js

const app = express();

// --- Security & Middleware ---
app.use(express.json({ limit: '50mb' })); // Body parser for JSON data
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Body parser for URL-encoded data
app.use(cookieParser()); // Cookie parser

// Sanitize data (NoSQL injection prevention)
app.use(mongoSanitize());

// Prevent XSS attacks
app.use(xss());

// Prevent http param pollution
app.use(hpp());

// Set security headers
app.use(helmet());

// Enable CORS
app.use(cors());

// Development logging (optional, use a more robust logger in production)
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

// Rate limiting (example: 100 requests per 15 minutes)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // max 100 requests per windowMs
    message: 'Too many requests from this IP, please try again after 15 minutes',
});
app.use(limiter);

// Compress all responses
app.use(compression());

// --- Mount Routes ---
// Public routes (no authentication)
app.use('/public', routes.publicRoutes);

// API routes (require authentication)
app.use('/api/auth', routes.authRoutes);
app.use('/api/comments', routes.commentRoutes);
app.use('/api/documents', routes.documentGenerationRoutes);
app.use('/api/invites', routes.inviteRoutes);
app.use('/api/media', routes.mediaRoutes); // NEWLY ADDED
app.use('/api/messages', routes.messageRoutes);
app.use('/api/notifications', routes.notificationRoutes);
app.use('/api/onboarding', routes.onboardingRoutes);
app.use('/api/properties', routes.propertyRoutes);
app.use('/api/units', routes.unitRoutes);
app.use('/api/properties', routes.unitRoutes); // For property-nested unit routes
app.use('/api/leases', routes.leaseRoutes);
app.use('/api/rents', routes.rentRoutes);
app.use('/api/requests', routes.requestRoutes);
app.use('/api/scheduled-maintenance', routes.scheduledMaintenanceRoutes);
app.use('/api/users', routes.userRoutes);
app.use('/api/vendors', routes.vendorRoutes);
app.use('/api/reports', routes.reportRoutes);


// --- Error Handling Middleware ---
// Catch 404 and forward to error handler
app.use(notFound);
// General error handler
app.use(errorHandler);

module.exports = app;



// server.js
const dotenv = require('dotenv');
dotenv.config(); // Load environment variables first

process.on('warning', (warning) => {
    console.warn('⚠️ Runtime Warning:', warning.name);
    console.warn('Message:', warning.message);
    console.warn('Stack:', warning.stack);
});


const app = require('./app'); // Import the configured Express app
// Temporarily comment out other imports that might cause issues for now
// const connectDB = require('./config/db');
// const { startCronJobs } = require('./jobs');
// const logger = require('./utils/logger');
// const path = require('path');
// const fs = require('fs');

// --- Database Connection ---
// connectDB(); // Temporarily comment out

// --- Cron Jobs ---
// Temporarily comment out
// if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
//     startCronJobs();
//     logger.info('Cron jobs are active.');
// } else {
//     logger.info('Cron jobs are not active in development/test environment.');
// }

// --- Static Files & Upload Directories ---
// Temporarily comment out
// const uploadDirs = ['uploads', 'uploads/onboarding'];
// uploadDirs.forEach(dir => {
//     const fullPath = path.join(__dirname, dir);
//     if (!fs.existsSync(fullPath)) {
//         fs.mkdirSync(fullPath, { recursive: true });
//         logger.info(`Created upload directory: ${fullPath}`);
//     }
// });
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// --- Root Endpoints (Optional, for API status) ---
// These are now handled by app.js, so remove if they conflict.
// app.get('/', (req, res) => res.send('Fix It by Threalty API running...'));
// app.get('/api', (req, res) => res.send("API Root Endpoint"));
// app.get('/healthz', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));


// --- Server Start ---
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`); // Use console.log for now
});

// --- Handle Unhandled Promise Rejections & Uncaught Exceptions ---
process.on('unhandledRejection', (err, promise) => {
    console.error(`Unhandled Rejection: ${err.message}`, err.stack); // Use console.error for now
    server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
    console.error(`Uncaught Exception: ${err.message}`, err.stack); // Use console.error for now
    server.close(() => process.exit(1));
});
