const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/user');
const PropertyUser = require('../models/propertyUser');
const Property = require('../models/property');
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Notification = require('../models/notification');
const Comment = require('../models/comment');
const { createAuditLog } = require('../services/auditService');
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');
const { registerUser: authServiceRegisterUser } = require('../services/authService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const {
    ROLE_ENUM, // Now an object
    PROPERTY_USER_ROLES_ENUM,
    REGISTRATION_STATUS_ENUM,
    AUDIT_ACTION_ENUM, // Now an object
    AUDIT_RESOURCE_TYPE_ENUM
} = require('../utils/constants/enums');
const crypto = require('crypto');

const APP_NAME = process.env.APP_NAME || 'Fix It by Threalty';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const getUserProfile = asyncHandler(async (req, res) => {
    const userProfile = await User.findById(req.user._id)
        .select('-passwordHash -resetPasswordToken -resetPasswordExpires -twoFactorSecret');

    if (!userProfile) {
        throw new AppError('User profile not found.', 404);
    }

    const associations = await PropertyUser.find({ user: userProfile._id, isActive: true })
        .populate('property', 'name address')
        .populate('unit', 'unitName');

    const userAssociations = {
        propertiesManaged: [],
        propertiesOwned: [],
        tenancies: [],
        vendorAssignments: [],
        adminAccess: [],
    };

    associations.forEach(assoc => {
        if (assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER) && assoc.property) {
            userAssociations.propertiesManaged.push(assoc.property);
        }
        if (assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.LANDLORD) && assoc.property) {
            userAssociations.propertiesOwned.push(assoc.property);
        }
        if (assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && assoc.property && assoc.unit) {
            userAssociations.tenancies.push({ property: assoc.property, unit: assoc.unit });
        }
        if (assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.VENDOR) && assoc.property) {
            userAssociations.vendorAssignments.push(assoc.property);
        }
        if (assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS) && assoc.property) {
            userAssociations.adminAccess.push(assoc.property);
        }
    });

    await createAuditLog({
        user: req.user._id,
        action: AUDIT_ACTION_ENUM.FETCH_PROFILE,
        description: `User ${userProfile.email} accessed their profile.`,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
        resourceId: userProfile._id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        status: 'success',
    });

    // --- Fix: map _id to id in the user object ---
    const plainUser = userProfile.toObject();
    plainUser.id = plainUser._id.toString(); // always as string for React
    delete plainUser._id;
    delete plainUser.__v;
    plainUser.associations = userAssociations;

    res.status(200).json({
        success: true,
        user: plainUser
    });
});


const updateUserProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);

    if (!user) {
        throw new AppError('User not found.', 404);
    }

    const oldUser = user.toObject();

    user.firstName = req.body.firstName !== undefined ? req.body.firstName : user.firstName;
    user.lastName = req.body.lastName !== undefined ? req.body.lastName : user.lastName;
    user.phone = req.body.phone !== undefined ? req.body.phone : user.phone;
    user.avatar = req.body.avatar !== undefined ? req.body.avatar : user.avatar;
    if (req.body.preferences) {
        user.preferences = { ...user.preferences, ...req.body.preferences };
    }

    const updatedUser = await user.save();
    logger.info(`UserController: User profile updated for ${updatedUser.email}`);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE, // Correctly uses UPDATE
        user: req.user._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
        resourceId: updatedUser._id,
        oldValue: { firstName: oldUser.firstName, lastName: oldUser.lastName, phone: oldUser.phone, avatar: oldUser.avatar, preferences: oldUser.preferences },
        newValue: { firstName: updatedUser.firstName, lastName: updatedUser.lastName, phone: updatedUser.phone, avatar: updatedUser.avatar, preferences: updatedUser.preferences },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        description: `User ${updatedUser.email} updated their profile.`,
        status: 'success'
    });

    res.status(200).json({
        success: true,
        message: 'Profile updated successfully.',
        user: {
            _id: updatedUser._id,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            email: updatedUser.email,
            phone: updatedUser.phone,
            role: updatedUser.role,
            isEmailVerified: updatedUser.isEmailVerified,
            status: updatedUser.status,
            avatar: updatedUser.avatar,
            preferences: updatedUser.preferences
        }
    });
});

