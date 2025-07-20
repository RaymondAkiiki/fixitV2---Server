// src/services/userService.js

const User = require('../models/user');
const PropertyUser = require('../models/propertyUser');
const Property = require('../models/property');
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Notification = require('../models/notification');
const Comment = require('../models/comment');
const auditService = require('./auditService');
const emailService = require('./emailService');
const notificationService = require('./notificationService');
const authService = require('./authService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const crypto = require('crypto');
const mongoose = require('mongoose');

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    REGISTRATION_STATUS_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM
} = require('../utils/constants/enums');

const {
    FRONTEND_URL = 'http://localhost:5173',
    APP_NAME = 'Fix It by Threalty'
} = process.env;

/**
 * Get the authenticated user's profile with property associations
 * @param {string} userId - The ID of the authenticated user
 * @returns {Promise<Object>} User profile with associations
 */
const getUserProfile = async (userId) => {
    try {
        // Get the user and exclude sensitive fields
        const userProfile = await User.findById(userId)
            .select('-passwordHash -resetPasswordToken -resetPasswordExpires -twoFactorSecret');

        if (!userProfile) {
            throw new AppError('User profile not found.', 404);
        }

        // Get all property associations for this user
        const associations = await PropertyUser.find({ user: userProfile._id, isActive: true })
            .populate('property', 'name address')
            .populate('unit', 'unitName');

        // Organize property associations by role
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
            if (assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.VENDOR_ACCESS) && assoc.property) {
                userAssociations.vendorAssignments.push(assoc.property);
            }
            if (assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS) && assoc.property) {
                userAssociations.adminAccess.push(assoc.property);
            }
        });

        // Format user for response
        const plainUser = userProfile.toObject();
        plainUser.id = plainUser._id.toString();
        delete plainUser._id;
        delete plainUser.__v;
        plainUser.associations = userAssociations;

        return plainUser;
    } catch (error) {
        logger.error(`UserService - Error getting user profile: ${error.message}`, { userId });
        throw error instanceof AppError ? error : new AppError(`Failed to get user profile: ${error.message}`, 500);
    }
};

/**
 * Update the authenticated user's profile
 * @param {string} userId - The ID of the authenticated user
 * @param {Object} updateData - Data to update
 * @param {string} [updateData.firstName] - First name
 * @param {string} [updateData.lastName] - Last name
 * @param {string} [updateData.phone] - Phone number
 * @param {string} [updateData.avatar] - Avatar URL
 * @param {Object} [updateData.preferences] - User preferences
 * @param {string} ipAddress - IP address for audit log
 * @returns {Promise<Object>} Updated user profile
 */
const updateUserProfile = async (userId, updateData, ipAddress) => {
    try {
        const user = await User.findById(userId);
        if (!user) {
            throw new AppError('User not found.', 404);
        }

        const oldUser = user.toObject();
        
        // Update fields if provided
        const { firstName, lastName, phone, avatar, preferences } = updateData;
        
        if (firstName !== undefined) user.firstName = firstName;
        if (lastName !== undefined) user.lastName = lastName;
        if (phone !== undefined) user.phone = phone;
        if (avatar !== undefined) user.avatar = avatar;
        if (preferences) user.preferences = { ...user.preferences, ...preferences };

        const updatedUser = await user.save();
        logger.info(`UserService: User profile updated for ${updatedUser.email}`);

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            updatedUser._id,
            {
                userId,
                ipAddress,
                description: `User ${updatedUser.email} updated their profile.`,
                status: 'success',
                oldValue: {
                    firstName: oldUser.firstName,
                    lastName: oldUser.lastName,
                    phone: oldUser.phone,
                    avatar: oldUser.avatar,
                    preferences: oldUser.preferences
                },
                newValue: {
                    firstName: updatedUser.firstName,
                    lastName: updatedUser.lastName,
                    phone: updatedUser.phone,
                    avatar: updatedUser.avatar,
                    preferences: updatedUser.preferences
                }
            }
        );

        // Return sanitized user object
        return {
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
        };
    } catch (error) {
        logger.error(`UserService - Error updating user profile: ${error.message}`, { userId });
        throw error instanceof AppError ? error : new AppError(`Failed to update user profile: ${error.message}`, 500);
    }
};

