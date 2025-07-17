// server/controllers/admin.controller.js

// Import all models from the central index file
const {
  User,
  Property,
  Unit,
  Vendor,
  Request,
  Lease,
  Rent,
  ScheduledMaintenance,
  Invite,
  Comment,
  Media,
  AuditLog,
  PropertyUser,
  // Ensure all models you intend to use are destructured here
} = require('../models'); // <-- Updated path!

// Import ENUMs from the central enums file
const {
  ROLE_ENUM,
  SERVICE_ENUM,
  REQUEST_STATUS_ENUM,
  PAYMENT_STATUS_ENUM,
  LEASE_STATUS_ENUM,
  INVITE_STATUS_ENUM,
  AUDIT_ACTION_ENUM,
  AUDIT_RESOURCE_TYPE_ENUM,
  UNIT_STATUS_ENUM,
  FREQUENCY_TYPE_ENUM,
  PROPERTY_USER_ROLES_ENUM, // Added for property user updates
  REGISTRATION_STATUS_ENUM,
  // ... any other ENUMs you need directly in the controller
} = require('../utils/constants/enums'); // <-- New path!

// Import Services
const emailService = require('../services/emailService'); // <-- New service import
const { uploadFileBuffer, deleteFile, getFileUrl } = require('../services/cloudStorageService'); // <-- New Cloud Storage Service import
const { sendNotification } = require('../services/notificationService'); // <-- New Notification Service import
const authService = require('../services/authService'); // <-- New Auth Service import

// Import Utilities
const { createAuditLog } = require('../services/auditService'); 
const { validateResult, validateUserRegistration, check } = require('../utils/validationUtils'); 
const logger = require('../utils/logger'); // <-- New Logger import
const mongoose = require('mongoose');
const crypto = require('crypto'); // Still needed for some token ops not in authService

// Helper for common error response
const sendErrorResponse = (res, statusCode, message, error = null) => {
    logger.error(`Error ${statusCode}: ${message}`, error);
    res.status(statusCode).json({ success: false, message, error: error ? error.message : null });
};