const getAllUsers = asyncHandler(async (req, res) => {
    const { role, status, search, propertyId, unitId, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    let userFilter = {};
    let propertyUserFilter = {};

    if (req.user.role === ROLE_ENUM.ADMIN) {
        // Admin can view all users
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(req.user.role)) {
        const managedPropertyIds = await PropertyUser.find({
            user: req.user._id,
            isActive: true,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
        }).distinct('property');

        if (managedPropertyIds.length === 0) {
            return res.status(200).json({ success: true, count: 0, total: 0, page: parseInt(page), limit: parseInt(limit), data: [] });
        }
        propertyUserFilter.property = { $in: managedPropertyIds };
    } else {
        throw new AppError('Access denied: You do not have permission to view other users.', 403);
    }

    if (role) {
        if (!Object.values(ROLE_ENUM).includes(role.toLowerCase())) {
            throw new AppError(`Invalid role filter: ${role}`, 400);
        }
        userFilter.role = role.toLowerCase();
    }
    if (status) {
        if (!Object.values(REGISTRATION_STATUS_ENUM).includes(status.toLowerCase())) {
            throw new AppError(`Invalid status filter: ${status}`, 400);
        }
        userFilter.status = status.toLowerCase();
    }
    if (search) {
        userFilter.$or = [
            { firstName: { $regex: search, $options: 'i' } },
            { lastName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } },
        ];
    }

    if (propertyId) {
        if (!propertyUserFilter.property) {
            propertyUserFilter.property = propertyId;
        } else {
            // Ensure propertyId is within the already filtered managedPropertyIds
            propertyUserFilter.property = { $in: propertyUserFilter.property.$in.filter(pId => pId.toString() === propertyId) };
            if (propertyUserFilter.property.$in.length === 0) {
                return res.status(200).json({ success: true, count: 0, total: 0, page: parseInt(page), limit: parseInt(limit), data: [] });
            }
        }
    }
    if (unitId) {
        propertyUserFilter.unit = unitId;
    }

    let usersToFetchIds = [];
    if (Object.keys(propertyUserFilter).length > 0) {
        usersToFetchIds = await PropertyUser.find(propertyUserFilter).distinct('user');
        if (usersToFetchIds.length === 0) {
            return res.status(200).json({ success: true, count: 0, total: 0, page: parseInt(page), limit: parseInt(limit), data: [] });
        }
        userFilter._id = { $in: usersToFetchIds };
    }

    const users = await User.find(userFilter)
        .select('-passwordHash -resetPasswordToken -resetPasswordExpires -twoFactorSecret')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip);

    const totalUsers = await User.countDocuments(userFilter);

    await createAuditLog({
        user: req.user._id,
        action: AUDIT_ACTION_ENUM.FETCH_ALL_USERS, // Changed from READ_ALL
        description: `User ${req.user.email} fetched list of users.`,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        status: 'success',
        metadata: { query: req.query }
    });

    res.status(200).json({
        success: true,
        count: users.length,
        total: totalUsers,
        page: parseInt(page),
        limit: parseInt(limit),
        data: users
    });
});

