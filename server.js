const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const connectDB = require('./config/db');
const path = require('path'); // For serving static files if needed 
const startCronJobs = require('./utils/cronJobs'); // Imports the cron job starter
const { errorHandler } = require('./middleware/errorMiddleware'); // Imports global error handler


// Connect to MongoDB
connectDB();

// Start cron jobs after database connection is established.......uncomment if you decide to use cron after fixing bug 
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
const auditLogRoutes = require('./routes/auditLogRoutes'); // Ensure this file exists if you have separate audit log routes

const app = express();

// Middleware
app.use(cors({
  origin: process.env.VITE_API_URL || "http://localhost:5173",
  credentials: true
}));
app.use(express.json());
app.use(helmet());
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

// Use API routes
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/scheduled-maintenance', scheduledMaintenanceRoutes);
app.use('/api/users', userRoutes); // (optional: for user profile & admin list)
app.use('/api/vendors', vendorRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/audit-logs', auditLogRoutes);

// Root endpoint
app.get('/', (req, res) => res.send('Fixit by Threalty API running...'));
app.get('/api', (req, res) => res.send("API Root Endpoint"));

// Simple Test Route
app.get('/api/test', (req, res) => res.send('API is running...'));


// 404 handler for unknown API endpoints
app.use((req, res) => {
  res.status(404).json({ message: "API endpoint not found." });
});
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
 * - All route files are imported and used, making routes accessible.
 * - Route order is logical and maintainable.
 * - Added 404 catch-all for unknown API endpoints.
 * - All route paths are /api/...
 * - Uses environment variable for CORS origin if provided.
 */
