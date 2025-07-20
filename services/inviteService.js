// src/services/inviteService.js

const Invite = require('../models/invite');
const User = require('../models/user');
const Property = require('../models/property');
const PropertyUser = require('../models/propertyUser');
const Unit = require('../models/unit');
const auditService = require('./auditService');
const emailService = require('./emailService');
const notificationService = require('./notificationService');
const smsService = require('./smsService');
const { generateToken } = require('../utils/jwt');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const crypto = require('crypto');
const mongoose = require('mongoose');

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    INVITE_STATUS_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    REGISTRATION_STATUS_ENUM,
    NOTIFICATION_TYPE_ENUM
} = require('../utils/constants/enums');

const {
    FRONTEND_URL = 'http://localhost:5173',
    INVITE_EXPIRATION_DAYS = 7
} = process.env;

/**
 * Generates a unique token for an invitation
 * @returns {string} A secure random token
 */
const generateUniqueInviteToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * Generates an expiration date for an invitation
 * @param {number} [days=INVITE_EXPIRATION_DAYS] - Number of days until expiration
 * @returns {Date} The expiration date
 */
const generateInviteExpirationDate = (days = INVITE_EXPIRATION_DAYS) => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (parseInt(days) || 7));
    return expiresAt;
};

/**
 * Checks if a user has permission to invite others with specific roles
 * @param {string} inviterId - ID of the inviting user
 * @param {string} propertyId - ID of the property
 * @param {string[]} rolesToInvite - Roles being assigned to invitee
 * @returns {Promise<boolean>} True if the user has permission
 */
const checkInvitePermission = async (inviterId, propertyId, rolesToInvite) => {
    const inviter = await User.findById(inviterId);
    if (!inviter) {
        return false;
    }

    // Admin can invite anyone to any property/role
    if (inviter.role === ROLE_ENUM.ADMIN) {
        return true;
    }

    // For admin_access role with no property, only admins can invite
    if (rolesToInvite.includes('admin_access') && !propertyId) {
        return inviter.role === ROLE_ENUM.ADMIN;
    }

    // Get inviter's property association
    const inviterPropertyUser = await PropertyUser.findOne({
        user: inviterId,
        property: propertyId,
        isActive: true,
        roles: { $in: [
            PROPERTY_USER_ROLES_ENUM.LANDLORD, 
            PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
            PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
        ]}
    });

    if (!inviterPropertyUser) {
        return false;
    }

    // Check permissions for each role being invited
    for (const role of rolesToInvite) {
        if (role === PROPERTY_USER_ROLES_ENUM.TENANT) {
            // Landlords/PMs can invite tenants
            if (!inviterPropertyUser.roles.some(r => [
                PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
            ].includes(r))) {
                return false;
            }
        } else if (role === PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER) {
            // Only Landlords or Admins can invite Property Managers
            if (!inviterPropertyUser.roles.includes(PROPERTY_USER_ROLES_ENUM.LANDLORD) && 
                inviter.role !== ROLE_ENUM.ADMIN) {
                return false;
            }
        } else if (role === PROPERTY_USER_ROLES_ENUM.LANDLORD || role === PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS) {
            // Only global Admins can invite Landlords or grant admin_access
            if (inviter.role !== ROLE_ENUM.ADMIN) {
                return false;
            }
        }
    }

    return true;
};

/**
 * Creates and sends a new invitation
 * @param {Object} inviteData - Invitation details
 * @param {string} inviteData.email - Invitee's email address
 * @param {string[]} inviteData.roles - Roles to assign
 * @param {string} [inviteData.propertyId] - Associated property ID
 * @param {string} [inviteData.unitId] - Associated unit ID
 * @param {string} inviteData.invitedBy - ID of user sending invite
 * @param {string} [inviteData.ipAddress] - IP address of requestor
 * @returns {Promise<Object>} The created invitation
 */