/**
 * Get all users with filtering and pagination, respecting access control
 * @param {Object} currentUser - The authenticated user making the request
 * @param {Object} filters - Filters to apply
 * @param {string} [filters.role] - Filter by role
 * @param {string} [filters.status] - Filter by status
 * @param {string} [filters.search] - Search term for name, email, phone
 * @param {string} [filters.propertyId] - Filter by property
 * @param {string} [filters.unitId] - Filter by unit
 * @param {number} [page=1] - Page number
 * @param {number} [limit=10] - Items per page
 * @param {string} ipAddress - IP address for audit log
 * @returns {Promise<Object>} Paginated users list
 */
const getAllUsers = async (currentUser, filters, page = 1, limit = 10, ipAddress) => {
    try {
        const skip = (parseInt(page) - 1) * parseInt(limit);
        let userFilter = {};
        let propertyUserFilter = {};

        // Apply access control based on user role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin can view all users
        } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            // Get properties managed by the current user
            const managedPropertyIds = await PropertyUser.find({
                user: currentUser._id,
                isActive: true,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD,
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]}
            }).distinct('property');

            if (managedPropertyIds.length === 0) {
                return {
                    users: [],
                    count: 0,
                    total: 0,
                    page: parseInt(page),
                    limit: parseInt(limit)
                };
            }
            
            propertyUserFilter.property = { $in: managedPropertyIds };
        } else {
            throw new AppError('Access denied: You do not have permission to view other users.', 403);
        }

        // Apply role filter
        if (filters.role) {
            if (!Object.values(ROLE_ENUM).includes(filters.role.toLowerCase())) {
                throw new AppError(`Invalid role filter: ${filters.role}`, 400);
            }
            userFilter.role = filters.role.toLowerCase();
        }

        // Apply status filter
        if (filters.status) {
            if (!Object.values(REGISTRATION_STATUS_ENUM).includes(filters.status.toLowerCase())) {
                throw new AppError(`Invalid status filter: ${filters.status}`, 400);
            }
            userFilter.status = filters.status.toLowerCase();
        }

        // Apply search filter
        if (filters.search) {
            userFilter.$or = [
                { firstName: { $regex: filters.search, $options: 'i' } },
                { lastName: { $regex: filters.search, $options: 'i' } },
                { email: { $regex: filters.search, $options: 'i' } },
                { phone: { $regex: filters.search, $options: 'i' } }
            ];
        }

        // Apply property filter
        if (filters.propertyId) {
            if (!propertyUserFilter.property) {
                propertyUserFilter.property = filters.propertyId;
            } else {
                // Ensure propertyId is within the already filtered managedPropertyIds
                propertyUserFilter.property = {
                    $in: Array.isArray(propertyUserFilter.property.$in) ?
                        propertyUserFilter.property.$in.filter(pId => pId.toString() === filters.propertyId) :
                        [filters.propertyId]
                };
                
                if (Array.isArray(propertyUserFilter.property.$in) && propertyUserFilter.property.$in.length === 0) {
                    return {
                        users: [],
                        count: 0,
                        total: 0,
                        page: parseInt(page),
                        limit: parseInt(limit)
                    };
                }
            }
        }

        // Apply unit filter
        if (filters.unitId) {
            propertyUserFilter.unit = filters.unitId;
        }

        // Get users based on property associations if needed
        let usersToFetchIds = [];
        if (Object.keys(propertyUserFilter).length > 0) {
            usersToFetchIds = await PropertyUser.find(propertyUserFilter).distinct('user');
            if (usersToFetchIds.length === 0) {
                return {
                    users: [],
                    count: 0,
                    total: 0,
                    page: parseInt(page),
                    limit: parseInt(limit)
                };
            }
            userFilter._id = { $in: usersToFetchIds };
        }

        // Fetch users with pagination
        const users = await User.find(userFilter)
            .select('-passwordHash -resetPasswordToken -resetPasswordExpires -twoFactorSecret')
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip(skip);

        const totalUsers = await User.countDocuments(userFilter);

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.FETCH_ALL_USERS,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            null,
            {
                userId: currentUser._id,
                ipAddress,
                description: `User ${currentUser.email} fetched list of users.`,
                status: 'success',
                metadata: { filters, page, limit }
            }
        );

        return {
            users,
            count: users.length,
            total: totalUsers,
            page: parseInt(page),
            limit: parseInt(limit)
        };
    } catch (error) {
        logger.error(`UserService - Error getting all users: ${error.message}`, { userId: currentUser._id });
        throw error instanceof AppError ? error : new AppError(`Failed to get users: ${error.message}`, 500);
    }
};

