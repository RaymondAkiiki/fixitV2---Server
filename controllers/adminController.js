const User = require('../models/user');
const Unit = require('../models/unit');
const Property = require('../models/property');
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Vendor = require('../models/vendor');
const Invite = require('../models/invite');
const AuditLog = require('../models/auditLog'); 
const Media = require('../models/media'); 
const { logAction } = require('../middleware/auditMiddleware'); 
const { sendNotification } = require('../utils/sendNotification');
const crypto = require('crypto');  
const mongoose = require('mongoose');

/**
 * @desc    Get admin dashboard statistics
 * @route   GET /api/admin/stats
 * @access  Private/Admin
 */
exports.getDashboardStatistics = async (req, res) => {
    try {
        const [
            totalUsers,
            totalProperties,
            totalUnits,
            totalRequests,
            totalScheduledMaintenance,
            recentUsers,
            totalVendors,
            activeInvites,
            requestsByStatusAgg,
            usersByRoleAgg
        ] = await Promise.all([
            User.countDocuments(),
            Property.countDocuments(),
            Unit.countDocuments(),
            Request.countDocuments(),
            ScheduledMaintenance.countDocuments(),
            User.find().sort({ createdAt: -1 }).limit(5).select('name email role createdAt'),
            Vendor.countDocuments(),
            Invite.countDocuments({ status: 'Pending' }),
            Request.aggregate([
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ]),
            User.aggregate([
                { $group: { _id: "$role", count: { $sum: 1 } } },
                { $project: { role: "$_id", count: 1, _id: 0 } }
            ])
        ]);

        const usersByRole = usersByRoleAgg.reduce((acc, roleCount) => {
            acc[roleCount.role] = roleCount.count;
            return acc;
        }, {});

        const requestsByStatus = requestsByStatusAgg.reduce((acc, statusCount) => {
            acc[statusCount._id] = statusCount.count;
            return acc;
        }, {});

        res.json({
            totalUsers,
            usersByRole,
            totalProperties,
            totalUnits,
            totalRequests,
            totalScheduledMaintenance,
            requestsByStatus,
            totalVendors,
            activeInvites,
            recentUsers: recentUsers.map(u => ({ id: u._id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt }))
        });
    } catch (err) {
        console.error("Error in getDashboardStatistics:", err);
        res.status(500).json({ message: 'Failed to load admin dashboard statistics.', error: err.message });
    }
};

// --- User Management ---

/**
 * @desc    List all users (admin)
 * @route   GET /api/admin/users
 * @access  Private/Admin
 */
exports.listAllUsers = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const searchTerm = req.query.search || '';
    const roleFilter = req.query.role || '';

    let query = {};
    if (searchTerm) {
      query.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { email: { $regex: searchTerm, $options: 'i' } }
      ];
    }
    if (roleFilter) {
      query.role = roleFilter;
    }

    try {
      const users = await User.find(query)
        .select('-password') // Exclude password
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      const totalUsers = await User.countDocuments(query);

      res.json({
         users,
         currentPage: page,
         totalPages: Math.ceil(totalUsers / limit),
         totalUsers
      });
    } catch (err) {
        console.error("Error in listAllUsers:", err);
        res.status(500).json({ message: 'Failed to fetch users.', error: err.message });
    }
};

/**
 * @desc    Get user details by ID (admin)
 * @route   GET /api/admin/users/:userId
 * @access  Private/Admin
 */
exports.getUserDetailsAdmin = async (req, res) => {
    try {
      const user = await User.findById(req.params.userId)
        .select('-password')
        .populate( 'name', 'properties', 'propertiesManaged', 'name address')
        .populate('propertiesOwned', 'name', 'name address')
        .populate({
          path: 'tenancies',
          populate: [
            { path: 'property', select: 'name address' },
            { path: 'unit', select: 'unitName' }
          ]
        });

      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }
      res.json(user);
    } catch (err) {
        console.error("Error in getUserDetailsAdmin:", err);
        res.status(500).json({ message: 'Failed to fetch user details.', error: err.message });
    }
};

