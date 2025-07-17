// server/utils/constants/enums.js

const SERVICE_ENUM = [
  'Plumbing', 'Electrical', 'HVAC', 'Appliance', 'Structural', 'Landscaping',
  'Other', 'Cleaning', 'Security', 'Pest Control', 'Painting', 'Roofing', 'Carpentry', 'General Repair'
];

const STATUS_ENUM = ['active', 'inactive', 'preferred']; // For Vendor status

const ROLE_ENUM = {
    TENANT: 'tenant',
    LANDLORD: 'landlord',
    ADMIN: 'admin',
    PROPERTY_MANAGER: 'propertymanager',
    VENDOR: 'vendor',
};

const NOTIFICATION_CHANNEL_ENUM = ['email', 'sms', 'in_app']; // For User preferences

const REGISTRATION_STATUS_ENUM = [ // For User registration status
  'pending_invite_acceptance',
  'pending_admin_approval',
  'pending_email_verification',
  'active',
  'deactivated'
];

const UNIT_STATUS_ENUM = ['occupied', 'vacant', 'under_maintenance', 'unavailable', 'leased']; // For Unit status

const UTILITY_RESPONSIBILITY_ENUM = ['all_included', 'tenant_pays_all', 'partial_included']; // For Unit utility responsibility

const CATEGORY_ENUM = [ // For ScheduledMaintenance and Request categories
  'plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'landscaping',
  'other', 'security', 'pest_control', 'cleaning', 'scheduled', // 'scheduled' for requests generated from schedules
  'painting', 'roofing', 'carpentry', 'general_repair'
];

const FREQUENCY_TYPE_ENUM = [ // For ScheduledMaintenance frequency
  'daily', 'weekly', 'monthly', 'yearly', 'custom_days', 'bi_weekly', 'quarterly'
];

const SCHEDULED_MAINTENANCE_STATUS_ENUM = ['active', 'paused', 'completed', 'canceled']; // For ScheduledMaintenance status

const ASSIGNED_TO_MODEL_ENUM = ['User', 'Vendor']; // For polymorphic assignment in Request/ScheduledMaintenance

const PRIORITY_ENUM = ['low', 'medium', 'high', 'urgent', 'critical']; // For Request priority

const REQUEST_STATUS_ENUM = [ // For Request status
  'new', 'triaged', 'assigned', 'in_progress', 'on_hold', 'completed', 'verified',
  'reopened', 'canceled', 'archived'
];

const PAYMENT_STATUS_ENUM = ['due', 'paid', 'overdue', 'partially_paid', 'waived']; // For Rent payment status

const LEASE_STATUS_ENUM = ['active', 'expired', 'pending_renewal', 'terminated', 'draft']; // For Lease status

const MESSAGE_CATEGORY_ENUM = ['general', 'maintenance', 'billing', 'onboarding', 'urgent']; // For Message category

const NOTIFICATION_TYPE_ENUM = [ // For Notification type
  'new_request', 'status_update', 'new_comment', 'assignment', 'reminder_due', 'reminder_overdue', 'invite_received', 'task_completed', 'task_verified', 'property_added', 'unit_added', 'payment_reminder', 'document_shared', 'user_deactivated', 'lease_expiry',
  'rent_due', 'rent_overdue', 'new_message', 'onboarding_task', 'user_approval_request', 'general_alert',
  'property_update', 'unit_update'
];

const MEDIA_RELATED_TO_ENUM = [ // For Media relatedTo field
  'Property', 'Request', 'User', 'Unit', 'Vendor', 'ScheduledMaintenance', 'Lease',  'Rent', 'Comment', 'Onboarding', 'Bill', 'Invoice'
];

const INVITE_STATUS_ENUM = ['pending', 'accepted', 'expired', 'revoked']; // For Invite status

const PROPERTY_USER_ROLES_ENUM = ['landlord', 'propertymanager', 'tenant', 'vendor_access', 'admin_access']; // For PropertyUser roles

const PROPERTY_TYPE_ENUM = ['residential', 'commercial', 'multi_family', 'single_family', 'condo', 'townhouse', 'duplex', 'other']; // For Property type

