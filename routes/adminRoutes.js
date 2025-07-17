const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// Middleware to ensure only users with the 'admin' role can access these routes.
const isAdmin = authorizeRoles('admin');

// Apply protection and role authorization to all subsequent routes in this file.
router.use(protect);
router.use(isAdmin);

// === Dashboard & System Health ===
router.get('/stats', adminController.getDashboardStatistics);
router.get('/me', adminController.getCurrentAdminUser); // Endpoint to get admin's own profile
router.get('/system-health', adminController.getSystemHealthSummary);

// === User Management ===
router.get('/users', adminController.getAllUsers);
router.get('/users/active', adminController.getCurrentlyActiveUsers);
router.get('/users/:id', adminController.getUserById);
router.post('/users', adminController.createUser);
router.put('/users/:id', adminController.updateUser);
router.put('/users/:id/deactivate', adminController.deactivateUser);
router.put('/users/:id/activate', adminController.activateUser);
router.put('/users/:id/approve', adminController.manuallyApproveUser);
router.post('/users/:id/reset-password', adminController.adminResetUserPassword);

// === Property Management ===
router.get('/properties', adminController.getAllProperties); // Renamed from listAllPropertiesAdmin
router.get('/properties/:id', adminController.getPropertyById); // Renamed from getPropertyDetailsAdmin, param from propertyId to id
router.post('/properties', adminController.createProperty); // New: Admin can create properties
router.put('/properties/:id', adminController.updateProperty); // New: Admin can update properties
router.put('/properties/:id/deactivate', adminController.deactivateProperty); // New: Admin can deactivate properties

// === Unit Management ===
router.get('/units', adminController.getAllUnits); // Renamed from listAllUnitsAdmin
router.get('/units/:id', adminController.getUnitById); // New: Get single unit by ID
router.post('/units', adminController.createUnit); // New: Admin can create units
router.put('/units/:id', adminController.updateUnit); // New: Admin can update units
router.put('/units/:id/deactivate', adminController.deactivateUnit); // New: Admin can deactivate units

// === Vendor Management ===
router.get('/vendors', adminController.getAllVendors); // Renamed from listAllVendorsAdmin
router.get('/vendors/:id', adminController.getVendorById); // Renamed from getVendorDetailsAdmin, param from vendorId to id
router.post('/vendors', adminController.createVendor); // New: Admin can create vendors
router.put('/vendors/:id', adminController.updateVendor); // New: Admin can update vendors
router.put('/vendors/:id/deactivate', adminController.deactivateVendor); // New: Admin can deactivate vendors

// === Maintenance Request Management ===
router.get('/requests', adminController.getAllRequests); // Renamed from listAllRequestsAdmin
router.get('/requests/analytics', adminController.getRequestAnalytics); // Added from old controller
router.get('/requests/:id', adminController.getRequestById); // Renamed from getRequestDetailsAdmin, param from requestId to id
router.put('/requests/:id/status', adminController.updateRequestStatus); // New: Update request status
router.put('/requests/:id/assign', adminController.assignRequest); // New: Assign request
router.post('/requests/:id/comments', adminController.addCommentToRequest); // New: Add comment to request

// === Lease Management ===
router.get('/leases', adminController.getAllLeases); // New: Get all leases
router.get('/leases/:id', adminController.getLeaseById); // New: Get single lease
router.post('/leases', adminController.createLease); // New: Create lease
router.put('/leases/:id', adminController.updateLease); // New: Update lease
router.put('/leases/:id/terminate', adminController.terminateLease); // New: Terminate lease

// === Rent Management ===
router.get('/rents', adminController.getAllRents); // New: Get all rents
router.get('/rents/:id', adminController.getRentById); // New: Get single rent
router.post('/rents', adminController.recordRentPayment); // New: Record rent payment
router.put('/rents/:id', adminController.updateRentPayment); // New: Update rent payment

// === Scheduled Maintenance Management ===
router.get('/scheduled-maintenances', adminController.getAllScheduledMaintenances); // New: Get all scheduled maintenances
router.get('/scheduled-maintenances/:id', adminController.getScheduledMaintenanceById); // New: Get single scheduled maintenance
router.post('/scheduled-maintenances', adminController.createScheduledMaintenance); // New: Create scheduled maintenance
router.put('/scheduled-maintenances/:id', adminController.updateScheduledMaintenance); // New: Update scheduled maintenance
router.put('/scheduled-maintenances/:id/pause', adminController.pauseScheduledMaintenance); // New: Pause scheduled maintenance
router.put('/scheduled-maintenances/:id/resume', adminController.resumeScheduledMaintenance); // New: Resume scheduled maintenance

// === Invite Management ===
router.get('/invites', adminController.getAllInvites); // Renamed from listAllInvitesAdmin
router.get('/invites/:id', adminController.getInviteById); // New: Get single invite by ID
router.post('/invites', adminController.createInvite); // New: Create and send invite
router.post('/invites/:id/resend', adminController.resendInvite); // Renamed from resendInviteAdmin, param from inviteId to id
router.put('/invites/:id/revoke', adminController.revokeInvite); // Renamed from revokeInviteAdmin, changed to PUT, param from inviteId to id

// === Comment Management ===
router.get('/comments', adminController.getAllComments); // New: Get all comments
router.delete('/comments/:id', adminController.deleteComment); // New: Delete a comment

// === Media Management ===
router.get('/media', adminController.getAllMedia); // Renamed from listAllMedia, now queries top-level Media model
router.get('/media/stats', adminController.getMediaStorageStats); // Added from old controller, now queries top-level Media model
router.delete('/media/:id', adminController.deleteMedia); // Renamed from deleteMediaFileAdmin, now deletes top-level Media document

// === Audit Log Management ===
router.get('/audit-logs', adminController.getAuditLogs); // Renamed from getAuditLogsAdmin

// === System Health & Notifications ===
router.get('/system-health', adminController.getSystemHealthSummary); // Added from old controller
router.post('/notifications/broadcast', adminController.sendSystemBroadcastNotification); // Added from old controller

// === PropertyUser Management ===
router.get('/property-users', adminController.getAllPropertyUsers); // New: Get all property user associations
router.get('/property-users/:id', adminController.getPropertyUserById); // New: Get single property user association
router.post('/property-users', adminController.createPropertyUser); // New: Create property user association
router.put('/property-users/:id', adminController.updatePropertyUser); // New: Update property user association
router.put('/property-users/:id/deactivate', adminController.deactivatePropertyUser); // New: Deactivate property user association


module.exports = router;