/**
 * @desc    Update user role (admin)
 * @route   PUT /api/admin/users/:userId/role
 * @access  Private/Admin
 */
exports.updateUserRole = async (req, res) => {
    const { role } = req.body;
    const validRoles = ['tenant', 'landlord', 'propertyManager', 'admin'];

    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role specified.' });
    }

    try {
      const user = await User.findById(req.params.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }

      const oldRole = user.role;
      user.role = role;
      await user.save();

      await logAction('USER_ROLE_UPDATED', req.user._id, 'User', user._id, { oldRole, newRole: role });
      // Optionally send notification to the user about role change
      // await sendNotification(user._id, null, 'role_changed', `Your role has been updated to ${role}.`);

      res.json({ message: 'User role updated successfully.', user });
    } catch (err) {
        console.error("Error in updateUserRole:", err);
        res.status(500).json({ message: 'Failed to update user role.', error: err.message });
    }
};

/**
 * @desc    Toggle user active status (admin)
 * @route   PUT /api/admin/users/:userId/status
 * @access  Private/Admin
 */
exports.toggleUserActiveStatus = async (req, res) => {
    const { isActive } = req.body; // Expecting a boolean

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ message: 'Invalid status value. Must be true or false.' });
    }

    try {
      const user = await User.findById(req.params.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }

      // Prevent admin from deactivating themselves if they are the only admin (optional safety check)
      if (user.role === 'admin' && user._id.equals(req.user._id)) {
        const adminCount = await User.countDocuments({ role: 'admin', isActive: true });
        if (adminCount <= 1 && !isActive) {
          return res.status(400).json({ message: 'Cannot deactivate the last active admin account.' });
        }
      }

      user.isActive = isActive;
      await user.save();

      await logAction(isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', req.user._id, 'User', user._id);
      res.json({ message: `User status updated to ${isActive ? 'active' : 'inactive'}.`, user });
    } catch (err) {
        console.error("Error in toggleUserActiveStatus:", err);
        res.status(500).json({ message: 'Failed to update user status.', error: err.message });
    }
};

/**
 * @desc    Manually approve a user (admin)
 * @route   PUT /api/admin/users/:userId/approve
 * @access  Private/Admin
 */
exports.manuallyApproveUser = async (req, res) => {
    try {
      const user = await User.findById(req.params.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }
      if (user.isApproved) {
        return res.status(400).json({ message: 'User is already approved.' });
      }

      user.isApproved = true;
      await user.save();

      await logAction('USER_MANUALLY_APPROVED', req.user._id, 'User', user._id);
      // Optionally send notification to the user
      // await sendNotification(user._id, null, 'account_approved', 'Your account has been approved.');

      res.json({ message: 'User approved successfully.', user });
    } catch (err) {
        console.error("Error in manuallyApproveUser:", err);
        res.status(500).json({ message: 'Failed to approve user.', error: err.message });
    }
};

/**
 * @desc    Get currently active users (admin)
 * @route   GET /api/admin/users/active
 * @access  Private/Admin
 */
exports.getCurrentlyActiveUsers = async (req, res) => {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    try {
      const users = await User.find({ lastLogin: { $gte: fifteenMinutesAgo } }).select('name email role lastLogin');
      res.json({ count: users.length, users });
    } catch (err) {
        console.error("Error in getCurrentlyActiveUsers:", err);
        res.status(500).json({ message: "Failed to fetch active users.", error: err.message });
    }
};


// --- Property & Unit Management (Admin View) ---

/**
 * @desc    List all properties (admin)
 * @route   GET /api/admin/properties
 * @access  Private/Admin
 */
