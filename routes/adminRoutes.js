// src/routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { validateUserRegistration } = require('../utils/validationUtils');
const { ROLE_ENUM } = require('../utils/constants/enums');

// Apply protection middleware to all admin routes
router.use(protect);
router.use(authorizeRoles(ROLE_ENUM.ADMIN));

// Dashboard & System Routes
router.get('/stats', adminController.getDashboardStatistics);
router.get('/system-health', adminController.getSystemHealthSummary);
router.post('/notifications/broadcast', adminController.sendSystemBroadcastNotification);

// User Management Routes
router.get('/users', adminController.getAllUsers);
router.get('/users/active', adminController.getCurrentlyActiveUsers);
router.get('/users/:id', adminController.getUserById);
router.post('/users', validateUserRegistration, adminController.createUser);
router.put('/users/:id', adminController.updateUser);
router.put('/users/:id/deactivate', adminController.deactivateUser);
router.put('/users/:id/activate', adminController.activateUser);
router.put('/users/:id/approve', adminController.manuallyApproveUser);
router.post('/users/:id/reset-password', adminController.adminResetUserPassword);

// Property Management Routes
router.get('/properties', adminController.getAllProperties);
router.get('/properties/:id', adminController.getPropertyById);
router.post('/properties', adminController.createProperty);
router.put('/properties/:id', adminController.updateProperty);
router.put('/properties/:id/deactivate', adminController.deactivateProperty);

// Unit Management Routes
router.get('/units', adminController.getAllUnits);
router.get('/units/:id', adminController.getUnitById);
router.post('/units', adminController.createUnit);
router.put('/units/:id', adminController.updateUnit);
router.put('/units/:id/deactivate', adminController.deactivateUnit);

// Maintenance Request Routes
router.get('/requests', adminController.getAllRequests);
router.get('/requests/analytics', adminController.getRequestAnalytics);
router.get('/requests/:id', adminController.getRequestById);
router.put('/requests/:id/status', adminController.updateRequestStatus);
router.put('/requests/:id/assign', adminController.assignRequest);
router.post('/requests/:id/comments', adminController.addCommentToRequest);

// Vendor Management Routes
router.get('/vendors', adminController.getAllVendors);
router.get('/vendors/:id', adminController.getVendorById);
router.post('/vendors', adminController.createVendor);
router.put('/vendors/:id', adminController.updateVendor);
router.put('/vendors/:id/deactivate', adminController.deactivateVendor);

// Invite Management Routes
router.get('/invites', adminController.getAllInvites);
router.get('/invites/:id', adminController.getInviteById);
router.post('/invites', adminController.createInvite);
router.post('/invites/:id/resend', adminController.resendInvite);
router.put('/invites/:id/revoke', adminController.revokeInvite);

// Audit Log Routes
router.get('/audit-logs', adminController.getAuditLogs);

// Media Management Routes
router.get('/media', adminController.getAllMedia);
router.get('/media/stats', adminController.getMediaStorageStats);
router.delete('/media/:id', adminController.deleteMedia);

// Lease Management Routes
router.get('/leases', adminController.getAllLeases);
router.get('/leases/:id', adminController.getLeaseById);
router.post('/leases', adminController.createLease);
router.put('/leases/:id', adminController.updateLease);
router.put('/leases/:id/terminate', adminController.terminateLease);

// Rent Management Routes
router.get('/rents', adminController.getAllRents);
router.get('/rents/:id', adminController.getRentById);
router.post('/rents', adminController.recordRentPayment);
router.put('/rents/:id', adminController.updateRentPayment);

// Scheduled Maintenance Routes
router.get('/scheduled-maintenances', adminController.getAllScheduledMaintenances);
router.get('/scheduled-maintenances/:id', adminController.getScheduledMaintenanceById);
router.post('/scheduled-maintenances', adminController.createScheduledMaintenance);
router.put('/scheduled-maintenances/:id', adminController.updateScheduledMaintenance);
router.put('/scheduled-maintenances/:id/pause', adminController.pauseScheduledMaintenance);
router.put('/scheduled-maintenances/:id/resume', adminController.resumeScheduledMaintenance);

// Property User Association Routes
router.get('/property-users', adminController.getAllPropertyUsers);
router.get('/property-users/:id', adminController.getPropertyUserById);
router.post('/property-users', adminController.createPropertyUser);
router.put('/property-users/:id', adminController.updatePropertyUser);
router.put('/property-users/:id/deactivate', adminController.deactivatePropertyUser);

// Comment Management Routes
router.get('/comments', adminController.getAllComments);
router.delete('/comments/:id', adminController.deleteComment);

module.exports = router;