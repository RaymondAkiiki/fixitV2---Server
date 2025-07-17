// src/controllers/inviteController.js

const asyncHandler = require('../utils/asyncHandler'); // For handling async errors
const inviteService = require('../services/inviteService'); // Import the new invite service
const logger = require('../utils/logger'); // Import logger
const AppError = require('../utils/AppError'); // Import custom AppError

/**
 * @desc Create and send a new invitation
 * @route POST /api/invites
 * @access Private (Admin, PropertyManager, Landlord)
 * @body {string} email - Recipient's email address
 * @body {Array<string>} roles - Array of roles for the invited user (e.g., ['tenant'], ['propertymanager'])
 * @body {string} propertyId - ID of the property the invite is for
 * @body {string} [unitId] - Optional. ID of the unit the invite is for (if role is 'tenant')
 */
const createInvite = asyncHandler(async (req, res) => {
    const { email, roles, propertyId, unitId } = req.body;
    const invitedBy = req.user._id; // The user sending the invite
    const ipAddress = req.ip;

    // Authorization check: Ensure invitedBy has permission to invite for this property/roles
    const canInvite = await inviteService.checkInvitePermission(invitedBy, propertyId, roles);
    if (!canInvite) {
        throw new AppError('You are not authorized to send invitations for this property with the specified roles.', 403);
    }

    const newInvite = await inviteService.createInvite({
        email,
        roles,
        propertyId,
        unitId,
        invitedBy
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
 * @query {string} [status] - Filter by invite status (e.g., 'pending', 'accepted', 'expired', 'declined', 'cancelled')
 * @query {string} [propertyId] - Filter by associated property ID
 * @query {string} [email] - Filter by invited email (partial match)
 */
const getInvites = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;

    const invites = await inviteService.getInvites(currentUser, filters);

    res.status(200).json({
        success: true,
        count: invites.length,
        data: invites
    });
});

/**
 * @desc Cancel an invitation
 * @route PATCH /api/invites/:id/cancel
 * @access Private (Admin, or the user who generated the invite)
 * @param {string} id - The ID of the invite to cancel
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

// --- Public Invitation Acceptance Endpoints (No Authentication Required for these) ---

/**
 * @desc Verify an invitation token (public endpoint, for frontend validation)
 * @route GET /public/invites/:token/verify
 * @access Public
 * @param {string} token - The invite token from URL params
 */
const verifyInviteToken = asyncHandler(async (req, res) => {
    const { token } = req.params;

    const invite = await inviteService.verifyInviteToken(token);

    res.status(200).json({
        success: true,
        message: 'Invite token is valid.',
        data: invite
    });
});

/**
 * @desc Accept an invitation and create/update user account
 * @route POST /public/invites/:token/accept
 * @access Public
 * @param {string} token - The invite token from URL params
 * @body {string} email - The email address (must match invite)
 * @body {string} [firstName] - First name (required for new users)
 * @body {string} [lastName] - Last name (required for new users)
 * @body {string} [password] - Password (required for new users)
 * @body {string} [confirmPassword] - Confirm password (required for new users)
 */
const acceptInvite = asyncHandler(async (req, res) => {
    const { token } = req.params;
    const userData = req.body; // Contains firstName, lastName, email, password, confirmPassword
    const ipAddress = req.ip;

    if (userData.password && userData.password !== userData.confirmPassword) {
        throw new AppError('Passwords do not match.', 400);
    }

    const result = await inviteService.acceptInvite(token, userData, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Invitation accepted and account setup successful!',
        user: result.user ? { _id: result.user._id, email: result.user.email, firstName: result.user.firstName, lastName: result.user.lastName, role: result.user.role } : null,
        token: result.token
    });
});

/**
 * @desc Decline an invitation
 * @route POST /public/invites/:token/decline
 * @access Public
 * @param {string} token - The invite token from URL params
 * @body {string} [reason] - Optional reason for declining
 */
const declineInvite = asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { reason } = req.body;
    // No req.user or ipAddress for public route, audit log will handle null user

    await inviteService.declineInvite(token, reason);

    res.status(200).json({
        success: true,
        message: 'Invitation declined successfully.'
    });
});


module.exports = {
    createInvite,
    getInvites,
    cancelInvite,
    verifyInviteToken,
    acceptInvite,
    declineInvite
};