// ... (Rest of your existing admin.controller.js methods) ...

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
            User.find().sort({ createdAt: -1 }).limit(5).select('firstName lastName email role createdAt'), // Adjusted select for new User model
            Vendor.countDocuments(),
            Invite.countDocuments({ status: 'pending', expiresAt: { $gt: new Date() } }),
            Request.aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } },
                { $project: { status: '$_id', count: 1, _id: 0 } }
            ]),
            User.aggregate([
                { $group: { _id: '$role', count: { $sum: 1 } } },
                { $project: { role: '$_id', count: 1, _id: 0 } }
            ])
        ]);

        const stats = {
            totalUsers,
            totalProperties,
            totalUnits,
            totalRequests,
            totalScheduledMaintenance,
            totalVendors,
            activeInvites,
            recentUsers,
            requestsByStatus: requestsByStatusAgg.reduce((acc, item) => ({ ...acc, [item.status]: item.count }), {}),
            usersByRole: usersByRoleAgg.reduce((acc, item) => ({ ...acc, [item.role]: item.count }), {}),
        };

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
        const adminUser = await User.findById(req.user.id).select('-passwordHash -resetPasswordToken -resetPasswordExpires');
        if (!adminUser) {
            return sendErrorResponse(res, 404, "Admin user not found.");
        }
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
        // Implement pagination, filtering, sorting as needed
        const { page = 1, limit = 10, role, status, search } = req.query;
        const query = {};
        if (role) query.role = role;
        if (status) query.isActive = status === 'active';
        if (search) {
            query.$or = [
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        const users = await User.find(query)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .sort({ createdAt: -1 });

        const totalUsers = await User.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all users',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            newValue: { query, count: users.length }
        });
        res.status(200).json({ success: true, count: users.length, total: totalUsers, page: parseInt(page), limit: parseInt(limit), data: users });
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
        const user = await User.findById(req.params.id);
        if (!user) {
            return sendErrorResponse(res, 404, 'User not found.');
        }
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed user ${user.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            newValue: user
        });
        res.status(200).json({ success: true, data: user });
    } catch (err) {
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
            // No need for explicit validationResult check here, validateResult middleware does it
            const { firstName, lastName, email, phone, password, role } = req.body;

            // Use authService to handle registration logic
            const newUser = await authService.registerUser({
                firstName,
                lastName,
                email,
                phone,
                password,
                role: role || 'tenant' // Default role
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
            sendErrorResponse(res, 400, err.message, err); // Use 400 for validation/business logic errors from service
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
        const { firstName, lastName, phone, email, role, isActive, preferences, registrationStatus } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return sendErrorResponse(res, 404, 'User not found.');
        }

        const oldUser = user.toObject(); // Get old state for audit log

        // Update fields
        if (firstName) user.firstName = firstName;
        if (lastName) user.lastName = lastName;
        if (phone) user.phone = phone;
        if (email && email !== user.email) {
            const emailExists = await User.findOne({ email, _id: { $ne: userId } });
            if (emailExists) {
                return sendErrorResponse(res, 400, 'Email already in use by another user.');
            }
            user.email = email;
        }
        if (role && Object.values(ROLE_ENUM).includes(role)) user.role = role;
        if (typeof isActive === 'boolean') user.isActive = isActive;
        if (preferences) user.preferences = { ...user.preferences, ...preferences };
        if (registrationStatus && Object.values(REGISTRATION_STATUS_ENUM).includes(registrationStatus)) user.registrationStatus = registrationStatus;

        await user.save({ validateBeforeSave: true }); // Validate on save

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.USER_UPDATED,
            description: `Updated user ${user.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            oldValue: oldUser,
            newValue: user
        });
        res.status(200).json({ success: true, data: user });
    } catch (err) {
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
        const user = await User.findById(req.params.id);
        if (!user) {
            return sendErrorResponse(res, 404, 'User not found.');
        }
        if (!user.isActive) {
            return sendErrorResponse(res, 400, 'User is already deactivated.');
        }

        const oldState = user.toObject();
        user.isActive = false;
        user.registrationStatus = 'deactivated';
        await user.save();

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.USER_DEACTIVATED,
            description: `Deactivated user ${user.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            oldValue: oldState,
            newValue: user
        });
        res.status(200).json({ success: true, message: 'User deactivated successfully.', data: user });
    } catch (err) {
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
        const user = await User.findById(req.params.id);
        if (!user) {
            return sendErrorResponse(res, 404, 'User not found.');
        }
        if (user.isActive) {
            return sendErrorResponse(res, 400, 'User is already active.');
        }

        const oldState = user.toObject();
        user.isActive = true;
        // If reactivating, set status to active or pending_admin_approval if it was deactivated before approval
        if (user.registrationStatus === 'deactivated' && oldState.registrationStatus === 'pending_admin_approval') {
            user.registrationStatus = 'pending_admin_approval';
        } else if (user.registrationStatus === 'deactivated') {
            user.registrationStatus = 'active';
        }
        await user.save();

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.USER_UPDATED,
            description: `Activated user ${user.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            oldValue: oldState,
            newValue: user
        });
        res.status(200).json({ success: true, message: 'User activated successfully.', data: user });
    } catch (err) {
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
        const user = await User.findById(req.params.id);
        if (!user) {
            return sendErrorResponse(res, 404, 'User not found.');
        }

        if (user.registrationStatus === 'active') {
            return sendErrorResponse(res, 400, 'User is already active and approved.');
        }
        if (user.registrationStatus !== 'pending_admin_approval') {
            return sendErrorResponse(res, 400, `User status is '${user.registrationStatus}'. Only 'pending_admin_approval' can be approved.`);
        }

        const oldState = user.toObject();
        user.registrationStatus = 'active';
        user.isActive = true; // Ensure active
        await user.save();

        // Send a notification to the user about their approval
        await sendNotification({
            recipientId: user._id,
            type: 'user_approved',
            message: `Your account for Property Management System has been approved by an administrator. You can now fully access all features.`,
            link: '/dashboard', // Link to user dashboard
            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            relatedResourceId: user._id,
            emailDetails: {
                subject: 'Your Account Has Been Approved!',
                html: `<p>Dear ${user.firstName},</p><p>Your account for Property Management System has been approved by an administrator. You can now fully access all features.</p><p>Click <a href="${process.env.FRONTEND_URL}/dashboard">here</a> to login.</p><p>Thank you,</p><p>The Property Management Team</p>`
            }
        });


        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.USER_APPROVED,
            description: `Approved user ${user.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            oldValue: oldState,
            newValue: user
        });
        res.status(200).json({ success: true, message: 'User approved and activated successfully.', data: user });
    } catch (err) {
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

    // Basic validation for new password
    const validationErrors = validateResult(req); // Need to define check in route or here for simplicity
    if (!newPassword || newPassword.length < 8) { // Basic check, better to use express-validator here
        return sendErrorResponse(res, 400, 'New password must be at least 8 characters long.');
    }

    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return sendErrorResponse(res, 404, 'User not found.');
        }

        const oldUser = user.toObject();
        user.passwordHash = newPassword; // Pre-save hook will hash this
        await user.save();

        // Send notification to user about password change
        await sendNotification({
            recipientId: user._id,
            type: 'password_reset',
            message: 'Your password has been reset by an administrator. If this was unexpected, please contact support immediately.',
            link: '/login',
            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            relatedResourceId: user._id,
            emailDetails: {
                subject: 'Your Password Has Been Reset by Administrator',
                html: `<p>Dear ${user.firstName},</p><p>Your password for Property Management System has been reset by an administrator.</p><p>If you did not request or authorize this change, please contact support immediately.</p><p>Click <a href="${process.env.FRONTEND_URL}/login">here</a> to login with your new password.</p><p>Thank you,</p><p>The Property Management Team</p>`
            }
        });

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PASSWORD_RESET,
            description: `Admin reset password for user ${user.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            oldValue: oldUser,
            newValue: user
        });
        res.status(200).json({ success: true, message: 'User password reset successfully.' });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to reset user password.', err);
    }
};


// === Property & Unit Management (admin View) ===

/**
 * @desc    Get all properties (admin view)
 * @route   GET /api/admin/properties
 * @access  Private/Admin
 */
exports.getAllProperties = async (req, res) => {
    try {
        const { page = 1, limit = 10, search, type, isActive } = req.query;
        const query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { 'address.city': { $regex: search, $options: 'i' } },
                { 'address.street': { $regex: search, $options: 'i' } }
            ];
        }
        if (type) query.propertyType = type;
        if (typeof isActive === 'boolean') query.isActive = isActive;

        const properties = await Property.find(query)
            .populate('mainContactUser', 'firstName lastName email')
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const totalProperties = await Property.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all properties',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
            newValue: { query, count: properties.length }
        });
        res.status(200).json({ success: true, count: properties.length, total: totalProperties, page: parseInt(page), limit: parseInt(limit), data: properties });
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
        const property = await Property.findById(req.params.id)
            .populate('mainContactUser', 'firstName lastName email')
            .populate('units'); // Populate units related to property
        if (!property) {
            return sendErrorResponse(res, 404, 'Property not found.');
        }
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed property ${property.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
            newValue: property
        });
        res.status(200).json({ success: true, data: property });
    } catch (err) {
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
        const { name, address, propertyType, yearBuilt, details, amenities, mainContactUser } = req.body;

        const newProperty = await Property.create({
            name,
            address,
            propertyType,
            yearBuilt,
            details,
            amenities,
            createdBy: req.user.id,
            mainContactUser: mainContactUser || req.user.id // Default to creator if not specified
        });

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

        const property = await Property.findById(propertyId);
        if (!property) {
            return sendErrorResponse(res, 404, 'Property not found.');
        }

        const oldProperty = property.toObject();

        Object.assign(property, updates); // Apply updates

        await property.save({ validateBeforeSave: true }); // Validate on save

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PROPERTY_UPDATED,
            description: `Updated property ${property.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
            oldValue: oldProperty,
            newValue: property
        });
        res.status(200).json({ success: true, data: property });
    } catch (err) {
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
        const property = await Property.findById(req.params.id);
        if (!property) {
            return sendErrorResponse(res, 404, 'Property not found.');
        }
        if (!property.isActive) {
            return sendErrorResponse(res, 400, 'Property is already deactivated.');
        }

        const oldState = property.toObject();
        property.isActive = false;
        await property.save();

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PROPERTY_DEACTIVATED,
            description: `Deactivated property ${property.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
            oldValue: oldState,
            newValue: property
        });
        res.status(200).json({ success: true, message: 'Property deactivated successfully.', data: property });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to deactivate property.', err);
    }
};


/**
 * @desc    Get all units (admin view) - can filter by propertyId
 * @route   GET /api/admin/units?propertyId=<id>
 * @access  Private/Admin
 */
exports.getAllUnits = async (req, res) => {
    try {
        const { page = 1, limit = 10, propertyId, status, search } = req.query;
        const query = {};
        if (propertyId) query.property = propertyId;
        if (status) query.status = status;
        if (search) {
            query.$or = [
                { unitName: { $regex: search, $options: 'i' } },
                { details: { $regex: search, $options: 'i' } }
            ];
        }

        const units = await Unit.find(query)
            .populate('property', 'name address')
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const totalUnits = await Unit.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed all units (filtered by property: ${propertyId})`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
            newValue: { query, count: units.length }
        });
        res.status(200).json({ success: true, count: units.length, total: totalUnits, page: parseInt(page), limit: parseInt(limit), data: units });
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
        const unit = await Unit.findById(req.params.id)
            .populate('property', 'name address');
        if (!unit) {
            return sendErrorResponse(res, 404, 'Unit not found.');
        }
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed unit ${unit.unitName}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
            newValue: unit
        });
        res.status(200).json({ success: true, data: unit });
    } catch (err) {
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
        const { unitName, property, floor, details, numBedrooms, numBathrooms, squareFootage, rentAmount, depositAmount, status, utilityResponsibility, notes, lastInspected } = req.body;

        const propertyExists = await Property.findById(property);
        if (!propertyExists) {
            return sendErrorResponse(res, 404, 'Associated property not found.');
        }

        const newUnit = await Unit.create({
            unitName,
            property,
            floor,
            details,
            numBedrooms,
            numBathrooms,
            squareFootage,
            rentAmount,
            depositAmount,
            status: status || UNIT_STATUS_ENUM[0], // Default 'occupied' or 'vacant'
            utilityResponsibility,
            notes,
            lastInspected
        });

        // Add unit to property's units array
        propertyExists.units.push(newUnit._id);
        propertyExists.numberOfUnits = (propertyExists.numberOfUnits || 0) + 1;
        await propertyExists.save();


        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.UNIT_CREATED,
            description: `Created unit ${newUnit.unitName} for property ${propertyExists.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
            newValue: newUnit
        });
        res.status(201).json({ success: true, data: newUnit });
    } catch (err) {
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

        const unit = await Unit.findById(unitId);
        if (!unit) {
            return sendErrorResponse(res, 404, 'Unit not found.');
        }

        const oldUnit = unit.toObject();

        Object.assign(unit, updates); // Apply updates

        await unit.save({ validateBeforeSave: true });

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.UNIT_UPDATED,
            description: `Updated unit ${unit.unitName}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
            oldValue: oldUnit,
            newValue: unit
        });
        res.status(200).json({ success: true, data: unit });
    } catch (err) {
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
        const unit = await Unit.findById(req.params.id);
        if (!unit) {
            return sendErrorResponse(res, 404, 'Unit not found.');
        }
        if (unit.status === 'unavailable') { // Assuming 'unavailable' is the deactivate status for units
            return sendErrorResponse(res, 400, 'Unit is already unavailable.');
        }

        const oldState = unit.toObject();
        unit.status = 'unavailable'; // Set appropriate deactivated status
        await unit.save();

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.UNIT_DEACTIVATED,
            description: `Deactivated unit ${unit.unitName}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
            oldValue: oldState,
            newValue: unit
        });
        res.status(200).json({ success: true, message: 'Unit deactivated successfully.', data: unit });
    } catch (err) {
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
        const query = {};

        if (status) query.status = status;
        if (priority) query.priority = priority;
        if (category) query.category = category;
        if (propertyId) query.property = propertyId;
        if (unitId) query.unit = unitId;
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const requests = await Request.find(query)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('createdBy', 'firstName lastName email')
            .populate('assignedTo', 'firstName lastName email name') // Populate user or vendor
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .sort({ createdAt: -1 });

        const totalRequests = await Request.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all requests',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            newValue: { query, count: requests.length }
        });
        res.status(200).json({ success: true, count: requests.length, total: totalRequests, page: parseInt(page), limit: parseInt(limit), data: requests });
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
        const statusBreakdown = await Request.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $project: { status: '$_id', count: 1, _id: 0 } }
        ]);

        const priorityBreakdown = await Request.aggregate([
            { $group: { _id: '$priority', count: { $sum: 1 } } },
            { $project: { priority: '$_id', count: 1, _id: 0 } }
        ]);

        // Average resolution time (example)
        const avgResolutionTimeResult = await Request.aggregate([
            { $match: { status: 'completed', resolvedAt: { $ne: null }, createdAt: { $ne: null } } },
            {
                $project: {
                    timeDiff: { $subtract: ['$resolvedAt', '$createdAt'] }
                }
            },
            {
                $group: {
                    _id: null,
                    averageTimeMs: { $avg: '$timeDiff' }
                }
            }
        ]);

        const avgResolutionTimeHours = avgResolutionTimeResult.length > 0
            ? (avgResolutionTimeResult[0].averageTimeMs / (1000 * 60 * 60)).toFixed(2)
            : 'N/A';

        const analytics = {
            statusBreakdown: statusBreakdown.reduce((acc, item) => ({ ...acc, [item.status]: item.count }), {}),
            priorityBreakdown: priorityBreakdown.reduce((acc, item) => ({ ...acc, [item.priority]: item.count }), {}),
            averageResolutionTimeHours: avgResolutionTimeHours
        };

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
        const request = await Request.findById(req.params.id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('createdBy', 'firstName lastName email')
            .populate('assignedTo', 'firstName lastName email name') // Populate user or vendor
            .populate({
                path: 'media', // Populate actual Media documents
                select: 'url filename mimeType size description'
            })
            .populate({
                path: 'comments', // Populate actual Comment documents
                populate: { path: 'sender', select: 'firstName lastName email' } // Populate sender of comments
            });

        if (!request) {
            return sendErrorResponse(res, 404, 'Request not found.');
        }
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed request ${request._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            newValue: request
        });
        res.status(200).json({ success: true, data: request });
    } catch (err) {
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
    if (!status || !Object.values(REQUEST_STATUS_ENUM).includes(status)) {
        return sendErrorResponse(res, 400, `Invalid status provided. Must be one of: ${Object.values(REQUEST_STATUS_ENUM).join(', ')}`);
    }

    try {
        const request = await Request.findById(req.params.id);
        if (!request) {
            return sendErrorResponse(res, 404, 'Request not found.');
        }

        const oldStatus = request.status;
        request.status = status;

        if (status === 'completed' || status === 'verified') {
            request.resolvedAt = new Date();
            request.completedBy = req.user.id; // Admin completes it
            request.completedByModel = 'User';
        } else {
            request.resolvedAt = undefined; // Clear if status changes from completed/verified
            request.completedBy = undefined;
            request.completedByModel = undefined;
        }

        await request.save({ validateBeforeSave: true });

        // Send notification about status change
        await sendNotification({
            recipientId: request.createdBy,
            type: 'status_update',
            message: `The status of your request "${request.title}" has been updated to: ${status}.`,
            link: `/requests/${request._id}`,
            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            relatedResourceId: request._id,
            emailDetails: {
                subject: `Request Status Update: ${request.title}`,
                html: `<p>Dear ${req.user.firstName},</p><p>The status of your request <strong>"${request.title}"</strong> has been updated to: <strong>${status}</strong>.</p><p>Click <a href="${process.env.FRONTEND_URL}/requests/${request._id}">here</a> to view details.</p><p>Thank you,</p><p>The Property Management Team</p>`
            }
        });

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.REQUEST_STATUS_UPDATED,
            description: `Request ${request._id} status changed from ${oldStatus} to ${status}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            oldValue: { status: oldStatus },
            newValue: { status: request.status }
        });
        res.status(200).json({ success: true, message: 'Request status updated.', data: request });
    } catch (err) {
        sendErrorResponse(res, 400, 'Failed to update request status.', err);
    }
};

