// src/middleware/validationMiddleware.js

const { body, param, validationResult } = require('express-validator');
const logger = require('../utils/logger'); // Correct path to logger utility
const AppError = require('../utils/AppError'); // Import custom AppError

// Import validation utilities from src/utils/validationUtils.js
const {
    validateResult, // Our centralized validation error handler
    emailValidator,
    passwordValidator,
    validateMongoId, // For validating MongoDB IDs in params
    validatePropertyCreation // Example: for property creation
} = require('../utils/validationUtils');

// Import enums for role validation consistency
const { PROPERTY_USER_ROLES_ENUM, UNIT_STATUS_ENUM, UTILITY_RESPONSIBILITY_ENUM, CATEGORY_ENUM, PRIORITY_ENUM, REQUEST_STATUS_ENUM, ASSIGNED_TO_MODEL_ENUM, SERVICE_ENUM, VENDOR_STATUS_ENUM } = require('../utils/constants/enums');


/**
 * Validates a new user's registration data.
 * Aligns with User model: firstName, lastName, phone, email, password, role.
 */
const validateUserRegistration = [
    body('firstName').notEmpty().withMessage('First name is required').trim().isLength({ max: 50 }),
    body('lastName').notEmpty().withMessage('Last name is required').trim().isLength({ max: 50 }),
    body('phone').notEmpty().withMessage('Phone number is required').trim().isMobilePhone('any', { strictMode: false }),
    ...emailValidator,
    ...passwordValidator,
    body('role').optional().isIn(PROPERTY_USER_ROLES_ENUM).withMessage('Invalid user role provided.'),
    validateResult
];


/**
 * Validation for creating/updating a Unit.
 * Aligns with Unit model: unitName, floor, details, property, numBedrooms, numBathrooms,
 * squareFootage, rentAmount, depositAmount, status, utilityResponsibility, notes, lastInspected.
 */
const validateUnit = [
    body('unitName')
        .notEmpty().withMessage('Unit name is required')
        .trim()
        .isLength({ max: 50 }).withMessage('Unit name cannot exceed 50 characters.'),
    body('floor')
        .optional()
        .isString().withMessage('Floor must be a string')
        .trim()
        .isLength({ max: 20 }).withMessage('Floor number/name cannot exceed 20 characters.'),
    body('details') // This is 'details' in Unit model, not 'description'
        .optional()
        .isString().withMessage('Details must be a string')
        .trim()
        .isLength({ max: 1000 }).withMessage('Details cannot exceed 1000 characters.'),
    body('property')
        .notEmpty().withMessage('Property is required')
        .isMongoId().withMessage('Property must be a valid MongoDB ID'),
    body('currentTenant') // This is 'currentTenant' in Unit model
        .optional()
        .isMongoId().withMessage('Current tenant must be a valid MongoDB ID'),
    body('numBedrooms').optional().isInt({ min: 0 }).withMessage('Number of bedrooms must be a non-negative integer.'),
    body('numBathrooms').optional().isInt({ min: 0 }).withMessage('Number of bathrooms must be a non-negative integer.'),
    body('squareFootage').optional().isFloat({ min: 0 }).withMessage('Square footage must be a non-negative number.'),
    body('rentAmount').optional().isFloat({ min: 0 }).withMessage('Rent amount must be a non-negative number.'),
    body('depositAmount').optional().isFloat({ min: 0 }).withMessage('Deposit amount must be a non-negative number.'),
    body('status')
        .optional()
        .isIn(UNIT_STATUS_ENUM).withMessage(`Invalid unit status. Must be one of: ${UNIT_STATUS_ENUM.join(', ')}`),
    body('utilityResponsibility')
        .optional()
        .isIn(UTILITY_RESPONSIBILITY_ENUM).withMessage(`Invalid utility responsibility. Must be one of: ${UTILITY_RESPONSIBILITY_ENUM.join(', ')}`),
    body('notes')
        .optional()
        .isString().withMessage('Notes must be a string')
        .trim()
        .isLength({ max: 2000 }).withMessage('Notes cannot exceed 2000 characters.'),
    body('lastInspected').optional().isISO8601().toDate().withMessage('Last inspected date must be a valid date.'),
    // unitImages is an array of strings (URLs) in the schema, typically handled by file upload logic not direct validation here.
    validateResult
];

/**
 * Validation for creating a Vendor.
 * Aligns with Vendor model: name, phone, email, address, contactPerson, serviceTags, status, notes.
 */