const getUserById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const user = await User.findById(id).select('-passwordHash -resetPasswordToken -resetPasswordExpires -twoFactorSecret');

    if (!user) {
        throw new AppError('User not found.', 404);
    }

    if (req.user.role === ROLE_ENUM.ADMIN) {
        // Admin has full access
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(req.user.role)) {
        const managedPropertyIds = await PropertyUser.find({
            user: req.user._id,
            isActive: true,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
        }).distinct('property');

        if (managedPropertyIds.length === 0) {
            throw new AppError('Access denied: You do not manage any properties.', 403);
        }

        const isAssociated = await PropertyUser.exists({
            user: id,
            property: { $in: managedPropertyIds },
            isActive: true
        });

        if (!isAssociated) {
            throw new AppError('Access denied: You do not have permission to view this user.', 403);
        }
    } else {
        throw new AppError('Access denied: You do not have permission to view other user profiles.', 403);
    }

    const propertyAssociations = await PropertyUser.find({
        user: user._id,
        property: req.user.role === ROLE_ENUM.ADMIN ? { $exists: true } : { $in: await PropertyUser.find({ user: req.user._id }).distinct('property') },
        isActive: true
    })
        .populate('property', 'name address')
        .populate('unit', 'unitName');

    await createAuditLog({
        user: req.user._id,
        action: AUDIT_ACTION_ENUM.READ_ONE_USER, // Changed from READ
        description: `User ${req.user.email} fetched details for user ${user.email}.`,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
        resourceId: user._id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        status: 'success',
    });

    res.status(200).json({
        success: true,
        user: {
            ...user.toObject(),
            propertyAssociations
        }
    });
});

