// src/controllers/adminController.js

const adminService = require('../services/adminService');
const { createAuditLog } = require('../services/auditService');
const logger = require('../utils/logger');
const { validateResult, validateUserRegistration } = require('../utils/validationUtils');
const { AUDIT_ACTION_ENUM, AUDIT_RESOURCE_TYPE_ENUM } = require('../utils/constants/enums');

// Helper for common error response
const sendErrorResponse = (res, statusCode, message, error = null) => {
    logger.error(`Error ${statusCode}: ${message}`, error);
    res.status(statusCode).json({ 
        success: false, 
        message, 
        error: error ? error.message : null 
    });
};

/**
 * @desc    Get admin dashboard statistics
 * @route   GET /api/admin/stats
 * @access  Private/Admin
 */
exports.getDashboardStatistics = async (req, res) => {
    try {
        const stats = await adminService.getDashboardStats();
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SYSTEM_EVENT,
            description: 'Accessed dashboard statistics',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.System,
            status: 'success',
            metadata: stats
        });
        
        res.status(200).json({ success: true, data: stats });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch dashboard statistics.', err);
    }
};

/**
 * @desc    Get current admin user details
 * @route   GET /api/admin/me
 * @access  Private/Admin
 */
exports.getCurrentAdminUser = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return sendErrorResponse(res, 401, "Not authorized, user data not found in request.");
        }
        
        const adminUser = await adminService.getAdminUser(req.user.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.LOGIN,
            description: 'Accessed own admin profile',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            newValue: adminUser
        });
        
        res.status(200).json({ success: true, data: adminUser });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to retrieve admin user details.', err);
    }
};

// === User Management ===

/**
 * @desc    Get all users (admin view)
 * @route   GET /api/admin/users
 * @access  Private/Admin
 */
exports.getAllUsers = async (req, res) => {
    try {
        const { page = 1, limit = 10, role, status, search } = req.query;
        const filters = { role, status, search };
        
        const result = await adminService.getAllUsers(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all users',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            newValue: { filters, count: result.users.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.users 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch users.', err);
    }
};

/**
 * @desc    Get a single user by ID (admin view)
 * @route   GET /api/admin/users/:id
 * @access  Private/Admin
 */
exports.getUserById = async (req, res) => {
    try {
        const user = await adminService.getUserById(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed user ${user.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            newValue: user
        });
        
        res.status(200).json({ success: true, data: user });
    } catch (err) {
        if (err.message === 'User not found') {
            return sendErrorResponse(res, 404, 'User not found.');
        }
        sendErrorResponse(res, 500, 'Failed to fetch user details.', err);
    }
};

/**
 * @desc    Create a new user (by admin)
 * @route   POST /api/admin/users
 * @access  Private/Admin
 */
exports.createUser = [
    // Apply validation chain
    ...validateUserRegistration,
    async (req, res) => {
        try {
            // No need for explicit validationResult check here, validateResult middleware handles it
            const { firstName, lastName, email, phone, password, role } = req.body;
            
            const newUser = await adminService.createUser({
                firstName, lastName, email, phone, password, role
            });
            
            await createAuditLog({
                user: req.user.id,
                action: AUDIT_ACTION_ENUM.USER_CREATED,
                description: `Created new user ${newUser.email} with role ${newUser.role}`,
                resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
                newValue: newUser
            });
            
            res.status(201).json({ success: true, data: newUser });
        } catch (err) {
            sendErrorResponse(res, 400, err.message, err);
        }
    }
];

/**
 * @desc    Update a user's details (by admin)
 * @route   PUT /api/admin/users/:id
 * @access  Private/Admin
 */
exports.updateUser = async (req, res) => {
    try {
        const userId = req.params.id;
        const updateData = req.body;
        
        const user = await adminService.updateUser(userId, updateData);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.USER_UPDATED,
            description: `Updated user ${user.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            newValue: user
        });
        
        res.status(200).json({ success: true, data: user });
    } catch (err) {
        if (err.message === 'User not found') {
            return sendErrorResponse(res, 404, 'User not found.');
        }
        if (err.message === 'Email already in use by another user') {
            return sendErrorResponse(res, 400, 'Email already in use by another user.');
        }
        sendErrorResponse(res, 400, 'Failed to update user.', err);
    }
};

/**
 * @desc    Deactivate a user account (soft delete)
 * @route   PUT /api/admin/users/:id/deactivate
 * @access  Private/Admin
 */
exports.deactivateUser = async (req, res) => {
    try {
        const user = await adminService.deactivateUser(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.USER_DEACTIVATED,
            description: `Deactivated user ${user.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            newValue: user
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'User deactivated successfully.', 
            data: user 
        });
    } catch (err) {
        if (err.message === 'User not found') {
            return sendErrorResponse(res, 404, 'User not found.');
        }
        if (err.message === 'User is already deactivated') {
            return sendErrorResponse(res, 400, 'User is already deactivated.');
        }
        sendErrorResponse(res, 500, 'Failed to deactivate user.', err);
    }
};

/**
 * @desc    Activate a user account
 * @route   PUT /api/admin/users/:id/activate
 * @access  Private/Admin
 */