/**
 * @desc    Assign a request to a user or vendor by Admin
 * @route   PUT /api/admin/requests/:id/assign
 * @access  Private/Admin
 */
exports.assignRequest = async (req, res) => {
    const { assignedToId, assignedToModel } = req.body; // assignedToModel: 'User' or 'Vendor'

    if (!assignedToId || !assignedToModel || !['User', 'Vendor'].includes(assignedToModel)) {
        return sendErrorResponse(res, 400, 'Valid assignedToId and assignedToModel (User or Vendor) are required.');
    }

    try {
        const request = await Request.findById(req.params.id);
        if (!request) {
            return sendErrorResponse(res, 404, 'Request not found.');
        }

        let assignedEntity;
        if (assignedToModel === 'User') {
            assignedEntity = await User.findById(assignedToId);
        } else if (assignedToModel === 'Vendor') {
            assignedEntity = await Vendor.findById(assignedToId);
        }

        if (!assignedEntity) {
            return sendErrorResponse(res, 404, `${assignedToModel} not found.`);
        }

        const oldAssignedTo = request.assignedTo ? request.assignedTo.toString() : 'none';
        const oldAssignedToModel = request.assignedToModel || 'none';

        request.assignedTo = assignedToId;
        request.assignedToModel = assignedToModel;
        request.assignedBy = req.user.id;
        request.assignedAt = new Date();
        request.status = 'assigned'; // Update status to assigned

        await request.save({ validateBeforeSave: true });

        // Send notification to the newly assigned entity
        await sendNotification({
            recipientId: assignedToId, // Assuming Vendor can also receive in-app notifications if they have a User account
            type: 'assignment',
            message: `You have been assigned to request: "${request.title}".`,
            link: assignedToModel === 'User' ? `/requests/${request._id}` : `/vendor-requests/${request._id}`,
            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            relatedResourceId: request._id,
            emailDetails: {
                subject: `New Request Assignment: ${request.title}`,
                html: `<p>Dear ${assignedEntity.firstName || assignedEntity.name},</p><p>You have been assigned to a new request: <strong>"${request.title}"</strong>.</p><p>Click <a href="${process.env.FRONTEND_URL}${assignedToModel === 'User' ? `/requests/${request._id}` : `/vendor-requests/${request._id}`}">here</a> to view details.</p><p>Thank you,</p><p>The Property Management Team</p>`
            }
        });


        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.REQUEST_ASSIGNED,
            description: `Request ${request._id} assigned to ${assignedToModel}: ${assignedEntity.email || assignedEntity.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            oldValue: { assignedTo: oldAssignedTo, assignedToModel: oldAssignedToModel },
            newValue: { assignedTo: request.assignedTo, assignedToModel: request.assignedToModel }
        });
        res.status(200).json({ success: true, message: 'Request assigned successfully.', data: request });
    } catch (err) {
        sendErrorResponse(res, 400, 'Failed to assign request.', err);
    }
};

/**
 * @desc    Add a comment to a request (by admin)
 * @route   POST /api/admin/requests/:id/comments
 * @access  Private/Admin
 */
exports.addCommentToRequest = async (req, res) => {
    const { message, isInternalNote, mediaFiles } = req.body; // mediaFiles will be array of objects: { url, filename, mimeType, size, publicId }

    if (!message) {
        return sendErrorResponse(res, 400, 'Comment message is required.');
    }

    try {
        const request = await Request.findById(req.params.id);
        if (!request) {
            return sendErrorResponse(res, 404, 'Request not found.');
        }

        const newComment = await Comment.create({
            contextType: 'Request',
            contextId: request._id,
            sender: req.user.id,
            message,
            isInternalNote: isInternalNote || false,
            // media: [], // Add media references after upload
            // isExternal: false, externalUserName: null, externalUserEmail: null are defaults
        });

        const uploadedMediaIds = [];
        if (mediaFiles && mediaFiles.length > 0) {
             for (const file of mediaFiles) {
                // Assuming mediaFiles contains objects with public_id, url, filename, size, mimeType
                // This means the file has already been uploaded via a separate endpoint/process (e.g., multer + cloudinary upload)
                // If not, you'd need to handle actual file buffer uploads here.
                const mediaDoc = await Media.create({
                    filename: file.filename,
                    originalname: file.originalname || file.filename,
                    mimeType: file.mimeType,
                    size: file.size,
                    url: file.url,
                    thumbnailUrl: file.thumbnailUrl || null,
                    uploadedBy: req.user.id,
                    relatedTo: 'Comment',
                    relatedId: newComment._id,
                    // Assume publicId from Cloudinary is passed if directly using pre-uploaded files
                    // Or you'd perform the upload here:
                    // const uploaded = await uploadFile(file.buffer, file.mimetype, 'comments');
                    // url: uploaded.secure_url, filename: uploaded.public_id, etc.
                });
                uploadedMediaIds.push(mediaDoc._id);
             }
             newComment.media = uploadedMediaIds;
             await newComment.save();
        }

        request.comments.push(newComment._id);
        await request.save();

        // Notify relevant parties (e.g., createdBy user if not an internal note)
        if (!isInternalNote && request.createdBy.toString() !== req.user.id.toString()) {
            await sendNotification({
                recipientId: request.createdBy,
                type: 'new_comment',
                message: `A new comment has been added to your request "${request.title}".`,
                link: `/requests/${request._id}`,
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
                relatedResourceId: newComment._id,
                emailDetails: {
                    subject: `New Comment on Your Request: ${request.title}`,
                    html: `<p>Dear ${req.user.firstName},</p><p>A new comment has been added to your request <strong>"${request.title}"</strong>:</p><p><em>"${message}"</em></p><p>Click <a href="${process.env.FRONTEND_URL}/requests/${request._id}">here</a> to view details.</p><p>Thank you,</p><p>The Property Management Team</p>`
                }
            });
        }

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.COMMENT_ADDED,
            description: `Added comment to request ${request._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
            newValue: newComment
        });
        res.status(201).json({ success: true, data: newComment });
    } catch (err) {
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
        const query = {};
        if (status) query.status = status;
        if (service) query.services = service; // Match any service
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { companyName: { $regex: search, $options: 'i' } }
            ];
        }

        const vendors = await Vendor.find(query)
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .sort({ createdAt: -1 });

        const totalVendors = await Vendor.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all vendors',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Vendor,
            newValue: { query, count: vendors.length }
        });
        res.status(200).json({ success: true, count: vendors.length, total: totalVendors, page: parseInt(page), limit: parseInt(limit), data: vendors });
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
        const vendor = await Vendor.findById(req.params.id)
            .populate('addedBy', 'firstName lastName email');
        if (!vendor) {
            return sendErrorResponse(res, 404, 'Vendor not found.');
        }
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed vendor ${vendor.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Vendor,
            newValue: vendor
        });
        res.status(200).json({ success: true, data: vendor });
    } catch (err) {
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
        const { name, phone, email, address, description, services, contactPerson, fixedCalloutFee, paymentTerms, status, companyName, licenseNumber, insuranceDetails } = req.body;

        const newVendor = await Vendor.create({
            name, phone, email, address, description, services, contactPerson, fixedCalloutFee, paymentTerms,
            status: status || 'active',
            companyName, licenseNumber, insuranceDetails,
            addedBy: req.user.id
        });

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

        const vendor = await Vendor.findById(vendorId);
        if (!vendor) {
            return sendErrorResponse(res, 404, 'Vendor not found.');
        }

        const oldVendor = vendor.toObject();

        Object.assign(vendor, updates);

        await vendor.save({ validateBeforeSave: true });

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.VENDOR_UPDATED,
            description: `Updated vendor ${vendor.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Vendor,
            oldValue: oldVendor,
            newValue: vendor
        });
        res.status(200).json({ success: true, data: vendor });
    } catch (err) {
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
        const vendor = await Vendor.findById(req.params.id);
        if (!vendor) {
            return sendErrorResponse(res, 404, 'Vendor not found.');
        }
        if (vendor.status === 'inactive') {
            return sendErrorResponse(res, 400, 'Vendor is already inactive.');
        }

        const oldState = vendor.toObject();
        vendor.status = 'inactive';
        await vendor.save();

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.VENDOR_DEACTIVATED,
            description: `Deactivated vendor ${vendor.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Vendor,
            oldValue: oldState,
            newValue: vendor
        });
        res.status(200).json({ success: true, message: 'Vendor deactivated successfully.', data: vendor });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to deactivate vendor.', err);
    }
};