const createUser = asyncHandler(async (req, res) => {
    const { firstName, lastName, email, phone, role, propertyId, unitId } = req.body;

    if (![ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(req.user.role)) {
        throw new AppError('Access denied: You do not have permission to create users.', 403);
    }
    if (role === ROLE_ENUM.TENANT && (!propertyId || !unitId)) {
        throw new AppError('Property ID and Unit ID are required for creating a tenant.', 400);
    }
    if (role === ROLE_ENUM.VENDOR && !propertyId) {
        throw new AppError('Property ID is required for creating a vendor.', 400);
    }
    if ([ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(role) && req.user.role !== ROLE_ENUM.ADMIN) {
        throw new AppError('Only administrators can create other admin, landlord, or property manager accounts.', 403);
    }

    if (propertyId) {
        const isAuthorizedProperty = await PropertyUser.exists({
            user: req.user._id,
            property: propertyId,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        });
        if (!isAuthorizedProperty && req.user.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Not authorized to create a user for this property.', 403);
        }
    }

    const tempPassword = crypto.randomBytes(8).toString('hex');
    const newUser = await authServiceRegisterUser({
        firstName,
        lastName,
        email,
        phone,
        password: tempPassword,
        role,
        status: REGISTRATION_STATUS_ENUM.PENDING_PASSWORD_SET
    });

    if (propertyId) {
        // Ensure role is correctly mapped to PROPERTY_USER_ROLES_ENUM if it's a specific property role
        let assignedPropertyRole = role.toLowerCase();
        if (assignedPropertyRole === ROLE_ENUM.LANDLORD) assignedPropertyRole = PROPERTY_USER_ROLES_ENUM.LANDLORD;
        else if (assignedPropertyRole === ROLE_ENUM.PROPERTY_MANAGER) assignedPropertyRole = PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER;
        else if (assignedPropertyRole === ROLE_ENUM.TENANT) assignedPropertyRole = PROPERTY_USER_ROLES_ENUM.TENANT;
        else if (assignedPropertyRole === ROLE_ENUM.VENDOR) assignedPropertyRole = PROPERTY_USER_ROLES_ENUM.VENDOR_ACCESS; // Assuming vendor role maps to vendor_access

        await PropertyUser.create({
            user: newUser._id,
            property: propertyId,
            unit: unitId || null,
            roles: [assignedPropertyRole], // Use the mapped role
            invitedBy: req.user._id,
            isActive: true,
            startDate: new Date()
        });
        logger.info(`UserController: Created PropertyUser association for ${newUser.email} to property ${propertyId}.`);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    newUser.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    newUser.resetPasswordExpires = Date.now() + 3600000 * 24;
    await newUser.save({ validateBeforeSave: false });

    const setPasswordUrl = `${FRONTEND_URL}/reset-password/${resetToken}`;
    try {
        await emailService.sendInvitationEmail({
            to: newUser.email,
            inviteLink: setPasswordUrl,
            role: newUser.role,
            invitedByUserName: req.user.firstName || 'A user',
            propertyDisplayName: propertyId || '', // Consider passing property name instead of ID for email
        });
        // Optionally, for future SMS/in-app: await notificationService.sendOnboardingNotification({ user: newUser, setPasswordUrl });
    } catch (emailError) {
        logger.error(`UserController: Failed to send onboarding set-password invitation to ${email}: ${emailError.message}`, emailError);
    }

    await createAuditLog({
        user: req.user._id,
        action: AUDIT_ACTION_ENUM.USER_CREATED, // Correctly uses USER_CREATED
        description: `User ${req.user.email} manually created new user: ${newUser.email} with role: ${newUser.role}.`,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
        resourceId: newUser._id,
        newValue: { email: newUser.email, role: newUser.role, status: newUser.status, propertyId, unitId },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        status: 'success',
    });

    res.status(201).json({
        success: true,
        message: 'User created successfully. An email has been sent to set their password.',
        user: {
            _id: newUser._id,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            email: newUser.email,
            role: newUser.role,
            status: newUser.status
        }
    });
});

const updateUserById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, phone, avatar, preferences, role, status } = req.body;

    const userToUpdate = await User.findById(id);
    if (!userToUpdate) {
        throw new AppError('User not found.', 404);
    }

    const oldUser = userToUpdate.toObject();

    if (req.user.role === ROLE_ENUM.ADMIN) {
        userToUpdate.firstName = firstName !== undefined ? firstName : userToUpdate.firstName;
        userToUpdate.lastName = lastName !== undefined ? lastName : userToUpdate.lastName;
        userToUpdate.phone = phone !== undefined ? phone : userToUpdate.phone;
        userToUpdate.avatar = avatar !== undefined ? avatar : userToUpdate.avatar;
        if (preferences) userToUpdate.preferences = { ...userToUpdate.preferences, ...preferences };

        if (role !== undefined && role !== userToUpdate.role && !(userToUpdate._id.equals(req.user._id) && role !== ROLE_ENUM.ADMIN)) {
            if (!Object.values(ROLE_ENUM).includes(role.toLowerCase())) {
                throw new AppError(`Invalid role provided: ${role}`, 400);
            }
            userToUpdate.role = role.toLowerCase();
        } else if (userToUpdate._id.equals(req.user._id) && role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Administrators cannot change their own global role to a non-admin role.', 403);
        }

        if (status !== undefined && status !== userToUpdate.status) {
            if (!Object.values(REGISTRATION_STATUS_ENUM).includes(status.toLowerCase())) {
                throw new AppError(`Invalid status provided: ${status}`, 400);
            }
            userToUpdate.status = status.toLowerCase();
            userToUpdate.isActive = (status.toLowerCase() === REGISTRATION_STATUS_ENUM.ACTIVE);
        }

    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(req.user.role)) {
        const managedPropertyIds = await PropertyUser.find({
            user: req.user._id,
            isActive: true,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
        }).distinct('property');

        const isAssociated = await PropertyUser.exists({
            user: id,
            property: { $in: managedPropertyIds },
            isActive: true
        });

        if (!isAssociated) {
            throw new AppError('Access denied: You are not authorized to update this user.', 403);
        }

        // Prevent Landlord/PM from updating other management roles or their own account via this endpoint
        if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.ADMIN].includes(userToUpdate.role) || userToUpdate._id.equals(req.user._id)) {
            throw new AppError('Not authorized to update this user role or your own account via this endpoint.', 403);
        }

        userToUpdate.firstName = firstName !== undefined ? firstName : userToUpdate.firstName;
        userToUpdate.lastName = lastName !== undefined ? lastName : userToUpdate.lastName;
        userToUpdate.phone = phone !== undefined ? phone : userToUpdate.phone;
        userToUpdate.avatar = avatar !== undefined ? avatar : userToUpdate.avatar;
        if (preferences) userToUpdate.preferences = { ...userToUpdate.preferences, ...preferences };

        if (status !== undefined && status !== userToUpdate.status) {
            if (!Object.values(REGISTRATION_STATUS_ENUM).includes(status.toLowerCase())) {
                throw new AppError(`Invalid status provided: ${status}`, 400);
            }
            userToUpdate.status = status.toLowerCase();
            userToUpdate.isActive = (status.toLowerCase() === REGISTRATION_STATUS_ENUM.ACTIVE);

            await PropertyUser.updateMany(
                { user: id, property: { $in: managedPropertyIds } },
                { $set: { isActive: userToUpdate.isActive, endDate: userToUpdate.isActive ? null : new Date() } }
            );
        }

        if (role !== undefined && role !== userToUpdate.role) {
            throw new AppError('Landlords/Property Managers cannot directly change global user roles.', 403);
        }
        if (req.body.email !== undefined && req.body.email !== userToUpdate.email) {
            throw new AppError('Landlords/Property Managers cannot directly change user email addresses.', 403);
        }

    } else {
        throw new AppError('Access denied: You do not have permission to update users.', 403);
    }

    const updatedUser = await userToUpdate.save();
    logger.info(`UserController: User ${updatedUser.email} updated by ${req.user.email}.`);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE, // Correctly uses UPDATE
        user: req.user._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
        resourceId: updatedUser._id,
        oldValue: oldUser,
        newValue: updatedUser.toObject(),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        description: `User ${updatedUser.email} updated by ${req.user.email}.`,
        status: 'success'
    });

    res.status(200).json({
        success: true,
        message: 'User updated successfully.',
        user: {
            _id: updatedUser._id,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            email: updatedUser.email,
            phone: updatedUser.phone,
            role: updatedUser.role,
            isEmailVerified: updatedUser.isEmailVerified,
            status: updatedUser.status,
            avatar: updatedUser.avatar,
            preferences: updatedUser.preferences
        }
    });
});

