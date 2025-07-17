// src/services/inviteService.js

const Invite = require('../models/invite');
const User = require('../models/user');
const Property = require('../models/property');
const PropertyUser = require('../models/propertyUser');
const Unit = require('../models/unit');
const { createAuditLog } = require('./auditService');
const { sendInvitationEmail } = require('../services/emailService'); // Assuming this utility exists and is robust
const generateToken = require('../utils/jwt'); // For generating JWTs for new users
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const crypto = require('crypto'); // For generating secure tokens

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    INVITE_STATUS_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    REGISTRATION_STATUS_ENUM
} = require('../utils/constants/enums');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const INVITE_EXPIRATION_DAYS = 7; // Default invite expiration

/**
 * Generates a unique token for an invitation.
 * @returns {string} A unique hexadecimal token.
 */
const generateUniqueInviteToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * Generates an expiration date for an invitation.
 * @returns {Date} The expiration date.
 */
const generateInviteExpirationDate = () => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRATION_DAYS);
    return expiresAt;
};

/**
 * Helper to check if a user has permission to invite others to a property with specific roles.
 * @param {string} inviterId - The ID of the user sending the invite.
 * @param {string} propertyId - The ID of the property the invite is for.
 * @param {Array<string>} rolesToInvite - The roles being invited (e.g., ['tenant'], ['propertymanager']).
 * @returns {Promise<boolean>} True if authorized, false otherwise.
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

    // Landlords and Property Managers can invite to properties they manage/own
    const inviterPropertyUser = await PropertyUser.findOne({
        user: inviterId,
        property: propertyId,
        isActive: true,
        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
    });

    if (!inviterPropertyUser) {
        return false; // Inviter is not associated with this property in a management role
    }

    // Specific role-based restrictions for who can invite whom
    for (const role of rolesToInvite) {
        if (role === PROPERTY_USER_ROLES_ENUM.TENANT) {
            // Landlords/PMs can invite tenants
            if (![PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS].some(r => inviterPropertyUser.roles.includes(r))) {
                return false; // Inviter doesn't have a role that can invite tenants
            }
        } else if (role === PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER) {
            // Only Landlords or Admins can invite Property Managers
            if (!inviterPropertyUser.roles.includes(PROPERTY_USER_ROLES_ENUM.LANDLORD) && inviter.role !== ROLE_ENUM.ADMIN) {
                return false;
            }
        } else if (role === PROPERTY_USER_ROLES_ENUM.LANDLORD || role === PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS) {
            // Only global Admins can invite other Landlords or grant admin_access
            if (inviter.role !== ROLE_ENUM.ADMIN) {
                return false;
            }
        }
    }

    return true;
};

/**
 * Creates and sends a new invitation.
 * @param {object} inviteData - Data for the invitation (email, propertyId, unitId, roles, invitedBy).
 * @returns {Promise<Invite>} The created invite document.
 * @throws {AppError} If validation fails or invite already exists.
 */