exports.listAllPropertiesAdmin = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const searchTerm = req.query.search || '';

    let query = {};
    if (searchTerm) {
      query.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { 'address.street': { $regex: searchTerm, $options: 'i' } },
        { 'address.city': { $regex: searchTerm, $options: 'i' } }
      ];
    }

    try {
      const properties = await Property.find(query)
        .populate('landlord', 'name email')
        .populate('propertyManager', 'name email')
        .populate('units', 'unitName') // Consider limiting the number of units populated for performance
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      const totalProperties = await Property.countDocuments(query);

      res.json({
         properties,
         currentPage: page,
         totalPages: Math.ceil(totalProperties / limit),
         totalProperties
      });
    } catch (err) {
        console.error("Error in listAllPropertiesAdmin:", err);
        res.status(500).json({ message: 'Failed to fetch properties.', error: err.message });
    }
};

/**
 * @desc    Get property details by ID (admin)
 * @route   GET /api/admin/properties/:propertyId
 * @access  Private/Admin
 */
exports.getPropertyDetailsAdmin = async (req, res) => {
    try {
      const property = await Property.findById(req.params.propertyId)
        .populate('landlord', 'name email')
        .populate('propertyManager', 'name email')
        .populate({
          path: 'units',
          populate: { path: 'tenant', select: 'name email' }
        });

      if (!property) {
        return res.status(404).json({ message: 'Property not found.' });
      }
      const requests = await Request.find({ property: property._id })
        .populate('createdBy', 'name email')
        .populate('assignedTo', 'name specialty')
        .sort({ createdAt: -1 });

      res.json({ property, requests });
    } catch (err) {
        console.error("Error in getPropertyDetailsAdmin:", err);
        res.status(500).json({ message: 'Failed to fetch property details.', error: err.message });
    }
};

/**
 * @desc    List all units (admin)
 * @route   GET /api/admin/units
 * @access  Private/Admin
 */
exports.listAllUnitsAdmin = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const propertyIdFilter = req.query.propertyId;

    let query = {};
    if (propertyIdFilter) {
        if (!mongoose.Types.ObjectId.isValid(propertyIdFilter)) {
            return res.status(400).json({ message: 'Invalid Property ID format.' });
        }
      query.property = propertyIdFilter;
    }

    try {
      const units = await Unit.find(query)
        .populate('property', 'name address')
        .populate('tenant', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      const totalUnits = await Unit.countDocuments(query);

      res.json({
         units,
         currentPage: page,
         totalPages: Math.ceil(totalUnits / limit),
         totalUnits
      });
    } catch (err) {
        console.error("Error in listAllUnitsAdmin:", err);
        res.status(500).json({ message: 'Failed to fetch units.', error: err.message });
    }
};

// --- Maintenance Request Management (Admin View) ---

/**
 * @desc    List all maintenance requests (admin)
 * @route   GET /api/admin/requests
 * @access  Private/Admin
 */
exports.listAllRequestsAdmin = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { status, priority, propertyId, category, dateFrom, dateTo, search } = req.query;

    let query = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (propertyId) {
        if (!mongoose.Types.ObjectId.isValid(propertyId)) {
            return res.status(400).json({ message: 'Invalid Property ID format.' });
        }
        query.property = propertyId;
    }
    if (category) query.category = category;
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
    }
    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    try {
      const requests = await Request.find(query)
        .populate('createdBy', 'name email')
        .populate('property', 'name')
        .populate('unit', 'unitIdentifier')
        .populate('assignedTo', 'name')        
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      const totalRequests = await Request.countDocuments(query);

      res.json({
         requests,
         currentPage: page,
         totalPages: Math.ceil(totalRequests / limit),
         totalRequests
      });
    } catch (err) {
        console.error("Error in listAllRequestsAdmin:", err);
        res.status(500).json({ message: 'Failed to fetch maintenance requests.', error: err.message });
    }
};

/**
 * @desc    Get maintenance request details by ID (admin)
 * @route   GET /api/admin/requests/:requestId
 * @access  Private/Admin
 */