const deleteUserById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (req.user._id.toString() === id) {
        throw new AppError('You cannot delete your own account via this endpoint.', 400);
    }

    const userToDelete = await User.findById(id);

    if (!userToDelete) {
        throw new AppError('User not found.', 404);
    }

    // Admins can delete users, but cannot delete other management roles (Admin, Landlord, PM)
    if (req.user.role !== ROLE_ENUM.ADMIN || [ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(userToDelete.role)) {
        throw new AppError('Access denied: Only administrators can delete users, and cannot delete other management roles.', 403);
    }

    await PropertyUser.deleteMany({ user: id });
    logger.info(`UserController: Deleted PropertyUser associations for user ${userToDelete.email}.`);

    // Set createdBy and assignedTo fields to null instead of deleting the entire request/scheduled maintenance
    // This maintains historical data integrity while removing the user's direct link.
    await Request.updateMany(
        { $or: [{ createdBy: id }, { assignedTo: id }] },
        { $unset: { createdBy: 1, assignedTo: 1, assignedToModel: 1 } } // Use $unset to remove the fields
    );
    await ScheduledMaintenance.updateMany(
        { $or: [{ createdBy: id }, { assignedTo: id }] },
        { $unset: { createdBy: 1, assignedTo: 1, assignedToModel: 1 } } // Use $unset to remove the fields
    );
    logger.info(`UserController: Updated Request and ScheduledMaintenance references for user ${userToDelete.email}.`);

    await Notification.deleteMany({ $or: [{ recipient: id }, { sender: id }] });
    logger.info(`UserController: Deleted notifications for user ${userToDelete.email}.`);

    await Comment.deleteMany({ sender: id });
    logger.info(`UserController: Deleted comments by user ${userToDelete.email}.`);

    await userToDelete.deleteOne();
    logger.info(`UserController: User ${userToDelete.email} deleted by ${req.user.email}.`);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE, // Correctly uses DELETE
        user: req.user._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
        resourceId: userToDelete._id,
        oldValue: userToDelete.toObject(),
        newValue: null,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        description: `User ${userToDelete.email} deleted by ${req.user.email}.`,
        status: 'success'
    });

    res.status(200).json({
        success: true,
        message: 'User and associated data deleted successfully.'
    });
});

