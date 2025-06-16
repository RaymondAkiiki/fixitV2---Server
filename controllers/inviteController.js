const Invite = require('../models/invite');
const User = require('../models/user');
const Property = require('../models/property');
const PropertyUser = require('../models/PropertyUser');
const Unit = require('../models/unit');
const asyncHandler = require('express-async-handler');
const { generateUniqueToken, generateExpirationDate } = require('../utils/inviteGenerator');
const { sendInvitationEmail } = require('../utils/emailService');
const generateToken = require('../utils/generateToken');

const FRONTEND_URL = process.env.VITE_API_URL || 'http://localhost:5173';

/**
 * @desc    Send a new invite (with token, expiration, and email).
 * This allows Landlords and Property Managers to invite users to properties/units.
 * @route   POST /api/invites/send
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.sendInvite = asyncHandler(async (req, res) => {
    const { email, role, property: propertyId, unit: unitId } = req.body;

    // Basic validation
    if (!email || !role) {
        res.status(400);
        throw new Error('Email and role are required for an invitation.');
    }

    // Role-based authorization: Ensure only Landlords/Managers/Admin can invite others
    if (!req.user || !['landlord', 'propertymanager', 'admin'].includes(req.user.role)) {
        res.status(403);
        throw new Error(`Role '${req.user?.role}' is not authorized to send invites.`);
    }

    // Optional: Check if the invited email already exists as an active user
    const existingUser = await User.findOne({ email, isActive: true });
    if (existingUser) {
        res.status(400);
        throw new Error(`User with email ${email} already exists.`);
    }

    // Optional: Check if a pending invite already exists for this email and role combination
    const existingInvite = await Invite.findOne({ email, role, status: 'Pending' });
    if (existingInvite) {
        res.status(400);
        throw new Error(`A pending invitation for ${email} as a ${role} already exists.`);
    }

    // Property/Unit ownership/management checks for the inviting user
    if (propertyId && req.user.role !== 'admin') {
        const property = await Property.findById(propertyId);
        if (!property) {
            res.status(404);
            throw new Error('Property not found.');
        }

        // Debug for diagnosis
        console.log('DEBUG: propertyId:', propertyId);
        console.log('DEBUG: req.user.role:', req.user.role);
        console.log('DEBUG: req.user._id:', req.user._id);

        // Landlord role check
        if (req.user.role === 'landlord') {
            const isLandlord = await PropertyUser.exists({
                user: req.user._id,
                property: propertyId,
                roles: 'landlord',
                isActive: true
            });
            if (!isLandlord) {
                console.log('DEBUG: Landlord NOT authorized for this property.');
                res.status(403);
                throw new Error('You are not authorized to invite users to this property.');
            }
        }

        // Property Manager role check
        if (req.user.role === 'propertymanager') {
            const isPM = await PropertyUser.exists({
                user: req.user._id,
                property: propertyId,
                roles: 'propertymanager',
                isActive: true
            });
            if (!isPM) {
                console.log('DEBUG: PropertyManager NOT authorized for this property.');
                res.status(403);
                throw new Error('You are not authorized to invite users to this property.');
            }
        }
    }

    if (unitId) {
        const unit = await Unit.findById(unitId);
        if (!unit) {
            res.status(404);
            throw new Error('Unit not found.');
        }
        if (propertyId && unit.property.toString() !== propertyId) {
            res.status(400);
            throw new Error('Unit does not belong to the specified property.');
        }
        // Add similar authorization checks for unit if necessary
    }

    // Generate unique token and expiration using the utilities
    const token = generateUniqueToken();
    const expiresAt = generateExpirationDate();

    // Create invite record
    const invite = await Invite.create({
        token,
        email,
        role,
        property: propertyId || null,
        unit: unitId || null,
        expiresAt,
        generatedBy: req.user._id, // User who sent the invite
        status: 'Pending'
    });

    // Construct invite link for frontend (points to frontend invite acceptance page)
    const link = `${FRONTEND_URL}/accept-invite/${token}`;

    // Send invite email
    await sendInvitationEmail(email, link, role, req.user.email); // Use req.user.email as sender name

    res.status(201).json({
        message: 'Invitation sent successfully.',
        inviteId: invite._id,
        inviteLink: link // Return the link for display/copy
    });
});

/**
 * @desc    Accept an invite and create or update the user.
 * Accepts: { token, email, password, name (optional) }
 * - If user with invite email does not exist, creates a new user.
 * - If user exists but is inactive or needs role update, updates them.
 * - Handles property/unit assignment.
 * @route   POST /api/invites/accept
 * @access  Public
 */
