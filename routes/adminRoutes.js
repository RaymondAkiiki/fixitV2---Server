// server/routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const userController = require('../controllers/userController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// console.log('Type of protect middleware:', typeof protect);
// console.log('Type of authorizeRoles function:', typeof authorizeRoles);

// Middleware to ensure only 'admin' role can access these routes
// Make sure 'admin' matches the role string in your User model exactly.
const isAdmin = authorizeRoles('admin');

// console.log('Type of isAdmin middleware:', typeof isAdmin); // And this one
// console.log('Admin Controller Object:', adminController); // Debug log
// console.log('Type of getCurrentAdminUser:', typeof adminController.getCurrentAdminUser); // Debug log


// === Dashboard & Statistics ===
router.get('/stats', protect, isAdmin, adminController.getDashboardStatistics);
router.get('/me', protect, isAdmin, adminController.getCurrentAdminUser);

// === User Management ===
router.get('/users', protect, isAdmin, adminController.listAllUsers);
router.get('/users/active', protect, isAdmin, adminController.getCurrentlyActiveUsers);
router.get('/users/:userId', protect, isAdmin, adminController.getUserDetailsAdmin);
router.put('/users/:userId/role', protect, isAdmin, adminController.updateUserRole);
router.put('/users/:userId/status', protect, isAdmin, adminController.toggleUserActiveStatus);
router.put('/users/:userId/approve', protect, isAdmin, adminController.manuallyApproveUser);
router.delete('/users/:userId', protect, isAdmin, userController.deleteUser); // Or a specific adminController.deleteUserAdmin

// === Property & Unit Management (admin View) ===
router.get('/properties', protect, isAdmin, adminController.listAllPropertiesAdmin);
router.get('/properties/:propertyId', protect, isAdmin, adminController.getPropertyDetailsAdmin);
router.get('/units', protect, isAdmin, adminController.listAllUnitsAdmin); // Can be filtered by propertyId via query param

// === Maintenance Request Management admin View) ===
router.get('/requests', protect, isAdmin, adminController.listAllRequestsAdmin);
router.get('/requests/analytics', protect, isAdmin, adminController.getRequestAnalytics);
router.get('/requests/:requestId', protect, isAdmin, adminController.getRequestDetailsAdmin);
// For updating/deleting requests, admin might use the general routes from requestRoutes.js
// if their role ('admin') is included in those routes' authorizeRoles checks.
// Or, you can create specific admin override routes here if different logic is needed.
// e.g., router.put('/requests/:requestId/admin-override', protect, isAdmin, adminController.adminOverrideRequestUpdate);

// === Vendor Management (admin View) ===
router.get('/vendors', protect, isAdmin, adminController.listAllVendorsAdmin);
router.get('/vendors/:vendorId', protect, isAdmin, adminController.getVendorDetailsAdmin);
// Similar to requests, admin can use general vendor CRUD routes (if permitted) or have specific admin routes.

// === Invite Management (Admin View) ===
router.get('/invites', protect, isAdmin, adminController.listAllInvitesAdmin);
router.post('/invites/:inviteId/resend', protect, isAdmin, adminController.resendInviteAdmin);
router.delete('/invites/:inviteId/revoke', protect, isAdmin, adminController.revokeInviteAdmin);

// === Audit Log Management ===
router.get('/audit-logs', protect, isAdmin, adminController.getAuditLogsAdmin);

// === System Health & Notifications ===
router.get('/system-health', protect, isAdmin, adminController.getSystemHealthSummary);
router.post('/notifications/broadcast', protect, isAdmin, adminController.sendSystemBroadcastNotification);

// === Media Management (Admin View) ===
router.get('/media/all', protect, isAdmin, adminController.listAllMedia);
router.delete('/media/:requestId/:mediaId', protect, isAdmin, adminController.deleteMediaFileAdmin);
router.get('/media/stats', protect, isAdmin, adminController.getMediaStorageStats);


module.exports = router;