const AUDIT_ACTION_ENUM = {
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT',
    PASSWORD_RESET: 'PASSWORD_RESET',
    APPROVAL: 'APPROVAL',
    REJECTION: 'REJECTION',
    FILE_UPLOAD: 'FILE_UPLOAD',
    FILE_DOWNLOAD: 'FILE_DOWNLOAD',
    USER_LOGIN: 'USER_LOGIN',
    SETTINGS_CHANGE: 'SETTINGS_CHANGE',
    ROLE_CHANGE: 'ROLE_CHANGE',
    ERROR: 'ERROR',
    SYSTEM_EVENT: 'SYSTEM_EVENT',
    USER_CREATED: 'USER_CREATED',
    USER_UPDATED: 'USER_UPDATED',
    USER_DEACTIVATED: 'USER_DEACTIVATED',
    USER_ROLE_UPDATED: 'USER_ROLE_UPDATED',
    PROPERTY_CREATED: 'PROPERTY_CREATED',
    PROPERTY_UPDATED: 'PROPERTY_UPDATED',
    PROPERTY_DEACTIVATED: 'PROPERTY_DEACTIVATED',
    UNIT_CREATED: 'UNIT_CREATED',
    UNIT_UPDATED: 'UNIT_UPDATED',
    UNIT_DEACTIVATED: 'UNIT_DEACTIVATED',
    REQUEST_CREATED: 'REQUEST_CREATED',
    REQUEST_UPDATED: 'REQUEST_UPDATED',
    REQUEST_STATUS_UPDATED: 'REQUEST_STATUS_UPDATED',
    REQUEST_ASSIGNED: 'REQUEST_ASSIGNED',
    REQUEST_COMPLETED: 'REQUEST_COMPLETED',
    REQUEST_VERIFIED: 'REQUEST_VERIFIED',
    REQUEST_REOPENED: 'REQUEST_REOPENED',
    REQUEST_CANCELED: 'REQUEST_CANCELED',
    REQUEST_ARCHIVED: 'REQUEST_ARCHIVED',
    SCHEDULED_MAINTENANCE_CREATED: 'SCHEDULED_MAINTENANCE_CREATED',
    SCHEDULED_MAINTENANCE_UPDATED: 'SCHEDULED_MAINTENANCE_UPDATED',
    SCHEDULED_MAINTENANCE_PAUSED: 'SCHEDULED_MAINTENANCE_PAUSED',
    SCHEDULED_MAINTENANCE_RESUMED: 'SCHEDULED_MAINTENANCE_RESUMED',
    SCHEDULED_MAINTENANCE_CANCELED: 'SCHEDULED_MAINTENANCE_CANCELED',
    SCHEDULED_MAINTENANCE_GENERATED_REQUEST: 'SCHEDULED_MAINTENANCE_GENERATED_REQUEST',
    VENDOR_CREATED: 'VENDOR_CREATED',
    VENDOR_UPDATED: 'VENDOR_UPDATED',
    VENDOR_DEACTIVATED: 'VENDOR_DEACTIVATED',
    INVITE_SENT: 'INVITE_SENT',
    INVITE_ACCEPTED: 'INVITE_ACCEPTED',
    INVITE_REVOKED: 'INVITE_REVOKED',
    INVITE_EXPIRED: 'INVITE_EXPIRED',
    COMMENT_ADDED: 'COMMENT_ADDED',
    MEDIA_UPLOADED: 'MEDIA_UPLOADED',
    DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
    PROPERTY_USER_ASSOCIATION_CREATED: 'PROPERTY_USER_ASSOCIATION_CREATED',
    PROPERTY_USER_ASSOCIATION_UPDATED: 'PROPERTY_USER_ASSOCIATION_UPDATED',
    PROPERTY_USER_ASSOCIATION_DEACTIVATED: 'PROPERTY_USER_ASSOCIATION_DEACTIVATED',
    BILL_CREATED: 'BILL_CREATED',
    BILL_UPDATED: 'BILL_UPDATED',
    BILL_PAID: 'BILL_PAID',
    EMAIL_VERIFICATION_SENT: 'EMAIL_VERIFICATION_SENT',
    EMAIL_VERIFIED: 'EMAIL_VERIFIED',
    INVOICE_CREATED: 'INVOICE_CREATED',
    INVOICE_UPDATED: 'INVOICE_UPDATED',
    INVOICE_SENT: 'INVOICE_SENT',
    INVOICE_PAID: 'INVOICE_PAID',
    USER_REGISTERED: 'USER_REGISTERED',
    PASSWORD_RESET_INITIATED: 'PASSWORD_RESET_INITIATED',
    BROADCAST_NOTIFICATION_SENT: 'BROADCAST_NOTIFICATION_SENT',
    USER_APPROVED: 'USER_APPROVED',
    // Add more specific actions for GET requests if you have them, e.g.:
    FETCH_ALL_RENTS: 'FETCH_ALL_RENTS',
    FETCH_ALL_LEASES: 'FETCH_ALL_LEASES',
    FETCH_ALL_PROPERTIES: 'FETCH_ALL_PROPERTIES',
    FETCH_PROFILE: 'FETCH_PROFILE', 
    FETCH_ALL_LEASES: 'FETCH_ALL_LEASES', // Add this
    READ_ONE_LEASE: 'READ_ONE_LEASE',   // Add this
    FETCH_ALL_PROPERTIES: 'FETCH_ALL_PROPERTIES', // Add this
    READ_ONE_PROPERTY: 'READ_ONE_PROPERTY',     // Add this
    FETCH_PROFILE: 'FETCH_PROFILE',     // Add this
    FETCH_ALL_USERS: 'FETCH_ALL_USERS', // Add this
    READ_ONE_USER: 'READ_ONE_USER',     // Add this
    USER_APPROVED: 'USER_APPROVED',     // Add this
    USER_ROLE_UPDATED: 'USER_ROLE_UPDATED', // Add this
    LOGIN_ATTEMPT_FAILED: 'LOGIN_ATTEMPT_FAILED',
    SYSTEM_EVENT: 'SYSTEM_EVENT',

};

