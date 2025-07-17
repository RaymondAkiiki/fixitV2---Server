const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const connectDB = require('./config/db');
const path = require('path');
const { errorHandler } = require('./middleware/errorMiddleware'); // Ensure this is imported

// Connect to MongoDB
connectDB();

const app = express(); // Initialize Express app FIRST

// =========================================================
// MIDDLEWARE CONFIGURATION (Order Matters!)
// =========================================================

// 1. CORS Configuration - MUST be placed before any routes
const corsOptions = {
    origin: 'http://localhost:5173', // Your frontend's URL
    credentials: true, // Allow cookies and authorization headers to be sent
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Explicitly allowed methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Explicitly allowed request headers
};
app.use(cors(corsOptions));

// 2. Security Middleware
app.use(helmet()); // Sets various HTTP headers for security

// 3. Request Logging
app.use(morgan('dev')); // HTTP request logger

// 4. Body Parsers - REQUIRED to parse JSON and URL-encoded data from requests
app.use(express.json()); // Parses incoming JSON requests
app.use(express.urlencoded({ extended: false })); // Parses incoming URL-encoded requests

// 5. Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

// =========================================================
// ROUTE IMPORTS
// =========================================================
const authRoutes = require('./routes/authRoutes');
const commentRoutes = require('./routes/commentRoutes');
const documentGenerationRoutes = require('./routes/documentGenerationRoutes');
const inviteRoutes = require('./routes/inviteRoutes');
const messageRoutes = require('./routes/messageRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const onboardingRoutes = require('./routes/onboardingRoutes');
const propertyRoutes = require('./routes/propertyRoutes');
const publicRoutes = require('./routes/publicRoutes');
const unitRoutes = require('./routes/unitRoutes');
const leaseRoutes = require('./routes/leaseRoutes');
const rentRoutes = require('./routes/rentRoutes');
const requestRoutes = require('./routes/requestRoutes');
const scheduledMaintenanceRoutes = require('./routes/scheduledMaintenanceRoutes');
const userRoutes = require('./routes/userRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const reportRoutes = require('./routes/reportRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const adminRoutes = require('./routes/adminRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');
const frontendLogRoutes = require('./routes/frontendLogRoutes');

// =========================================================
// MOUNT ROUTES - AFTER all general middleware
// =========================================================
app.use('/api/auth', authRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/documents', documentGenerationRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/leases', leaseRoutes);
app.use('/api/rents', rentRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/scheduled-maintenance', scheduledMaintenanceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auditlogs', auditLogRoutes);
app.use('/api', frontendLogRoutes);

// =========================================================
// GENERAL ENDPOINTS & ERROR HANDLING
// =========================================================

// Root and test endpoints - Place these BEFORE the 404 handler
app.get('/', (req, res) => res.send('Fixit by Threalty API running...'));
app.get('/api', (req, res) => res.send("API Root Endpoint"));
app.get('/api/test', (req, res) => res.send('API is running...'));
app.get('/healthz', (req, res) => res.json({ status: 'ok' })); // Health check should be reachable

// 404 Handler - This MUST be placed AFTER all your defined routes
// Its signature MUST include `next`
app.use((req, res, next) => {
    res.status(404).json({ message: "API endpoint not found." });
});

// Global Error Handler - This MUST be the LAST middleware
// Use the `errorHandler` imported from your middleware folder
app.use(errorHandler);

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;