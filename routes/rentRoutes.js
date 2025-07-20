// src/routes/rentRoutes.js

const express = require('express');
const router = express.Router();
const rentController = require('../controllers/rentController'); // Import controller
const rentScheduleController = require('../controllers/rentController'); // Reuse same controller for schedules
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Import auth middleware
const { upload } = require('../middleware/uploadMiddleware'); // For single file uploads
const { validateMongoId, validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { ROLE_ENUM, PAYMENT_STATUS_ENUM, RENT_BILLING_PERIOD_ENUM } = require('../utils/constants/enums'); // Import enums
const { body, query, param } = require('express-validator'); // For specific body/query/param validation

/**
 * Middleware for common date validation
 */
const dateRangeValidators = [
    query('startDate').optional().isISO8601().toDate().withMessage('Start date must be a valid ISO 8601 date (YYYY-MM-DD).'),
    query('endDate').optional().isISO8601().toDate().withMessage('End date must be a valid ISO 8601 date (YYYY-MM-DD).'),
    query('startDate').optional().custom((startDate, { req }) => {
        if (req.query.endDate && new Date(startDate) > new Date(req.query.endDate)) {
            throw new Error('Start date cannot be after end date.');
        }
        return true;
    }),
    validateResult
];

/**
 * Middleware for validating rent record data
 */
const validateRentRecordData = [
    body('lease').notEmpty().withMessage('Lease ID is required.').isMongoId().withMessage('Invalid Lease ID format.'),
    body('amountDue').notEmpty().withMessage('Amount due is required.').isFloat({ min: 0 }).withMessage('Amount due must be a non-negative number.'),
    body('dueDate').notEmpty().withMessage('Due date is required.').isISO8601().toDate().withMessage('Due date must be a valid date.'),
    body('billingPeriod').notEmpty().withMessage('Billing period is required.').matches(/^\d{4}-\d{2}$/).withMessage('Billing period must be in YYYY-MM format.'),
    body('status').optional().isIn(PAYMENT_STATUS_ENUM).withMessage(`Invalid status. Must be one of: ${PAYMENT_STATUS_ENUM.join(', ')}`),
    body('currency').optional().isString().trim().isLength({ max: 10 }).withMessage('Currency cannot exceed 10 characters.'),
    body('notes').optional().isString().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
    validateResult
];

/**
 * Middleware for validating payment data
 */
const validatePaymentData = [
    body('amountPaid').notEmpty().withMessage('Amount paid is required.').isFloat({ min: 0.01 }).withMessage('Amount paid must be greater than zero.'),
    body('paymentDate').notEmpty().withMessage('Payment date is required.').isISO8601().toDate().withMessage('Payment date must be a valid date.'),
    body('paymentMethod').optional().isString().trim().isLength({ max: 50 }).withMessage('Payment method cannot exceed 50 characters.'),
    body('transactionId').optional().isString().trim().isLength({ max: 100 }).withMessage('Transaction ID cannot exceed 100 characters.'),
    body('notes').optional().isString().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
    validateResult
];

/**
 * Middleware for validating rent schedule data
 */
const validateRentScheduleData = [
    body('lease').notEmpty().withMessage('Lease ID is required.').isMongoId().withMessage('Invalid Lease ID format.'),
    body('amount').notEmpty().withMessage('Rent amount is required.').isFloat({ min: 0 }).withMessage('Rent amount must be a non-negative number.'),
    body('currency').optional().isString().trim().isLength({ max: 10 }).withMessage('Currency cannot exceed 10 characters.'),
    body('dueDateDay').notEmpty().withMessage('Due date day is required.').isInt({ min: 1, max: 31 }).withMessage('Due date day must be between 1 and 31.'),
    body('billingPeriod').notEmpty().withMessage('Billing period is required.').isIn(RENT_BILLING_PERIOD_ENUM).withMessage(`Invalid billing period. Must be one of: ${RENT_BILLING_PERIOD_ENUM.join(', ')}`),
    body('effectiveStartDate').notEmpty().withMessage('Effective start date is required.').isISO8601().toDate().withMessage('Effective start date must be a valid date.'),
    body('effectiveEndDate').optional().isISO8601().toDate().withMessage('Effective end date must be a valid date.'),
    body('notes').optional().isString().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
    body('autoGenerateRent').optional().isBoolean().withMessage('Auto generate rent must be a boolean value.'),
    validateResult
];

// ==========================================
// RENT RECORD ROUTES
// ==========================================

/**
 * Special case routes that need to come before :id routes to avoid conflicts
 */

/**
 * @route GET /api/rents/upcoming
 * @desc Get upcoming rent due dates
 * @access Private (Landlord/Admin, Property Manager, Tenant)
 */
router.get(
    '/upcoming',
    protect,
    [
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        query('daysAhead').optional().isInt({ min: 1 }).withMessage('Days ahead must be a positive integer.'),
        validateResult
    ],
    rentController.getUpcomingRent
);

/**
 * @route GET /api/rents/history
 * @desc Get rent history
 * @access Private (Landlord/Admin, PM, Tenant)
 */
router.get(
    '/history',
    protect,
    [
        query('leaseId').optional().isMongoId().withMessage('Invalid Lease ID format.'),
        query('tenantId').optional().isMongoId().withMessage('Invalid Tenant ID format.'),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        ...dateRangeValidators
    ],
    rentController.getRentHistory
);

/**
 * @route POST /api/rents/generate
 * @desc Generate rent records based on schedules
 * @access Private (Landlord/Admin, Property Manager)
 */
router.post(
    '/generate',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    [
        body('forDate').optional().isISO8601().toDate().withMessage('For date must be a valid date.'),
        body('forceGeneration').optional().isBoolean().withMessage('Force generation must be a boolean value.'),
        validateResult
    ],
    rentController.generateRentRecords
);

/**
 * @route POST /api/rents
 * @desc Create a new rent record
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateRentRecordData,
    rentController.createRentRecord
);

/**
 * @route GET /api/rents
 * @desc Get all rent records accessible by the logged-in user
 * @access Private (with access control)
 */
router.get(
    '/',
    protect,
    [
        query('status').optional().isIn(PAYMENT_STATUS_ENUM).withMessage(`Invalid status filter. Must be one of: ${PAYMENT_STATUS_ENUM.join(', ')}`),
        query('billingPeriod').optional().matches(/^\d{4}-\d{2}$/).withMessage('Billing period must be in YYYY-MM format.'),
        query('leaseId').optional().isMongoId().withMessage('Invalid Lease ID format.'),
        query('tenantId').optional().isMongoId().withMessage('Invalid Tenant ID format.'),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        ...dateRangeValidators,
        query('sortBy').optional().isString().trim().withMessage('Sort by field must be a string.'),
        query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be "asc" or "desc".'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
        validateResult
    ],
    rentController.getAllRentRecords
);

/**
 * @route GET /api/rents/:id
 * @desc Get a single rent record by ID
 * @access Private (Accessible if user is associated with rent record's lease/property)
 */
router.get(
    '/:id',
    protect,
    validateMongoId('id'),
    rentController.getRentRecordById
);

/**
 * @route PUT /api/rents/:id
 * @desc Update a rent record
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.put(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    [
        body('amountDue').optional().isFloat({ min: 0 }).withMessage('Amount due must be a non-negative number.'),
        body('dueDate').optional().isISO8601().toDate().withMessage('Due date must be a valid date.'),
        body('billingPeriod').optional().matches(/^\d{4}-\d{2}$/).withMessage('Billing period must be in YYYY-MM format.'),
        body('status').optional().isIn(PAYMENT_STATUS_ENUM).withMessage(`Invalid status. Must be one of: ${PAYMENT_STATUS_ENUM.join(', ')}`),
        body('notes').optional().isString().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
        body('reminderSent').optional().isBoolean().withMessage('Reminder sent must be a boolean value.'),
        body('lastReminderDate').optional().isISO8601().toDate().withMessage('Last reminder date must be a valid date.'),
        validateResult
    ],
    rentController.updateRentRecord
);

/**
 * @route POST /api/rents/:id/pay
 * @desc Record a rent payment
 * @access Private (Landlord/Admin, PM, Tenant)
 */
router.post(
    '/:id/pay',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.TENANT),
    validateMongoId('id'),
    upload.single('documentFile'),
    validatePaymentData,
    rentController.recordRentPayment
);

