// src/routes/leaseRoutes.js

const express = require('express');
const router = express.Router();
const leaseController = require('../controllers/leaseController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadMiddleware');
const { validateMongoId, validateResult } = require('../utils/validationUtils');
const { ROLE_ENUM, LEASE_STATUS_ENUM } = require('../utils/constants/enums');
const { body, query, param } = require('express-validator');

/**
 * Lease validation middleware for common fields
 */
const validateLeaseData = [
    body('leaseStartDate')
        .optional()
        .isISO8601().toDate().withMessage('Lease start date must be a valid date.'),
    
    body('leaseEndDate')
        .optional()
        .isISO8601().toDate().withMessage('Lease end date must be a valid date.'),
    
    body('leaseEndDate')
        .optional()
        .custom((endDate, { req }) => {
            if (req.body.leaseStartDate && new Date(endDate) <= new Date(req.body.leaseStartDate)) {
                throw new Error('Lease end date must be after lease start date.');
            }
            return true;
        }),
    
    body('monthlyRent')
        .optional()
        .isFloat({ min: 0 }).withMessage('Monthly rent must be a non-negative number.'),
    
    body('currency')
        .optional()
        .isString().trim()
        .isLength({ max: 10 }).withMessage('Currency cannot exceed 10 characters.'),
    
    body('paymentDueDate')
        .optional()
        .isInt({ min: 1, max: 31 }).withMessage('Payment due date must be a day of the month (1-31).'),
    
    body('securityDeposit')
        .optional()
        .isFloat({ min: 0 }).withMessage('Security deposit must be a non-negative number.'),
    
    body('terms')
        .optional()
        .isString().trim()
        .isLength({ max: 2000 }).withMessage('Terms cannot exceed 2000 characters.'),
    
    body('status')
        .optional()
        .isIn(LEASE_STATUS_ENUM).withMessage(`Invalid status. Must be one of: ${LEASE_STATUS_ENUM.join(', ')}`),
    
    validateResult
];

/**
 * Date range validation middleware
 */
const dateRangeValidators = [
    query('startDate')
        .optional()
        .isISO8601().toDate().withMessage('Start date must be a valid ISO 8601 date (YYYY-MM-DD).'),
    
    query('endDate')
        .optional()
        .isISO8601().toDate().withMessage('End date must be a valid ISO 8601 date (YYYY-MM-DD).'),
    
    query('startDate')
        .optional()
        .custom((startDate, { req }) => {
            if (req.query.endDate && new Date(startDate) > new Date(req.query.endDate)) {
                throw new Error('Start date cannot be after end date.');
            }
            return true;
        }),
    
    validateResult
];

// Routes that list or search all leases

/**
 * @route GET /api/leases/expiring
 * @desc Get upcoming lease expiries
 * @access Private (Landlord/Admin, Property Manager, Tenant)
 */
router.get(
    '/expiring',
    protect,
    [
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        query('daysAhead').optional().isInt({ min: 1 }).withMessage('Days ahead must be a positive integer.'),
        validateResult
    ],
    leaseController.getExpiringLeases
);

/**
 * @route POST /api/leases
 * @desc Create a new lease agreement
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    [
        body('property').notEmpty().withMessage('Property ID is required.').isMongoId().withMessage('Invalid Property ID format.'),
        body('unit').notEmpty().withMessage('Unit ID is required.').isMongoId().withMessage('Invalid Unit ID format.'),
        body('tenant').notEmpty().withMessage('Tenant ID is required.').isMongoId().withMessage('Invalid Tenant ID format.'),
        body('leaseStartDate').notEmpty().withMessage('Lease start date is required.').isISO8601().toDate().withMessage('Lease start date must be a valid date.'),
        body('leaseEndDate').notEmpty().withMessage('Lease end date is required.').isISO8601().toDate().withMessage('Lease end date must be a valid date.'),
        body('leaseEndDate').custom((endDate, { req }) => {
            if (new Date(endDate) <= new Date(req.body.leaseStartDate)) {
                throw new Error('Lease end date must be after lease start date.');
            }
            return true;
        }),
        body('monthlyRent').notEmpty().withMessage('Monthly rent is required.').isFloat({ min: 0 }).withMessage('Monthly rent must be a non-negative number.'),
        body('currency').optional().isString().trim().isLength({ max: 10 }).withMessage('Currency cannot exceed 10 characters.'),
        body('paymentDueDate').notEmpty().withMessage('Payment due date is required.').isInt({ min: 1, max: 31 }).withMessage('Payment due date must be a day of the month (1-31).'),
        body('securityDeposit').optional().isFloat({ min: 0 }).withMessage('Security deposit must be a non-negative number.'),
        body('terms').optional().isString().trim().isLength({ max: 2000 }).withMessage('Terms cannot exceed 2000 characters.'),
        body('status').optional().isIn(LEASE_STATUS_ENUM).withMessage(`Invalid status. Must be one of: ${LEASE_STATUS_ENUM.join(', ')}`),
        validateResult
    ],
    leaseController.createLease
);

/**
 * @route GET /api/leases
 * @desc Get all leases accessible by the logged-in user
 * @access Private (with access control)
 */
