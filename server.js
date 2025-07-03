const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const connectDB = require('./config/db');
const path = require('path');
const startCronJobs = require('./utils/cronJobs');
const { errorHandler } = require('./middleware/errorMiddleware');

// Connect to MongoDB
connectDB();

// Start cron jobs after database connection is established
startCronJobs();

// Import all routes
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes');
const commentRoutes = require('./routes/commentRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const propertyRoutes = require('./routes/propertyRoutes');
const reportRoutes = require('./routes/reportRoutes');
const requestRoutes = require('./routes/requestRoutes');
const scheduledMaintenanceRoutes = require('./routes/scheduledMaintenanceRoutes');
const userRoutes = require('./routes/userRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const inviteRoutes = require('./routes/inviteRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.VITE_API_URL || "http://localhost:5173",
  credentials: true
}));
app.use(helmet());
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

// ---------------------
// FILE UPLOAD HANDLING
// ---------------------
// To support both multipart (file upload) and JSON on the /api/requests endpoints,
// we mount the router twice with different middleware handling.

// The requestRoutes file should export a router that only registers
// file upload endpoints (POST /, POST /:id/media, etc) at the top, then
// JSON endpoints (PUT, PATCH, etc) _after_ express.json() is used below.

// 1. Mount upload endpoints (these use multer, and must come BEFORE express.json())
app.use('/api/requests', requestRoutes);

// 2. Enable JSON parsing for all subsequent requests (including PUT/PATCH updates)
app.use(express.json());

// 3. Mount all other API routes (including /api/requests again for non-upload endpoints)
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/scheduled-maintenance', scheduledMaintenanceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/audit-logs', auditLogRoutes);
// Mount /api/requests again for non-upload endpoints (such as PUT/PATCH)
// This ensures express.json() is applied for these routes.
app.use('/api/requests', requestRoutes);

// Root endpoint
app.get('/', (req, res) => res.send('Fixit by Threalty API running...'));
app.get('/api', (req, res) => res.send("API Root Endpoint"));

// Simple Test Route
app.get('/api/test', (req, res) => res.send('API is running...'));

// 404 handler for unknown API endpoints
app.use((req, res) => {
  res.status(404).json({ message: "API endpoint not found." });
});

// Health check endpoint
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong. Please try again later." });
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

/**
 * CHANGES/NOTES:
 * - /api/requests is mounted TWICE:
 *   - FIRST before express.json(), for file upload routes (multipart/form-data, multer).
 *   - AGAIN after express.json(), for update routes (PUT/PATCH) that expect JSON.
 * - This resolves both file upload and JSON body parsing issues for the same endpoint set.
 * - If you separate upload and non-upload routes into different routers, you can avoid double-mount.
 */