/**
 * @route POST /api/rents/:id/upload-proof
 * @desc Upload payment proof for a rent record
 * @access Private (Landlord/Admin, PM, or Tenant)
 */
router.post(
    '/:id/upload-proof',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.TENANT),
    validateMongoId('id'),
    upload.single('documentFile'),
    [
        body('notes').optional().isString().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
        validateResult
    ],
    rentController.uploadPaymentProof
);

/**
 * @route GET /api/rents/:id/download-proof
 * @desc Download payment proof for a rent record
 * @access Private (Landlord/Admin, PM, or Tenant associated with rent)
 */
router.get(
    '/:id/download-proof',
    protect,
    validateMongoId('id'),
    rentController.downloadPaymentProof
);

/**
 * @route DELETE /api/rents/:id
 * @desc Delete a rent record
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.delete(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    rentController.deleteRentRecord
);

// ==========================================
// RENT SCHEDULE ROUTES
// ==========================================

/**
 * @route POST /api/rent-schedules
 * @desc Create a new rent schedule
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.post(
    '/rent-schedules',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateRentScheduleData,
    rentController.createRentSchedule
);

/**
 * @route GET /api/rent-schedules
 * @desc Get all rent schedules accessible by the logged-in user
 * @access Private (with access control)
 */
router.get(
    '/rent-schedules',
    protect,
    [
        query('leaseId').optional().isMongoId().withMessage('Invalid Lease ID format.'),
        query('tenantId').optional().isMongoId().withMessage('Invalid Tenant ID format.'),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        query('billingPeriod').optional().isIn(RENT_BILLING_PERIOD_ENUM).withMessage(`Invalid billing period. Must be one of: ${RENT_BILLING_PERIOD_ENUM.join(', ')}`),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
        validateResult
    ],
    rentController.getRentSchedules
);