// === Invite Management ===

/**
 * @desc    Get all invites (admin view)
 * @route   GET /api/admin/invites
 * @access  Private/Admin
 */
exports.getAllInvites = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, role, search } = req.query;
        const query = {};
        if (status) query.status = status;
        if (role) query.role = role;
        if (search) {
            query.email = { $regex: search, $options: 'i' };
        }

        const invites = await Invite.find(query)
            .populate('generatedBy', 'firstName lastName email')
            .populate('acceptedBy', 'firstName lastName email')
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .sort({ createdAt: -1 });

        const totalInvites = await Invite.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all invites',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
            newValue: { query, count: invites.length }
        });
        res.status(200).json({ success: true, count: invites.length, total: totalInvites, page: parseInt(page), limit: parseInt(limit), data: invites });
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
        const invite = await Invite.findById(req.params.id)
            .populate('generatedBy', 'firstName lastName email')
            .populate('acceptedBy', 'firstName lastName email')
            .populate('property', 'name')
            .populate('unit', 'unitName');
        if (!invite) {
            return sendErrorResponse(res, 404, 'Invite not found.');
        }
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed invite ${invite._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
            newValue: invite
        });
        res.status(200).json({ success: true, data: invite });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch invite details.', err);
    }
};

/**
 * @desc    Create and send a new invite
 * @route   POST /api/admin/invites
 * @access  Private/Admin
 */