exports.activateUser = async (req, res) => {
    try {
        const user = await adminService.activateUser(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.USER_UPDATED,
            description: `Activated user ${user.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            newValue: user
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'User activated successfully.', 
            data: user 
        });
    } catch (err) {
        if (err.message === 'User not found') {
            return sendErrorResponse(res, 404, 'User not found.');
        }
        if (err.message === 'User is already active') {
            return sendErrorResponse(res, 400, 'User is already active.');
        }
        sendErrorResponse(res, 500, 'Failed to activate user.', err);
    }
};

/**
 * @desc    Manually approve a user whose registration is pending admin approval
 * @route   PUT /api/admin/users/:id/approve
 * @access  Private/Admin
 */
exports.manuallyApproveUser = async (req, res) => {
    try {
        const user = await adminService.approveUser(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.USER_APPROVED,
            description: `Approved user ${user.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            newValue: user
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'User approved and activated successfully.', 
            data: user 
        });
    } catch (err) {
        if (err.message === 'User not found') {
            return sendErrorResponse(res, 404, 'User not found.');
        }
        if (err.message.includes('User status is') || err.message === 'User is already active and approved') {
            return sendErrorResponse(res, 400, err.message);
        }
        sendErrorResponse(res, 500, 'Failed to approve user.', err);
    }
};

/**
 * @desc    Admin resets a user's password (without knowing current password)
 * @route   POST /api/admin/users/:id/reset-password
 * @access  Private/Admin
 */
exports.adminResetUserPassword = async (req, res) => {
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 8) {
        return sendErrorResponse(res, 400, 'New password must be at least 8 characters long.');
    }
    
    try {
        await adminService.resetUserPassword(req.params.id, newPassword);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PASSWORD_RESET,
            description: `Admin reset password for user ID ${req.params.id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'User password reset successfully.' 
        });
    } catch (err) {
        if (err.message === 'User not found') {
            return sendErrorResponse(res, 404, 'User not found.');
        }
        sendErrorResponse(res, 500, 'Failed to reset user password.', err);
    }
};

// === Property Management ===

/**
 * @desc    Get all properties (admin view)
 * @route   GET /api/admin/properties
 * @access  Private/Admin
 */
exports.getAllProperties = async (req, res) => {
    try {
        const { page = 1, limit = 10, search, type, isActive } = req.query;
        const filters = { search, type, isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined };
        
        const result = await adminService.getAllProperties(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all properties',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
            newValue: { filters, count: result.properties.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.properties 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch properties.', err);
    }
};

/**
 * @desc    Get a single property by ID (admin view)
 * @route   GET /api/admin/properties/:id
 * @access  Private/Admin
 */
exports.getPropertyById = async (req, res) => {
    try {
        const property = await adminService.getPropertyById(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed property ${property.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
            newValue: property
        });
        
        res.status(200).json({ success: true, data: property });
    } catch (err) {
        if (err.message === 'Property not found') {
            return sendErrorResponse(res, 404, 'Property not found.');
        }
        sendErrorResponse(res, 500, 'Failed to fetch property details.', err);
    }
};

/**
 * @desc    Create a new property
 * @route   POST /api/admin/properties
 * @access  Private/Admin
 */
exports.createProperty = async (req, res) => {
    try {
        const propertyData = req.body;
        const newProperty = await adminService.createProperty(propertyData, req.user.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PROPERTY_CREATED,
            description: `Created property ${newProperty.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
            newValue: newProperty
        });
        
        res.status(201).json({ success: true, data: newProperty });
    } catch (err) {
        sendErrorResponse(res, 400, 'Failed to create property.', err);
    }
};

/**
 * @desc    Update an existing property
 * @route   PUT /api/admin/properties/:id
 * @access  Private/Admin
 */
exports.updateProperty = async (req, res) => {
    try {
        const propertyId = req.params.id;
        const updates = req.body;
        
        const property = await adminService.updateProperty(propertyId, updates);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PROPERTY_UPDATED,
            description: `Updated property ${property.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
            newValue: property
        });
        
        res.status(200).json({ success: true, data: property });
    } catch (err) {
        if (err.message === 'Property not found') {
            return sendErrorResponse(res, 404, 'Property not found.');
        }
        sendErrorResponse(res, 400, 'Failed to update property.', err);
    }
};

/**
 * @desc    Deactivate a property (soft delete)
 * @route   PUT /api/admin/properties/:id/deactivate
 * @access  Private/Admin
 */
exports.deactivateProperty = async (req, res) => {
    try {
        const property = await adminService.deactivateProperty(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PROPERTY_DEACTIVATED,
            description: `Deactivated property ${property.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
            newValue: property
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Property deactivated successfully.', 
            data: property 
        });
    } catch (err) {
        if (err.message === 'Property not found') {
            return sendErrorResponse(res, 404, 'Property not found.');
        }
        if (err.message === 'Property is already deactivated') {
            return sendErrorResponse(res, 400, 'Property is already deactivated.');
        }
        sendErrorResponse(res, 500, 'Failed to deactivate property.', err);
    }
};

// === Unit Management ===

/**
 * @desc    Get all units (admin view) - can filter by propertyId
 * @route   GET /api/admin/units?propertyId=<id>
 * @access  Private/Admin
 */
