// server/utils/constants/enums.js

// --- Service & Status Enums ---
const SERVICE_ENUM = [
  'Plumbing', 'Electrical', 'HVAC', 'Appliance', 'Structural', 'Landscaping',
  'Other', 'Cleaning', 'Security', 'Pest Control', 'Painting', 'Roofing', 'Carpentry', 'General Repair'
];
const STATUS_ENUM = ['active', 'inactive', 'preferred']; // For Vendor status

// --- User & Role Enums ---
const ROLE_ENUM = {
    TENANT: 'tenant',
    LANDLORD: 'landlord',
    ADMIN: 'admin',
    PROPERTY_MANAGER: 'propertymanager',
    VENDOR: 'vendor',
};
const REGISTRATION_STATUS_ENUM = [
  'pending_invite_acceptance', 'pending_admin_approval', 'pending_email_verification',
  'active', 'deactivated'
];
const PROPERTY_USER_ROLES_ENUM = ['landlord', 'propertymanager', 'tenant', 'vendor_access', 'admin_access'];

// --- Property & Unit Enums ---
const PROPERTY_TYPE_ENUM = [
  'residential', 'commercial', 'multi_family', 'single_family', 'condo', 'townhouse', 'duplex', 'other'
];
const UNIT_STATUS_ENUM = ['occupied', 'vacant', 'under_maintenance', 'unavailable', 'leased'];
const UTILITY_RESPONSIBILITY_ENUM = ['all_included', 'tenant_pays_all', 'partial_included'];

// --- Maintenance & Request Enums ---
const CATEGORY_ENUM = [
  'plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'landscaping',
  'other', 'security', 'pest_control', 'cleaning', 'scheduled',
  'painting', 'roofing', 'carpentry', 'general_repair'
];
const PRIORITY_ENUM = ['low', 'medium', 'high', 'urgent', 'critical'];
const REQUEST_STATUS_ENUM = [
  'new', 'triaged', 'assigned', 'in_progress', 'on_hold', 'completed', 'verified',
  'reopened', 'canceled', 'archived'
];
const ASSIGNED_TO_MODEL_ENUM = ['User', 'Vendor'];

// --- Scheduled Maintenance Enums ---
const SCHEDULED_MAINTENANCE_STATUS_ENUM = ['active', 'paused', 'completed', 'canceled'];
const FREQUENCY_TYPE_ENUM = [
  'daily', 'weekly', 'monthly', 'yearly', 'custom_days', 'bi_weekly', 'quarterly'
];

// --- Lease & Rent Enums ---
const LEASE_STATUS_ENUM = ['active', 'expired', 'pending_renewal', 'terminated', 'draft'];
const PAYMENT_STATUS_ENUM = ['due', 'paid', 'overdue', 'partially_paid', 'waived'];
const RENT_BILLING_PERIOD_ENUM = ['monthly', 'quarterly', 'bi_annually', 'annually', 'bi_weekly', 'weekly'];

// --- Communication & Invite Enums ---
const MESSAGE_CATEGORY_ENUM = ['general', 'maintenance', 'billing', 'onboarding', 'urgent'];
const NOTIFICATION_CHANNEL_ENUM = ['email', 'sms', 'in_app'];
const NOTIFICATION_TYPE_ENUM = [
  'new_request', 'status_update', 'new_comment', 'assignment', 'reminder_due', 'reminder_overdue',
  'invite_received', 'task_completed', 'task_verified', 'property_added', 'unit_added',
  'payment_reminder', 'document_shared', 'user_deactivated', 'lease_expiry',
  'rent_due', 'rent_overdue', 'new_message', 'onboarding_task', 'user_approval_request',
  'general_alert', 'property_update', 'unit_update'
];
const INVITE_STATUS_ENUM = ['pending', 'accepted', 'expired', 'revoked'];

// --- Document, Media, & Onboarding Enums ---
const MEDIA_RELATED_TO_ENUM = [
  'Property', 'Request', 'User', 'Unit', 'Vendor', 'ScheduledMaintenance', 'Lease',
  'Rent', 'Comment', 'Onboarding', 'Bill', 'Invoice'
];
const DOCUMENT_TYPE_ENUM = [
  'lease_agreement', 'rent_invoice', 'maintenance_report', 'lease_notice', 'rent_report'
];
const ONBOARDING_CATEGORY_ENUM = [
    'SOP', 'Training', 'Welcome Guide', 'Maintenance', 'Emergency Info', 'Other', 'Forms'
];
const ONBOARDING_VISIBILITY_ENUM = [
    'all_tenants', 'property_tenants', 'unit_tenants', 'specific_tenant'
];

