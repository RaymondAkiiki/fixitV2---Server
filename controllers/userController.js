// backend/controllers/userController.js
const bcrypt = require('bcryptjs');
const { sendEmail } = require('../utils/emailService'); // Correct utility
const { generateResetToken } = require('../utils/token');
const asyncHandler = require('express-async-handler'); // For handling async errors
const User = require('../models/user'); // Corrected import: lowercase file name
const PropertyUser = require('../models/propertyUser'); // Import PropertyUser model
const Property = require('../models/property'); // For populating property details
const Request = require('../models/request');

// Helper for validation errors
// This function assumes `express-validator` is used in the routes.
const handleValidationErrors = (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }
    return null; // No errors
};

/**
 * @desc    Get current logged-in user's profile
 * @route   GET /api/users/me (or /api/auth/profile, consolidated to authController)
 * @access  Private
 * @notes   This is already handled by authController.getMe. This endpoint can be for a more detailed user profile
 * that includes aggregated data from other models (like associated properties, units, etc.).
 */
exports.getProfile = asyncHandler(async (req, res) => {
    // req.user is set by the protect middleware.
    // Populate user's associated properties and units through PropertyUser model
    const userProfile = await User.findById(req.user._id).select('-passwordHash');

    if (!userProfile) {
        res.status(404);
        throw new Error('User profile not found.');
    }

    // Fetch properties and units associated with this user via PropertyUser model
    const associations = await PropertyUser.find({ user: userProfile._id })
        .populate('property')
        .populate('unit'); // Populate unit if relevant

    const userAssociations = {
        propertiesManaged: [],
        propertiesOwned: [],
        tenancies: [],
        // Add other roles as needed
    };

    associations.forEach(assoc => {
        if (assoc.roles.includes('propertymanager') && assoc.property) {
            userAssociations.propertiesManaged.push(assoc.property);
        }
        if (assoc.roles.includes('landlord') && assoc.property) {
            userAssociations.propertiesOwned.push(assoc.property);
        }
        if (assoc.roles.includes('tenant') && assoc.property && assoc.unit) {
            userAssociations.tenancies.push({ property: assoc.property, unit: assoc.unit });
        }
        // If a vendor role is directly associated with a property, handle here
        if (assoc.roles.includes('vendor') && assoc.property) {
            // For vendors, you might want to show properties they are primary vendors for,
            // distinct from individual request assignments.
        }
    });

    res.status(200).json({
        ...userProfile.toObject(), // Convert Mongoose document to plain object
        associations: userAssociations, // Add aggregated associations
        // Remove direct property/unit arrays from user model, now using associations
    });
});

/**
 * @desc    Update a user's own profile
 * @route   PUT /api/users/me
 * @access  Private
 * @notes   Allows users to update their name, phone, etc.
 */
exports.updateMyProfile = asyncHandler(async (req, res) => {
    // No validationResult check needed if using it as middleware in route
    const { name, phone } = req.body; // Allow update of name and phone

    const user = await User.findById(req.user._id);

    if (!user) {
        res.status(404);
        throw new Error('User not found.');
    }

    user.name = name || user.name;
    user.phone = phone || user.phone;
    // Do NOT allow direct role or email changes via this route for security
    // Password changes are handled by resetPassword.

    const updatedUser = await user.save();

    res.status(200).json({
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        role: updatedUser.role, // Role remains unchanged by this route
    });
});

/**
 * @desc    List all users with filtering capabilities
 * @route   GET /api/users
 * @access  Private (Admin, PropertyManager, Landlord)
 * @notes   PMs/Landlords can only see users relevant to their properties.
 */