exports.getAllUnits = async (req, res) => {
    try {
        const { page = 1, limit = 10, propertyId, status, search } = req.query;
        const filters = { propertyId, status, search };
        
        const result = await adminService.getAllUnits(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed all units (filtered by property: ${propertyId})`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
            newValue: { filters, count: result.units.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.units 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch units.', err);
    }
};

/**
 * @desc    Get a single unit by ID (admin view)
 * @route   GET /api/admin/units/:id
 * @access  Private/Admin
 */
exports.getUnitById = async (req, res) => {
    try {
        const unit = await adminService.getUnitById(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed unit ${unit.unitName}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
            newValue: unit
        });
        
        res.status(200).json({ success: true, data: unit });
    } catch (err) {
        if (err.message === 'Unit not found') {
            return sendErrorResponse(res, 404, 'Unit not found.');
        }
        sendErrorResponse(res, 500, 'Failed to fetch unit details.', err);
    }
};

/**
 * @desc    Create a new unit
 * @route   POST /api/admin/units
 * @access  Private/Admin
 */
exports.createUnit = async (req, res) => {
    try {
        const unitData = req.body;
        const newUnit = await adminService.createUnit(unitData);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.UNIT_CREATED,
            description: `Created unit ${newUnit.unitName} for property ID ${newUnit.property}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
            newValue: newUnit
        });
        
        res.status(201).json({ success: true, data: newUnit });
    } catch (err) {
        if (err.message === 'Associated property not found') {
            return sendErrorResponse(res, 404, 'Associated property not found.');
        }
        sendErrorResponse(res, 400, 'Failed to create unit.', err);
    }
};

/**
 * @desc    Update an existing unit
 * @route   PUT /api/admin/units/:id
 * @access  Private/Admin
 */
exports.updateUnit = async (req, res) => {
    try {
        const unitId = req.params.id;
        const updates = req.body;
        
        const unit = await adminService.updateUnit(unitId, updates);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.UNIT_UPDATED,
            description: `Updated unit ${unit.unitName}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
            newValue: unit
        });
        
        res.status(200).json({ success: true, data: unit });
    } catch (err) {
        if (err.message === 'Unit not found') {
            return sendErrorResponse(res, 404, 'Unit not found.');
        }
        sendErrorResponse(res, 400, 'Failed to update unit.', err);
    }
};

/**
 * @desc    Deactivate a unit
 * @route   PUT /api/admin/units/:id/deactivate
 * @access  Private/Admin
 */
exports.deactivateUnit = async (req, res) => {
    try {
        const unit = await adminService.deactivateUnit(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.UNIT_DEACTIVATED,
            description: `Deactivated unit ${unit.unitName}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
            newValue: unit
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Unit deactivated successfully.', 
            data: unit 
        });
    } catch (err) {
        if (err.message === 'Unit not found') {
            return sendErrorResponse(res, 404, 'Unit not found.');
        }
        if (err.message === 'Unit is already unavailable') {
            return sendErrorResponse(res, 400, 'Unit is already unavailable.');
        }
        sendErrorResponse(res, 500, 'Failed to deactivate unit.', err);
    }
};

// === Maintenance Request Management ===

/**
 * @desc    Get all maintenance requests (admin view)
 * @route   GET /api/admin/requests
 * @access  Private/Admin
 */
exports.getAllRequests = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, priority, category, propertyId, unitId, search } = req.query;
        const filters = { status, priority, category, propertyId, unitId, search };
        
        const result = await adminService.getAllRequests(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all requests',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            newValue: { filters, count: result.requests.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.requests 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch requests.', err);
    }
};

/**
 * @desc    Get request analytics (admin view)
 * @route   GET /api/admin/requests/analytics
 * @access  Private/Admin
 */
exports.getRequestAnalytics = async (req, res) => {
    try {
        const analytics = await adminService.getRequestAnalytics();
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SYSTEM_EVENT,
            description: 'Accessed request analytics',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            newValue: analytics
        });
        
        res.status(200).json({ success: true, data: analytics });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch request analytics.', err);
    }
};

/**
 * @desc    Get a single maintenance request by ID (admin view)
 * @route   GET /api/admin/requests/:id
 * @access  Private/Admin
 */
exports.getRequestById = async (req, res) => {
    try {
        const request = await adminService.getRequestById(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed request ${request._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            newValue: request
        });
        
        res.status(200).json({ success: true, data: request });
    } catch (err) {
        if (err.message === 'Request not found') {
            return sendErrorResponse(res, 404, 'Request not found.');
        }
        sendErrorResponse(res, 500, 'Failed to fetch request details.', err);
    }
};

/**
 * @desc    Update a request's status by Admin
 * @route   PUT /api/admin/requests/:id/status
 * @access  Private/Admin
 */
exports.updateRequestStatus = async (req, res) => {
    const { status } = req.body;
    
    try {
        const request = await adminService.updateRequestStatus(req.params.id, status, req.user.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.REQUEST_STATUS_UPDATED,
            description: `Request ${request._id} status changed to ${status}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            newValue: { status: request.status }
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Request status updated.', 
            data: request 
        });
    } catch (err) {
        if (err.message === 'Request not found') {
            return sendErrorResponse(res, 404, 'Request not found.');
        }
        if (err.message.includes('Invalid status provided')) {
            return sendErrorResponse(res, 400, err.message);
        }
        sendErrorResponse(res, 400, 'Failed to update request status.', err);
    }
};

/**
 * @desc    Assign a request to a user or vendor by Admin
 * @route   PUT /api/admin/requests/:id/assign
 * @access  Private/Admin
 */
exports.assignRequest = async (req, res) => {
    const { assignedToId, assignedToModel } = req.body;
    
    try {
        const request = await adminService.assignRequest(
            req.params.id, 
            assignedToId, 
            assignedToModel, 
            req.user.id
        );
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.REQUEST_ASSIGNED,
            description: `Request ${request._id} assigned to ${assignedToModel}: ${assignedToId}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            newValue: { assignedTo: request.assignedTo, assignedToModel: request.assignedToModel }
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Request assigned successfully.', 
            data: request 
        });
    } catch (err) {
        if (err.message === 'Request not found') {
            return sendErrorResponse(res, 404, 'Request not found.');
        }
        if (err.message.includes('not found') || err.message.includes('required')) {
            return sendErrorResponse(res, 400, err.message);
        }
        sendErrorResponse(res, 400, 'Failed to assign request.', err);
    }
};