exports.acceptInvite = asyncHandler(async (req, res) => {
    const { token, email, password, name, phone } = req.body;

    // Find invite by token and check status
    const invite = await Invite.findOne({ token, status: 'Pending' }); // Only accept 'Pending' invites

    if (!invite) {
        res.status(400);
        throw new Error('Invalid, expired, or already accepted invitation link.');
    }

    // Check expiration
    if (invite.expiresAt < new Date()) {
        invite.status = 'Expired'; // Mark as expired in DB
        await invite.save();
        res.status(400);
        throw new Error('Invitation link has expired.');
    }

    // Ensure the email provided in the request matches the email associated with the invite
    if (invite.email.toLowerCase() !== email.toLowerCase()) {
        res.status(400);
        throw new Error('The email provided does not match the invited email.');
    }

    // Find user by email or create new one
    let user = await User.findOne({ email: invite.email }).select('+passwordHash');
    let isNewUser = false;

    if (!user) {
        // Create new user
        user = new User({
            name: name || '',
            phone: phone || '',
            email: invite.email,
            passwordHash: password, // This will trigger the pre-save hash hook
            role: invite.role,
            isActive: true,
            approved: true,
        });
        await user.save();
        isNewUser = true;
    } else {
        // User exists, update their role and associations if needed
        user.role = invite.role;
        user.isActive = true;
        user.approved = true;

        // If password was provided, update it (only if the user already exists and is changing it)
        if (password) {
            user.passwordHash = password; // Triggers pre-save hook for hashing
        }
        await user.save();
    }

    // Create or update the PropertyUser association
    if (invite.property) {
        const propertyUserQuery = {
            user: user._id,
            property: invite.property,
            unit: invite.unit || null
        };
        const update = {
            $addToSet: { roles: invite.role },
            $set: { isActive: true, invitedBy: invite.generatedBy || null }
        };
        await PropertyUser.findOneAndUpdate(
            propertyUserQuery,
            update,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }

    // Mark invite as accepted
    invite.status = 'Accepted';
    invite.acceptedBy = user._id;
    await invite.save();

    res.status(200).json({
        message: 'Invitation accepted and account setup successful!',
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
        token: generateToken(user._id)
    });
});

/**
 * @desc    Get all invites (optionally with pagination and filters)
 * @route   GET /api/invites
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.getAllInvites = asyncHandler(async (req, res) => {
    let filter = {};
    // If you want to restrict to only the invites created by the current user:
    // if (req.user.role !== 'admin') filter.generatedBy = req.user._id;

    const invites = await Invite.find(filter)
        .populate('property', 'name')
        .populate('unit', 'unitIdentifier')
        .sort({ createdAt: -1 });

    res.json({ invites });
});

// In inviteController.js
exports.verifyInviteToken = asyncHandler(async (req, res) => {
    const { token } = req.params;
    const invite = await Invite.findOne({ token, status: 'Pending' });
    if (!invite) {
        res.status(404);
        throw new Error('Invalid or expired invite token.');
    }
    if (invite.expiresAt < new Date()) {
        invite.status = 'Expired';
        await invite.save();
        res.status(400);
        throw new Error('Invite token has expired.');
    }
    res.status(200).json({ message: 'Invite token is valid.', invite });
});