exports.createInvite = async (req, res) => {
    const { email, role, propertyId, unitId } = req.body;

    if (!email || !role || !Object.values(PROPERTY_USER_ROLES_ENUM).includes(role)) {
        return sendErrorResponse(res, 400, 'Email and a valid role are required.');
    }

    if (['tenant', 'landlord', 'propertymanager', 'vendor_access'].includes(role) && !propertyId) {
        return sendErrorResponse(res, 400, `Property ID is required for ${role} role invites.`);
    }

    if (role === 'tenant' && !unitId) {
        return sendErrorResponse(res, 400, 'Unit ID is required for tenant role invites.');
    }

    try {
        // Check if user with this email already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return sendErrorResponse(res, 400, `A user with email ${email} already exists.`);
        }

        // Check if an active invite already exists for this email/role/property/unit combo
        const existingInvite = await Invite.findOne({
            email,
            role,
            property: propertyId,
            unit: unitId || null,
            status: 'pending',
            expiresAt: { $gt: Date.now() }
        });

        if (existingInvite) {
            return sendErrorResponse(res, 400, 'An active invitation for this email, role, property, and unit already exists.');
        }

        const token = crypto.randomBytes(20).toString('hex'); // Generate an unhashed token for the URL
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days expiry

        const newInvite = await Invite.create({
            email,
            role,
            property: propertyId,
            unit: unitId || null,
            token: token,
            // hashedToken will be generated by pre-save hook
            generatedBy: req.user.id,
            expiresAt,
            status: 'pending'
        });

        // Construct invitation link
        const inviteLink = `${process.env.FRONTEND_URL}/accept-invite/${token}`;

        // Send invitation email
        await emailService.sendInvitationEmail({
            to: email,
            inviteLink,
            role,
            invitedByUserName: req.user.firstName,
            propertyDisplayName: propertyId ? (await Property.findById(propertyId).select('name')).name : 'the system'
        });

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.INVITE_SENT,
            description: `Sent invite to ${email} for role ${role}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
            newValue: newInvite
        });
        res.status(201).json({ success: true, message: 'Invitation sent successfully.', data: newInvite });

    } catch (err) {
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
        const invite = await Invite.findById(req.params.id);
        if (!invite) {
            return sendErrorResponse(res, 404, 'Invite not found.');
        }
        if (invite.status !== 'pending' && invite.status !== 'expired') {
            return sendErrorResponse(res, 400, `Invite status is ${invite.status}. Only 'pending' or 'expired' invites can be resent.`);
        }

        // Generate a new token and update expiry
        invite.token = crypto.randomBytes(20).toString('hex');
        invite.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // New 7 days expiry
        invite.status = 'pending'; // Ensure status is pending again
        await invite.save();

        const inviteLink = `${process.env.FRONTEND_URL}/accept-invite/${invite.token}`;

        await emailService.sendInvitationEmail({
            to: invite.email,
            inviteLink,
            role: invite.role,
            invitedByUserName: req.user.firstName,
            propertyDisplayName: invite.property ? (await Property.findById(invite.property).select('name')).name : 'the system'
        });

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.INVITE_SENT,
            description: `Resent invite to ${invite.email} for role ${invite.role}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
            newValue: invite
        });
        res.status(200).json({ success: true, message: 'Invitation resent successfully.', data: invite });
    } catch (err) {
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
        const invite = await Invite.findById(req.params.id);
        if (!invite) {
            return sendErrorResponse(res, 404, 'Invite not found.');
        }
        if (invite.status === 'revoked' || invite.status === 'accepted') {
            return sendErrorResponse(res, 400, `Invite is already ${invite.status}.`);
        }

        const oldState = invite.toObject();
        invite.status = 'revoked';
        invite.revokedBy = req.user.id;
        invite.revokedAt = new Date();
        await invite.save();

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.INVITE_REVOKED,
            description: `Revoked invite to ${invite.email}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
            oldValue: oldState,
            newValue: invite
        });
        res.status(200).json({ success: true, message: 'Invitation revoked successfully.', data: invite });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to revoke invite.', err);
    }
};

// === Audit Log Management ===

/**
 * @desc    Get all audit logs
 * @route   GET /api/admin/audit-logs
 * @access  Private/Admin
 */
exports.getAuditLogs = async (req, res) => {
    try {
        const { page = 1, limit = 20, userId, action, resourceType, status, search } = req.query;
        const query = {};

        if (userId) query.user = userId;
        if (action) query.action = action;
        if (resourceType) query.resourceType = resourceType;
        if (status) query.status = status;
        if (search) {
            query.$or = [
                { description: { $regex: search, $options: 'i' } },
                { errorMessage: { $regex: search, $options: 'i' } },
                { ipAddress: { $regex: search, $options: 'i' } },
                { userAgent: { $regex: search, $options: 'i' } }
            ];
        }

        const auditLogs = await AuditLog.find(query)
            .populate('user', 'firstName lastName email')
            .populate('resourceId') // Populate related resource if possible
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .sort({ createdAt: -1 });

        const totalLogs = await AuditLog.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed audit logs',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.System,
            newValue: { query, count: auditLogs.length }
        });
        res.status(200).json({ success: true, count: auditLogs.length, total: totalLogs, page: parseInt(page), limit: parseInt(limit), data: auditLogs });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch audit logs.', err);
    }
};

// === System Health & Notifications ===

/**
 * @desc    Get system health summary (basic checks)
 * @route   GET /api/admin/system-health
 * @access  Private/Admin
 */
exports.getSystemHealthSummary = async (req, res) => {
    try {
        const health = {
            database: {
                status: 'checking',
                message: ''
            },
            emailService: {
                status: 'checking',
                message: ''
            },
            cloudStorageService: {
                status: 'checking',
                message: ''
            },
            envVariables: {
                status: 'checking',
                message: ''
            }
        };

        // Database Check
        try {
            await mongoose.connection.db.admin().ping();
            health.database.status = 'healthy';
            health.database.message = 'Database connection successful.';
        } catch (dbErr) {
            health.database.status = 'unhealthy';
            health.database.message = `Database connection failed: ${dbErr.message}`;
            logger.error('Database health check failed:', dbErr);
        }

        // Email Service Check (attempt to get access token)
        try {
            // This is a simplified check. A more robust one might send a test email.
            // For now, relies on the internal check within sendEmail that gets access token
            // A direct check without sending email would involve oAuth2Client.getAccessToken()
            // which is internal to emailService. You might expose a health check method in emailService.
            // For simplicity, just check if env vars are present.
            if (process.env.GMAIL_USER && process.env.OAUTH_CLIENT_ID) {
                 health.emailService.status = 'healthy';
                 health.emailService.message = 'Email service environment variables configured.';
            } else {
                 health.emailService.status = 'unhealthy';
                 health.emailService.message = 'Missing Gmail OAuth2 environment variables.';
            }
        } catch (emailErr) {
            health.emailService.status = 'unhealthy';
            health.emailService.message = `Email service check failed: ${emailErr.message}`;
            logger.error('Email service health check failed:', emailErr);
        }

        // Cloud Storage Service Check (e.g., Cloudinary)
        try {
            if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
                // A more robust check might upload/delete a tiny test file
                health.cloudStorageService.status = 'healthy';
                health.cloudStorageService.message = 'Cloudinary environment variables configured.';
            } else {
                health.cloudStorageService.status = 'unhealthy';
                health.cloudStorageService.message = 'Missing Cloudinary environment variables.';
            }
        } catch (storageErr) {
            health.cloudStorageService.status = 'unhealthy';
            health.cloudStorageService.message = `Cloud storage service check failed: ${storageErr.message}`;
            logger.error('Cloud storage service health check failed:', storageErr);
        }

        // Environment Variables Check (basic)
        const requiredEnvVars = [
            'PORT', 'NODE_ENV', 'MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET',
            'GMAIL_USER', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'OAUTH_REFRESH_TOKEN',
            'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
            'FRONTEND_URL'
        ];
        const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
        if (missingEnvVars.length > 0) {
            health.envVariables.status = 'unhealthy';
            health.envVariables.message = `Missing environment variables: ${missingEnvVars.join(', ')}`;
        } else {
            health.envVariables.status = 'healthy';
            health.envVariables.message = 'All critical environment variables are present.';
        }


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
    const { message, link, type = 'general_alert', emailSubject, emailHtml } = req.body;

    if (!message) {
        return sendErrorResponse(res, 400, 'Broadcast message is required.');
    }

    try {
        const allActiveUsers = await User.find({ isActive: true }).select('_id firstName email preferences');

        const notificationPromises = allActiveUsers.map(user => {
            return sendNotification({
                recipientId: user._id,
                type,
                message,
                link,
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.System, // Relate to system itself for broadcast
                relatedResourceId: req.user.id, // Or null/specific system ID if you have one
                emailDetails: {
                    subject: emailSubject || `System Broadcast: ${message.substring(0, 50)}...`,
                    html: emailHtml || `<p>Dear ${user.firstName},</p><p>${message}</p>${link ? `<p>Click <a href="${process.env.FRONTEND_URL}${link}">here</a> for more details.</p>` : ''}<p>Thank you,</p><p>The Property Management Team</p>`
                }
            }).catch(error => {
                logger.error(`Failed to send broadcast notification to user ${user.email}:`, error);
                // Don't re-throw, allow other notifications to proceed
            });
        });

        await Promise.allSettled(notificationPromises); // Use allSettled to ensure all promises resolve/reject

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.BROADCAST_NOTIFICATION_SENT,
            description: `Sent system broadcast: ${message.substring(0, 100)}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.System,
            newValue: { message, link, type, sentToCount: allActiveUsers.length }
        });
        res.status(200).json({ success: true, message: 'Broadcast notification initiated successfully. Check logs for individual send statuses.' });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to send broadcast notification.', err);
    }
};

// === Media Management ===

/**
 * @desc    List all media files (admin view)
 * @route   GET /api/admin/media
 * @access  Private/Admin
 */
exports.getAllMedia = async (req, res) => {
    try {
        const { page = 1, limit = 10, relatedTo, relatedId, uploadedBy, mimeType, search } = req.query;
        const query = {};

        if (relatedTo) query.relatedTo = relatedTo;
        if (relatedId) query.relatedId = relatedId;
        if (uploadedBy) query.uploadedBy = uploadedBy;
        if (mimeType) query.mimeType = { $regex: mimeType, $options: 'i' };
        if (search) {
            query.$or = [
                { filename: { $regex: search, $options: 'i' } },
                { originalname: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { tags: { $regex: search, $options: 'i' } }
            ];
        }

        const mediaFiles = await Media.find(query)
            .populate('uploadedBy', 'firstName lastName email')
            .populate('relatedId') // Populate the actual related document
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .sort({ createdAt: -1 });

        const totalMedia = await Media.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all media files',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Media,
            newValue: { query, count: mediaFiles.length }
        });
        res.status(200).json({ success: true, count: mediaFiles.length, total: totalMedia, page: parseInt(page), limit: parseInt(limit), data: mediaFiles });
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
        const result = await Media.aggregate([
            {
                $group: {
                    _id: null,
                    totalFiles: { $sum: 1 },
                    totalSizeInBytes: { $sum: '$size' }
                }
            }
        ]);

        const stats = {
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
                stats.notes = "Size calculation requires 'size' field in media documents.";
            }
        } else {
            stats.notes = "No media files found or 'size' field missing for calculation.";
        }

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SYSTEM_EVENT,
            description: 'Accessed media storage stats',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Media,
            newValue: stats
        });
        res.json({ success: true, data: stats });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch media storage stats.', err);
    }
};


/**
 * @desc    Delete a media file (from Cloudinary and DB)
 * @route   DELETE /api/admin/media/:id
 * @access  Private/Admin
 */