/**
 * @desc    Add a comment to a request (by admin)
 * @route   POST /api/admin/requests/:id/comments
 * @access  Private/Admin
 */
exports.addCommentToRequest = async (req, res) => {
    try {
        const commentData = req.body;
        const newComment = await adminService.addCommentToRequest(
            req.params.id, 
            commentData, 
            req.user.id
        );
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.COMMENT_ADDED,
            description: `Added comment to request ${req.params.id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
            newValue: newComment
        });
        
        res.status(201).json({ success: true, data: newComment });
    } catch (err) {
        if (err.message === 'Request not found') {
            return sendErrorResponse(res, 404, 'Request not found.');
        }
        if (err.message === 'Comment message is required') {
            return sendErrorResponse(res, 400, 'Comment message is required.');
        }
        sendErrorResponse(res, 400, 'Failed to add comment to request.', err);
    }
};

// === Vendor Management ===

/**
 * @desc    Get all vendors (admin view)
 * @route   GET /api/admin/vendors
 * @access  Private/Admin
 */
exports.getAllVendors = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, service, search } = req.query;
        const filters = { status, service, search };
        
        const result = await adminService.getAllVendors(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all vendors',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Vendor,
            newValue: { filters, count: result.vendors.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.vendors 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch vendors.', err);
    }
};

/**
 * @desc    Get a single vendor by ID (admin view)
 * @route   GET /api/admin/vendors/:id
 * @access  Private/Admin
 */
exports.getVendorById = async (req, res) => {
    try {
        const vendor = await adminService.getVendorById(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed vendor ${vendor.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Vendor,
            newValue: vendor
        });
        
        res.status(200).json({ success: true, data: vendor });
    } catch (err) {
        if (err.message === 'Vendor not found') {
            return sendErrorResponse(res, 404, 'Vendor not found.');
        }
        sendErrorResponse(res, 500, 'Failed to fetch vendor details.', err);
    }
};

/**
 * @desc    Create a new vendor
 * @route   POST /api/admin/vendors
 * @access  Private/Admin
 */
exports.createVendor = async (req, res) => {
    try {
        const vendorData = req.body;
        const newVendor = await adminService.createVendor(vendorData, req.user.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.VENDOR_CREATED,
            description: `Created vendor ${newVendor.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Vendor,
            newValue: newVendor
        });
        
        res.status(201).json({ success: true, data: newVendor });
    } catch (err) {
        sendErrorResponse(res, 400, 'Failed to create vendor.', err);
    }
};

/**
 * @desc    Update an existing vendor
 * @route   PUT /api/admin/vendors/:id
 * @access  Private/Admin
 */
exports.updateVendor = async (req, res) => {
    try {
        const vendorId = req.params.id;
        const updates = req.body;
        
        const vendor = await adminService.updateVendor(vendorId, updates);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.VENDOR_UPDATED,
            description: `Updated vendor ${vendor.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Vendor,
            newValue: vendor
        });
        
        res.status(200).json({ success: true, data: vendor });
    } catch (err) {
        if (err.message === 'Vendor not found') {
            return sendErrorResponse(res, 404, 'Vendor not found.');
        }
        sendErrorResponse(res, 400, 'Failed to update vendor.', err);
    }
};

/**
 * @desc    Deactivate a vendor
 * @route   PUT /api/admin/vendors/:id/deactivate
 * @access  Private/Admin
 */
exports.deactivateVendor = async (req, res) => {
    try {
        const vendor = await adminService.deactivateVendor(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.VENDOR_DEACTIVATED,
            description: `Deactivated vendor ${vendor.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Vendor,
            newValue: vendor
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Vendor deactivated successfully.', 
            data: vendor 
        });
    } catch (err) {
        if (err.message === 'Vendor not found') {
            return sendErrorResponse(res, 404, 'Vendor not found.');
        }
        if (err.message === 'Vendor is already inactive') {
            return sendErrorResponse(res, 400, 'Vendor is already inactive.');
        }
        sendErrorResponse(res, 500, 'Failed to deactivate vendor.', err);
    }
};

// src/controllers/adminController.js (continuing from where we left off)

/**
 * @desc    Get all invites (admin view)
 * @route   GET /api/admin/invites
 * @access  Private/Admin
 */
exports.getAllInvites = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, role, search } = req.query;
        const filters = { status, role, search };
        
        const result = await adminService.getAllInvites(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all invites',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
            newValue: { filters, count: result.invites.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.invites 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch invites.', err);
    }
};

/**
 * @desc    Get a single invite by ID (admin view)
 * @route   GET /api/admin/invites/:id
 * @access  Private/Admin
 */
exports.getInviteById = async (req, res) => {
    try {
        const invite = await adminService.getInviteById(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed invite ${invite._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
            newValue: invite
        });
        
        res.status(200).json({ success: true, data: invite });
    } catch (err) {
        if (err.message === 'Invite not found') {
            return sendErrorResponse(res, 404, 'Invite not found.');
        }
        sendErrorResponse(res, 500, 'Failed to fetch invite details.', err);
    }
};

/**
 * @desc    Create and send a new invite
 * @route   POST /api/admin/invites
 * @access  Private/Admin
 */