/**
 * Get a specific user by ID with access control
 * @param {string} userId - The ID of the user to fetch
 * @param {Object} currentUser - The authenticated user making the request
 * @param {string} ipAddress - IP address for audit log
 * @returns {Promise<Object>} User details with property associations
 */
const getUserById = async (userId, currentUser, ipAddress) => {
    try {
        const user = await User.findById(userId)
            .select('-passwordHash -resetPasswordToken -resetPasswordExpires -twoFactorSecret');

        if (!user) {
            throw new AppError('User not found.', 404);
        }

        // Apply access control based on user role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin has full access
        } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            // Get properties managed by the current user
            const managedPropertyIds = await PropertyUser.find({
                user: currentUser._id,
                isActive: true,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD,
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]}
            }).distinct('property');

            if (managedPropertyIds.length === 0) {
                throw new AppError('Access denied: You do not manage any properties.', 403);
            }

            // Check if the requested user is associated with any of the managed properties
            const isAssociated = await PropertyUser.exists({
                user: userId,
                property: { $in: managedPropertyIds },
                isActive: true
            });

            if (!isAssociated) {
                throw new AppError('Access denied: You do not have permission to view this user.', 403);
            }
        } else {
            throw new AppError('Access denied: You do not have permission to view other user profiles.', 403);
        }

        // Get property associations for this user
        const propertyAssociations = await PropertyUser.find({
            user: user._id,
            property: currentUser.role === ROLE_ENUM.ADMIN ? 
                { $exists: true } : 
                { $in: await PropertyUser.find({ user: currentUser._id }).distinct('property') },
            isActive: true
        })
            .populate('property', 'name address')
            .populate('unit', 'unitName');

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ONE_USER,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            userId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `User ${currentUser.email} fetched details for user ${user.email}.`,
                status: 'success'
            }
        );

        return {
            ...user.toObject(),
            propertyAssociations
        };
    } catch (error) {
        logger.error(`UserService - Error getting user by ID: ${error.message}`, { userId, currentUserId: currentUser._id });
        throw error instanceof AppError ? error : new AppError(`Failed to get user details: ${error.message}`, 500);
    }
};

/**
 * Create a new user with permission checks
 * @param {Object} userData - User data
 * @param {string} userData.firstName - First name
 * @param {string} userData.lastName - Last name
 * @param {string} userData.email - Email address
 * @param {string} userData.phone - Phone number
 * @param {string} userData.role - User role
 * @param {string} [userData.propertyId] - Associated property ID
 * @param {string} [userData.unitId] - Associated unit ID
 * @param {Object} currentUser - The authenticated user making the request
 * @param {string} ipAddress - IP address for audit log
 * @returns {Promise<Object>} Created user
 */
