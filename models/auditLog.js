const mongoose = require('mongoose');
const { AUDIT_ACTION_ENUM, AUDIT_RESOURCE_TYPE_ENUM, AUDIT_STATUS_ENUM } = require('../utils/constants/enums');

const auditLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null,
  },
  externalUserIdentifier: {
    type: String,
    trim: true,
    default: null,
  },
  action: {
    type: String,
    required: true,
    // --- THIS IS THE CRITICAL FIX ---
    // Use Object.values() to provide an array of allowed strings to the enum validator.
    enum: Object.values(AUDIT_ACTION_ENUM),
  },
  description: {
    type: String,
    trim: true,
    default: null,
  },
  resourceType: {
    type: String,
    enum: AUDIT_RESOURCE_TYPE_ENUM,
    default: null,
  },
  resourceId: {
    // This can refer to any model, so we don't set a hard 'ref'
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  oldValue: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  newValue: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  status: {
    type: String,
    enum: AUDIT_STATUS_ENUM,
    default: 'success',
  },
  errorMessage: {
    type: String,
    trim: true,
    default: null,
  },
  ipAddress: {
    type: String,
    trim: true,
    default: null,
  },
  userAgent: {
    type: String,
    trim: true,
    default: null,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { timestamps: true });

// Indexes for performance
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ status: 1 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);