exports.deleteMedia = async (req, res) => {
    try {
        const mediaId = req.params.id;
        const mediaDoc = await Media.findById(mediaId);

        if (!mediaDoc) {
            return sendErrorResponse(res, 404, 'Media file not found.');
        }

        // publicId is stored in the mediaDoc
        const publicId = mediaDoc.public_id || mediaDoc.filename;
        const resourceType = mediaDoc.resource_type || (mediaDoc.mimeType.startsWith('image/') ? 'image' : mediaDoc.mimeType.startsWith('video/') ? 'video' : 'raw');

        // Delete from Cloudinary
        await deleteFile(publicId, resourceType);

        // Delete from MongoDB
        await mediaDoc.deleteOne();

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.DELETE,
            description: `Deleted media file: ${mediaDoc.filename}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Media,
            oldValue: mediaDoc
        });
        res.status(200).json({ success: true, message: 'Media file deleted successfully.' });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to delete media file.', err);
    }
};


// === Lease Management ===

/**
 * @desc    Get all leases (admin view)
 * @route   GET /api/admin/leases
 * @access  Private/Admin
 */
exports.getAllLeases = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, propertyId, tenantId, search } = req.query;
        const query = {};

        if (status) query.status = status;
        if (propertyId) query.property = propertyId;
        if (tenantId) query.tenant = tenantId;
        if (search) {
            query.$or = [
                { terms: { $regex: search, $options: 'i' } } // Example search on terms
            ];
        }

        const leases = await Lease.find(query)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('landlord', 'firstName lastName email')
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .sort({ leaseStartDate: -1 });

        const totalLeases = await Lease.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all leases',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            newValue: { query, count: leases.length }
        });
        res.status(200).json({ success: true, count: leases.length, total: totalLeases, page: parseInt(page), limit: parseInt(limit), data: leases });
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
        const lease = await Lease.findById(req.params.id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('landlord', 'firstName lastName email')
            .populate('documents', 'url filename mimeType'); // Populate actual media docs for lease documents

        if (!lease) {
            return sendErrorResponse(res, 404, 'Lease not found.');
        }
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed lease ${lease._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            newValue: lease
        });
        res.status(200).json({ success: true, data: lease });
    } catch (err) {
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
        const { property, unit, tenant, landlord, leaseStartDate, leaseEndDate, monthlyRent, currency, paymentDueDate, securityDeposit, terms } = req.body;

        const propertyExists = await Property.findById(property);
        if (!propertyExists) return sendErrorResponse(res, 404, 'Property not found.');
        const unitExists = await Unit.findById(unit);
        if (!unitExists) return sendErrorResponse(res, 404, 'Unit not found.');
        const tenantExists = await User.findById(tenant);
        if (!tenantExists) return sendErrorResponse(res, 404, 'Tenant user not found.');
        const landlordExists = await User.findById(landlord);
        if (!landlordExists) return sendErrorResponse(res, 404, 'Landlord user not found.');

        const newLease = await Lease.create({
            property, unit, tenant, landlord, leaseStartDate, leaseEndDate, monthlyRent, currency, paymentDueDate, securityDeposit, terms
        });

        // Update unit status to 'occupied' or 'leased' if it's not already
        if (unitExists.status !== 'occupied' && unitExists.status !== 'leased') {
            unitExists.status = 'occupied';
            await unitExists.save();
            await createAuditLog({
                user: req.user.id,
                action: AUDIT_ACTION_ENUM.UNIT_UPDATED,
                description: `Unit ${unitExists.unitName} status updated to occupied due to new lease`,
                resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
                oldValue: { status: unitExists.status },
                newValue: { status: 'occupied' }
            });
        }

        // Create PropertyUser association if it doesn't exist or update roles
        let propertyUser = await PropertyUser.findOne({ user: tenant, property: property, unit: unit });
        if (propertyUser) {
            if (!propertyUser.roles.includes('tenant')) {
                propertyUser.roles.push('tenant');
                await propertyUser.save();
                await createAuditLog({
                    user: req.user.id,
                    action: AUDIT_ACTION_ENUM.PROPERTY_USER_ASSOCIATION_UPDATED,
                    description: `Added tenant role to existing PropertyUser for ${tenantExists.email} on ${propertyExists.name}/${unitExists.unitName}`,
                    resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
                    newValue: propertyUser
                });
            }
        } else {
            propertyUser = await PropertyUser.create({
                user: tenant,
                property: property,
                unit: unit,
                roles: ['tenant'],
                invitedBy: req.user.id // Admin creates the association
            });
            await createAuditLog({
                user: req.user.id,
                action: AUDIT_ACTION_ENUM.PROPERTY_USER_ASSOCIATION_CREATED,
                description: `Created new PropertyUser association for tenant ${tenantExists.email} on ${propertyExists.name}/${unitExists.unitName}`,
                resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
                newValue: propertyUser
            });
        }

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.LEASE_CREATED,
            description: `Created new lease for tenant ${tenantExists.email} on property ${propertyExists.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            newValue: newLease
        });
        res.status(201).json({ success: true, data: newLease });
    } catch (err) {
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
        const updates = req.body;

        const lease = await Lease.findById(leaseId);
        if (!lease) {
            return sendErrorResponse(res, 404, 'Lease not found.');
        }

        const oldLease = lease.toObject();

        Object.assign(lease, updates);

        await lease.save({ validateBeforeSave: true });

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.LEASE_UPDATED,
            description: `Updated lease ${lease._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            oldValue: oldLease,
            newValue: lease
        });
        res.status(200).json({ success: true, data: lease });
    } catch (err) {
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
        const lease = await Lease.findById(req.params.id);
        if (!lease) {
            return sendErrorResponse(res, 404, 'Lease not found.');
        }

        if (lease.status === 'terminated') {
            return sendErrorResponse(res, 400, 'Lease is already terminated.');
        }

        const oldState = lease.toObject();
        lease.status = 'terminated';
        lease.leaseEndDate = new Date(); // Set end date to now or provided date if exists
        await lease.save();

        // Update unit status to vacant
        const unit = await Unit.findById(lease.unit);
        if (unit && unit.status !== 'vacant') {
            unit.status = 'vacant';
            await unit.save();
            await createAuditLog({
                user: req.user.id,
                action: AUDIT_ACTION_ENUM.UNIT_UPDATED,
                description: `Unit ${unit.unitName} status updated to vacant due to lease termination`,
                resourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
                oldValue: { status: oldState.status },
                newValue: { status: 'vacant' }
            });
        }

        // Remove tenant association from PropertyUser if this was their only property/unit association
        const propertyUser = await PropertyUser.findOne({ user: lease.tenant, property: lease.property, unit: lease.unit });
        if (propertyUser) {
            if (propertyUser.roles.includes('tenant')) {
                propertyUser.roles = propertyUser.roles.filter(role => role !== 'tenant');
                if (propertyUser.roles.length === 0) { // If no other roles, deactivate association
                    propertyUser.isActive = false;
                    await propertyUser.save();
                    await createAuditLog({
                        user: req.user.id,
                        action: AUDIT_ACTION_ENUM.PROPERTY_USER_ASSOCIATION_DEACTIVATED,
                        description: `Deactivated PropertyUser association for ${lease.tenant.email} on property ${lease.property.name} (no remaining roles)`,
                        resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
                        newValue: propertyUser
                    });
                } else {
                    await propertyUser.save();
                    await createAuditLog({
                        user: req.user.id,
                        action: AUDIT_ACTION_ENUM.PROPERTY_USER_ASSOCIATION_UPDATED,
                        description: `Removed tenant role from PropertyUser for ${lease.tenant.email} on property ${lease.property.name}`,
                        resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
                        newValue: propertyUser
                    });
                }
            }
        }


        // Potentially send notification to tenant
        await sendNotification({
            recipientId: lease.tenant,
            type: 'lease_termination',
            message: `Your lease for unit ${unit.unitName || 'N/A'} at property ${lease.property.name || 'N/A'} has been terminated.`,
            link: `/leases/${lease._id}`,
            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            relatedResourceId: lease._id,
            emailDetails: {
                subject: `Lease Termination Notification: ${lease.property.name}`,
                html: `<p>Dear ${lease.tenant.firstName || 'Tenant'},</p><p>This is to inform you that your lease for unit <strong>${unit.unitName || 'N/A'}</strong> at property <strong>${lease.property.name || 'N/A'}</strong> has been terminated.</p><p>For details, please contact your property manager.</p><p>Thank you,</p><p>The Property Management Team</p>`
            }
        });


        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.LEASE_UPDATED,
            description: `Terminated lease ${lease._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            oldValue: oldState,
            newValue: lease
        });
        res.status(200).json({ success: true, message: 'Lease terminated successfully.', data: lease });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to terminate lease.', err);
    }
};

// === Rent Management ===

/**
 * @desc    Get all rent records (admin view)
 * @route   GET /api/admin/rents
 * @access  Private/Admin
 */