router.get(
    '/',
    protect,
    [
        query('status').optional().isIn(LEASE_STATUS_ENUM).withMessage(`Invalid status filter. Must be one of: ${LEASE_STATUS_ENUM.join(', ')}`),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        query('tenantId').optional().isMongoId().withMessage('Invalid Tenant ID format.'),
        query('startDate').optional().isISO8601().toDate().withMessage('Start date must be a valid ISO 8601 date (YYYY-MM-DD).'),
        query('endDate').optional().isISO8601().toDate().withMessage('End date must be a valid ISO 8601 date (YYYY-MM-DD).'),
        query('expiryStartDate').optional().isISO8601().toDate().withMessage('Expiry start date must be a valid ISO 8601 date (YYYY-MM-DD).'),
        query('expiryEndDate').optional().isISO8601().toDate().withMessage('Expiry end date must be a valid ISO 8601 date (YYYY-MM-DD).'),
        query('startDate').optional().custom((startDate, { req }) => {
            if (req.query.endDate && new Date(startDate) > new Date(req.query.endDate)) {
                throw new Error('Start date cannot be after end date.');
            }
            return true;
        }),
        query('expiryStartDate').optional().custom((startDate, { req }) => {
            if (req.query.expiryEndDate && new Date(startDate) > new Date(req.query.expiryEndDate)) {
                throw new Error('Expiry start date cannot be after expiry end date.');
            }
            return true;
        }),
        query('sortBy').optional().isString().trim().withMessage('Sort by field must be a string.'),
        query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be "asc" or "desc".'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
        validateResult
    ],
    leaseController.getAllLeases
);

// Routes for specific lease by ID

/**
 * @route GET /api/leases/:id
 * @desc Get a single lease by ID
 * @access Private (Accessible if user is associated with lease)
 */
router.get(
    '/:id',
    protect,
    validateMongoId('id'),
    leaseController.getLeaseById
);

/**
 * @route PUT /api/leases/:id
 * @desc Update a lease agreement
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.put(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    validateLeaseData,
    leaseController.updateLease
);

/**
 * @route DELETE /api/leases/:id
 * @desc Delete a lease agreement
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.delete(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    leaseController.deleteLease
);

/**
 * @route PUT /api/leases/:id/mark-renewal-sent
 * @desc Mark a lease as renewal notice sent
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.put(
    '/:id/mark-renewal-sent',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    leaseController.markRenewalNoticeSent
);

/**
 * @route POST /api/leases/:id/documents
 * @desc Upload a lease document
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.post(
    '/:id/documents',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    upload.single('documentFile'),
    leaseController.uploadLeaseDocument
);

/**
 * @route GET /api/leases/:leaseId/documents/:documentId/download
 * @desc Download a lease document
 * @access Private (Landlord/Admin, PM, or Tenant associated with lease)
 */
router.get(
    '/:leaseId/documents/:documentId/download',
    protect,
    validateMongoId('leaseId'),
    validateMongoId('documentId'),
    leaseController.downloadLeaseDocument
);

/**
 * @route POST /api/leases/:id/generate-document
 * @desc Generate a lease-related document
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.post(
    '/:id/generate-document',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    [
        body('documentType')
            .notEmpty().withMessage('Document type is required.')
            .isIn(['renewal_notice', 'exit_letter', 'termination_notice', 'lease_notice'])
            .withMessage('Document type must be one of: renewal_notice, exit_letter, termination_notice, lease_notice'),
        validateResult
    ],
    leaseController.generateLeaseDocument
);

/**
 * @route POST /api/leases/:id/amendments
 * @desc Add an amendment to a lease
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.post(
    '/:id/amendments',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    [
        body('description')
            .notEmpty().withMessage('Amendment description is required.')
            .isString().trim()
            .isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters.'),
        body('documentId')
            .optional()
            .isMongoId().withMessage('Document ID must be a valid MongoDB ID.'),
        validateResult
    ],
    leaseController.addLeaseAmendment
);

/**
 * @route GET /api/leases/:id/rent-report
 * @desc Get rent report for a lease
 * @access Private (Landlord/Admin, PropertyManager, Tenant)
 */
router.get(
    '/:id/rent-report',
    protect,
    validateMongoId('id'),
    dateRangeValidators,
    leaseController.getLeaseRentReport
);

/**
 * @route POST /api/leases/:id/rent-report/generate
 * @desc Generate and download a rent report PDF
 * @access Private (Landlord/Admin, PropertyManager, Tenant)
 */
router.post(
    '/:id/rent-report/generate',
    protect,
    validateMongoId('id'),
    [
        body('startDate').optional().isISO8601().toDate().withMessage('Start date must be a valid date.'),
        body('endDate').optional().isISO8601().toDate().withMessage('End date must be a valid date.'),
        body('startDate').optional().custom((startDate, { req }) => {
            if (req.body.endDate && new Date(startDate) > new Date(req.body.endDate)) {
                throw new Error('Start date cannot be after end date.');
            }
            return true;
        }),
        validateResult
    ],
    leaseController.generateRentReportDocument
);

module.exports = router;