const createUser = async (userData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { firstName, lastName, email, phone, role, propertyId, unitId } = userData;

        // Permission checks
        if (![ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            throw new AppError('Access denied: You do not have permission to create users.', 403);
        }

        // Validate requirements for tenant and vendor roles
        if (role === ROLE_ENUM.TENANT && (!propertyId || !unitId)) {
            throw new AppError('Property ID and Unit ID are required for creating a tenant.', 400);
        }

        if (role === ROLE_ENUM.VENDOR && !propertyId) {
            throw new AppError('Property ID is required for creating a vendor.', 400);
        }

        // Check if current user has permission to create management roles
        if ([ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(role) && 
            currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Only administrators can create other admin, landlord, or property manager accounts.', 403);
        }

        // If associating with a property, verify the current user has access to that property
        if (propertyId) {
            const isAuthorizedProperty = await PropertyUser.exists({
                user: currentUser._id,
                property: propertyId,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD,
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            });

            if (!isAuthorizedProperty && currentUser.role !== ROLE_ENUM.ADMIN) {
                throw new AppError('Not authorized to create a user for this property.', 403);
            }
        }

        // Generate a temporary password
        const tempPassword = crypto.randomBytes(8).toString('hex');

        // Create the user via auth service
        const newUser = await authService.registerUser({
            firstName,
            lastName,
            email,
            phone,
            password: tempPassword,
            role,
            status: REGISTRATION_STATUS_ENUM.PENDING_PASSWORD_SET
        }, { session });

        // If property is provided, create property association
        if (propertyId) {
            // Map role to property user role
            let assignedPropertyRole = role.toLowerCase();
            if (assignedPropertyRole === ROLE_ENUM.LANDLORD) {
                assignedPropertyRole = PROPERTY_USER_ROLES_ENUM.LANDLORD;
            } else if (assignedPropertyRole === ROLE_ENUM.PROPERTY_MANAGER) {
                assignedPropertyRole = PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER;
            } else if (assignedPropertyRole === ROLE_ENUM.TENANT) {
                assignedPropertyRole = PROPERTY_USER_ROLES_ENUM.TENANT;
            } else if (assignedPropertyRole === ROLE_ENUM.VENDOR) {
                assignedPropertyRole = PROPERTY_USER_ROLES_ENUM.VENDOR_ACCESS;
            }

            await PropertyUser.create([{
                user: newUser._id,
                property: propertyId,
                unit: unitId || null,
                roles: [assignedPropertyRole],
                invitedBy: currentUser._id,
                isActive: true,
                startDate: new Date()
            }], { session });

            logger.info(`UserService: Created PropertyUser association for ${newUser.email} to property ${propertyId}.`);
        }

        // Generate password reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        newUser.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        newUser.resetPasswordExpires = Date.now() + 3600000 * 24; // 24 hours
        await newUser.save({ session, validateBeforeSave: false });

        // Generate set password URL
        const setPasswordUrl = `${FRONTEND_URL}/reset-password/${resetToken}`;

        // Get property name if provided
        let propertyName = '';
        if (propertyId) {
            const property = await Property.findById(propertyId).session(session);
            propertyName = property ? property.name : '';
        }

        // Send email invitation
        await emailService.sendInvitationEmail({
            to: newUser.email,
            inviteLink: setPasswordUrl,
            role: newUser.role,
            invitedByUserName: `${currentUser.firstName} ${currentUser.lastName}`.trim() || 'A user',
            propertyDisplayName: propertyName || 'our system'
        });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.USER_CREATED,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            newUser._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `User ${currentUser.email} manually created new user: ${newUser.email} with role: ${newUser.role}.`,
                status: 'success',
                newValue: {
                    email: newUser.email,
                    role: newUser.role,
                    status: newUser.status,
                    propertyId,
                    unitId
                }
            },
            { session }
        );

        await session.commitTransaction();

        // Return sanitized user object
        return {
            _id: newUser._id,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            email: newUser.email,
            role: newUser.role,
            status: newUser.status
        };
    } catch (error) {
        await session.abortTransaction();
        logger.error(`UserService - Error creating user: ${error.message}`, {
            email: userData?.email,
            currentUserId: currentUser._id
        });
        throw error instanceof AppError ? error : new AppError(`Failed to create user: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Update a user by ID with permission checks
 * @param {string} userId - The ID of the user to update
 * @param {Object} updateData - Data to update
 * @param {Object} currentUser - The authenticated user making the request
 * @param {string} ipAddress - IP address for audit log
 * @returns {Promise<Object>} Updated user
 */
const updateUserById = async (userId, updateData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { firstName, lastName, phone, avatar, preferences, role, status } = updateData;

        const userToUpdate = await User.findById(userId).session(session);
        if (!userToUpdate) {
            throw new AppError('User not found.', 404);
        }

        const oldUser = userToUpdate.toObject();

        // Apply updates based on current user's role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin can update all fields
            if (firstName !== undefined) userToUpdate.firstName = firstName;
            if (lastName !== undefined) userToUpdate.lastName = lastName;
            if (phone !== undefined) userToUpdate.phone = phone;
            if (avatar !== undefined) userToUpdate.avatar = avatar;
            if (preferences) userToUpdate.preferences = { ...userToUpdate.preferences, ...preferences };

            // Role update checks
            if (role !== undefined && role !== userToUpdate.role) {
                // Check if admin is trying to change their own role to non-admin
                if (userToUpdate._id.equals(currentUser._id) && role !== ROLE_ENUM.ADMIN) {
                    throw new AppError('Administrators cannot change their own global role to a non-admin role.', 403);
                }
                
                // Validate role
                if (!Object.values(ROLE_ENUM).includes(role.toLowerCase())) {
                    throw new AppError(`Invalid role provided: ${role}`, 400);
                }
                
                userToUpdate.role = role.toLowerCase();
            }

            // Status update
            if (status !== undefined && status !== userToUpdate.status) {
                if (!Object.values(REGISTRATION_STATUS_ENUM).includes(status.toLowerCase())) {
                    throw new AppError(`Invalid status provided: ${status}`, 400);
                }
                userToUpdate.status = status.toLowerCase();
                userToUpdate.isActive = (status.toLowerCase() === REGISTRATION_STATUS_ENUM.ACTIVE);
            }
        } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            // Landlord/PM can only update certain users they manage
            const managedPropertyIds = await PropertyUser.find({
                user: currentUser._id,
                isActive: true,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD,
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]}
            }).distinct('property');

            const isAssociated = await PropertyUser.exists({
                user: userId,
                property: { $in: managedPropertyIds },
                isActive: true
            });

            if (!isAssociated) {
                throw new AppError('Access denied: You are not authorized to update this user.', 403);
            }

            // Prevent Landlord/PM from updating management roles or their own account
            if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.ADMIN].includes(userToUpdate.role) || 
                userToUpdate._id.equals(currentUser._id)) {
                throw new AppError('Not authorized to update this user role or your own account via this endpoint.', 403);
            }

            // Apply allowed updates
            if (firstName !== undefined) userToUpdate.firstName = firstName;
            if (lastName !== undefined) userToUpdate.lastName = lastName;
            if (phone !== undefined) userToUpdate.phone = phone;
            if (avatar !== undefined) userToUpdate.avatar = avatar;
            if (preferences) userToUpdate.preferences = { ...userToUpdate.preferences, ...preferences };

            // Status update for property associations
            if (status !== undefined && status !== userToUpdate.status) {
                if (!Object.values(REGISTRATION_STATUS_ENUM).includes(status.toLowerCase())) {
                    throw new AppError(`Invalid status provided: ${status}`, 400);
                }
                userToUpdate.status = status.toLowerCase();
                userToUpdate.isActive = (status.toLowerCase() === REGISTRATION_STATUS_ENUM.ACTIVE);

                // Update property associations
                await PropertyUser.updateMany(
                    { user: userId, property: { $in: managedPropertyIds } },
                    { $set: { isActive: userToUpdate.isActive, endDate: userToUpdate.isActive ? null : new Date() } },
                    { session }
                );
            }

            // Restricted fields for landlord/PM
            if (role !== undefined && role !== userToUpdate.role) {
                throw new AppError('Landlords/Property Managers cannot directly change global user roles.', 403);
            }
            if (updateData.email !== undefined && updateData.email !== userToUpdate.email) {
                throw new AppError('Landlords/Property Managers cannot directly change user email addresses.', 403);
            }
        } else {
            throw new AppError('Access denied: You do not have permission to update users.', 403);
        }

        // Save the updated user
        const updatedUser = await userToUpdate.save({ session });
        logger.info(`UserService: User ${updatedUser.email} updated by ${currentUser.email}.`);

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            updatedUser._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `User ${updatedUser.email} updated by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldUser,
                newValue: updatedUser.toObject()
            },
            { session }
        );

        await session.commitTransaction();

        // Return sanitized user object
        return {
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
        };
    } catch (error) {
        await session.abortTransaction();
        logger.error(`UserService - Error updating user: ${error.message}`, { userId, currentUserId: currentUser._id });
        throw error instanceof AppError ? error : new AppError(`Failed to update user: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Delete a user by ID with permission checks
 * @param {string} userId - The ID of the user to delete
 * @param {Object} currentUser - The authenticated user making the request
 * @param {string} ipAddress - IP address for audit log
 * @returns {Promise<void>}
 */
const deleteUserById = async (userId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Prevent self-deletion
        if (currentUser._id.toString() === userId) {
            throw new AppError('You cannot delete your own account via this endpoint.', 400);
        }

        const userToDelete = await User.findById(userId).session(session);
        if (!userToDelete) {
            throw new AppError('User not found.', 404);
        }

        // Only admins can delete users, and they cannot delete other management roles
        if (currentUser.role !== ROLE_ENUM.ADMIN || 
            [ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(userToDelete.role)) {
            throw new AppError('Access denied: Only administrators can delete users, and cannot delete other management roles.', 403);
        }

        // Store user data for audit
        const userData = userToDelete.toObject();

        // Delete property associations
        await PropertyUser.deleteMany({ user: userId }, { session });
        logger.info(`UserService: Deleted PropertyUser associations for user ${userToDelete.email}.`);

        // Update references in requests and scheduled maintenance
        await Request.updateMany(
            { $or: [{ createdBy: userId }, { assignedTo: userId }] },
            { $unset: { createdBy: 1, assignedTo: 1, assignedToModel: 1 } },
            { session }
        );
        
        await ScheduledMaintenance.updateMany(
            { $or: [{ createdBy: userId }, { assignedTo: userId }] },
            { $unset: { createdBy: 1, assignedTo: 1, assignedToModel: 1 } },
            { session }
        );
        
        logger.info(`UserService: Updated Request and ScheduledMaintenance references for user ${userToDelete.email}.`);

        // Delete notifications
        await Notification.deleteMany(
            { $or: [{ recipient: userId }, { sender: userId }] }, 
            { session }
        );
        
        logger.info(`UserService: Deleted notifications for user ${userToDelete.email}.`);

        // Delete comments
        await Comment.deleteMany({ sender: userId }, { session });
        logger.info(`UserService: Deleted comments by user ${userToDelete.email}.`);

        // Delete the user
        await userToDelete.deleteOne({ session });
        logger.info(`UserService: User ${userToDelete.email} deleted by ${currentUser.email}.`);

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            userId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `User ${userToDelete.email} deleted by ${currentUser.email}.`,
                status: 'success',
                oldValue: userData,
                newValue: null
            },
            { session }
        );

        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        logger.error(`UserService - Error deleting user: ${error.message}`, { userId, currentUserId: currentUser._id });
        throw error instanceof AppError ? error : new AppError(`Failed to delete user: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Approve a pending user
 * @param {string} userId - The ID of the user to approve
 * @param {Object} currentUser - The authenticated user making the request
 * @param {string} ipAddress - IP address for audit log
 * @returns {Promise<Object>} Approved user
 */
const approveUser = async (userId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const userToApprove = await User.findById(userId).session(session);
        if (!userToApprove) {
            throw new AppError('User not found.', 404);
        }

        if (userToApprove.status === REGISTRATION_STATUS_ENUM.ACTIVE) {
            throw new AppError('User is already active.', 400);
        }

        // Apply permission checks
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin can approve any user
        } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            // Get properties managed by the current user
            const managedPropertyIds = await PropertyUser.find({
                user: currentUser._id,
                isActive: true,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD,
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]}
            }).distinct('property');

            // Check if user has inactive associations with managed properties
            const isAssociated = await PropertyUser.exists({
                user: userId,
                property: { $in: managedPropertyIds },
                isActive: false,
                roles: { $in: [PROPERTY_USER_ROLES_ENUM.TENANT, PROPERTY_USER_ROLES_ENUM.VENDOR_ACCESS] }
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

        // Store old values for audit
        const oldStatus = userToApprove.status;
        const oldIsActive = userToApprove.isActive;

        // Update user status
        userToApprove.status = REGISTRATION_STATUS_ENUM.ACTIVE;
        userToApprove.isActive = true;
        const updatedUser = await userToApprove.save({ session });

        // Activate associated property user entries
        await PropertyUser.updateMany(
            { user: userId, isActive: false },
            { $set: { isActive: true, startDate: new Date(), endDate: null } },
            { session }
        );

        logger.info(`UserService: User ${updatedUser.email} approved by ${currentUser.email}.`);

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.USER_APPROVED,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            updatedUser._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `User ${updatedUser.email} approved by ${currentUser.email}.`,
                status: 'success',
                oldValue: { status: oldStatus, isActive: oldIsActive },
                newValue: { status: updatedUser.status, isActive: updatedUser.isActive }
            },
            { session }
        );

        // Send approval notification
        try {
            await notificationService.sendNotification({
                recipientId: userId,
                type: NOTIFICATION_TYPE_ENUM.USER_APPROVED,
                message: `Your account has been approved by ${currentUser.firstName} ${currentUser.lastName}.`,
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
                relatedResourceId: userId,
                emailDetails: {
                    subject: `Your ${APP_NAME} Account Has Been Approved`,
                    html: `
                        <p>Hello ${updatedUser.firstName},</p>
                        <p>Your account on ${APP_NAME} has been approved by ${currentUser.firstName} ${currentUser.lastName}.</p>
                        <p>You can now log in using your credentials.</p>
                        <p><a href="${FRONTEND_URL}/login">Click here to log in</a></p>
                        <p>Best regards,<br>The ${APP_NAME} Team</p>
                    `,
                    text: `Hello ${updatedUser.firstName}, Your account on ${APP_NAME} has been approved by ${currentUser.firstName} ${currentUser.lastName}. You can now log in using your credentials. ${FRONTEND_URL}/login`
                },
                senderId: currentUser._id
            });
        } catch (notificationError) {
            logger.warn(`Failed to send approval notification to user ${userId}: ${notificationError.message}`);
            // Continue even if notification fails
        }

        await session.commitTransaction();

        // Return sanitized user object
        return {
            _id: updatedUser._id,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            email: updatedUser.email,
            role: updatedUser.role,
            status: updatedUser.status,
            isActive: updatedUser.isActive
        };
    } catch (error) {
        await session.abortTransaction();
        logger.error(`UserService - Error approving user: ${error.message}`, { userId, currentUserId: currentUser._id });
        throw error instanceof AppError ? error : new AppError(`Failed to approve user: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Update a user's global role (admin only)
 * @param {string} userId - The ID of the user to update
 * @param {string} role - New role to assign
 * @param {Object} currentUser - The authenticated user making the request
 * @param {string} ipAddress - IP address for audit log
 * @returns {Promise<Object>} Updated user
 */
const updateUserRole = async (userId, role, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Validate role
        if (!Object.values(ROLE_ENUM).includes(role.toLowerCase())) {
            throw new AppError('Invalid role provided.', 400);
        }

        // Find the user
        const userToUpdate = await User.findById(userId).session(session);
        if (!userToUpdate) {
            throw new AppError('User not found.', 404);
        }

        // Only admins can update roles
        if (currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Access denied: Only administrators can update user roles.', 403);
        }

        // Prevent admin from changing their own role to non-admin
        if (userToUpdate._id.equals(currentUser._id) && role.toLowerCase() !== ROLE_ENUM.ADMIN) {
            throw new AppError('Administrators cannot change their own global role to a non-admin role via this endpoint.', 403);
        }

        // Store old role for audit
        const oldRole = userToUpdate.role;

        // Update role
        userToUpdate.role = role.toLowerCase();
        const updatedUser = await userToUpdate.save({ session });

        logger.info(`UserService: User ${updatedUser.email} global role changed from ${oldRole} to ${updatedUser.role} by ${currentUser.email}.`);

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.USER_ROLE_UPDATED,
            AUDIT_RESOURCE_TYPE_ENUM.User,
            updatedUser._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `User ${updatedUser.email} global role changed to ${updatedUser.role} by ${currentUser.email}.`,
                status: 'success',
                oldValue: { role: oldRole },
                newValue: { role: updatedUser.role }
            },
            { session }
        );

        // Send notification about role change
        try {
            await notificationService.sendNotification({
                recipientId: userId,
                type: NOTIFICATION_TYPE_ENUM.ROLE_UPDATED,
                message: `Your account role has been updated to ${updatedUser.role} by ${currentUser.firstName} ${currentUser.lastName}.`,
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
                relatedResourceId: userId,
                emailDetails: {
                    subject: `Your ${APP_NAME} Account Role Has Been Updated`,
                    html: `
                        <p>Hello ${updatedUser.firstName},</p>
                        <p>Your account role on ${APP_NAME} has been updated to <strong>${updatedUser.role}</strong> by ${currentUser.firstName} ${currentUser.lastName}.</p>
                        <p>This change may affect your access permissions within the system.</p>
                        <p><a href="${FRONTEND_URL}/login">Click here to log in</a></p>
                        <p>Best regards,<br>The ${APP_NAME} Team</p>
                    `,
                    text: `Hello ${updatedUser.firstName}, Your account role on ${APP_NAME} has been updated to ${updatedUser.role} by ${currentUser.firstName} ${currentUser.lastName}. This change may affect your access permissions within the system. ${FRONTEND_URL}/login`
                },
                senderId: currentUser._id
            });
        } catch (notificationError) {
            logger.warn(`Failed to send role update notification to user ${userId}: ${notificationError.message}`);
            // Continue even if notification fails
        }

        await session.commitTransaction();

        // Return sanitized user object
        return {
            _id: updatedUser._id,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            email: updatedUser.email,
            role: updatedUser.role,
            status: updatedUser.status
        };
    } catch (error) {
        await session.abortTransaction();
        logger.error(`UserService - Error updating user role: ${error.message}`, { userId, role, currentUserId: currentUser._id });
        throw error instanceof AppError ? error : new AppError(`Failed to update user role: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

module.exports = {
    getUserProfile,
    updateUserProfile,
    getAllUsers,
    getUserById,
    createUser,
    updateUserById,
    deleteUserById,
    approveUser,
    updateUserRole
};