const createInvite = async (inviteData) => {
    const { email, roles, propertyId, unitId, invitedBy, ipAddress } = inviteData;
    const session = await mongoose.startSession();
    
    try {
        session.startTransaction();
        
        // Validate property exists if provided
        let property = null;
        if (propertyId) {
            property = await Property.findById(propertyId).session(session);
            if (!property) {
                throw new AppError('Property not found.', 404);
            }
        } else if (!roles.includes('admin_access')) {
            throw new AppError('Property ID is required for non-admin invites.', 400);
        }

        // Validate unit exists if provided
        let unit = null;
        if (unitId) {
            unit = await Unit.findById(unitId).session(session);
            if (!unit) {
                throw new AppError('Unit not found.', 404);
            }
            
            if (property && unit.property.toString() !== propertyId) {
                throw new AppError('Unit does not belong to the specified property.', 400);
            }
        } else if (roles.includes('tenant')) {
            throw new AppError('Unit ID is required for tenant invites.', 400);
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email }).session(session);
        
        // Check for existing active property-user association
        if (existingUser && propertyId) {
            const existingPropertyUser = await PropertyUser.findOne({
                user: existingUser._id,
                property: propertyId,
                unit: unitId || null,
                roles: { $in: roles },
                isActive: true
            }).session(session);
            
            if (existingPropertyUser) {
                throw new AppError(
                    `User with email ${email} is already an active ${roles.join(', ')} for this property/unit.`, 
                    409
                );
            }
        }

        // Check for existing pending invite
        const existingPendingInvite = await Invite.findOne({
            email,
            property: propertyId || null,
            unit: unitId || null,
            roles: { $in: roles },
            status: 'pending'
        }).session(session);
        
        if (existingPendingInvite) {
            throw new AppError(
                `A pending invitation for ${email} as a ${roles.join(', ')} already exists for this property/unit.`, 
                409
            );
        }

        // Create the invite
        const token = generateUniqueInviteToken();
        const expiresAt = generateInviteExpirationDate();

        const newInvite = new Invite({
            email,
            roles,
            property: propertyId || null,
            unit: unitId || null,
            token,
            expiresAt,
            generatedBy: invitedBy,
            status: 'pending'
        });

        const createdInvite = await newInvite.save({ session });

        // Get inviter details for notification
        const inviter = await User.findById(invitedBy).session(session);
        const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}`.trim() : 'LeaseLogix Admin';
        
        // Build invite link for frontend
        const inviteLink = `${FRONTEND_URL}/accept-invite/${token}`;
        
        // Get property and unit names
        const propertyName = property ? property.name : 'Global System';
        const unitName = unit ? unit.unitName : null;
        
        // Send email invitation
        await emailService.sendInvitationEmail({
            to: email,
            inviteLink,
            role: roles.join(', '),
            invitedByUserName: inviterName,
            propertyDisplayName: unitName ? `${propertyName} - Unit ${unitName}` : propertyName
        });
        
        // If phone number is provided with invite data, send SMS too
        if (inviteData.phone) {
            try {
                await smsService.sendInvitationSms({
                    to: inviteData.phone,
                    inviteLink,
                    role: roles.join(', '),
                    invitedByName: inviterName,
                    propertyName: unitName ? `${propertyName} - Unit ${unitName}` : propertyName
                });
            } catch (smsError) {
                // Log but don't fail if SMS fails
                logger.warn(`Failed to send invitation SMS to ${inviteData.phone}: ${smsError.message}`);
            }
        }
        
        // If existing user, send in-app notification
        if (existingUser) {
            try {
                await notificationService.sendNotification({
                    recipientId: existingUser._id,
                    type: NOTIFICATION_TYPE_ENUM.INVITATION,
                    message: `You've been invited as a ${roles.join(', ')} for ${propertyName}${unitName ? ` - Unit ${unitName}` : ''}`,
                    link: inviteLink,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
                    relatedResourceId: createdInvite._id,
                    emailDetails: {
                        subject: `Invitation to ${propertyName}`,
                        html: `<p>You've been invited as a ${roles.join(', ')} for ${propertyName}${unitName ? ` - Unit ${unitName}` : ''}. <a href="${inviteLink}">Click here to accept.</a></p>`,
                        text: `You've been invited as a ${roles.join(', ')} for ${propertyName}${unitName ? ` - Unit ${unitName}` : ''}. Accept here: ${inviteLink}`
                    },
                    senderId: invitedBy
                });
            } catch (notificationError) {
                // Log but don't fail if notification fails
                logger.warn(`Failed to send in-app notification for invitation: ${notificationError.message}`);
            }
        }
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.Invite,
            createdInvite._id,
            {
                userId: invitedBy,
                ipAddress,
                description: `Invitation sent to ${email} for roles ${roles.join(', ')} for property ${propertyName}.`,
                status: 'success',
                metadata: {
                    email,
                    roles,
                    propertyId: propertyId || null,
                    unitId: unitId || null,
                    expiresAt
                }
            }
        );

        await session.commitTransaction();
        logger.info(`InviteService: Invitation sent to ${email} for roles ${roles.join(', ')} by ${inviter?.email || 'unknown'}.`);
        
        return createdInvite;
    } catch (error) {
        await session.abortTransaction();
        logger.error(`InviteService error creating invite: ${error.message}`, error);
        throw error instanceof AppError ? error : new AppError(`Failed to create invitation: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets invitations based on user's access and filters
 * @param {Object} currentUser - The authenticated user
 * @param {Object} [filters={}] - Optional filters
 * @param {string} [filters.status] - Filter by invite status
 * @param {string} [filters.propertyId] - Filter by property
 * @param {string} [filters.email] - Filter by email
 * @param {number} [page=1] - Page number for pagination
 * @param {number} [limit=10] - Items per page
 * @returns {Promise<Object>} Paginated invitations and count
 */
const getInvites = async (currentUser, filters = {}, page = 1, limit = 10) => {
    try {
        let query = {};
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Base filtering by user role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin sees all
        } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            const userAssociatedProperties = await PropertyUser.find({
                user: currentUser._id,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('property');

            if (userAssociatedProperties.length === 0) {
                return { invites: [], total: 0, page: parseInt(page), limit: parseInt(limit) };
            }
            
            query.property = { $in: userAssociatedProperties };
            
            // Non-admins can only see invites they generated
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                query.generatedBy = currentUser._id;
            }
        } else {
            throw new AppError('Not authorized to view invitations.', 403);
        }

        // Apply filters
        if (filters.status) {
            if (!INVITE_STATUS_ENUM.includes(filters.status.toLowerCase())) {
                throw new AppError(`Invalid status filter: ${filters.status}`, 400);
            }
            query.status = filters.status.toLowerCase();
        }
        
        if (filters.propertyId) {
            // Ensure user has access to this property
            const hasAccess = await checkInvitePermission(
                currentUser._id, 
                filters.propertyId, 
                [PROPERTY_USER_ROLES_ENUM.TENANT]
            );
            
            if (!hasAccess && currentUser.role !== ROLE_ENUM.ADMIN) {
                throw new AppError('Not authorized to view invites for this property.', 403);
            }
            
            query.property = filters.propertyId;
        }
        
        if (filters.email) {
            query.email = new RegExp(filters.email, 'i');
        }

        // Execute query with pagination
        const invites = await Invite.find(query)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('generatedBy', 'firstName lastName email')
            .populate('acceptedBy', 'firstName lastName email')
            .populate('revokedBy', 'firstName lastName email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Invite.countDocuments(query);

        // Log activity
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Invite,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched list of invites.`,
                status: 'success',
                metadata: { filters, page, limit }
            }
        );

        return {
            invites,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / parseInt(limit))
        };
    } catch (error) {
        logger.error(`InviteService error getting invites: ${error.message}`, error);
        throw error instanceof AppError ? error : new AppError(`Failed to get invitations: ${error.message}`, 500);
    }
};