exports.listUsers = asyncHandler(async (req, res) => {
    // Admin can see all users
    // PMs/Landlords can only see users associated with their properties/units
    const { role, propertyId, unitId, search } = req.query;
    const query = {};

    // Base query to fetch users, excluding passwordHash
    let userQuery = User.find().select('-passwordHash');

    if (search) {
        query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } },
        ];
    }

    // Role-based filtering of users for Property Managers and Landlords
    if (req.user.role === 'propertymanager' || req.user.role === 'landlord') {
        const userAssociatedProperties = await PropertyUser.find({
            user: req.user._id,
            $or: [{ roles: 'propertymanager' }, { roles: 'landlord' }]
        }).distinct('property'); // Get IDs of properties the current user manages/owns

        // If the requesting user doesn't manage/own any properties, return empty
        if (userAssociatedProperties.length === 0) {
            return res.status(200).json([]);
        }

        // Find PropertyUser entries for users associated with these properties
        const accessibleUserAssociations = await PropertyUser.find({
            property: { $in: userAssociatedProperties },
            // Optional: filter by specific roles if PM/Landlord only see tenants/vendors
            // roles: { $in: ['tenant', 'vendor'] }
        }).distinct('user'); // Get distinct user IDs from these associations

        query._id = { $in: accessibleUserAssociations }; // Filter users by these IDs
    }

    if (role) {
        query.role = role.toLowerCase(); // Filter by requested role
    }

    // Apply main query to User model
    userQuery = userQuery.find(query);

    // If propertyId or unitId is provided, further filter by PropertyUser associations
    if (propertyId || unitId) {
        const specificPropertyUserQuery = { user: { $in: userQuery.map(u => u._id) } }; // Start with users already filtered
        if (propertyId) specificPropertyUserQuery.property = propertyId;
        if (unitId) specificPropertyUserQuery.unit = unitId;

        const specificAssociatedUserIds = await PropertyUser.find(specificPropertyUserQuery).distinct('user');
        userQuery = userQuery.find({ _id: { $in: specificAssociatedUserIds } });
    }

    const users = await userQuery.exec();

    res.status(200).json(users);
});

/**
 * @desc    Get specific user details by ID
 * @route   GET /api/users/:id
 * @access  Private (Admin, PropertyManager, Landlord - with access control)
 * @notes   Admin can get any user. PMs/Landlords can only get users they are associated with.
 */
exports.getUserById = asyncHandler(async (req, res) => {
    const userId = req.params.id;

    // Fetch user and exclude passwordHash
    const user = await User.findById(userId).select('-passwordHash');

    if (!user) {
        res.status(404);
        throw new Error('User not found.');
    }

    // Authorization check: Admin can access any user
    if (req.user.role === 'admin') {
        // Fetch and include associations for admin view
        const associations = await PropertyUser.find({ user: user._id })
            .populate('property', 'name address')
            .populate('unit', 'unitName property');
        return res.status(200).json({ ...user.toObject(), associations });
    }

    // For PMs/Landlords, check if they are associated with this user through a property they manage/own
    if (req.user.role === 'propertymanager' || req.user.role === 'landlord') {
        const userAssociatedProperties = await PropertyUser.find({
            user: req.user._id,
            $or: [{ roles: 'propertymanager' }, { roles: 'landlord' }]
        }).distinct('property');

        const isAssociated = await PropertyUser.exists({
            user: userId,
            property: { $in: userAssociatedProperties }
        });

        if (isAssociated) {
            // Fetch and include associations for PM/Landlord view
            const associations = await PropertyUser.find({ user: user._id })
                .populate('property', 'name address')
                .populate('unit', 'unitName property');
            return res.status(200).json({ ...user.toObject(), associations });
        } else {
            res.status(403);
            throw new Error('You are not authorized to view this user.');
        }
    }

    // Default: if user is not admin, PM, or Landlord, they can only view their own profile (handled by getMe)
    // Or, if this route is restricted to admin/PM/Landlord only, this case might not be reachable.
    res.status(403);
    throw new Error('Not authorized to view this user profile.');
});


/**
 * @desc    Update a user's profile (Admin only for full update, or specific changes by PM/Landlord)
 * @route   PUT /api/users/:id
 * @access  Private (Admin, PropertyManager, Landlord - for limited fields)
 * @notes   This should allow admins to change roles, activate/deactivate users.
 * PMs/Landlords might update a tenant's name/phone if necessary.
 */