exports.getRequestDetailsAdmin = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.requestId)) {
            return res.status(400).json({ message: 'Invalid Request ID format.' });
        }
      const request = await Request.findById(req.params.requestId)
        .populate('reportedBy', 'name email role')
        .populate('property', 'name address')
        .populate('unit', 'unitIdentifier')
        .populate('assignedTo', 'name specialty contactEmail contactPhone')
        .populate('comments.user', 'name role');

      if (!request) {
        return res.status(404).json({ message: 'Maintenance request not found.' });
      }
      res.json(request);
    } catch (err) {
        console.error("Error in getRequestDetailsAdmin:", err);
        res.status(500).json({ message: 'Failed to fetch maintenance request details.', error: err.message });
    }
};

/**
 * @desc    Get maintenance request analytics (admin)
 * @route   GET /api/admin/requests/analytics
 * @access  Private/Admin
 */
exports.getRequestAnalytics = async (req, res) => {
    try {
        const requestsPerMonth = await Request.aggregate([
          {
            $group: {
              _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
              count: { $sum: 1 }
            }
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } }
        ]);

        const requestsByCategory = await Request.aggregate([
          { $group: { _id: "$category", count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]);

        const requestsByPriority = await Request.aggregate([
          { $group: { _id: "$priority", count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]);

        const resolvedRequests = await Request.find({
          status: { $in: ['Completed', 'Verified & Closed'] },
          createdAt: { $ne: null },
          completionDate: { $ne: null }
        }).select('createdAt completionDate');

        let totalResolutionTime = 0;
        let resolvedCount = 0;
        resolvedRequests.forEach(req => {
          if (req.completionDate && req.createdAt) {
            totalResolutionTime += (req.completionDate.getTime() - req.createdAt.getTime());
            resolvedCount++;
          }
        });
        const averageResolutionTime = resolvedCount > 0 ? (totalResolutionTime / resolvedCount / (1000 * 60 * 60 * 24)) : 0; // in days

        res.json({
          requestsPerMonth,
          requestsByCategory,
          requestsByPriority,
          averageResolutionTimeDays: averageResolutionTime.toFixed(2)
        });
    } catch (err) {
        console.error("Error in getRequestAnalytics:", err);
        res.status(500).json({ message: 'Failed to fetch request analytics.', error: err.message });
    }
};


// --- Vendor Management (Admin View) ---

/**
 * @desc    List all vendors (admin)
 * @route   GET /api/admin/vendors
 * @access  Private/Admin
 */
exports.listAllVendorsAdmin = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const searchTerm = req.query.search || '';

    let query = {};
    if (searchTerm) {
      query.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { specialty: { $regex: searchTerm, $options: 'i' } } // Assuming specialty is an array of strings
      ];
    }

    try {
      const vendors = await Vendor.find(query)
        .populate('addedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      const totalVendors = await Vendor.countDocuments(query);

      res.json({
         vendors,
         currentPage: page,
         totalPages: Math.ceil(totalVendors / limit),
         totalVendors
      });
    } catch (err) {
        console.error("Error in listAllVendorsAdmin:", err);
        res.status(500).json({ message: 'Failed to fetch vendors.', error: err.message });
    }
};

/**
 * @desc    Get vendor details by ID (admin)
 * @route   GET /api/admin/vendors/:vendorId
 * @access  Private/Admin
 */
exports.getVendorDetailsAdmin = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.vendorId)) {
            return res.status(400).json({ message: 'Invalid Vendor ID format.' });
        }
      const vendor = await Vendor.findById(req.params.vendorId)
        .populate('addedBy', 'name email')
        .populate('services', 'name');

      if (!vendor) {
        return res.status(404).json({ message: 'Vendor not found.' });
      }
     const assignedRequests = await Request.find({ assignedToVendor: vendor._id})
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .sort({createdAt: -1});

      res.json({ vendor, assignedRequests });
    } catch (err) {
        console.error("Error in getVendorDetailsAdmin:", err);
        res.status(500).json({ message: 'Failed to fetch vendor details.', error: err.message });
    }
};