exports.createInvite = async (req, res) => {
    try {
        const inviteData = req.body;
        const result = await adminService.createInvite(inviteData, req.user.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.INVITE_SENT,
            description: `Sent invite to ${inviteData.email} for role ${inviteData.role}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
            newValue: result.invite
        });
        
        res.status(201).json({ 
            success: true, 
            message: 'Invitation sent successfully.', 
            data: result.invite 
        });
    } catch (err) {
        if (err.message.includes('required') || err.message.includes('already exists')) {
            return sendErrorResponse(res, 400, err.message);
        }
        sendErrorResponse(res, 400, 'Failed to create and send invite.', err);
    }
};

/**
 * @desc    Resend an existing invite
 * @route   POST /api/admin/invites/:id/resend
 * @access  Private/Admin
 */
exports.resendInvite = async (req, res) => {
    try {
        const result = await adminService.resendInvite(req.params.id, req.user.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.INVITE_SENT,
            description: `Resent invite to ${result.invite.email} for role ${result.invite.role}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
            newValue: result.invite
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Invitation resent successfully.', 
            data: result.invite 
        });
    } catch (err) {
        if (err.message === 'Invite not found') {
            return sendErrorResponse(res, 404, 'Invite not found.');
        }
        if (err.message.includes('status is')) {
            return sendErrorResponse(res, 400, err.message);
        }
        sendErrorResponse(res, 500, 'Failed to resend invite.', err);
    }
};

/**
 * @desc    Revoke an invite
 * @route   PUT /api/admin/invites/:id/revoke
 * @access  Private/Admin
 */
exports.revokeInvite = async (req, res) => {
    try {
        const invite = await adminService.revokeInvite(req.params.id, req.user.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.INVITE_REVOKED,
            description: `Revoked invite to ${invite.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
            newValue: invite
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Invitation revoked successfully.', 
            data: invite 
        });
    } catch (err) {
        if (err.message === 'Invite not found') {
            return sendErrorResponse(res, 404, 'Invite not found.');
        }
        if (err.message.includes('already')) {
            return sendErrorResponse(res, 400, err.message);
        }
        sendErrorResponse(res, 500, 'Failed to revoke invite.', err);
    }
};

/**
 * @desc    Get all audit logs
 * @route   GET /api/admin/audit-logs
 * @access  Private/Admin
 */
exports.getAuditLogs = async (req, res) => {
    try {
        const { page = 1, limit = 20, userId, action, resourceType, status, search } = req.query;
        const filters = { userId, action, resourceType, status, search };
        
        const result = await adminService.getAuditLogs(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed audit logs',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.System,
            newValue: { filters, count: result.auditLogs.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.auditLogs 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch audit logs.', err);
    }
};

/**
 * @desc    Get system health summary (basic checks)
 * @route   GET /api/admin/system-health
 * @access  Private/Admin
 */
exports.getSystemHealthSummary = async (req, res) => {
    try {
        const health = await adminService.getSystemHealth();
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SYSTEM_EVENT,
            description: 'Accessed system health summary',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.System,
            newValue: health
        });
        
        res.status(200).json({ success: true, data: health });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch system health summary.', err);
    }
};

/**
 * @desc    Send a system-wide broadcast notification
 * @route   POST /api/admin/notifications/broadcast
 * @access  Private/Admin
 */
exports.sendSystemBroadcastNotification = async (req, res) => {
    try {
        const notificationData = req.body;
        
        if (!notificationData.message) {
            return sendErrorResponse(res, 400, 'Broadcast message is required.');
        }
        
        const result = await adminService.sendBroadcastNotification(notificationData, req.user.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.BROADCAST_NOTIFICATION_SENT,
            description: `Sent system broadcast: ${notificationData.message.substring(0, 100)}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.System,
            newValue: { 
                message: notificationData.message, 
                sentToCount: result.totalUsers,
                successCount: result.successCount,
                failedCount: result.failedCount
            }
        });
        
        res.status(200).json({ 
            success: true, 
            message: `Broadcast notification sent to ${result.successCount} users (${result.failedCount} failed).`,
            data: result
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to send broadcast notification.', err);
    }
};

/**
 * @desc    List all media files (admin view)
 * @route   GET /api/admin/media
 * @access  Private/Admin
 */
exports.getAllMedia = async (req, res) => {
    try {
        const { page = 1, limit = 10, relatedTo, relatedId, uploadedBy, mimeType, search } = req.query;
        const filters = { relatedTo, relatedId, uploadedBy, mimeType, search };
        
        const result = await adminService.getAllMedia(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all media files',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Media,
            newValue: { filters, count: result.mediaFiles.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.mediaFiles 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch media files.', err);
    }
};

/**
 * @desc    Get media storage statistics
 * @route   GET /api/admin/media/stats
 * @access  Private/Admin
 */
exports.getMediaStorageStats = async (req, res) => {
    try {
        const stats = await adminService.getMediaStorageStats();
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SYSTEM_EVENT,
            description: 'Accessed media storage stats',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Media,
            newValue: stats
        });
        
        res.status(200).json({ success: true, data: stats });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch media storage stats.', err);
    }
};

/**
 * @desc    Delete a media file (from storage and DB)
 * @route   DELETE /api/admin/media/:id
 * @access  Private/Admin
 */
exports.deleteMedia = async (req, res) => {
    try {
        const mediaId = req.params.id;
        
        await adminService.deleteMedia(mediaId);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.DELETE,
            description: `Deleted media file with ID: ${mediaId}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Media
        });
        
        res.status(200).json({ success: true, message: 'Media file deleted successfully.' });
    } catch (err) {
        if (err.message === 'Media file not found') {
            return sendErrorResponse(res, 404, 'Media file not found.');
        }
        sendErrorResponse(res, 500, 'Failed to delete media file.', err);
    }
};

/**
 * @desc    Get all leases (admin view)
 * @route   GET /api/admin/leases
 * @access  Private/Admin
 */
exports.getAllLeases = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, propertyId, tenantId, search } = req.query;
        const filters = { status, propertyId, tenantId, search };
        
        const result = await adminService.getAllLeases(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all leases',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            newValue: { filters, count: result.leases.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.leases 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch leases.', err);
    }
};

/**
 * @desc    Get a single lease by ID (admin view)
 * @route   GET /api/admin/leases/:id
 * @access  Private/Admin
 */
exports.getLeaseById = async (req, res) => {
    try {
        const lease = await adminService.getLeaseById(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed lease ${lease._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            newValue: lease
        });
        
        res.status(200).json({ success: true, data: lease });
    } catch (err) {
        if (err.message === 'Lease not found') {
            return sendErrorResponse(res, 404, 'Lease not found.');
        }
        sendErrorResponse(res, 500, 'Failed to fetch lease details.', err);
    }
};

/**
 * @desc    Create a new lease
 * @route   POST /api/admin/leases
 * @access  Private/Admin
 */
exports.createLease = async (req, res) => {
    try {
        const leaseData = req.body;
        const newLease = await adminService.createLease(leaseData);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.LEASE_CREATED,
            description: `Created new lease for tenant ID ${leaseData.tenant} on property ID ${leaseData.property}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            newValue: newLease
        });
        
        res.status(201).json({ success: true, data: newLease });
    } catch (err) {
        if (err.message.includes('not found')) {
            return sendErrorResponse(res, 404, err.message);
        }
        sendErrorResponse(res, 400, 'Failed to create lease.', err);
    }
};