const AUDIT_RESOURCE_TYPE_ENUM = [ // For Audit Log resource types
  'User', 'Property', 'Unit', 'Request', 'ScheduledMaintenance',
  'Vendor', 'Invite', 'Media', 'Comment', 'Bill', 'Invoice',
  'Lease', 'Rent', 'Message', 'Notification', 'Onboarding', 'PropertyUser', 'System' // Added 'System' for broadcast
];

const AUDIT_STATUS_ENUM = ['success', 'failure']; // For Audit Log status

const DOCUMENT_TYPE_ENUM = ['lease_agreement', 'rent_invoice', 'maintenance_report', 'lease_notice', 'rent_report'];

// Added to enums.js for consistency
const RENT_BILLING_PERIOD_ENUM = ['monthly', 'quarterly', 'bi_annually', 'annually', 'bi_weekly', 'weekly'];

const ONBOARDING_CATEGORY_ENUM = [
    'SOP',
    'Training',
    'Welcome Guide',
    'Maintenance',
    'Emergency Info',
    'Other',
    'Forms'
];

const ONBOARDING_VISIBILITY_ENUM = [
    'all_tenants',
    'property_tenants',
    'unit_tenants',
    'specific_tenant'
];


module.exports = {
  SERVICE_ENUM,
  STATUS_ENUM,
  ROLE_ENUM,
  NOTIFICATION_CHANNEL_ENUM,
  REGISTRATION_STATUS_ENUM,
  UNIT_STATUS_ENUM,
  UTILITY_RESPONSIBILITY_ENUM,
  CATEGORY_ENUM,
  FREQUENCY_TYPE_ENUM,
  SCHEDULED_MAINTENANCE_STATUS_ENUM,
  ASSIGNED_TO_MODEL_ENUM,
  PRIORITY_ENUM,
  REQUEST_STATUS_ENUM,
  PAYMENT_STATUS_ENUM,
  LEASE_STATUS_ENUM,
  MESSAGE_CATEGORY_ENUM,
  NOTIFICATION_TYPE_ENUM,
  MEDIA_RELATED_TO_ENUM,
  INVITE_STATUS_ENUM,
  PROPERTY_USER_ROLES_ENUM,
  PROPERTY_TYPE_ENUM,
  AUDIT_ACTION_ENUM,
  AUDIT_RESOURCE_TYPE_ENUM,
  AUDIT_STATUS_ENUM,
  RENT_BILLING_PERIOD_ENUM, // New: Consolidated into enums.js
  DOCUMENT_TYPE_ENUM,
  ONBOARDING_CATEGORY_ENUM,
  ONBOARDING_VISIBILITY_ENUM,
};