// backend/models/User.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // For password hashing
const crypto = require('crypto'); // For generating reset tokens

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required.'],
        trim: true
    },
    phone: {
        type: String,
        required: [true, 'Phone number is required.'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Email is required.'],
        trim: true,
        match: [
            /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
            'Please enter a valid email.',
        ],
        unique: true,
        lowercase: true // Store emails in lowercase for consistent lookups
    },
    passwordHash: { // Stores the hashed password
        type: String,
        required: [true, 'Password is required.'],
        trim: true,
        minlength: [8, 'Password must be at least 8 characters.'],
        select: false, // Do not return passwordHash by default on queries
    },
    isActive: {
        type: Boolean,
        default: true
    }, // For deactivating users
    lastVisit: {
        type: Date
    },
    role: {
        type: String,
        enum: ['tenant', 'landlord', 'admin', 'propertymanager', 'vendor'], // Ensure consistency with lowercase roles
        default: 'tenant',
        lowercase: true,
    },
    resetPasswordToken: { // Stores the hashed reset token
        type: String
    },
    resetPasswordExpires: { // Stores the expiration date of the reset token
        type: Date
    },
    approved: {
        type: Boolean,
        default: true
    }, // If invites are mandatory, this might be redundant. If direct signups require approval, keep.

    // Associations for a user's *specific relationships* to properties/units.
    // Given the `PropertyUser` model, these arrays here become redundant.
    // We will rely on `PropertyUser` to define these relationships.
    // Removed: propertiesManaged, propertiesOwned, tenancies, unit (single reference)
    // The previous implementation of `User.propertiesManaged`, `User.propertiesOwned`, `User.tenancies`
    // is now handled by querying the `PropertyUser` collection.
    // For example, to get properties a user manages: find PropertyUser where user matches and role is 'propertymanager'.

}, {
    timestamps: true // Adds createdAt and updatedAt fields
});

// Pre-save hook to hash password before saving if it's new or modified
userSchema.pre('save', async function(next) {
    // Only hash if passwordHash field is modified (e.g., on registration or password reset)
    if (!this.isModified('passwordHash')) {
        return next();
    }
    const salt = await bcrypt.genSalt(12); // Higher salt rounds for better security
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);

    // Invalidate reset token when password changes for security
    this.resetPasswordToken = undefined;
    this.resetPasswordExpires = undefined;
    next();
});

// Method to compare entered password with hashed password in DB
userSchema.methods.matchPassword = async function (enteredPassword) {
    // Compare entered password with the stored passwordHash
    // When querying for login, ensure '.select('+passwordHash')' is used to retrieve the hash.
    return await bcrypt.compare(enteredPassword, this.passwordHash);
};

// Generate a reset token for forgot password
userSchema.methods.generateResetToken = function () {
    const resetToken = crypto.randomBytes(32).toString('hex'); // Raw, unhashed token
    // Hash the reset token before saving to database for security
    this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    // Set expiration time (e.g., 10 minutes from now)
    this.resetPasswordExpires = Date.now() + 10 * 60 * 1000;
    return resetToken; // Return the unhashed token to send to the user via email
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
