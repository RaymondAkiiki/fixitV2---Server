// src/routes/rentRoutes.js

const express = require('express');
const router = express.Router();
const rentController = require('../controllers/RentController'); // Import controller
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Import auth middleware
const { upload } = require('../middleware/uploadMiddleware'); // For single file uploads
const { validateMongoId, validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { ROLE_ENUM, PAYMENT_STATUS_ENUM } = require('../utils/constants/enums'); // Import enums
const { body, query, param } = require('express-validator'); // For specific body/query/param validation

// Middleware for common date validation
const dateRangeValidators = [
    query('startDate').optional().isISO8601().toDate().withMessage('Start date must be a valid ISO 8601 date (YYYY-MM-DD).'),
    query('endDate').optional().isISO8601().toDate().withMessage('End date must be a valid ISO 8601 date (YYYY-MM-DD).'),
    query('startDate').optional().custom((startDate, { req }) => {
        if (req.query.endDate && new Date(startDate) > new Date(req.query.endDate)) {
            throw new Error('Start date cannot be after end date.');
        }
        return true;
    }),
];

// Private routes (require authentication)

/**
 * @route POST /api/rents
 * @desc Create a new rent record
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    [
        body('lease').notEmpty().withMessage('Lease ID is required.').isMongoId().withMessage('Invalid Lease ID format.'),
        body('amountDue').notEmpty().withMessage('Amount due is required.').isFloat({ min: 0 }).withMessage('Amount due must be a non-negative number.'),
        body('dueDate').notEmpty().withMessage('Due date is required.').isISO8601().toDate().withMessage('Due date must be a valid date.'),
        body('billingPeriod').notEmpty().withMessage('Billing period is required.').matches(/^\d{4}-\d{2}$/).withMessage('Billing period must be in YYYY-MM format.'),
        body('status').optional().isIn(PAYMENT_STATUS_ENUM).withMessage(`Invalid status. Must be one of: ${PAYMENT_STATUS_ENUM.join(', ')}`),
        validateResult
    ],
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
    // Authorization handled in service
    [
        query('status').optional().isIn(PAYMENT_STATUS_ENUM).withMessage(`Invalid status filter. Must be one of: ${PAYMENT_STATUS_ENUM.join(', ')}`),
        query('billingPeriod').optional().matches(/^\d{4}-\d{2}$/).withMessage('Billing period must be in YYYY-MM format.'),
        query('leaseId').optional().isMongoId().withMessage('Invalid Lease ID format.'),
        query('tenantId').optional().isMongoId().withMessage('Invalid Tenant ID format.'),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        ...dateRangeValidators, // For dueDate filtering
        query('sortBy').optional().isString().trim().withMessage('Sort by field must be a string.'),
        query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be "asc" or "desc".'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer.'),
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
        body('amountPaid').optional().isFloat({ min: 0 }).withMessage('Amount paid must be a non-negative number.'),
        body('paymentDate').optional().isISO8601().toDate().withMessage('Payment date must be a valid date.'),
        body('paymentMethod').optional().isString().trim().isLength({ max: 50 }).withMessage('Payment method cannot exceed 50 characters.'),
        body('transactionId').optional().isString().trim().isLength({ max: 100 }).withMessage('Transaction ID cannot exceed 100 characters.'),
        body('notes').optional().isString().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
        validateResult
    ],
    rentController.updateRentRecord
);

/**
 * @route POST /api/rents/:id/pay
 * @desc Record a rent payment
 * @access Private (Landlord/Admin, PM, Tenant)
 * @notes This route expects `multipart/form-data` if `paymentProof` is included.
 */
router.post(
    '/:id/pay',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.TENANT),
    validateMongoId('id'),
    upload.single('documentFile'), // For paymentProof file upload (field name 'file' by default)
    [
        body('amountPaid').notEmpty().withMessage('Amount paid is required.').isFloat({ min: 0 }).withMessage('Amount paid must be a non-negative number.'),
        body('paymentDate').notEmpty().withMessage('Payment date is required.').isISO8601().toDate().withMessage('Payment date must be a valid date.'),
        body('paymentMethod').optional().isString().trim().isLength({ max: 50 }).withMessage('Payment method cannot exceed 50 characters.'),
        body('transactionId').optional().isString().trim().isLength({ max: 100 }).withMessage('Transaction ID cannot exceed 100 characters.'),
        body('notes').optional().isString().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
        // paymentProof is handled by multer, its metadata will be in req.file
        validateResult
    ],
    rentController.recordRentPayment
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

/**
 * @route GET /api/rents/upcoming
 * @desc Get upcoming rent due dates
 * @access Private (Landlord/Admin, Property Manager, Tenant)
 */
router.get(
    '/upcoming',
    protect,
    // Authorization handled in service
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
    // Authorization handled in service
    [
        query('leaseId').optional().isMongoId().withMessage('Invalid Lease ID format.'),
        query('tenantId').optional().isMongoId().withMessage('Invalid Tenant ID format.'),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        ...dateRangeValidators, // For dueDate filtering
        validateResult
    ],
    rentController.getRentHistory
);

/**
 * @route POST /api/rents/:id/upload-proof
 * @desc Upload payment proof for a rent record
 * @access Private (Landlord/Admin, PM, or Tenant)
 * @notes This route expects `multipart/form-data` with a field named `file`.
 */
router.post(
    '/:id/upload-proof',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.TENANT),
    validateMongoId('id'),
    upload.single('documentFile'), // Multer middleware to handle single file upload (req.file)
    // No specific body validation here as the file itself is the primary payload
    validateResult,
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

module.exports = router;