/**
 * Gets a single invite by ID
 * @param {string} inviteId - Invite ID
 * @param {Object} [currentUser] - Optional authenticated user for access control
 * @returns {Promise<Object>} The invite document
 */
const getInviteById = async (inviteId, currentUser = null) => {
    try {
        const invite = await Invite.findById(inviteId)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('generatedBy', 'firstName lastName email')
            .populate('acceptedBy', 'firstName lastName email')
            .populate('revokedBy', 'firstName lastName email');
            
        if (!invite) {
            throw new AppError('Invitation not found.', 404);
        }
        
        // Access control if currentUser is provided
        if (currentUser && currentUser.role !== ROLE_ENUM.ADMIN) {
            // Check if user generated this invite
            const isInviter = invite.generatedBy && 
                invite.generatedBy._id.toString() === currentUser._id.toString();
                
            // Check if user has access to the property
            let hasPropertyAccess = false;
            if (invite.property) {
                const propertyAccess = await PropertyUser.exists({
                    user: currentUser._id,
                    property: invite.property._id,
                    roles: { $in: [
                        PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                        PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                        PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                    ]},
                    isActive: true
                });
                hasPropertyAccess = !!propertyAccess;
            }
            
            if (!isInviter && !hasPropertyAccess) {
                throw new AppError('Not authorized to access this invitation.', 403);
            }
        }
        
        // Log access if currentUser is provided
        if (currentUser) {
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.READ,
                AUDIT_RESOURCE_TYPE_ENUM.Invite,
                inviteId,
                {
                    userId: currentUser._id,
                    description: `User ${currentUser.email} accessed invite details.`,
                    status: 'success'
                }
            );
        }
        
        return invite;
    } catch (error) {
        logger.error(`InviteService error getting invite by ID: ${error.message}`, error);
        throw error instanceof AppError ? error : new AppError(`Failed to get invitation: ${error.message}`, 500);
    }
};