exports.updateUser = asyncHandler(async (req, res) => {
    // Implement validation for fields being updated
    // if (handleValidationErrors(req, res)) return;

    const userId = req.params.id;
    const { name, phone, email, role, isActive, approved, propertyAssociations } = req.body;

    const userToUpdate = await User.findById(userId).select('+passwordHash'); // Select passwordHash if needed for some logic

    if (!userToUpdate) {
        res.status(404);
        throw new Error('User not found.');
    }

    // Admin can update anything except their own role to prevent lockout
    if (req.user.role === 'admin') {
        userToUpdate.name = name !== undefined ? name : userToUpdate.name;
        userToUpdate.phone = phone !== undefined ? phone : userToUpdate.phone;
        // userToUpdate.email = email !== undefined ? email : userToUpdate.email; // Email change might require verification
        userToUpdate.isActive = isActive !== undefined ? isActive : userToUpdate.isActive;
        userToUpdate.approved = approved !== undefined ? approved : userToUpdate.approved;

        // Allow Admin to change role
        if (role !== undefined && userToUpdate._id.toString() !== req.user._id.toString()) { // Prevent admin from changing their own role via this route
            userToUpdate.role = role.toLowerCase();
        }

        // Handle updates to PropertyUser associations (complex, typically separate endpoint for adding/removing associations)
        // For simplicity here, assume `propertyAssociations` is an array of { propertyId, unitId, roles }
        // This is a placeholder for more complex logic.
        if (propertyAssociations && Array.isArray(propertyAssociations)) {
             // Logic to sync PropertyUser entries based on `propertyAssociations`
             // This would involve finding existing PropertyUser entries for `userId`
             // and updating/creating/deleting them based on `propertyAssociations` array.
             // This can be complex and should likely be a dedicated helper function.
             console.log(`Admin updating associations for user ${userId}:`, propertyAssociations);
        }

    } else if (req.user._id.toString() === userId) {
        // Users can update their own name and phone
        userToUpdate.name = name || userToUpdate.name;
        userToUpdate.phone = phone || userToUpdate.phone;
    } else {
        // PMs/Landlords can update specific fields for users they manage/own,
        // e.g., tenant's phone number or name, if they are associated with the user's property.
        // Requires authorization check (similar to getUserById)
        const userAssociatedProperties = await PropertyUser.find({
            user: req.user._id,
            $or: [{ roles: 'propertymanager' }, { roles: 'landlord' }]
        }).distinct('property');

        const isAssociated = await PropertyUser.exists({
            user: userId,
            property: { $in: userAssociatedProperties }
        });

        if (!isAssociated) {
            res.status(403);
            throw new Error('Not authorized to update this user profile.');
        }

        // Allow PM/Landlord to update limited fields for associated users
        userToUpdate.name = name || userToUpdate.name;
        userToUpdate.phone = phone || userToUpdate.phone;
    }

    const updatedUser = await userToUpdate.save();

    res.status(200).json({
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        role: updatedUser.role,
        isActive: updatedUser.isActive,
        approved: updatedUser.approved,
    });
});


/**
 * @desc    Delete a user by ID
 * @route   DELETE /api/users/:id
 * @access  Private (Admin only)
 * @notes   Also needs to clean up all related PropertyUser entries, requests, etc.
 */
exports.deleteUser = asyncHandler(async (req, res) => {
    const userId = req.params.id;

    // Prevent deletion of self for safety, especially if it's the only admin
    if (req.user._id.toString() === userId) {
        res.status(400);
        throw new Error('Cannot delete your own user account via this endpoint.');
    }

    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
        res.status(404);
        throw new Error('User not found.');
    }

    // --- Cleanup related data ---
    // 1. Remove all PropertyUser associations for this user
    await PropertyUser.deleteMany({ user: userId });
    // 2. Update requests where this user was createdBy or assignedTo
    // Set createdBy/assignedTo to null or a 'system' user, or delete related requests (careful with data loss)
    // For now, let's just set to null, assuming referential integrity is not enforced by Mongoose on delete.
    await Request.updateMany(
        { $or: [{ createdBy: userId }, { assignedTo: userId }] },
        { $unset: { createdBy: 1, assignedTo: 1, assignedToModel: 1 } }
    );
    // 3. Update ScheduledMaintenance where createdBy or assignedTo
    await ScheduledMaintenance.updateMany(
        { $or: [{ createdBy: userId }, { assignedTo: userId }] },
        { $unset: { createdBy: 1, assignedTo: 1, assignedToModel: 1 } }
    );
    // 4. Delete notifications where recipient or sender
    await Notification.deleteMany({ $or: [{ recipient: userId }, { sender: userId }] });
    // 5. Delete comments where sender
    await Comment.deleteMany({ sender: userId });
    // 6. Update properties where this user was owner or manager (if not handled by PropertyUser)
    // Note: If you removed landlord/propertyManager from Property, this is not needed.
    // Ensure all references are handled.

    res.status(200).json({ message: 'User and associated data deleted successfully.' });
});