const createInvite = async (inviteData) => {
    const { email, propertyId, unitId, roles, invitedBy } = inviteData;

    // Check if property exists
    const property = await Property.findById(propertyId);
    if (!property) {
        throw new AppError('Property not found.', 404);
    }

    // Check if unit exists if provided
    if (unitId) {
        const unit = await Unit.findById(unitId);
        if (!unit) {
            throw new AppError('Unit not found.', 404);
        }
        if (unit.property.toString() !== propertyId) {
            throw new AppError('Unit does not belong to the specified property.', 400);
        }
    }

    // Check if invited email already exists as an active user
    const existingActiveUser = await User.findOne({ email, status: REGISTRATION_STATUS_ENUM.find(s => s === 'active') });
    if (existingActiveUser) {
        // If user exists and is already associated with this property and role, prevent duplicate invite
        const existingPropertyUser = await PropertyUser.findOne({
            user: existingActiveUser._id,
            property: propertyId,
            unit: unitId || null,
            roles: { $in: roles },
            isActive: true
        });
        if (existingPropertyUser) {
            throw new AppError(`User with email ${email} is already an active ${roles.join(', ')} for this property/unit.`, 409);
        }
    }

    // Check for existing pending invite for this email, property, and role combination
    const existingPendingInvite = await Invite.findOne({
        email,
        property: propertyId,
        unit: unitId || null,
        roles: { $in: roles }, // Check if any of the roles are already pending
        status: INVITE_STATUS_ENUM.find(s => s === 'pending')
    });
    if (existingPendingInvite) {
        throw new AppError(`A pending invitation for ${email} as a ${roles.join(', ')} already exists for this property/unit.`, 409);
    }

    const token = generateUniqueInviteToken();
    const expiresAt = generateInviteExpirationDate();

    const newInvite = new Invite({
        email,
        roles,
        property: propertyId,
        unit: unitId || null,
        token,
        expiresAt,
        generatedBy: invitedBy,
        status: INVITE_STATUS_ENUM.find(s => s === 'pending')
    });

    const createdInvite = await newInvite.save();

    // Construct invite link for frontend (points to frontend invite acceptance page)
    const inviteLink = `${FRONTEND_URL}/accept-invite/${token}`;

    // Get inviter's email for the email sender name
    const inviterUser = await User.findById(invitedBy).select('firstName lastName email');
    const inviterName = inviterUser ? `${inviterUser.firstName} ${inviterUser.lastName}`.trim() : 'LeaseLogix Admin';

    // Send invite email
    await sendInvitationEmail(
        email,
        inviteLink,
        roles.join(', '), // Send roles as a string for email content
        property.name,
        unit ? unit.unitName : 'N/A',
        inviterName
    );

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE,
        user: invitedBy,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
        resourceId: createdInvite._id,
        newValue: createdInvite.toObject(),
        ipAddress: inviterUser.ip, // Assuming ip is on user object or passed
        description: `Invitation sent to ${email} for roles ${roles.join(', ')} for property ${property.name}.`,
        status: 'success'
    });

    logger.info(`InviteService: Invitation sent to ${email} for roles ${roles.join(', ')} by ${inviterUser.email}.`);
    return createdInvite;
};

/**
 * Gets invitations based on user's access and filters.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Filters (status, propertyId, email).
 * @returns {Promise<Array<Invite>>} Array of invite documents.
 * @throws {AppError} If user not authorized.
 */