exports.getAllRents = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, tenantId, propertyId, unitId, dueDateBefore, dueDateAfter } = req.query;
        const query = {};

        if (status) query.status = status;
        if (tenantId) query.tenant = tenantId;
        if (propertyId) query.property = propertyId;
        if (unitId) query.unit = unitId;
        if (dueDateBefore) query.dueDate = { ...query.dueDate, $lte: new Date(dueDateBefore) };
        if (dueDateAfter) query.dueDate = { ...query.dueDate, $gte: new Date(dueDateAfter) };

        const rents = await Rent.find(query)
            .populate('lease', 'monthlyRent leaseStartDate leaseEndDate')
            .populate('tenant', 'firstName lastName email')
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .sort({ dueDate: -1 });

        const totalRents = await Rent.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all rent records',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
            newValue: { query, count: rents.length }
        });
        res.status(200).json({ success: true, count: rents.length, total: totalRents, page: parseInt(page), limit: parseInt(limit), data: rents });
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
        const rent = await Rent.findById(req.params.id)
            .populate('lease', 'monthlyRent leaseStartDate leaseEndDate')
            .populate('tenant', 'firstName lastName email')
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('paymentProof', 'url filename'); // Populate actual media doc for payment proof

        if (!rent) {
            return sendErrorResponse(res, 404, 'Rent record not found.');
        }
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed rent record ${rent._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
            newValue: rent
        });
        res.status(200).json({ success: true, data: rent });
    } catch (err) {
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
        const { lease, tenant, property, unit, billingPeriod, amountDue, dueDate, amountPaid, paymentDate, status, paymentMethod, transactionId, paymentProofId, notes } = req.body;

        // Basic validation for required fields
        if (!lease || !tenant || !property || !unit || !billingPeriod || !amountDue || !dueDate) {
            return sendErrorResponse(res, 400, 'Missing required fields for rent payment.');
        }

        const newRent = await Rent.create({
            lease, tenant, property, unit, billingPeriod, amountDue, dueDate,
            amountPaid: amountPaid || 0,
            paymentDate: paymentDate || null,
            status: status || 'due',
            paymentMethod, transactionId, paymentProof: paymentProofId || null, notes
        });

        // Update lease's last payment date or status if needed (complex, typically in a dedicated cron/service)
        // For simplicity, we just record the rent payment.

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.BILL_PAID,
            description: `Recorded rent payment for lease ${lease}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
            newValue: newRent
        });
        res.status(201).json({ success: true, data: newRent });
    } catch (err) {
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
        const updates = req.body;

        const rent = await Rent.findById(rentId);
        if (!rent) {
            return sendErrorResponse(res, 404, 'Rent record not found.');
        }

        const oldRent = rent.toObject();

        // Specific logic for updating payment status
        if (updates.amountPaid !== undefined) {
            rent.amountPaid = updates.amountPaid;
            if (rent.amountPaid >= rent.amountDue) {
                rent.status = 'paid';
            } else if (rent.amountPaid > 0 && rent.amountPaid < rent.amountDue) {
                rent.status = 'partially_paid';
            } else if (rent.amountPaid === 0 && new Date() > rent.dueDate) {
                rent.status = 'overdue';
            } else {
                rent.status = 'due';
            }
        }
        if (updates.status && Object.values(PAYMENT_STATUS_ENUM).includes(updates.status)) {
            rent.status = updates.status;
        }

        // Apply other updates
        Object.assign(rent, updates);


        await rent.save({ validateBeforeSave: true });

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.BILL_UPDATED,
            description: `Updated rent payment ${rent._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
            oldValue: oldRent,
            newValue: rent
        });
        res.status(200).json({ success: true, data: rent });
    } catch (err) {
        sendErrorResponse(res, 400, 'Failed to update rent payment.', err);
    }
};

// === Scheduled Maintenance Management ===

/**
 * @desc    Get all scheduled maintenances (admin view)
 * @route   GET /api/admin/scheduled-maintenances
 * @access  Private/Admin
 */
exports.getAllScheduledMaintenances = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, category, propertyId, unitId, recurring, search } = req.query;
        const query = {};

        if (status) query.status = status;
        if (category) query.category = category;
        if (propertyId) query.property = propertyId;
        if (unitId) query.unit = unitId;
        if (typeof recurring === 'boolean') query.recurring = recurring;
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const scheduledMaintenances = await ScheduledMaintenance.find(query)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('createdBy', 'firstName lastName email')
            .populate('assignedTo', 'firstName lastName email name')
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .sort({ scheduledDate: -1 });

        const totalScheduledMaintenances = await ScheduledMaintenance.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all scheduled maintenances',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            newValue: { query, count: scheduledMaintenances.length }
        });
        res.status(200).json({ success: true, count: scheduledMaintenances.length, total: totalScheduledMaintenances, page: parseInt(page), limit: parseInt(limit), data: scheduledMaintenances });
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
        const scheduledMaintenance = await ScheduledMaintenance.findById(req.params.id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('createdBy', 'firstName lastName email')
            .populate('assignedTo', 'firstName lastName email name')
            .populate('media', 'url filename mimeType'); // Populate actual media docs
        if (!scheduledMaintenance) {
            return sendErrorResponse(res, 404, 'Scheduled maintenance not found.');
        }
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed scheduled maintenance ${scheduledMaintenance._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            newValue: scheduledMaintenance
        });
        res.status(200).json({ success: true, data: scheduledMaintenance });
    } catch (err) {
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
        const { title, description, category, property, unit, scheduledDate, recurring, frequency, assignedTo, assignedToModel, mediaIds } = req.body;

        const propertyExists = await Property.findById(property);
        if (!propertyExists) return sendErrorResponse(res, 404, 'Property not found.');
        if (unit) {
            const unitExists = await Unit.findById(unit);
            if (!unitExists) return sendErrorResponse(res, 404, 'Unit not found.');
        }

        const newScheduledMaintenance = await ScheduledMaintenance.create({
            title, description, category, property, unit: unit || null, scheduledDate, recurring, frequency,
            assignedTo: assignedTo || null,
            assignedToModel: assignedToModel || null,
            createdBy: req.user.id,
            media: mediaIds || [] // Link pre-uploaded media
        });

        // Potentially generate first request if scheduledDate is in past or very near
        // This logic is usually in a separate job/cron for recurring tasks

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SCHEDULED_MAINTENANCE_CREATED,
            description: `Created scheduled maintenance: ${newScheduledMaintenance.title}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            newValue: newScheduledMaintenance
        });
        res.status(201).json({ success: true, data: newScheduledMaintenance });
    } catch (err) {
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
        const smId = req.params.id;
        const updates = req.body;

        const scheduledMaintenance = await ScheduledMaintenance.findById(smId);
        if (!scheduledMaintenance) {
            return sendErrorResponse(res, 404, 'Scheduled maintenance not found.');
        }

        const oldScheduledMaintenance = scheduledMaintenance.toObject();

        Object.assign(scheduledMaintenance, updates);

        await scheduledMaintenance.save({ validateBeforeSave: true });

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SCHEDULED_MAINTENANCE_UPDATED,
            description: `Updated scheduled maintenance ${scheduledMaintenance.title}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            oldValue: oldScheduledMaintenance,
            newValue: scheduledMaintenance
        });
        res.status(200).json({ success: true, data: scheduledMaintenance });
    } catch (err) {
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
        const sm = await ScheduledMaintenance.findById(req.params.id);
        if (!sm) {
            return sendErrorResponse(res, 404, 'Scheduled maintenance not found.');
        }
        if (sm.status === 'paused') {
            return sendErrorResponse(res, 400, 'Scheduled maintenance is already paused.');
        }

        const oldState = sm.toObject();
        sm.status = 'paused';
        await sm.save();

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SCHEDULED_MAINTENANCE_PAUSED,
            description: `Paused scheduled maintenance: ${sm.title}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            oldValue: oldState,
            newValue: sm
        });
        res.status(200).json({ success: true, message: 'Scheduled maintenance paused.', data: sm });
    } catch (err) {
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
        const sm = await ScheduledMaintenance.findById(req.params.id);
        if (!sm) {
            return sendErrorResponse(res, 404, 'Scheduled maintenance not found.');
        }
        if (sm.status === 'active') {
            return sendErrorResponse(res, 400, 'Scheduled maintenance is already active.');
        }

        const oldState = sm.toObject();
        sm.status = 'active';
        await sm.save();

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.SCHEDULED_MAINTENANCE_RESUMED,
            description: `Resumed scheduled maintenance: ${sm.title}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.ScheduledMaintenance,
            oldValue: oldState,
            newValue: sm
        });
        res.status(200).json({ success: true, message: 'Scheduled maintenance resumed.', data: sm });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to resume scheduled maintenance.', err);
    }
};


// === PropertyUser Management ===

/**
 * @desc    Get all PropertyUser associations
 * @route   GET /api/admin/property-users
 * @access  Private/Admin
 */