const validateVendor = [
    body('name')
        .notEmpty().withMessage('Vendor name is required')
        .trim()
        .isLength({ max: 100 }).withMessage('Vendor name cannot exceed 100 characters.'),
    body('phone') // Use 'phone' as per Vendor model, not 'phoneNumber'
        .notEmpty().withMessage('Vendor phone number is required')
        .trim()
        .isMobilePhone('any', { strictMode: false }).withMessage('Please provide a valid phone number.'),
    body('email')
        .optional() // Made optional as per Vendor model
        .isEmail().withMessage('Please enter a valid email address')
        .normalizeEmail(),
    // Address sub-document validation (assuming it's nested)
    body('address.city').notEmpty().withMessage('City is required for vendor address.').trim(),
    body('address.country').notEmpty().withMessage('Country is required for vendor address.').trim(),
    body('contactPerson').optional().trim().isLength({ max: 100 }).withMessage('Contact person name cannot exceed 100 characters.'),
    body('serviceTags') // This is 'serviceTags' in Vendor model, not 'services'
        .isArray({ min: 1 }).withMessage('At least one service tag is required')
        .custom(value => value.every(tag => SERVICE_ENUM.includes(tag))) // Validate against SERVICE_ENUM
        .withMessage(`Invalid service tag(s). Must be one of: ${SERVICE_ENUM.join(', ')}`),
    body('status')
        .optional()
        .isIn(VENDOR_STATUS_ENUM).withMessage(`Invalid vendor status. Must be one of: ${VENDOR_STATUS_ENUM.join(', ')}`),
    body('notes')
        .optional()
        .isString().withMessage('Notes must be a string')
        .trim()
        .isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
    validateResult
];

/**
 * Validation for creating/updating a Maintenance Request.
 * Aligns with Request model: title, description, category, priority, property, unit,
 * createdBy, assignedTo, assignedToModel, status, images, comments, feedback, publicToken.
 */
const validateMaintenanceRequest = [
    body('title')
        .notEmpty().withMessage('Request title is required')
        .trim()
        .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters.'),
    body('description')
        .notEmpty().withMessage('Description is required for the request')
        .trim()
        .isLength({ max: 2000 }).withMessage('Description cannot exceed 2000 characters.'),
    body('category')
        .notEmpty().withMessage('Category is required')
        .isIn(CATEGORY_ENUM).withMessage(`Invalid category. Must be one of: ${CATEGORY_ENUM.join(', ')}`),
    body('priority')
        .optional()
        .isIn(PRIORITY_ENUM).withMessage(`Invalid priority. Must be one of: ${PRIORITY_ENUM.join(', ')}`),
    body('property')
        .notEmpty().withMessage('Property is required')
        .isMongoId().withMessage('Property must be a valid MongoDB ID'),
    body('unit')
        .optional()
        .isMongoId().withMessage('Unit must be a valid MongoDB ID'),
    body('createdBy')
        .notEmpty().withMessage('Creator is required')
        .isMongoId().withMessage('Creator must be a valid MongoDB ID'),
    body('assignedTo')
        .optional()
        .isMongoId().withMessage('AssignedTo must be a valid MongoDB ID'),
    body('assignedToModel')
        .optional()
        .isIn(ASSIGNED_TO_MODEL_ENUM).withMessage(`Invalid assignedToModel. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}`),
    body('status')
        .optional()
        .isIn(REQUEST_STATUS_ENUM).withMessage(`Invalid request status. Must be one of: ${REQUEST_STATUS_ENUM.join(', ')}`),
    // 'media' (images) are handled by upload middleware, not direct body validation
    // 'comments' and 'feedback' are typically added via separate endpoints or sub-schemas
    validateResult
];

/**
 * Validation for creating/updating a Lease.
 * Aligns with Lease model: property, unit, tenant, landlord, leaseStartDate, leaseEndDate,
 * monthlyRent, currency, paymentDueDate, securityDeposit, terms, status, documents.
 */