/**
 * @desc    Update an existing lease
 * @route   PUT /api/admin/leases/:id
 * @access  Private/Admin
 */
exports.updateLease = async (req, res) => {
    try {
        const leaseId = req.params.id;
        const updateData = req.body;
        
        const lease = await adminService.updateLease(leaseId, updateData);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.LEASE_UPDATED,
            description: `Updated lease ${lease._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            newValue: lease
        });
        
        res.status(200).json({ success: true, data: lease });
    } catch (err) {
        if (err.message === 'Lease not found') {
            return sendErrorResponse(res, 404, 'Lease not found.');
        }
        sendErrorResponse(res, 400, 'Failed to update lease.', err);
    }
};

/**
 * @desc    Terminate a lease
 * @route   PUT /api/admin/leases/:id/terminate
 * @access  Private/Admin
 */
exports.terminateLease = async (req, res) => {
    try {
        const lease = await adminService.terminateLease(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.LEASE_UPDATED,
            description: `Terminated lease ${lease._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            newValue: lease
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Lease terminated successfully.', 
            data: lease 
        });
    } catch (err) {
        if (err.message === 'Lease not found') {
            return sendErrorResponse(res, 404, 'Lease not found.');
        }
        if (err.message === 'Lease is already terminated') {
            return sendErrorResponse(res, 400, 'Lease is already terminated.');
        }
        sendErrorResponse(res, 500, 'Failed to terminate lease.', err);
    }
};

/**
 * @desc    Get all rent records (admin view)
 * @route   GET /api/admin/rents
 * @access  Private/Admin
 */
exports.getAllRents = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, tenantId, propertyId, unitId, dueDateBefore, dueDateAfter } = req.query;
        const filters = { status, tenantId, propertyId, unitId, dueDateBefore, dueDateAfter };
        
        const result = await adminService.getAllRents(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all rent records',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
            newValue: { filters, count: result.rents.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.rents 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch rent records.', err);
    }
};

/**
 * @desc    Get a single rent record by ID (admin view)
 * @route   GET /api/admin/rents/:id
 * @access  Private/Admin
 */
exports.getRentById = async (req, res) => {
    try {
        const rent = await adminService.getRentById(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed rent record ${rent._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
            newValue: rent
        });
        
        res.status(200).json({ success: true, data: rent });
    } catch (err) {
        if (err.message === 'Rent record not found') {
            return sendErrorResponse(res, 404, 'Rent record not found.');
        }
        sendErrorResponse(res, 500, 'Failed to fetch rent record details.', err);
    }
};

/**
 * @desc    Record a new rent payment
 * @route   POST /api/admin/rents
 * @access  Private/Admin
 */
exports.recordRentPayment = async (req, res) => {
    try {
        const rentData = req.body;
        const newRent = await adminService.recordRentPayment(rentData);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.BILL_PAID,
            description: `Recorded rent payment for lease ${rentData.lease}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
            newValue: newRent
        });
        
        res.status(201).json({ success: true, data: newRent });
    } catch (err) {
        if (err.message === 'Missing required fields for rent payment') {
            return sendErrorResponse(res, 400, 'Missing required fields for rent payment.');
        }
        sendErrorResponse(res, 400, 'Failed to record rent payment.', err);
    }
};

/**
 * @desc    Update an existing rent payment record
 * @route   PUT /api/admin/rents/:id
 * @access  Private/Admin
 */
exports.updateRentPayment = async (req, res) => {
    try {
        const rentId = req.params.id;
        const updateData = req.body;
        
        const rent = await adminService.updateRentPayment(rentId, updateData);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.BILL_UPDATED,
            description: `Updated rent payment ${rent._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
            newValue: rent
        });
        
        res.status(200).json({ success: true, data: rent });
    } catch (err) {
        if (err.message === 'Rent record not found') {
            return sendErrorResponse(res, 404, 'Rent record not found.');
        }
        sendErrorResponse(res, 400, 'Failed to update rent payment.', err);
    }
};