/**
 * Updates an invite's status
 * @param {string} inviteId - Invite ID
 * @param {string} newStatus - New status to set
 * @param {Object} [options={}] - Additional options
 * @param {string} [options.reason] - Reason for status change
 * @param {Object} [options.user] - User making the change
 * @param {string} [options.ipAddress] - IP address of request
 * @returns {Promise<Object>} Updated invite
 */
const updateInviteStatus = async (inviteId, newStatus, options = {}) => {
    const { reason, user, ipAddress } = options;
    const session = await mongoose.startSession();
    
    try {
        session.startTransaction();
        
        const invite = await Invite.findById(inviteId).session(session);
        if (!invite) {
            throw new AppError('Invitation not found.', 404);
        }

        // Validate status transition
        if (invite.status !== 'pending') {
            throw new AppError(`Cannot change status from ${invite.status} to ${newStatus}.`, 400);
        }
        
        if (!INVITE_STATUS_ENUM.includes(newStatus.toLowerCase())) {
            throw new AppError(`Invalid new status: ${newStatus}`, 400);
        }

        // Store old status for audit
        const oldStatus = invite.status;
        
        // Update invite
        invite.status = newStatus.toLowerCase();
        
        if (reason) {
            invite.declineReason = reason;
        }
        
        if (newStatus.toLowerCase() === 'cancelled') {
            invite.revokedAt = new Date();
            invite.revokedBy = user?._id || null;
        } else if (newStatus.toLowerCase() === 'expired') {
            invite.expiresAt = new Date(); // Force expiration
        } else if (newStatus.toLowerCase() === 'accepted') {
            invite.acceptedAt = new Date();
            invite.acceptedBy = user?._id || null;
        }

        const updatedInvite = await invite.save({ session });
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Invite,
            inviteId,
            {
                userId: user?._id || null,
                ipAddress: ipAddress || null,
                description: `Invitation status updated from ${oldStatus} to ${newStatus}.`,
                status: 'success',
                oldValue: { status: oldStatus },
                newValue: { 
                    status: newStatus,
                    declineReason: reason || null,
                    revokedAt: invite.revokedAt,
                    revokedBy: invite.revokedBy,
                    acceptedAt: invite.acceptedAt,
                    acceptedBy: invite.acceptedBy
                }
            }
        );
        
        await session.commitTransaction();
        logger.info(`InviteService: Invitation ${inviteId} status updated to ${newStatus}.`);
        
        return updatedInvite;
    } catch (error) {
        await session.abortTransaction();
        logger.error(`InviteService error updating invite status: ${error.message}`, error);
        throw error instanceof AppError ? error : new AppError(`Failed to update invitation status: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Accepts an invitation and creates/updates user account
 * @param {string} token - Invite token
 * @param {Object} userData - User data for account creation/update
 * @param {string} [ipAddress] - IP address of request
 * @returns {Promise<Object>} Result with user, token and status
 */
const acceptInvite = async (token, userData, ipAddress) => {
    const { firstName, lastName, email, password, phone } = userData;
    const session = await mongoose.startSession();
    
    try {
        session.startTransaction();
        
        // Find and validate invite
        const invite = await Invite.findOne({ 
            token, 
            status: 'pending' 
        }).populate('property', 'name').populate('unit', 'unitName').session(session);

        if (!invite) {
            throw new AppError('Invalid, expired, or already accepted invitation link.', 400);
        }

        if (invite.expiresAt < new Date()) {
            invite.status = 'expired';
            await invite.save({ session });
            throw new AppError('Invitation link has expired.', 400);
        }

        if (invite.email.toLowerCase() !== email.toLowerCase()) {
            throw new AppError('The email provided does not match the invited email.', 400);
        }

        // Track attempt
        invite.attemptCount += 1;
        invite.lastAttemptAt = new Date();
        await invite.save({ session });

        // Find or create user
        let user = await User.findOne({ email: invite.email }).select('+passwordHash').session(session);
        let isNewUser = false;

        if (!user) {
            // Validate required fields for new user
            if (!firstName || !lastName || !password) {
                throw new AppError('First name, last name, and password are required for new user registration.', 400);
            }
            
            // Create new user
            user = new User({
                firstName,
                lastName,
                email: invite.email,
                phone: phone || null,
                passwordHash: password, // Will be hashed in pre-save hook
                role: ROLE_ENUM.USER, // Default role
                registrationStatus: 'active',
                isEmailVerified: true // Email verified by accepting invite
            });
            
            await user.save({ session });
            isNewUser = true;
            logger.info(`InviteService: New user created via invite: ${user.email}`);
        } else {
            // Update existing user
            if (firstName) user.firstName = firstName;
            if (lastName) user.lastName = lastName;
            if (phone) user.phone = phone;
            user.registrationStatus = 'active';
            user.isEmailVerified = true;
            
            if (password) {
                user.passwordHash = password; // Will be hashed in pre-save hook
            }
            
            await user.save({ session });
            logger.info(`InviteService: Existing user updated via invite: ${user.email}`);
        }

        // Create PropertyUser associations for each role
        const propertyUserAssociations = [];
        
        for (const role of invite.roles) {
            // Skip creating PropertyUser for admin_access with no property
            if (role === 'admin_access' && !invite.property) {
                continue;
            }
            
            const propertyUserQuery = {
                user: user._id,
                property: invite.property,
                unit: invite.unit || null
            };
            
            const update = {
                $addToSet: { roles: role },
                $set: { 
                    isActive: true, 
                    invitedBy: invite.generatedBy || null,
                    startDate: new Date(),
                    endDate: null
                }
            };
            
            const propertyUser = await PropertyUser.findOneAndUpdate(
                propertyUserQuery,
                update,
                { 
                    upsert: true, 
                    new: true, 
                    setDefaultsOnInsert: true,
                    session 
                }
            );
            
            propertyUserAssociations.push(propertyUser);
            
            logger.info(`InviteService: PropertyUser association created/updated for ${user.email} as ${role} for property ${invite.property?._id || 'Global'}.`);
        }

        // Update invite status
        invite.status = 'accepted';
        invite.acceptedBy = user._id;
        invite.acceptedAt = new Date();
        await invite.save({ session });
        
        // Generate JWT token
        const jwtToken = generateToken({ id: user._id });
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Invite,
            invite._id,
            {
                userId: user._id,
                ipAddress,
                description: `Invitation accepted by ${user.email}.`,
                status: 'success',
                oldValue: { status: 'pending' },
                newValue: { 
                    status: 'accepted',
                    acceptedBy: user._id,
                    acceptedAt: invite.acceptedAt
                }
            }
        );
        
        // Send notification to inviter
        if (invite.generatedBy) {
            try {
                const propertyName = invite.property?.name || 'Global System';
                const unitName = invite.unit?.unitName || null;
                
                await notificationService.sendNotification({
                    recipientId: invite.generatedBy,
                    type: NOTIFICATION_TYPE_ENUM.INVITATION_ACCEPTED,
                    message: `${user.firstName} ${user.lastName} (${user.email}) has accepted your invitation as a ${invite.roles.join(', ')}${propertyName ? ` for ${propertyName}` : ''}${unitName ? ` - Unit ${unitName}` : ''}.`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
                    relatedResourceId: invite._id,
                    emailDetails: {
                        subject: `Invitation Accepted: ${user.email}`,
                        html: `<p>${user.firstName} ${user.lastName} (${user.email}) has accepted your invitation as a ${invite.roles.join(', ')}${propertyName ? ` for ${propertyName}` : ''}${unitName ? ` - Unit ${unitName}` : ''}.</p>`,
                        text: `${user.firstName} ${user.lastName} (${user.email}) has accepted your invitation as a ${invite.roles.join(', ')}${propertyName ? ` for ${propertyName}` : ''}${unitName ? ` - Unit ${unitName}` : ''}.`
                    },
                    senderId: user._id
                });
            } catch (notificationError) {
                // Log but don't fail if notification fails
                logger.warn(`Failed to send invitation acceptance notification: ${notificationError.message}`);
            }
        }
        
        await session.commitTransaction();
        logger.info(`InviteService: Invite ${invite._id} accepted by ${user.email}.`);
        
        return { 
            user: user.toObject(), 
            propertyUserAssociations,
            isNewUser,
            token: jwtToken
        };
    } catch (error) {
        await session.abortTransaction();
        logger.error(`InviteService error accepting invite: ${error.message}`, error);
        throw error instanceof AppError ? error : new AppError(`Failed to accept invitation: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Declines an invitation
 * @param {string} token - Invite token
 * @param {string} [reason] - Reason for declining
 * @param {string} [ipAddress] - IP address of request
 * @returns {Promise<Object>} Updated invite
 */
const declineInvite = async (token, reason = null, ipAddress = null) => {
    try {
        const invite = await Invite.findOne({ 
            token, 
            status: 'pending' 
        });

        if (!invite) {
            throw new AppError('Invalid, expired, or already processed invitation link.', 400);
        }

        if (invite.expiresAt < new Date()) {
            invite.status = 'expired';
            await invite.save();
            throw new AppError('Invitation link has expired.', 400);
        }

        invite.status = 'declined';
        invite.declineReason = reason;
        await invite.save();

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Invite,
            invite._id,
            {
                userId: null,
                externalUserIdentifier: invite.email,
                ipAddress,
                description: `Invitation for ${invite.email} declined. Reason: ${reason || 'Not provided'}.`,
                status: 'success',
                oldValue: { status: 'pending' },
                newValue: { 
                    status: 'declined',
                    declineReason: reason
                }
            }
        );
        
        // Send notification to inviter
        if (invite.generatedBy) {
            try {
                await notificationService.sendNotification({
                    recipientId: invite.generatedBy,
                    type: NOTIFICATION_TYPE_ENUM.INVITATION_DECLINED,
                    message: `${invite.email} has declined your invitation.`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
                    relatedResourceId: invite._id,
                    emailDetails: {
                        subject: `Invitation Declined: ${invite.email}`,
                        html: `<p>${invite.email} has declined your invitation. ${reason ? `Reason: ${reason}` : ''}</p>`,
                        text: `${invite.email} has declined your invitation. ${reason ? `Reason: ${reason}` : ''}`
                    }
                });
            } catch (notificationError) {
                // Log but don't fail if notification fails
                logger.warn(`Failed to send invitation decline notification: ${notificationError.message}`);
            }
        }

        logger.info(`InviteService: Invitation for ${invite.email} declined.`);
        return invite;
    } catch (error) {
        logger.error(`InviteService error declining invite: ${error.message}`, error);
        throw error instanceof AppError ? error : new AppError(`Failed to decline invitation: ${error.message}`, 500);
    }
};

/**
 * Cancels an invitation
 * @param {string} inviteId - Invite ID
 * @param {Object} cancellerUser - User cancelling the invite
 * @param {string} [ipAddress] - IP address of request
 * @returns {Promise<Object>} Updated invite
 */
const cancelInvite = async (inviteId, cancellerUser, ipAddress) => {
    try {
        const invite = await Invite.findById(inviteId)
            .populate('property', 'name')
            .populate('unit', 'unitName');
            
        if (!invite) {
            throw new AppError('Invitation not found.', 404);
        }

        // Authorization check
        if (cancellerUser.role !== ROLE_ENUM.ADMIN && 
            invite.generatedBy.toString() !== cancellerUser._id.toString()) {
            throw new AppError('You are not authorized to cancel this invitation.', 403);
        }

        if (invite.status !== 'pending') {
            throw new AppError(`Cannot cancel an invite with status: ${invite.status}. Only 'pending' invites can be cancelled.`, 400);
        }

        // Update invite
        invite.status = 'cancelled';
        invite.revokedBy = cancellerUser._id;
        invite.revokedAt = new Date();
        const updatedInvite = await invite.save();

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Invite,
            updatedInvite._id,
            {
                userId: cancellerUser._id,
                ipAddress,
                description: `Invitation for ${updatedInvite.email} cancelled by ${cancellerUser.email}.`,
                status: 'success',
                oldValue: { status: 'pending' },
                newValue: { 
                    status: 'cancelled',
                    revokedBy: updatedInvite.revokedBy,
                    revokedAt: updatedInvite.revokedAt
                }
            }
        );
        
        // Send notification to invited user if they exist
        const existingUser = await User.findOne({ email: invite.email });
        if (existingUser) {
            try {
                const propertyName = invite.property?.name || 'Global System';
                const unitName = invite.unit?.unitName || null;
                
                await notificationService.sendNotification({
                    recipientId: existingUser._id,
                    type: NOTIFICATION_TYPE_ENUM.INVITATION_CANCELLED,
                    message: `Your invitation as a ${invite.roles.join(', ')}${propertyName ? ` for ${propertyName}` : ''}${unitName ? ` - Unit ${unitName}` : ''} has been cancelled.`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
                    relatedResourceId: invite._id,
                    emailDetails: {
                        subject: `Invitation Cancelled`,
                        html: `<p>Your invitation as a ${invite.roles.join(', ')}${propertyName ? ` for ${propertyName}` : ''}${unitName ? ` - Unit ${unitName}` : ''} has been cancelled.</p>`,
                        text: `Your invitation as a ${invite.roles.join(', ')}${propertyName ? ` for ${propertyName}` : ''}${unitName ? ` - Unit ${unitName}` : ''} has been cancelled.`
                    },
                    senderId: cancellerUser._id
                });
            } catch (notificationError) {
                // Log but don't fail if notification fails
                logger.warn(`Failed to send invitation cancellation notification: ${notificationError.message}`);
            }
        }

        logger.info(`InviteService: Invitation ${updatedInvite._id} cancelled by ${cancellerUser.email}.`);
        return updatedInvite;
    } catch (error) {
        logger.error(`InviteService error cancelling invite: ${error.message}`, error);
        throw error instanceof AppError ? error : new AppError(`Failed to cancel invitation: ${error.message}`, 500);
    }
};