const approveUser = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const userToApprove = await User.findById(id);
    if (!userToApprove) {
        throw new AppError('User not found.', 404);
    }

    if (userToApprove.status === REGISTRATION_STATUS_ENUM.ACTIVE) {
        throw new AppError('User is already active.', 400);
    }

    if (req.user.role === ROLE_ENUM.ADMIN) {
        // Admin can approve
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(req.user.role)) {
        const managedPropertyIds = await PropertyUser.find({
            user: req.user._id,
            isActive: true,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
        }).distinct('property');

        const isAssociated = await PropertyUser.exists({
            user: id,
            property: { $in: managedPropertyIds },
            isActive: false, // Look for inactive associations to approve
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.TENANT, PROPERTY_USER_ROLES_ENUM.VENDOR_ACCESS] } // Corrected from VENDOR
        });

        if (!isAssociated) {
            throw new AppError('Access denied: You are not authorized to approve this user or they are not a pending tenant/vendor for your properties.', 403);
        }
        // Landlords/PMs cannot approve other management roles
        if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.ADMIN].includes(userToApprove.role)) {
            throw new AppError('Not authorized to approve this user role.', 403);
        }
    } else {
        throw new AppError('Access denied: You do not have permission to approve users.', 403);
    }

    const oldStatus = userToApprove.status;
    const oldIsActive = userToApprove.isActive;

    userToApprove.status = REGISTRATION_STATUS_ENUM.ACTIVE;
    userToApprove.isActive = true;
    const updatedUser = await userToApprove.save();

    // Activate associated PropertyUser entries
    await PropertyUser.updateMany(
        { user: id, isActive: false },
        { $set: { isActive: true, startDate: new Date(), endDate: null } } // Set endDate to null on activation
    );

    logger.info(`UserController: User ${updatedUser.email} approved by ${req.user.email}.`);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.USER_APPROVED, // Changed from APPROVAL
        user: req.user._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
        resourceId: updatedUser._id,
        oldValue: { status: oldStatus, isActive: oldIsActive },
        newValue: { status: updatedUser.status, isActive: updatedUser.isActive },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        description: `User ${updatedUser.email} approved by ${req.user.email}.`,
        status: 'success'
    });

    // Optionally send notification: await notificationService.sendUserApprovedNotification(updatedUser);

    res.status(200).json({
        success: true,
        message: 'User approved successfully.',
        user: {
            _id: updatedUser._id,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            email: updatedUser.email,
            role: updatedUser.role,
            status: updatedUser.status,
            isActive: updatedUser.isActive
        }
    });
});

const updateUserRole = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!Object.values(ROLE_ENUM).includes(role.toLowerCase())) {
        throw new AppError('Invalid role provided.', 400);
    }

    const userToUpdate = await User.findById(id);
    if (!userToUpdate) {
        throw new AppError('User not found.', 404);
    }

    if (req.user.role !== ROLE_ENUM.ADMIN) {
        throw new AppError('Access denied: Only administrators can update user roles.', 403);
    }

    if (userToUpdate._id.equals(req.user._id) && role.toLowerCase() !== ROLE_ENUM.ADMIN) {
        throw new AppError('Administrators cannot change their own global role to a non-admin role via this endpoint.', 403);
    }

    const oldRole = userToUpdate.role;
    userToUpdate.role = role.toLowerCase();
    const updatedUser = await userToUpdate.save();

    logger.info(`UserController: User ${updatedUser.email} global role changed from ${oldRole} to ${updatedUser.role} by ${req.user.email}.`);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.USER_ROLE_UPDATED, // Changed from UPDATE
        user: req.user._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
        resourceId: updatedUser._id,
        oldValue: { role: oldRole },
        newValue: { role: updatedUser.role },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        description: `User ${updatedUser.email} global role changed to ${updatedUser.role} by ${req.user.email}.`,
        status: 'success'
    });

    res.status(200).json({
        success: true,
        message: `User role updated to ${updatedUser.role}.`,
        user: {
            _id: updatedUser._id,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            email: updatedUser.email,
            role: updatedUser.role,
            status: updatedUser.status
        }
    });
});

module.exports = {
    getUserProfile, // Make sure this is exported
    updateUserProfile,
    getAllUsers,
    getUserById,
    createUser,
    updateUserById,
    deleteUserById,
    approveUser,
    updateUserRole,
};