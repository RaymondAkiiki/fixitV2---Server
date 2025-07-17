const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { ROLE_ENUM, NOTIFICATION_CHANNEL_ENUM, REGISTRATION_STATUS_ENUM } = require('../utils/constants/enums');

// USER SCHEMA
const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required.'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters.']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required.'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters.']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required.'],
    trim: true,
    validate: {
      validator: v => /^\+?[0-9\s-]{7,20}$/.test(v),
      message: props => `${props.value} is not a valid phone number format!`
    }
  },
  email: {
    type: String,
    required: [true, 'Email is required.'],
    trim: true,
    unique: true,
    lowercase: true,
    match: [
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
      'Please enter a valid email.',
    ]
  },
  passwordHash: {
    type: String,
    required: [true, 'Password is required.'],
    trim: true,
    minlength: [8, 'Password must be at least 8 characters.'],
    select: false, // Ensures passwordHash is not returned in queries by default
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: null
  },
  role: {
    type: String,
    enum: ROLE_ENUM,
    default: 'tenant',
    lowercase: true,
  },
  avatar: {
    type: String,
    // IMPORTANT: Replace with your actual Cloudinary default avatar URL
    default: 'https://res.cloudinary.com/<your-cloud-name>/image/upload/v1/<your-default-avatar-public-id>.png'
  },
  // OAuth Integration
  googleId: {
    type: String,
    unique: true,
    sparse: true // Allows null values but enforces uniqueness for non-null values
  },
  resetPasswordToken: {
    type: String
  },
  resetPasswordExpires: {
    type: Date
  },
  twoFactorSecret: {
    type: String,
    default: null
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  preferences: {
    notificationChannels: {
      type: [String],
      enum: NOTIFICATION_CHANNEL_ENUM,
      default: ['email', 'in_app']
    },
    timezone: {
      type: String,
      default: 'Africa/Kampala' // Your current timezone
    },
    locale: {
      type: String,
      default: 'en-US'
    }
  },
  registrationStatus: {
    type: String,
    enum: REGISTRATION_STATUS_ENUM,
    // CHANGED: Default to 'pending_email_verification' for new classic registrations.
    // For Google or tenant invite, set from service layer.
    default: 'pending_email_verification',
    lowercase: true
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  emailVerificationExpires: Date
}, {
  timestamps: true // Adds createdAt and updatedAt timestamps
});

// Virtual for full name (derived property, not stored in DB)
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// ------------------------------------------------------------------
// PRE-SAVE HOOK: Password Hashing & Token Cleanup
// ------------------------------------------------------------------
userSchema.pre('save', async function (next) {
  // Only hash the password if it has been modified AND it does NOT already look like a bcrypt hash.
  if (this.isModified('passwordHash') &&
      !this.passwordHash.startsWith('$2a$') &&
      !this.passwordHash.startsWith('$2b$') &&
      !this.passwordHash.startsWith('$2y$')) {
    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
  }

  // Clear reset password tokens if password is being changed/saved
  if (this.isModified('passwordHash')) {
    this.resetPasswordToken = undefined;
    this.resetPasswordExpires = undefined;
  }

  // Clear email verification tokens if email is marked as verified
  if (this.isModified('isEmailVerified') && this.isEmailVerified) {
    this.emailVerificationToken = undefined;
    this.emailVerificationExpires = undefined;
  }
  
  next(); // Continue with the save operation
});

// ------------------------------------------------------------------
// INSTANCE METHOD: Compare Passwords
// ------------------------------------------------------------------
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.passwordHash) {
    return false;
  }
  return await bcrypt.compare(enteredPassword, this.passwordHash);
};

// ------------------------------------------------------------------
// INSTANCE METHOD: Generate Password Reset Token
// ------------------------------------------------------------------
userSchema.methods.generateResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.resetPasswordExpires = Date.now() + 10 * 60 * 1000;
  return resetToken;
};

// ------------------------------------------------------------------
// TO JSON TRANSFORMATION: Hide Sensitive Data
// ------------------------------------------------------------------
userSchema.set('toJSON', {
  transform: function (doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.resetPasswordToken;
    delete ret.resetPasswordExpires;
    delete ret.twoFactorSecret;
    delete ret.googleId;
    delete ret.emailVerificationToken;
    delete ret.emailVerificationExpires;
    return ret;
  }
});

// ------------------------------------------------------------------
// INDEXES
// ------------------------------------------------------------------
userSchema.index({ phone: 1 });
userSchema.index({ role: 1 });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);