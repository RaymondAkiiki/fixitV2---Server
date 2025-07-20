// src/controllers/inviteController.js

const asyncHandler = require('../utils/asyncHandler');
const inviteService = require('../services/inviteService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { PROPERTY_USER_ROLES_ENUM } = require('../utils/constants/enums');

/**
 * @desc Create and send a new invitation
 * @route POST /api/invites
 * @access Private (Admin, PropertyManager, Landlord)
 */
const createInvite = asyncHandler(async (req, res) => {
    const { email, roles, propertyId, unitId, phone } = req.body;
    const invitedBy = req.user._id;
    const ipAddress = req.ip;

    // Validate roles array
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
        throw new AppError('At least one valid role must be specified.', 400);
    }
    
    // Validate each role is valid
    for (const role of roles) {
        if (!PROPERTY_USER_ROLES_ENUM.includes(role)) {
            throw new AppError(`Invalid role: ${role}. Valid roles are: ${PROPERTY_USER_ROLES_ENUM.join(', ')}`, 400);
        }
    }

    // Authorization check
    const canInvite = await inviteService.checkInvitePermission(invitedBy, propertyId, roles);
    if (!canInvite) {
        throw new AppError('You are not authorized to send invitations for this property with the specified roles.', 403);
    }

    const newInvite = await inviteService.createInvite({
        email,
        roles,
        propertyId,
        unitId,
        phone,
        invitedBy,
        ipAddress
    });

    res.status(201).json({
        success: true,
        message: 'Invitation sent successfully.',
        data: newInvite
    });
});

/**
 * @desc Get all invitations accessible by the logged-in user
 * @route GET /api/invites
 * @access Private (Admin, PropertyManager, Landlord)
 */
const getInvites = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const { status, propertyId, email, page = 1, limit = 10 } = req.query;

    const result = await inviteService.getInvites(
        currentUser, 
        { status, propertyId, email },
        page,
        limit
    );

    res.status(200).json({
        success: true,
        message: 'Invitations retrieved successfully.',
        count: result.invites.length,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        data: result.invites
    });
});

/**
 * @desc Get a specific invitation by ID
 * @route GET /api/invites/:id
 * @access Private (Admin or invite creator)
 */
const getInviteById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    const invite = await inviteService.getInviteById(id, currentUser);

    res.status(200).json({
        success: true,
        data: invite
    });
});

/**
 * @desc Cancel an invitation
 * @route PATCH /api/invites/:id/cancel
 * @access Private (Admin, or the user who generated the invite)
 */
const cancelInvite = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const canceller = req.user;
    const ipAddress = req.ip;

    await inviteService.cancelInvite(id, canceller, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Invitation cancelled successfully.'
    });
});

/**
 * @desc Resend an invitation
 * @route PATCH /api/invites/:id/resend
 * @access Private (Admin, or the user who generated the invite)
 */
const resendInvite = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const resender = req.user;
    const ipAddress = req.ip;

    const updatedInvite = await inviteService.resendInvite(id, resender, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Invitation resent successfully.',
        data: {
            email: updatedInvite.email,
            expiresAt: updatedInvite.expiresAt,
            resendCount: updatedInvite.resendCount
        }
    });
});

// --- Public Invitation Endpoints ---

/**
 * @desc Verify an invitation token (public endpoint)
 * @route GET /api/public/invites/:token/verify
 * @access Public
 */
const verifyInviteToken = asyncHandler(async (req, res) => {
    const { token } = req.params;

    const invite = await inviteService.verifyInviteToken(token);

    res.status(200).json({
        success: true,
        message: 'Invite token is valid.',
        data: {
            email: invite.email,
            roles: invite.roles,
            propertyName: invite.property?.name || null,
            unitName: invite.unit?.unitName || null,
            expiresAt: invite.expiresAt,
            invitedBy: invite.generatedBy ? `${invite.generatedBy.firstName} ${invite.generatedBy.lastName}` : null
        }
    });
});

/**
 * @desc Accept an invitation and create/update user account
 * @route POST /api/public/invites/:token/accept
 * @access Public
 */
const acceptInvite = asyncHandler(async (req, res) => {
    const { token } = req.params;
    const userData = req.body;
    const ipAddress = req.ip;

    // Validate password confirmation if provided
    if (userData.password && userData.password !== userData.confirmPassword) {
        throw new AppError('Passwords do not match.', 400);
    }

    const result = await inviteService.acceptInvite(token, userData, ipAddress);

    // Return limited user data for security
    const userResponse = {
        _id: result.user._id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName
    };

    res.status(200).json({
        success: true,
        message: 'Invitation accepted and account setup successful!',
        isNewUser: result.isNewUser,
        user: userResponse,
        token: result.token
    });
});

/**
 * @desc Decline an invitation
 * @route POST /api/public/invites/:token/decline
 * @access Public
 */
const declineInvite = asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { reason } = req.body;
    const ipAddress = req.ip;

    await inviteService.declineInvite(token, reason, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Invitation declined successfully.'
    });
});

module.exports = {
    createInvite,
    getInvites,
    getInviteById,
    cancelInvite,
    resendInvite,
    verifyInviteToken,
    acceptInvite,
    declineInvite
};