exports.getAllPropertyUsers = async (req, res) => {
    try {
        const { page = 1, limit = 10, userId, propertyId, unitId, role, isActive, search } = req.query;
        const query = {};

        if (userId) query.user = userId;
        if (propertyId) query.property = propertyId;
        if (unitId) query.unit = unitId;
        if (role) query.roles = role; // Match if role is in array
        if (typeof isActive === 'boolean') query.isActive = isActive;
        if (search) {
            // Search on populated user/property names/emails
            const users = await User.find({
                $or: [
                    { firstName: { $regex: search, $options: 'i' } },
                    { lastName: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            }).select('_id');
            const userIds = users.map(u => u._id);

            const properties = await Property.find({ name: { $regex: search, $options: 'i' } }).select('_id');
            const propertyIds = properties.map(p => p._id);

            query.$or = [
                { user: { $in: userIds } },
                { property: { $in: propertyIds } }
            ];
            if (mongoose.Types.ObjectId.isValid(search)) { // Allow searching by ID directly
                query.$or.push({ _id: search });
            }
        }

        const propertyUsers = await PropertyUser.find(query)
            .populate('user', 'firstName lastName email role')
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('invitedBy', 'firstName lastName email')
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .sort({ createdAt: -1 });

        const totalPropertyUsers = await PropertyUser.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all property user associations',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            newValue: { query, count: propertyUsers.length }
        });
        res.status(200).json({ success: true, count: propertyUsers.length, total: totalPropertyUsers, page: parseInt(page), limit: parseInt(limit), data: propertyUsers });
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
        const propertyUser = await PropertyUser.findById(req.params.id)
            .populate('user', 'firstName lastName email role')
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('invitedBy', 'firstName lastName email');
        if (!propertyUser) {
            return sendErrorResponse(res, 404, 'Property user association not found.');
        }
        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: `Viewed property user association ${propertyUser._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            newValue: propertyUser
        });
        res.status(200).json({ success: true, data: propertyUser });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to fetch property user association details.', err);
    }
};

/**
 * @desc    Create a new PropertyUser association (e.g., manually assign landlord/manager)
 * @route   POST /api/admin/property-users
 * @access  Private/Admin
 */
exports.createPropertyUser = async (req, res) => {
    try {
        const { user: userId, property: propertyId, unit: unitId, roles } = req.body;

        if (!userId || !propertyId || !Array.isArray(roles) || roles.length === 0) {
            return sendErrorResponse(res, 400, 'User ID, Property ID, and at least one role are required.');
        }

        const user = await User.findById(userId);
        if (!user) return sendErrorResponse(res, 404, 'User not found.');
        const property = await Property.findById(propertyId);
        if (!property) return sendErrorResponse(res, 404, 'Property not found.');
        if (unitId) {
            const unit = await Unit.findById(unitId);
            if (!unit) return sendErrorResponse(res, 404, 'Unit not found.');
        }

        // Validate roles against enum
        const invalidRoles = roles.filter(role => !Object.values(PROPERTY_USER_ROLES_ENUM).includes(role));
        if (invalidRoles.length > 0) {
            return sendErrorResponse(res, 400, `Invalid roles provided: ${invalidRoles.join(', ')}`);
        }

        // Check for existing association to avoid duplicates (though compound index handles it)
        let existingAssociation = await PropertyUser.findOne({ user: userId, property: propertyId, unit: unitId || null });
        if (existingAssociation) {
            // Merge roles if association exists
            const mergedRoles = [...new Set([...existingAssociation.roles, ...roles])];
            existingAssociation.roles = mergedRoles;
            existingAssociation.isActive = true; // Reactivate if it was deactivated
            await existingAssociation.save();
            await createAuditLog({
                user: req.user.id,
                action: AUDIT_ACTION_ENUM.PROPERTY_USER_ASSOCIATION_UPDATED,
                description: `Updated existing property user association for ${user.email} on ${property.name}`,
                resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
                newValue: existingAssociation
            });
            return res.status(200).json({ success: true, message: 'Property user association updated.', data: existingAssociation });
        }

        const newAssociation = await PropertyUser.create({
            user: userId,
            property: propertyId,
            unit: unitId || null,
            roles,
            invitedBy: req.user.id,
            isActive: true
        });

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PROPERTY_USER_ASSOCIATION_CREATED,
            description: `Created new property user association for ${user.email} on ${property.name}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            newValue: newAssociation
        });
        res.status(201).json({ success: true, data: newAssociation });
    } catch (err) {
        sendErrorResponse(res, 400, 'Failed to create property user association.', err);
    }
};

/**
 * @desc    Update an existing PropertyUser association (e.g., change roles)
 * @route   PUT /api/admin/property-users/:id
 * @access  Private/Admin
 */
exports.updatePropertyUser = async (req, res) => {
    try {
        const associationId = req.params.id;
        const { roles, isActive, startDate, endDate, permissions, unit } = req.body;

        const propertyUser = await PropertyUser.findById(associationId);
        if (!propertyUser) {
            return sendErrorResponse(res, 404, 'Property user association not found.');
        }

        const oldPropertyUser = propertyUser.toObject();

        if (roles) {
            if (!Array.isArray(roles) || roles.length === 0) {
                return sendErrorResponse(res, 400, 'Roles must be a non-empty array.');
            }
            const invalidRoles = roles.filter(role => !Object.values(PROPERTY_USER_ROLES_ENUM).includes(role));
            if (invalidRoles.length > 0) {
                return sendErrorResponse(res, 400, `Invalid roles provided: ${invalidRoles.join(', ')}`);
            }
            propertyUser.roles = roles;
        }
        if (typeof isActive === 'boolean') propertyUser.isActive = isActive;
        if (startDate) propertyUser.startDate = startDate;
        if (endDate) propertyUser.endDate = endDate;
        if (permissions) propertyUser.permissions = permissions;
        if (unit) propertyUser.unit = unit; // Allow changing associated unit (careful with this)

        await propertyUser.save({ validateBeforeSave: true });

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PROPERTY_USER_ASSOCIATION_UPDATED,
            description: `Updated property user association ${propertyUser._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            oldValue: oldPropertyUser,
            newValue: propertyUser
        });
        res.status(200).json({ success: true, data: propertyUser });
    } catch (err) {
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
        const propertyUser = await PropertyUser.findById(req.params.id);
        if (!propertyUser) {
            return sendErrorResponse(res, 404, 'Property user association not found.');
        }
        if (!propertyUser.isActive) {
            return sendErrorResponse(res, 400, 'Property user association is already inactive.');
        }

        const oldState = propertyUser.toObject();
        propertyUser.isActive = false;
        await propertyUser.save();

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.PROPERTY_USER_ASSOCIATION_DEACTIVATED,
            description: `Deactivated property user association ${propertyUser._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            oldValue: oldState,
            newValue: propertyUser
        });
        res.status(200).json({ success: true, message: 'Property user association deactivated successfully.', data: propertyUser });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to deactivate property user association.', err);
    }
};

// === Comment Management ===
/**
 * @desc    Get all comments (admin view)
 * @route   GET /api/admin/comments
 * @access  Private/Admin
 */
exports.getAllComments = async (req, res) => {
    try {
        const { page = 1, limit = 10, contextType, contextId, senderId, isInternalNote, search } = req.query;
        const query = {};

        if (contextType) query.contextType = contextType;
        if (contextId) query.contextId = contextId;
        if (senderId) query.sender = senderId;
        if (typeof isInternalNote === 'boolean') query.isInternalNote = isInternalNote;
        if (search) {
            query.$or = [
                { message: { $regex: search, $options: 'i' } },
                { externalUserName: { $regex: search, $options: 'i' } },
                { externalUserEmail: { $regex: search, $options: 'i' } }
            ];
        }

        const comments = await Comment.find(query)
            .populate('sender', 'firstName lastName email')
            .populate('contextId') // Populate the actual related document (Request, ScheduledMaintenance etc.)
            .populate('media', 'url filename mimeType') // Populate associated media
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit))
            .sort({ createdAt: -1 });

        const totalComments = await Comment.countDocuments(query);

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.READ,
            description: 'Viewed all comments',
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
            newValue: { query, count: comments.length }
        });
        res.status(200).json({ success: true, count: comments.length, total: totalComments, page: parseInt(page), limit: parseInt(limit), data: comments });
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
        const comment = await Comment.findById(commentId);

        if (!comment) {
            return sendErrorResponse(res, 404, 'Comment not found.');
        }

        // Optional: Remove media associated with the comment from cloud storage
        if (comment.media && comment.media.length > 0) {
            for (const mediaId of comment.media) {
                const mediaDoc = await Media.findById(mediaId);
                if (mediaDoc) {
                    const publicId = mediaDoc.public_id || mediaDoc.filename;
                    const resourceType = mediaDoc.resource_type || (mediaDoc.mimeType.startsWith('image/') ? 'image' : mediaDoc.mimeType.startsWith('video/') ? 'video' : 'raw');
                    await deleteFile(publicId, resourceType).catch(err => logger.error(`Failed to delete Cloudinary file ${publicId}:`, err));
                    await mediaDoc.deleteOne(); // Delete media doc from DB
                }
            }
        }

        // Also remove the comment reference from its context document (e.g., Request)
        if (comment.contextType === 'Request') {
            await Request.updateOne({ _id: comment.contextId }, { $pull: { comments: comment._id } });
        } else if (comment.contextType === 'ScheduledMaintenance') {
             await ScheduledMaintenance.updateOne({ _id: comment.contextId }, { $pull: { comments: comment._id } });
        }
        // Add more context types as needed

        await comment.deleteOne();

        await createAuditLog({
            user: req.user.id,
            action: AUDIT_ACTION_ENUM.DELETE,
            description: `Deleted comment ${comment._id}`,
            resourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
            oldValue: comment
        });
        res.status(200).json({ success: true, message: 'Comment deleted successfully.' });
    } catch (err) {
        sendErrorResponse(res, 500, 'Failed to delete comment.', err);
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