/**
 * @desc    Approve a user (if signup requires approval)
 * @route   PATCH /api/users/:id/approve
 * @access  Private (Admin only)
 * @notes   This endpoint is only relevant if User.approved defaults to `false` for non-invite signups.
 * Given our models, `approved` defaults to `true`, and invite acceptance handles this.
 * Keeping it for explicit admin control if needed.
 */
exports.approveUser = asyncHandler(async (req, res) => {
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) {
        res.status(404);
        throw new Error("User not found.");
    }

    if (user.approved === true) {
        return res.status(200).json({ message: "User already approved", user });
    }

    user.approved = true;
    await user.save();

    res.status(200).json({ message: "User approved successfully", user });
});

/**
 * @desc    Update a user's role (Admin only)
 * @route   PATCH /api/users/:id/role
 * @access  Private (Admin only)
 */
exports.updateUserRole = asyncHandler(async (req, res) => {
    // Implement validation for new role
    // if (handleValidationErrors(req, res)) return;

    const userId = req.params.id;
    const { role } = req.body;

    if (!role || !['tenant', 'landlord', 'admin', 'propertymanager', 'vendor'].includes(role.toLowerCase())) {
        res.status(400);
        throw new Error('Invalid role provided.');
    }

    // Prevent admin from changing their own role to prevent lockout
    if (req.user._id.toString() === userId && role.toLowerCase() !== 'admin') {
        res.status(400);
        throw new Error('Admins cannot change their own role to a non-admin role via this endpoint.');
    }

    const user = await User.findById(userId);
    if (!user) {
        res.status(404);
        throw new Error('User not found.');
    }

    user.role = role.toLowerCase();
    const updatedUser = await user.save();

    res.status(200).json({
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        isActive: updatedUser.isActive,
    });
});


/**
 * @desc    Create a new user (Admin, Landlord, or PM can manually add a tenant)
 * @route   POST /api/users
 * @access  Private (Admin, Landlord, PropertyManager)
 */

exports.createUser = asyncHandler(async (req, res) => {
    const { name, email, phone, role, propertyId, unitId } = req.body;

    if (!name || !email || !role) {
        res.status(400);
        throw new Error("Name, email, and role are required.");
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
        res.status(400);
        throw new Error("A user with this email already exists.");
    }

    // Generate a set-password token
    const resetToken = generateResetToken();
    const resetPasswordExpires = Date.now() + 1000 * 60 * 60 * 24; // 24 hours

    // --- FIX: Always set a temp passwordHash on creation ---
    const randomTempPassword = Math.random().toString(36).slice(-8);
    const tempPasswordHash = await bcrypt.hash(randomTempPassword, 10);

    const user = await User.create({
        name,
        email: email.toLowerCase(),
        phone,
        role: role.toLowerCase(),
        passwordHash: tempPasswordHash,          // <-- REQUIRED by your schema!
        resetPasswordToken: resetToken,
        resetPasswordExpires
    });

    if ((propertyId || unitId) && role.toLowerCase() === "tenant") {
        await PropertyUser.create({
            user: user._id,
            property: propertyId,
            unit: unitId,
            roles: ['tenant'],
            isActive: true,
        });
    }

    // Send "Set Password" email
    try {
        const setPasswordUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/set-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
        await sendEmail({
            to: email,
            subject: "Set up your password for [Your Platform Name]",
            text: `Hello ${name},\n\nAn account has been created for you on [Your Platform Name].\n\nPlease set your password using the following link (valid for 24 hours):\n\n${setPasswordUrl}\n\nIf you did not expect this, please ignore this email.\n\nThank you!`
        });
    } catch (err) {
        console.error('Failed to send set-password email:', err.message);
    }

    res.status(201).json(user);
});