// --- Invite Management (Admin View) ---

/**
 * @desc    List all invites (admin)
 * @route   GET /api/admin/invites
 * @access  Private/Admin
 */
exports.listAllInvitesAdmin = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { status, roleToInvite, search } = req.query;

    let query = {};
    if (status) query.status = status;
    if (roleToInvite) query.roleToInvite = roleToInvite;
    if (search) query.email = { $regex: search, $options: 'i' };


    try {
      const invites = await Invite.find(query)
        .populate('generatedBy', 'name email')
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('acceptedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      const totalInvites = await Invite.countDocuments(query);

      res.json({
         invites,
         currentPage: page,
         totalPages: Math.ceil(totalInvites / limit),
         totalInvites
      });
    } catch (err) {
        console.error("Error in listAllInvitesAdmin:", err);
        res.status(500).json({ message: 'Failed to fetch invites.', error: err.message });
    }
};

/**
 * @desc    Resend an invite (admin)
 * @route   POST /api/admin/invites/:inviteId/resend
 * @access  Private/Admin
 */
exports.resendInviteAdmin = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.inviteId)) {
            return res.status(400).json({ message: 'Invalid Invite ID format.' });
        }
      const invite = await Invite.findById(req.params.inviteId).populate('generatedBy', 'name email');
      if (!invite) {
        return res.status(404).json({ message: 'Invite not found.' });
      }
      if (invite.status !== 'Pending') {
        return res.status(400).json({ message: 'Cannot resend an invite that is not pending.' });
      }
      if (new Date() > new Date(invite.expiresAt)) {
        return res.status(400).json({ message: 'Cannot resend an expired invite. Please generate a new one.' });
      }

      // Actual email sending logic using your emailService
      // await emailService.sendInviteEmail(invite.email, invite.token, invite.roleToInvite, invite.generatedBy.name, invite.property, invite.unit);
      console.log(`Simulating resending invite to ${invite.email} with token ${invite.token}`);


      await logAction('INVITE_RESENT_ADMIN', req.user._id, 'Invite', invite._id);
      res.json({ message: 'Invite resent successfully.' });
    } catch (err) {
        console.error("Error in resendInviteAdmin:", err);
        res.status(500).json({ message: 'Failed to resend invite.', error: err.message });
    }
};

/**
 * @desc    Revoke an invite (admin)
 * @route   DELETE /api/admin/invites/:inviteId/revoke
 * @access  Private/Admin
 */
exports.revokeInviteAdmin = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.inviteId)) {
            return res.status(400).json({ message: 'Invalid Invite ID format.' });
        }
      const invite = await Invite.findById(req.params.inviteId);
      if (!invite) {
        return res.status(404).json({ message: 'Invite not found.' });
      }
      if (invite.status !== 'Pending') {
        return res.status(400).json({ message: 'Cannot revoke an invite that is not pending.' });
      }

      invite.status = 'Revoked';
      await invite.save();

      await logAction('INVITE_REVOKED_ADMIN', req.user._id, 'Invite', invite._id);
      res.json({ message: 'Invite revoked successfully.' });
    } catch (err) {
        console.error("Error in revokeInviteAdmin:", err);
        res.status(500).json({ message: 'Failed to revoke invite.', error: err.message });
    }
};


// --- Audit Log Management (Admin View) ---

/**
 * @desc    Get audit logs (admin)
 * @route   GET /api/admin/audit-logs
 * @access  Private/Admin
 */