const getInvites = async (currentUser, filters) => {
    let query = {};

    // Base filtering based on user role
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin sees all
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
        const userAssociatedProperties = await PropertyUser.find({
            user: currentUser._id,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return [];
        }
        query.property = { $in: userAssociatedProperties };
        // Additionally, they can only see invites they generated, unless they are a global admin
        query.generatedBy = currentUser._id;
    } else {
        throw new AppError('Not authorized to view invitations.', 403);
    }

    // Apply additional filters
    if (filters.status) {
        if (!INVITE_STATUS_ENUM.includes(filters.status.toLowerCase())) {
            throw new AppError(`Invalid status filter: ${filters.status}`, 400);
        }
        query.status = filters.status.toLowerCase();
    }
    if (filters.propertyId) {
        // Ensure the user has access to this property if filtering
        const hasAccess = await checkInvitePermission(currentUser._id, filters.propertyId, [PROPERTY_USER_ROLES_ENUM.TENANT]); // Check if they can invite tenants to this property
        if (!hasAccess && currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Not authorized to view invites for this property.', 403);
        }
        query.property = filters.propertyId;
    }
    if (filters.email) {
        query.email = new RegExp(filters.email, 'i'); // Case-insensitive search
    }

    const invites = await Invite.find(query)
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('generatedBy', 'firstName lastName email')
        .populate('acceptedBy', 'firstName lastName email')
        .sort({ createdAt: -1 });

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ_ALL,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched list of invites.`,
        status: 'success',
        metadata: { filters }
    });

    return invites;
};

/**
 * Gets a single invite by ID.
 * @param {string} inviteId - The ID of the invite.
 * @returns {Promise<Invite>} The invite document.
 * @throws {AppError} If invite not found.
 */
const getInviteById = async (inviteId) => {
    const invite = await Invite.findById(inviteId);
    if (!invite) {
        throw new AppError('Invitation not found.', 404);
    }
    return invite;
};

/**
 * Updates an invite's status.
 * @param {string} inviteId - The ID of the invite.
 * @param {string} newStatus - The new status (e.g., 'cancelled', 'expired').
 * @param {string} [reason] - Optional reason for status change (e.g., decline reason).
 * @returns {Promise<Invite>} The updated invite document.
 * @throws {AppError} If invite not found or status transition is invalid.
 */
const updateInviteStatus = async (inviteId, newStatus, reason = null) => {
    const invite = await Invite.findById(inviteId);
    if (!invite) {
        throw new AppError('Invitation not found.', 404);
    }

    // Basic state transition validation (can be more complex if needed)
    if (invite.status !== INVITE_STATUS_ENUM.find(s => s === 'pending')) {
        throw new AppError(`Cannot change status from ${invite.status} to ${newStatus}.`, 400);
    }
    if (!INVITE_STATUS_ENUM.includes(newStatus.toLowerCase())) {
        throw new AppError(`Invalid new status: ${newStatus}`, 400);
    }

    invite.status = newStatus.toLowerCase();
    if (reason) {
        invite.declineReason = reason;
    }
    if (newStatus.toLowerCase() === INVITE_STATUS_ENUM.find(s => s === 'cancelled')) {
        invite.revokedAt = new Date();
    } else if (newStatus.toLowerCase() === INVITE_STATUS_ENUM.find(s => s === 'expired')) {
        invite.expiresAt = new Date(); // Force expiration now
    }

    const updatedInvite = await invite.save();
    return updatedInvite;
};

/**
 * Accepts an invitation. This is a public endpoint, handles user creation/update.
 * @param {string} token - The invite token.
 * @param {object} userData - User data (firstName, lastName, email, password, confirmPassword).
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<object>} Object containing user, propertyUser, invite, isNewUser, and JWT token.
 * @throws {AppError} If invite invalid/expired, email mismatch, or password mismatch.
 */
const acceptInvite = async (token, userData, ipAddress) => {
    const { firstName, lastName, email, password } = userData;

    const invite = await Invite.findOne({ token, status: INVITE_STATUS_ENUM.find(s => s === 'pending') });

    if (!invite) {
        throw new AppError('Invalid, expired, or already accepted invitation link.', 400);
    }

    if (invite.expiresAt < new Date()) {
        invite.status = INVITE_STATUS_ENUM.find(s => s === 'expired');
        await invite.save();
        throw new AppError('Invitation link has expired.', 400);
    }

    if (invite.email.toLowerCase() !== email.toLowerCase()) {
        throw new AppError('The email provided does not match the invited email.', 400);
    }

    let user = await User.findOne({ email: invite.email }).select('+passwordHash'); // Select passwordHash for update
    let isNewUser = false;

    if (!user) {
        // Create new user
        if (!password) {
            throw new AppError('Password is required for new user registration.', 400);
        }
        user = new User({
            firstName,
            lastName,
            email: invite.email,
            passwordHash: password, // This will be hashed by the pre-save hook
            role: ROLE_ENUM.find(r => r === 'user'), // Default user role, actual roles from invite.roles are for PropertyUser
            status: REGISTRATION_STATUS_ENUM.find(s => s === 'active'),
            isEmailVerified: true, // Email is verified by accepting invite
        });
        await user.save();
        isNewUser = true;
        logger.info(`InviteService: New user created via invite acceptance: ${user.email}`);
    } else {
        // User exists, update their profile and ensure active status
        if (firstName) user.firstName = firstName;
        if (lastName) user.lastName = lastName;
        user.status = REGISTRATION_STATUS_ENUM.find(s => s === 'active'); // Ensure user is active
        user.isEmailVerified = true; // Mark email as verified

        // If password provided, update it (only if different from current or if user wants to set it)
        if (password) {
            user.passwordHash = password; // Triggers pre-save hook for hashing
        }
        await user.save();
        logger.info(`InviteService: Existing user ${user.email} updated via invite acceptance.`);
    }

    // Create or update the PropertyUser association(s)
    let propertyUser;
    for (const role of invite.roles) {
        const propertyUserQuery = {
            user: user._id,
            property: invite.property,
            unit: invite.unit || null
        };
        const update = {
            $addToSet: { roles: role }, // Add the role to the roles array
            $set: { isActive: true, invitedBy: invite.generatedBy || null }
        };
        propertyUser = await PropertyUser.findOneAndUpdate(
            propertyUserQuery,
            update,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        logger.info(`InviteService: PropertyUser association created/updated for ${user.email} as ${role} for property ${invite.property}.`);
    }


    // Mark invite as accepted
    invite.status = INVITE_STATUS_ENUM.find(s => s === 'accepted');
    invite.acceptedBy = user._id;
    invite.acceptedAt = new Date();
    await invite.save();
    logger.info(`InviteService: Invite ${invite._id} accepted by ${user.email}.`);

    // Generate JWT token for the user
    const jwtToken = generateToken(user._id);

    return { user, propertyUser, invite, isNewUser, token: jwtToken };
};

/**
 * Declines an invitation.
 * @param {string} token - The invite token.
 * @param {string} [reason] - Optional reason for declining.
 * @returns {Promise<Invite>} The updated invite document.
 * @throws {AppError} If invite invalid/expired.
 */
const declineInvite = async (token, reason = null) => {
    const invite = await Invite.findOne({ token, status: INVITE_STATUS_ENUM.find(s => s === 'pending') });

    if (!invite) {
        throw new AppError('Invalid, expired, or already processed invitation link.', 400);
    }

    if (invite.expiresAt < new Date()) {
        invite.status = INVITE_STATUS_ENUM.find(s => s === 'expired');
        await invite.save();
        throw new AppError('Invitation link has expired.', 400);
    }

    invite.status = INVITE_STATUS_ENUM.find(s => s === 'declined');
    invite.declineReason = reason;
    await invite.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE, // Treat decline as an update to invite status
        user: null, // No authenticated user for public decline
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
        resourceId: invite._id,
        oldValue: { status: INVITE_STATUS_ENUM.find(s => s === 'pending') },
        newValue: { status: INVITE_STATUS_ENUM.find(s => s === 'declined'), declineReason: reason },
        externalUserIdentifier: invite.email,
        ipAddress: 'System', // Or attempt to get IP from request if available
        description: `Invitation for ${invite.email} declined. Reason: ${reason || 'Not provided'}.`,
        status: 'success'
    });

    logger.info(`InviteService: Invitation for ${invite.email} declined.`);
    return invite;
};

/**
 * Cancels an invitation.
 * @param {string} inviteId - The ID of the invite to cancel.
 * @param {object} cancellerUser - The user cancelling the invite.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Invite>} The updated invite document.
 * @throws {AppError} If invite not found, user not authorized, or invite not pending.
 */
const cancelInvite = async (inviteId, cancellerUser, ipAddress) => {
    const invite = await Invite.findById(inviteId);
    if (!invite) {
        throw new AppError('Invitation not found.', 404);
    }

    // Authorization: Only the user who generated the invite or an Admin can cancel
    if (cancellerUser.role !== ROLE_ENUM.ADMIN && invite.generatedBy.toString() !== cancellerUser._id.toString()) {
        throw new AppError('You are not authorized to cancel this invitation.', 403);
    }

    if (invite.status !== INVITE_STATUS_ENUM.find(s => s === 'pending')) {
        throw new AppError(`Cannot cancel an invite with status: ${invite.status}. Only 'pending' invites can be cancelled.`, 400);
    }

    const oldInvite = invite.toObject(); // Capture old state for audit log

    invite.status = INVITE_STATUS_ENUM.find(s => s === 'cancelled');
    invite.revokedBy = cancellerUser._id;
    invite.revokedAt = new Date();
    const updatedInvite = await invite.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE, // Treat cancel as an update to invite status
        user: cancellerUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Invite,
        resourceId: updatedInvite._id,
        oldValue: { status: oldInvite.status },
        newValue: { status: updatedInvite.status, revokedBy: updatedInvite.revokedBy, revokedAt: updatedInvite.revokedAt },
        ipAddress: ipAddress,
        description: `Invitation for ${updatedInvite.email} cancelled by ${cancellerUser.email}.`,
        status: 'success'
    });

    logger.info(`InviteService: Invitation ${updatedInvite._id} cancelled by ${cancellerUser.email}.`);
    return updatedInvite;
};

/**
 * Verifies an invite token for public access (e.g., before showing acceptance form).
 * @param {string} token - The invite token.
 * @returns {Promise<Invite>} The invite document if valid and pending.
 * @throws {AppError} If token is invalid, expired, or already processed.
 */
const verifyInviteToken = async (token) => {
    const invite = await Invite.findOne({ token, status: INVITE_STATUS_ENUM.find(s => s === 'pending') })
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('generatedBy', 'firstName lastName email');

    if (!invite) {
        throw new AppError('Invalid or already processed invitation link.', 404); // Use 404 for not found, or 400 if you want to be vague
    }

    if (invite.expiresAt < new Date()) {
        invite.status = INVITE_STATUS_ENUM.find(s => s === 'expired');
        await invite.save();
        throw new AppError('Invitation link has expired.', 400);
    }

    return invite;
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
    checkInvitePermission // Export for use in controller for initial authorization
};