const validateLease = [
    body('property').notEmpty().withMessage('Property is required').isMongoId().withMessage('Property must be a valid MongoDB ID'),
    body('unit').notEmpty().withMessage('Unit is required').isMongoId().withMessage('Unit must be a valid MongoDB ID'),
    body('tenant').notEmpty().withMessage('Tenant is required').isMongoId().withMessage('Tenant must be a valid MongoDB ID'),
    body('landlord').notEmpty().withMessage('Landlord is required').isMongoId().withMessage('Landlord must be a valid MongoDB ID'),
    body('leaseStartDate').notEmpty().withMessage('Lease start date is required').isISO8601().toDate().withMessage('Lease start date must be a valid date.'),
    body('leaseEndDate').notEmpty().withMessage('Lease end date is required').isISO8601().toDate().withMessage('Lease end date must be a valid date.')
        .custom((endDate, { req }) => {
            if (new Date(endDate) <= new Date(req.body.leaseStartDate)) {
                throw new Error('Lease end date must be after lease start date.');
            }
            return true;
        }),
    body('monthlyRent').notEmpty().withMessage('Monthly rent is required').isFloat({ min: 0 }).withMessage('Monthly rent must be a non-negative number.'),
    body('currency').optional().isString().trim().isLength({ max: 10 }).withMessage('Currency cannot exceed 10 characters.'),
    body('paymentDueDate').notEmpty().withMessage('Payment due date is required').isInt({ min: 1, max: 31 }).withMessage('Payment due date must be a day between 1 and 31.'),
    body('securityDeposit').optional().isFloat({ min: 0 }).withMessage('Security deposit must be a non-negative number.'),
    body('terms').optional().isString().trim().isLength({ max: 2000 }).withMessage('Terms cannot exceed 2000 characters.'),
    body('status').optional().isIn(['active', 'expired', 'terminated', 'pending_renewal']).withMessage('Invalid lease status.'), // Adjust enum as per your constants
    // 'documents' are handled by file upload logic, not direct body validation
    validateResult
];

/**
 * Validation for creating/updating a PropertyUser.
 * Aligns with PropertyUser model: user, property, unit, roles, invitedBy, isActive, startDate, endDate.
 */
const validatePropertyUser = [
    body('user').notEmpty().withMessage('User ID is required').isMongoId().withMessage('User ID must be a valid MongoDB ID'),
    body('property').notEmpty().withMessage('Property ID is required').isMongoId().withMessage('Property ID must be a valid MongoDB ID'),
    body('unit').optional().isMongoId().withMessage('Unit ID must be a valid MongoDB ID'),
    body('roles')
        .notEmpty().withMessage('Roles are required')
        .isArray({ min: 1 }).withMessage('At least one role is required')
        .custom(value => value.every(role => PROPERTY_USER_ROLES_ENUM.includes(role)))
        .withMessage(`Invalid role(s) provided. Must be one of: ${PROPERTY_USER_ROLES_ENUM.join(', ')}`),
    body('invitedBy').optional().isMongoId().withMessage('InvitedBy ID must be a valid MongoDB ID'),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
    body('startDate').optional().isISO8601().toDate().withMessage('Start date must be a valid date.'),
    body('endDate').optional().isISO8601().toDate().withMessage('End date must be a valid date.')
        .custom((endDate, { req }) => {
            if (req.body.startDate && new Date(endDate) <= new Date(req.body.startDate)) {
                throw new Error('End date must be after start date.');
            }
            return true;
        }),
    validateResult
];

/**
 * Validation for creating/updating a ScheduledMaintenance.
 * Aligns with ScheduledMaintenance model: title, description, category, property, unit,
 * scheduledDate, recurring, frequency, status, assignedTo, createdBy, media, comments, publicLink.
 */
const validateScheduledMaintenance = [
    body('title').notEmpty().withMessage('Title is required for scheduled maintenance.').trim().isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters.'),
    body('description').notEmpty().withMessage('Description is required for scheduled maintenance.').trim().isLength({ max: 2000 }).withMessage('Description cannot exceed 2000 characters.'),
    body('category').notEmpty().withMessage('Category is required.').isIn(CATEGORY_ENUM).withMessage(`Invalid category. Must be one of: ${CATEGORY_ENUM.join(', ')}`),
    body('property').notEmpty().withMessage('Property is required for scheduled maintenance.').isMongoId().withMessage('Property must be a valid MongoDB ID'),
    body('unit').optional().isMongoId().withMessage('Unit must be a valid MongoDB ID'),
    body('scheduledDate').notEmpty().withMessage('Scheduled date is required.').isISO8601().toDate().withMessage('Scheduled date must be a valid date.'),
    body('recurring').isBoolean().withMessage('Recurring must be a boolean.'),
    body('frequency').custom((value, { req }) => {
        if (req.body.recurring && !value) {
            throw new Error('Frequency is required for recurring maintenance.');
        }
        if (value && value.type && !['daily', 'weekly', 'bi_weekly', 'monthly', 'quarterly', 'annually', 'once', 'custom_days'].includes(value.type)) {
            throw new Error('Invalid frequency type.');
        }
        // Add more specific frequency validation here if needed (e.g., interval, dayOfWeek, dayOfMonth)
        return true;
    }),
    body('status').optional().isIn(['scheduled', 'in_progress', 'completed', 'cancelled']).withMessage('Invalid status.'), // Adjust enum as per your constants
    body('assignedTo').optional().isMongoId().withMessage('AssignedTo must be a valid MongoDB ID'),
    body('assignedToModel').optional().isIn(ASSIGNED_TO_MODEL_ENUM).withMessage(`Invalid assignedToModel. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}`),
    body('createdBy').notEmpty().withMessage('Creator is required for scheduled maintenance.').isMongoId().withMessage('Creator must be a valid MongoDB ID'),
    // 'media' and 'comments' are typically handled separately
    validateResult
];