exports.getAuditLogsAdmin = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { userId, action, entity, entityId, dateFrom, dateTo } = req.query;

    let query = {};
    if (userId && mongoose.Types.ObjectId.isValid(userId)) query.user = userId;
    if (action) query.action = { $regex: action, $options: 'i' };
    if (entity) query.targetModel = entity;
    if (entityId && mongoose.Types.ObjectId.isValid(entityId)) query.targetId = entityId;
    if (dateFrom || dateTo) {
      query.timestamp = {};
      if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
      if (dateTo) query.timestamp.$lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999)); // Include full end day
    }

    try {
      const auditLogs = await AuditLog.find(query)
        .populate('user', 'name email role') // Populate user details
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit);
      const totalLogs = await AuditLog.countDocuments(query);

      res.json({
         auditLogs,
         currentPage: page,
         totalPages: Math.ceil(totalLogs / limit),
         totalLogs
      });
    } catch (err) {
        console.error("Error in getAuditLogsAdmin:", err);
        res.status(500).json({ message: 'Failed to fetch audit logs.', error: err.message });
    }
};


// --- System Health & Notifications (Admin) ---

/**
 * @desc    Get system health summary (admin)
 * @route   GET /api/admin/system-health
 * @access  Private/Admin
 */
exports.getSystemHealthSummary = async (req, res) => {
    try {
      const dbState = mongoose.connection.readyState;
      let dbStatus = 'Unknown';
      switch (dbState) {
        case 0: dbStatus = 'Disconnected'; break;
        case 1: dbStatus = 'Connected'; break;
        case 2: dbStatus = 'Connecting'; break;
        case 3: dbStatus = 'Disconnecting'; break;
        default: dbStatus = 'Unknown State';
      }

      // Placeholder for other health checks (e.g., email service, external APIs)
      // const emailServiceStatus = await emailService.checkStatus(); 

      res.json({
        databaseStatus: dbStatus,
        uptimeInSeconds: process.uptime(),
        // emailServiceStatus: emailServiceStatus, // Example
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage: process.memoryUsage(),
      });
    } catch (err) {
        console.error("Error in getSystemHealthSummary:", err);
        res.status(500).json({ message: 'Failed to fetch system health.', error: err.message });
    }
};

/**
 * @desc    Send a system-wide or role-based broadcast notification (admin)
 * @route   POST /api/admin/notifications/broadcast
 * @access  Private/Admin
 */
exports.sendSystemBroadcastNotification = async (req, res) => {
    const { message, targetRole, title } = req.body;

    if (!message || !title) {
      return res.status(400).json({ message: 'Title and message are required for broadcast.' });
    }
    const validRoles = ['tenant', 'landlord', 'propertyManager', 'admin', 'All'];
    if (targetRole && !validRoles.includes(targetRole)) {
        return res.status(400).json({ message: 'Invalid target role specified.' });
    }

    try {
      let recipientsQuery = {};
      if (targetRole && targetRole !== 'All') {
        recipientsQuery.role = targetRole;
      }

      const targetUsers = await User.find(recipientsQuery).select('_id');

      if (targetUsers.length === 0) {
        return res.status(404).json({ message: 'No users found for the specified target role.' });
      }

      const notificationPromises = targetUsers.map(user => {
        return sendNotification(
          user._id,
          req.user._id, // Sender is the admin
          'system_broadcast',
          message,
          null, // No specific related resource for a general broadcast
          title
        );
      });

      await Promise.all(notificationPromises);

      await logAction('BROADCAST_NOTIFICATION_SENT', req.user._id, 'System', null, { targetRole, title, messageCount: targetUsers.length });
      res.status(200).json({ message: `Broadcast notification sent to ${targetUsers.length} users.` });

    } catch (err) {
        console.error("Error in sendSystemBroadcastNotification:", err);
        res.status(500).json({ message: 'Failed to send broadcast notification.', error: err.message });
    }
};

// --- Media Management (Admin View) ---

/**
 * @desc    List all media files (admin)
 * This function assumes media items are subdocuments in Request.
 * If Media is a separate collection, this query would be simpler.
 * @route   GET /api/admin/media/all
 * @access  Private/Admin
 */