/**
 * @route GET /api/rent-schedules/:id
 * @desc Get a single rent schedule by ID
 * @access Private (Accessible if user is associated with schedule's lease/property)
 */
router.get(
    '/rent-schedules/:id',
    protect,
    validateMongoId('id'),
    rentController.getRentScheduleById
);

/**
 * @route PUT /api/rent-schedules/:id
 * @desc Update a rent schedule
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.put(
    '/rent-schedules/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    [
        body('amount').optional().isFloat({ min: 0 }).withMessage('Rent amount must be a non-negative number.'),
        body('currency').optional().isString().trim().isLength({ max: 10 }).withMessage('Currency cannot exceed 10 characters.'),
        body('dueDateDay').optional().isInt({ min: 1, max: 31 }).withMessage('Due date day must be between 1 and 31.'),
        body('billingPeriod').optional().isIn(RENT_BILLING_PERIOD_ENUM).withMessage(`Invalid billing period. Must be one of: ${RENT_BILLING_PERIOD_ENUM.join(', ')}`),
        body('effectiveStartDate').optional().isISO8601().toDate().withMessage('Effective start date must be a valid date.'),
        body('effectiveEndDate').optional().isISO8601().toDate().withMessage('Effective end date must be a valid date.'),
        body('notes').optional().isString().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
        body('autoGenerateRent').optional().isBoolean().withMessage('Auto generate rent must be a boolean value.'),
        validateResult
    ],
    rentController.updateRentSchedule
);

/**
 * @route DELETE /api/rent-schedules/:id
 * @desc Delete a rent schedule
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.delete(
    '/rent-schedules/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    rentController.deleteRentSchedule
);

module.exports = router;