/**
 * Validation for creating/updating a Lease.
 * Aligns with Lease model: property, unit, tenant, landlord, leaseStartDate, leaseEndDate,
 * monthlyRent, currency, paymentDueDate, securityDeposit, terms, status, documents.
 */
const validateLeaseUpdate = [
    body('property').optional().isMongoId().withMessage('Property must be a valid MongoDB ID'),
    body('unit').optional().isMongoId().withMessage('Unit must be a valid MongoDB ID'),
    body('tenant').optional().isMongoId().withMessage('Tenant must be a valid MongoDB ID'),
    body('landlord').optional().isMongoId().withMessage('Landlord must be a valid MongoDB ID'),
    body('leaseStartDate').optional().isISO8601().toDate().withMessage('Lease start date must be a valid date.'),
    body('leaseEndDate').optional().isISO8601().toDate().withMessage('Lease end date must be a valid date.')
        .custom((endDate, { req }) => {
            if (req.body.leaseStartDate && new Date(endDate) <= new Date(req.body.leaseStartDate)) {
                throw new Error('Lease end date must be after lease start date.');
            }
            return true;
        }),
    body('monthlyRent').optional().isFloat({ min: 0 }).withMessage('Monthly rent must be a non-negative number.'),
    body('currency').optional().isString().trim().isLength({ max: 10 }).withMessage('Currency cannot exceed 10 characters.'),
    body('paymentDueDate').optional().isInt({ min: 1, max: 31 }).withMessage('Payment due date must be a day between 1 and 31.'),
    body('securityDeposit').optional().isFloat({ min: 0 }).withMessage('Security deposit must be a non-negative number.'),
    body('terms').optional().isString().trim().isLength({ max: 2000 }).withMessage('Terms cannot exceed 2000 characters.'),
    body('status').optional().isIn(['active', 'expired', 'terminated', 'pending_renewal']).withMessage('Invalid lease status.'), // Adjust enum as per your constants
    validateResult
];

/**
 * Validation for recording a Rent Payment.
 * Aligns with Rent model: lease, tenant, property, unit, billingPeriod, amountDue, dueDate,
 * amountPaid, paymentDate, status, paymentMethod, transactionId, paymentProof, notes.
 */
const validateRentPayment = [
    body('leaseId').notEmpty().withMessage('Lease ID is required').isMongoId().withMessage('Lease ID must be a valid MongoDB ID'),
    body('amountPaid').notEmpty().withMessage('Amount paid is required').isFloat({ min: 0 }).withMessage('Amount paid must be a non-negative number.'),
    body('paymentDate').notEmpty().withMessage('Payment date is required').isISO8601().toDate().withMessage('Payment date must be a valid date.'),
    body('paymentMethod').notEmpty().withMessage('Payment method is required').trim().isLength({ max: 50 }).withMessage('Payment method cannot exceed 50 characters.'),
    body('transactionId').optional().trim().isLength({ max: 100 }).withMessage('Transaction ID cannot exceed 100 characters.'),
    // proofOfPayment is handled by upload middleware, not direct body validation
    body('notes').optional().isString().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
    body('paidByUserId').notEmpty().withMessage('Paid by user ID is required').isMongoId().withMessage('Paid by user ID must be a valid MongoDB ID'),
    validateResult
];


module.exports = {
    // Re-export express-validator functions for direct use if needed
    check,
    validationResult,
    validateResult,
    emailValidator,
    passwordValidator,
    validateMongoId,
    validateUserRegistration,
    validatePropertyCreation,
    validateUnit,
    validateVendor,
    validateMaintenanceRequest,
    validateLease,
    validateLeaseUpdate,
    validatePropertyUser,
    validateScheduledMaintenance,
    validateRentPayment,
    // Add other specific validators here as your API grows
};