/**
 * @desc    Get all scheduled maintenances (admin view)
 * @route   GET /api/admin/scheduled-maintenances
 * @access  Private/Admin
 */
exports.getAllScheduledMaintenances = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, category, propertyId, unitId, recurring, search } = req.query;
        const filters = { 
            status, 
            category, 
            propertyId, 
            unitId, 
            recurring: recurring === 'true' ? true : recurring === 'false' ? false : undefined, 
            search 
        };
        
        const result = await adminService.getAllScheduledMaintenances(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all scheduled maintenances',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            newValue: { filters, count: result.scheduledMaintenances.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.scheduledMaintenances 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch scheduled maintenances.', err);
    }
};

/**
 * @desc    Get a single scheduled maintenance by ID (admin view)
 * @route   GET /api/admin/scheduled-maintenances/:id
 * @access  Private/Admin
 */
exports.getScheduledMaintenanceById = async (req, res) => {
    try {
        const maintenance = await adminService.getScheduledMaintenanceById(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed scheduled maintenance ${maintenance._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            newValue: maintenance
        });
        
        res.status(200).json({ success: true, data: maintenance });
    } catch (err) {
        if (err.message === 'Scheduled maintenance not found') {
            return sendErrorResponse(res, 404, 'Scheduled maintenance not found.');
        }
        sendErrorResponse(res, 500, 'Failed to fetch scheduled maintenance details.', err);
    }
};

/**
 * @desc    Create a new scheduled maintenance
 * @route   POST /api/admin/scheduled-maintenances
 * @access  Private/Admin
 */
exports.createScheduledMaintenance = async (req, res) => {
    try {
        const maintenanceData = req.body;
        const newMaintenance = await adminService.createScheduledMaintenance(maintenanceData, req.user.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SCHEDULED_MAINTENANCE_CREATED,
            description: `Created scheduled maintenance: ${newMaintenance.title}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            newValue: newMaintenance
        });
        
        res.status(201).json({ success: true, data: newMaintenance });
    } catch (err) {
        if (err.message.includes('not found')) {
            return sendErrorResponse(res, 404, err.message);
        }
        sendErrorResponse(res, 400, 'Failed to create scheduled maintenance.', err);
    }
};

/**
 * @desc    Update an existing scheduled maintenance
 * @route   PUT /api/admin/scheduled-maintenances/:id
 * @access  Private/Admin
 */
exports.updateScheduledMaintenance = async (req, res) => {
    try {
        const maintenanceId = req.params.id;
        const updateData = req.body;
        
        const maintenance = await adminService.updateScheduledMaintenance(maintenanceId, updateData);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SCHEDULED_MAINTENANCE_UPDATED,
            description: `Updated scheduled maintenance ${maintenance.title}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            newValue: maintenance
        });
        
        res.status(200).json({ success: true, data: maintenance });
    } catch (err) {
        if (err.message === 'Scheduled maintenance not found') {
            return sendErrorResponse(res, 404, 'Scheduled maintenance not found.');
        }
        sendErrorResponse(res, 400, 'Failed to update scheduled maintenance.', err);
    }
};

/**
 * @desc    Pause a scheduled maintenance
 * @route   PUT /api/admin/scheduled-maintenances/:id/pause
 * @access  Private/Admin
 */
exports.pauseScheduledMaintenance = async (req, res) => {
    try {
        const maintenance = await adminService.pauseScheduledMaintenance(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SCHEDULED_MAINTENANCE_PAUSED,
            description: `Paused scheduled maintenance: ${maintenance.title}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            newValue: maintenance
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Scheduled maintenance paused.', 
            data: maintenance 
        });
    } catch (err) {
        if (err.message === 'Scheduled maintenance not found') {
            return sendErrorResponse(res, 404, 'Scheduled maintenance not found.');
        }
        if (err.message === 'Scheduled maintenance is already paused') {
            return sendErrorResponse(res, 400, 'Scheduled maintenance is already paused.');
        }
        sendErrorResponse(res, 500, 'Failed to pause scheduled maintenance.', err);
    }
};

/**
 * @desc    Resume a scheduled maintenance
 * @route   PUT /api/admin/scheduled-maintenances/:id/resume
 * @access  Private/Admin
 */
exports.resumeScheduledMaintenance = async (req, res) => {
    try {
        const maintenance = await adminService.resumeScheduledMaintenance(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SCHEDULED_MAINTENANCE_RESUMED,
            description: `Resumed scheduled maintenance: ${maintenance.title}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            newValue: maintenance
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Scheduled maintenance resumed.', 
            data: maintenance 
        });
    } catch (err) {
        if (err.message === 'Scheduled maintenance not found') {
            return sendErrorResponse(res, 404, 'Scheduled maintenance not found.');
        }
        if (err.message === 'Scheduled maintenance is already active') {
            return sendErrorResponse(res, 400, 'Scheduled maintenance is already active.');
        }
        sendErrorResponse(res, 500, 'Failed to resume scheduled maintenance.', err);
    }
};

/**
 * @desc    Get all PropertyUser associations
 * @route   GET /api/admin/property-users
 * @access  Private/Admin
 */