/**
 * Verifies an invite token
 * @param {string} token - Invite token
 * @returns {Promise<Object>} Invite details if valid
 */
const verifyInviteToken = async (token) => {
    try {
        const invite = await Invite.findOne({ 
            token, 
            status: 'pending' 
        })
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('generatedBy', 'firstName lastName email');

        if (!invite) {
            throw new AppError('Invalid or already processed invitation link.', 404);
        }

        if (invite.expiresAt < new Date()) {
            invite.status = 'expired';
            await invite.save();
            throw new AppError('Invitation link has expired.', 400);
        }
        
        // Track verification attempt
        invite.attemptCount += 1;
        invite.lastAttemptAt = new Date();
        await invite.save();

        return invite;
    } catch (error) {
        logger.error(`InviteService error verifying token: ${error.message}`, error);
        throw error instanceof AppError ? error : new AppError(`Failed to verify invitation: ${error.message}`, 500);
    }
};

/**
 * Resends an invitation
 * @param {string} inviteId - Invite ID
 * @param {Object} resenderUser - User resending the invite
 * @param {string} [ipAddress] - IP address of request
 * @returns {Promise<Object>} Updated invite
 */
const resendInvite = async (inviteId, resenderUser, ipAddress) => {
    try {
        const invite = await Invite.findById(inviteId)
            .populate('property', 'name')
            .populate('unit', 'unitName');
            
        if (!invite) {
            throw new AppError('Invitation not found.', 404);
        }

        // Authorization check
        if (resenderUser.role !== ROLE_ENUM.ADMIN && 
            invite.generatedBy.toString() !== resenderUser._id.toString()) {
            throw new AppError('You are not authorized to resend this invitation.', 403);
        }

        if (invite.status !== 'pending') {
            throw new AppError(`Cannot resend an invite with status: ${invite.status}. Only 'pending' invites can be resent.`, 400);
        }
        
        // Check if invite can be resent (rate limiting)
        if (!invite.canResend()) {
            const hoursToWait = invite.lastResendAt ? 
                Math.ceil((24 - (Date.now() - invite.lastResendAt.getTime()) / (1000 * 60 * 60))) : 0;
                
            throw new AppError(
                `This invitation has been resent too many times or too recently. ${
                    hoursToWait > 0 ? `Please wait ${hoursToWait} hours before trying again.` : ''
                }`, 
                429
            );
        }

        // Update invite with new expiration and tracking
        invite.expiresAt = generateInviteExpirationDate();
        invite.resendCount += 1;
        invite.lastResendAt = new Date();
        const updatedInvite = await invite.save();

        // Build invite link
        const inviteLink = `${FRONTEND_URL}/accept-invite/${invite.token}`;
        
        // Get resender details
        const resenderName = `${resenderUser.firstName} ${resenderUser.lastName}`.trim();
        
        // Get property and unit names
        const propertyName = invite.property?.name || 'Global System';
        const unitName = invite.unit?.unitName || null;

        // Send email invitation
        await emailService.sendInvitationEmail({
            to: invite.email,
            inviteLink,
            role: invite.roles.join(', '),
            invitedByUserName: resenderName,
            propertyDisplayName: unitName ? `${propertyName} - Unit ${unitName}` : propertyName
        });
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Invite,
            updatedInvite._id,
            {
                userId: resenderUser._id,
                ipAddress,
                description: `Invitation for ${updatedInvite.email} resent by ${resenderUser.email}.`,
                status: 'success',
                metadata: {
                    resendCount: updatedInvite.resendCount,
                    newExpiresAt: updatedInvite.expiresAt
                }
            }
        );

        logger.info(`InviteService: Invitation ${updatedInvite._id} resent by ${resenderUser.email}.`);
        return updatedInvite;
    } catch (error) {
        logger.error(`InviteService error resending invite: ${error.message}`, error);
        throw error instanceof AppError ? error : new AppError(`Failed to resend invitation: ${error.message}`, 500);
    }
};

module.exports = {
    createInvite,
    getInvites,
    getInviteById,
    updateInviteStatus,
    acceptInvite,
    declineInvite,
    cancelInvite,
    verifyInviteToken,
    resendInvite,
    checkInvitePermission
};