// --- Audit Log Enums (Cleaned and Organized) ---
const AUDIT_ACTION_ENUM = {
    // Generic Actions
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    FETCH_ALL: 'FETCH_ALL',
    FETCH_ONE: 'FETCH_ONE',
    ERROR: 'ERROR',
    SYSTEM_EVENT: 'SYSTEM_EVENT',
    
    // Auth Actions
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGIN_FAILURE: 'LOGIN_FAILURE',
    LOGOUT: 'LOGOUT',
    USER_REGISTERED: 'USER_REGISTERED',
    PASSWORD_RESET_INITIATED: 'PASSWORD_RESET_INITIATED',
    PASSWORD_RESET_SUCCESS: 'PASSWORD_RESET_SUCCESS',
    EMAIL_VERIFICATION_SENT: 'EMAIL_VERIFICATION_SENT',
    EMAIL_VERIFIED: 'EMAIL_VERIFIED',

    // User Actions
    USER_CREATED: 'USER_CREATED',
    USER_UPDATED: 'USER_UPDATED',
    USER_DEACTIVATED: 'USER_DEACTIVATED',
    USER_APPROVED: 'USER_APPROVED',
    USER_ROLE_UPDATED: 'USER_ROLE_UPDATED',
    FETCH_PROFILE: 'FETCH_PROFILE',
    FETCH_ALL_USERS: 'FETCH_ALL_USERS',
    FETCH_ONE_USER: 'FETCH_ONE_USER',
    USER_LOGIN: 'USER_LOGIN',

    // Property Actions
    PROPERTY_CREATED: 'PROPERTY_CREATED',
    PROPERTY_UPDATED: 'PROPERTY_UPDATED',
    PROPERTY_DEACTIVATED: 'PROPERTY_DEACTIVATED',
    FETCH_ALL_PROPERTIES: 'FETCH_ALL_PROPERTIES',
    FETCH_ONE_PROPERTY: 'FETCH_ONE_PROPERTY',

    // Unit Actions
    UNIT_CREATED: 'UNIT_CREATED',
    UNIT_UPDATED: 'UNIT_UPDATED',
    UNIT_DEACTIVATED: 'UNIT_DEACTIVATED',

    // Request Actions
    REQUEST_CREATED: 'REQUEST_CREATED',
    REQUEST_UPDATED: 'REQUEST_UPDATED',
    REQUEST_STATUS_UPDATED: 'REQUEST_STATUS_UPDATED',
    REQUEST_ASSIGNED: 'REQUEST_ASSIGNED',
    REQUEST_COMPLETED: 'REQUEST_COMPLETED',
    REQUEST_VERIFIED: 'REQUEST_VERIFIED',
    REQUEST_REOPENED: 'REQUEST_REOPENED',
    REQUEST_CANCELED: 'REQUEST_CANCELED',
    REQUEST_ARCHIVED: 'REQUEST_ARCHIVED',
    
    // Scheduled Maintenance Actions
    SCHEDULED_MAINTENANCE_CREATED: 'SCHEDULED_MAINTENANCE_CREATED',
    SCHEDULED_MAINTENANCE_UPDATED: 'SCHEDULED_MAINTENANCE_UPDATED',
    SCHEDULED_MAINTENANCE_PAUSED: 'SCHEDULED_MAINTENANCE_PAUSED',
    SCHEDULED_MAINTENANCE_RESUMED: 'SCHEDULED_MAINTENANCE_RESUMED',
    SCHEDULED_MAINTENANCE_CANCELED: 'SCHEDULED_MAINTENANCE_CANCELED',
    SCHEDULED_MAINTENANCE_GENERATED_REQUEST: 'SCHEDULED_MAINTENANCE_GENERATED_REQUEST',

    // Vendor Actions
    VENDOR_CREATED: 'VENDOR_CREATED',
    VENDOR_UPDATED: 'VENDOR_UPDATED',
    VENDOR_DEACTIVATED: 'VENDOR_DEACTIVATED',
    FETCH_ALL_VENDORS: 'FETCH_ALL_VENDORS',
    FETCH_ONE_VENDOR: 'FETCH_ONE_VENDOR',

    // Invite Actions
    INVITE_SENT: 'INVITE_SENT',
    INVITE_ACCEPTED: 'INVITE_ACCEPTED',
    INVITE_REVOKED: 'INVITE_REVOKED',
    INVITE_EXPIRED: 'INVITE_EXPIRED',

    // Communication & File Actions
    COMMENT_ADDED: 'COMMENT_ADDED',
    MEDIA_UPLOADED: 'MEDIA_UPLOADED',
    DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
    FILE_DOWNLOAD: 'FILE_DOWNLOAD',
    BROADCAST_NOTIFICATION_SENT: 'BROADCAST_NOTIFICATION_SENT',

    // Association Actions
    PROPERTY_USER_ASSOCIATION_CREATED: 'PROPERTY_USER_ASSOCIATION_CREATED',
    PROPERTY_USER_ASSOCIATION_UPDATED: 'PROPERTY_USER_ASSOCIATION_UPDATED',
    PROPERTY_USER_ASSOCIATION_DEACTIVATED: 'PROPERTY_USER_ASSOCIATION_DEACTIVATED',

    // Financial Actions
    BILL_CREATED: 'BILL_CREATED',
    BILL_UPDATED: 'BILL_UPDATED',
    BILL_PAID: 'BILL_PAID',
    INVOICE_CREATED: 'INVOICE_CREATED',
    INVOICE_UPDATED: 'INVOICE_UPDATED',
    INVOICE_SENT: 'INVOICE_SENT',
    INVOICE_PAID: 'INVOICE_PAID',
    FETCH_ALL_RENTS: 'FETCH_ALL_RENTS',
    FETCH_ALL_LEASES: 'FETCH_ALL_LEASES',
};

const AUDIT_RESOURCE_TYPE_ENUM = [
  'User', 'Property', 'Unit', 'Request', 'ScheduledMaintenance',
  'Vendor', 'Invite', 'Media', 'Comment', 'Bill', 'Invoice',
  'Lease', 'Rent', 'Message', 'Notification', 'Onboarding', 'PropertyUser', 'System'
];
const AUDIT_STATUS_ENUM = ['success', 'failure'];


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
  RENT_BILLING_PERIOD_ENUM,
  DOCUMENT_TYPE_ENUM,
  ONBOARDING_CATEGORY_ENUM,
  ONBOARDING_VISIBILITY_ENUM,
};