exports.getAllPropertyUsers = async (req, res) => {
    try {
        const { page = 1, limit = 10, userId, propertyId, unitId, role, isActive, search } = req.query;
        const filters = { 
            userId, 
            propertyId, 
            unitId, 
            role, 
            isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined, 
            search 
        };
        
        const result = await adminService.getAllPropertyUsers(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all property user associations',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            newValue: { filters, count: result.propertyUsers.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.propertyUsers 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch property user associations.', err);
    }
};

/**
 * @desc    Get a single PropertyUser association by ID
 * @route   GET /api/admin/property-users/:id
 * @access  Private/Admin
 */
exports.getPropertyUserById = async (req, res) => {
    try {
        const propertyUser = await adminService.getPropertyUserById(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed property user association ${propertyUser._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            newValue: propertyUser
        });
        
        res.status(200).json({ success: true, data: propertyUser });
    } catch (err) {
        if (err.message === 'Property user association not found') {
            return sendErrorResponse(res, 404, 'Property user association not found.');
        }
        sendErrorResponse(res, 500, 'Failed to fetch property user association details.', err);
    }
};

/**
 * @desc    Create a new PropertyUser association
 * @route   POST /api/admin/property-users
 * @access  Private/Admin
 */
exports.createPropertyUser = async (req, res) => {
    try {
        const associationData = req.body;
        const newAssociation = await adminService.createPropertyUser(associationData, req.user.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PROPERTY_USER_ASSOCIATION_CREATED,
            description: `Created new property user association for user ID ${associationData.user} on property ID ${associationData.property}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            newValue: newAssociation
        });
        
        res.status(201).json({ success: true, data: newAssociation });
    } catch (err) {
        if (err.message.includes('not found')) {
            return sendErrorResponse(res, 404, err.message);
        }
        if (err.message.includes('required') || err.message.includes('invalid')) {
            return sendErrorResponse(res, 400, err.message);
        }
        sendErrorResponse(res, 400, 'Failed to create property user association.', err);
    }
};

/**
 * @desc    Update an existing PropertyUser association
 * @route   PUT /api/admin/property-users/:id
 * @access  Private/Admin
 */
exports.updatePropertyUser = async (req, res) => {
    try {
        const associationId = req.params.id;
        const updateData = req.body;
        
        const propertyUser = await adminService.updatePropertyUser(associationId, updateData);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PROPERTY_USER_ASSOCIATION_UPDATED,
            description: `Updated property user association ${propertyUser._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            newValue: propertyUser
        });
        
        res.status(200).json({ success: true, data: propertyUser });
    } catch (err) {
        if (err.message === 'Property user association not found') {
            return sendErrorResponse(res, 404, 'Property user association not found.');
        }
        if (err.message.includes('must be') || err.message.includes('invalid')) {
            return sendErrorResponse(res, 400, err.message);
        }
        sendErrorResponse(res, 400, 'Failed to update property user association.', err);
    }
};

/**
 * @desc    Deactivate a PropertyUser association
 * @route   PUT /api/admin/property-users/:id/deactivate
 * @access  Private/Admin
 */
exports.deactivatePropertyUser = async (req, res) => {
    try {
        const propertyUser = await adminService.deactivatePropertyUser(req.params.id);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PROPERTY_USER_ASSOCIATION_DEACTIVATED,
            description: `Deactivated property user association ${propertyUser._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            newValue: propertyUser
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Property user association deactivated successfully.', 
            data: propertyUser 
        });
    } catch (err) {
        if (err.message === 'Property user association not found') {
            return sendErrorResponse(res, 404, 'Property user association not found.');
        }
        if (err.message === 'Property user association is already inactive') {
            return sendErrorResponse(res, 400, 'Property user association is already inactive.');
        }
        sendErrorResponse(res, 500, 'Failed to deactivate property user association.', err);
    }
};

/**
 * @desc    Get all comments (admin view)
 * @route   GET /api/admin/comments
 * @access  Private/Admin
 */
exports.getAllComments = async (req, res) => {
    try {
        const { page = 1, limit = 10, contextType, contextId, senderId, isInternalNote, search } = req.query;
        const filters = { 
            contextType, 
            contextId, 
            senderId, 
            isInternalNote: isInternalNote === 'true' ? true : isInternalNote === 'false' ? false : undefined, 
            search 
        };
        
        const result = await adminService.getAllComments(filters, page, limit);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all comments',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
            newValue: { filters, count: result.comments.length }
        });
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            total: result.total, 
            page: result.page, 
            limit: result.limit, 
            data: result.comments 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch comments.', err);
    }
};

/**
 * @desc    Delete a comment
 * @route   DELETE /api/admin/comments/:id
 * @access  Private/Admin
 */
exports.deleteComment = async (req, res) => {
    try {
        const commentId = req.params.id;
        
        await adminService.deleteComment(commentId);
        
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.DELETE,
            description: `Deleted comment ${commentId}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment
        });
        
        res.status(200).json({ success: true, message: 'Comment deleted successfully.' });
    } catch (err) {
        if (err.message === 'Comment not found') {
            return sendErrorResponse(res, 404, 'Comment not found.');
        }
        sendErrorResponse(res, 500, 'Failed to delete comment.', err);
    }
};

/**
 * @desc    Get currently active users (admin)
 * @route   GET /api/admin/users/active
 * @access  Private/Admin
 */
exports.getCurrentlyActiveUsers = async (req, res) => {
    try {
        const minutesThreshold = parseInt(req.query.minutes) || 15;
        const result = await adminService.getCurrentlyActiveUsers(minutesThreshold);
        
        res.status(200).json({ 
            success: true, 
            count: result.count, 
            data: result.users 
        });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch active users.', err);
    }
};