exports.listAllMedia = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20; // Number of media items per page
    const skip = (page - 1) * limit;
    const { type, uploaderId, requestId, propertyId } = req.query;

    try {
        let aggregationPipeline = [];

        // Start by unwinding the media array from Requests
        aggregationPipeline.push({ $unwind: "$media" });

        // Match stage for filtering based on query parameters
        const matchStage = {};
        if (type) matchStage['media.mimetype'] = new RegExp(type, 'i'); // e.g., 'image', 'video', 'pdf'
        if (uploaderId && mongoose.Types.ObjectId.isValid(uploaderId)) matchStage.reportedBy = new mongoose.Types.ObjectId(uploaderId);
        if (requestId && mongoose.Types.ObjectId.isValid(requestId)) matchStage._id = new mongoose.Types.ObjectId(requestId); // This filters by request ID
        // To filter by propertyId, we might need a lookup first or ensure propertyId is on the request
        // For simplicity, if propertyId is provided, we first filter requests by propertyId
        if (propertyId && mongoose.Types.ObjectId.isValid(propertyId)) {
            aggregationPipeline.unshift({ $match: { property: new mongoose.Types.ObjectId(propertyId) } });
        }


        if (Object.keys(matchStage).length > 0) {
            aggregationPipeline.push({ $match: matchStage });
        }

        // Project to reshape the output to focus on media items
        aggregationPipeline.push({
            $project: {
                _id: "$media._id", // Use media's own _id if it exists and is unique, otherwise consider request._id + index or a generated one
                url: "$media.url",
                filename: "$media.filename",
                mimetype: "$media.mimetype",
                uploadedAt: "$media.uploadedAt", // Assuming this field exists in your media subdocument
                size: "$media.size", // Assuming this field exists
                requestId: "$_id",
                requestTitle: "$title",
                propertyId: "$property",
                reportedBy: "$reportedBy" // This is the user who reported the request
            }
        });

        // Add sorting
        aggregationPipeline.push({ $sort: { uploadedAt: -1, filename: 1 } });

        // Create a parallel pipeline for counting total documents matching the criteria
        const countPipeline = [...aggregationPipeline]; // Clone the pipeline up to this point
        countPipeline.push({ $count: "totalDocs" });

        const totalResult = await Request.aggregate(countPipeline);
        const totalMediaFiles = totalResult.length > 0 ? totalResult[0].totalDocs : 0;

        // Add pagination to the main data pipeline
        aggregationPipeline.push({ $skip: skip });
        aggregationPipeline.push({ $limit: limit });

        // Lookups for related data (uploader, property)
        aggregationPipeline.push(
            {
                $lookup: {
                    from: "users", // The actual name of your users collection
                    localField: "reportedBy",
                    foreignField: "_id",
                    as: "uploaderInfo"
                }
            },
            { $unwind: { path: "$uploaderInfo", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "properties", // The actual name of your properties collection
                    localField: "propertyId",
                    foreignField: "_id",
                    as: "propertyInfo"
                }
            },
            { $unwind: { path: "$propertyInfo", preserveNullAndEmptyArrays: true } },
            {
                $project: { // Final projection
                    _id: 1, url: 1, filename: 1, mimetype: 1, uploadedAt: 1, size: 1,
                    requestId: 1, requestTitle: 1,
                    property: { _id: "$propertyInfo._id", name: "$propertyInfo.name" },
                    uploader: { _id: "$uploaderInfo._id", name: "$uploaderInfo.name", email: "$uploaderInfo.email" }
                }
            }
        );

        const mediaFiles = await Request.aggregate(aggregationPipeline);

        res.json({
            mediaFiles,
            currentPage: page,
            totalPages: Math.ceil(totalMediaFiles / limit),
            totalMediaFiles
        });

    } catch (err) {
        console.error("Error in listAllMedia:", err.message, err.stack);
        res.status(500).json({ message: 'Failed to fetch media files.', error: err.message });
    }
};


