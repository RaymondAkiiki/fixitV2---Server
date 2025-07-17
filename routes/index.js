// src/routes/index.js

// Import all individual route files
const authRoutes = require('./authRoutes');
const commentRoutes = require('./commentRoutes');
const documentGenerationRoutes = require('./documentGenerationRoutes');
const inviteRoutes = require('./inviteRoutes');
const messageRoutes = require('./messageRoutes');
const notificationRoutes = require('./notificationRoutes');
const onboardingRoutes = require('./onboardingRoutes');
const propertyRoutes = require('./propertyRoutes');
const publicRoutes = require('./publicRoutes'); // For public-facing links
const unitRoutes = require('./unitRoutes');
const leaseRoutes = require('./leaseRoutes'); // For Lease management
const rentRoutes = require('./rentRoutes');   // For Rent management
const requestRoutes = require('./requestRoutes'); // For Maintenance Request management
const scheduledMaintenanceRoutes = require('./scheduledMaintenanceRoutes'); // For Scheduled Maintenance management
const userRoutes = require('./userRoutes');   // For general User management
const vendorRoutes = require('./vendorRoutes'); // For Vendor management
const reportRoutes = require('./reportRoutes'); // For Reporting
const mediaRoutes = require('./mediaRoutes'); // NEW
const adminRoutes = require('./adminRoutes');
const auditLogRoutes = require('./auditLogRoutes');



/**
 * Centralized module to export all application routes.
 * This makes it easy to mount them in the main Express app.
 */
module.exports = {
 
    adminRoutes,
    auditLogRoutes,
    authRoutes,
    commentRoutes,
    documentGenerationRoutes,
    inviteRoutes,
    messageRoutes,
    notificationRoutes,
    onboardingRoutes,
    propertyRoutes,
    mediaRoutes,
    publicRoutes,
    unitRoutes,
    leaseRoutes,
    rentRoutes,
    requestRoutes,
    scheduledMaintenanceRoutes,
    userRoutes,
    vendorRoutes,
    reportRoutes,
 
};