/**
 * @desc    Delete a media file (admin). This is complex if media is embedded.
 * Requires identifying the specific media item within the request's media array.
 * A unique ID for each media item in the array would be best.
 * @route   DELETE /api/admin/media/:requestId/:mediaId  (Assuming mediaId is unique within the request)
 * @access  Private/Admin
 */
exports.deleteMediaFileAdmin = async (req, res) => {
    const { requestId, mediaId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(requestId) || !mongoose.Types.ObjectId.isValid(mediaId)) { // Assuming mediaId is an ObjectId now
        return res.status(400).json({ message: 'Invalid Request ID or Media ID format.' });
    }

    try {
        const request = await Request.findById(requestId);
        if (!request) {
            return res.status(404).json({ message: 'Maintenance request not found.' });
        }

        const mediaItem = request.media.id(mediaId); // Mongoose subdocument array .id() method
        if (!mediaItem) {
            return res.status(404).json({ message: 'Media file not found in this request.' });
        }

        // IMPORTANT: Add logic here to delete the actual file from your cloud storage (S3, Cloudinary, etc.)
        // e.g., await cloudStorageService.deleteFile(mediaItem.storageKeyOrUrl);
        // This requires storing a unique identifier for the cloud file (e.g., storageKey) in your media object.
        console.log(`TODO: Implement actual file deletion from cloud storage for: ${mediaItem.url}`);

        // Remove the subdocument from the array
        mediaItem.remove(); // Mongoose < 5.X use pull
        // For Mongoose 5.x and later, if .remove() on subdoc doesn't work as expected:
        // request.media.pull({ _id: mediaId });

        await request.save();
        await logAction('MEDIA_DELETED_ADMIN', req.user._id, 'Request', requestId, { mediaId: mediaItem._id, filename: mediaItem.filename });

        res.json({ message: 'Media file removed successfully.' });
    } catch (err) {
        console.error("Error in deleteMediaFileAdmin:", err);
        res.status(500).json({ message: 'Failed to delete media file.', error: err.message });
    }
};

/**
 * @desc    Get media storage statistics (admin)
 * @route   GET /api/admin/media/stats
 * @access  Private/Admin
 */
exports.getMediaStorageStats = async (req, res) => {
    try {
        // If media items have a 'size' field (in bytes)
        const result = await Request.aggregate([
            { $unwind: "$media" },
            {
                $group: {
                    _id: null,
                    totalFiles: { $sum: 1 },
                    totalSizeInBytes: { $sum: "$media.size" } // Requires 'size' field in media subdocument
                }
            }
        ]);

        let stats = {
            totalFiles: 0,
            totalSizeInBytes: 0,
            totalSizeMB: 0,
            notes: ""
        };

        if (result.length > 0) {
            stats.totalFiles = result[0].totalFiles;
            if (result[0].totalSizeInBytes) {
                stats.totalSizeInBytes = result[0].totalSizeInBytes;
                stats.totalSizeMB = (result[0].totalSizeInBytes / (1024 * 1024)).toFixed(2);
            } else {
                stats.notes = "Size calculation requires 'size' field in media subdocuments.";
            }
        } else {
            stats.notes = "No media files found or 'size' field missing for calculation.";
        }

        res.json(stats);
    } catch (err) {
        console.error("Error in getMediaStorageStats:", err);
        res.status(500).json({ message: 'Failed to fetch media storage stats.', error: err.message });
    }
};

// GET /api/admin/me (current admin user info) - often handled by authController.getMe, but can be explicit here
exports.getCurrentAdminUser = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: "Not authorized, user not found." });
        }
        const { _id, name, email, role, createdAt, isActive, isApproved } = req.user;
        res.status(200).json({ _id, name, email, role, createdAt, isActive, isApproved });
    } catch (error) {
        console.error("Error in getCurrentAdminUser:", error);
        res.status(500).json({ message: "Server error while fetching admin user data." });
    }
};