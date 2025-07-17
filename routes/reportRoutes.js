// src/routes/reportRoutes.js

const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController'); // Import controller
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Import auth middleware
const { validateMongoId, validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { ROLE_ENUM, REQUEST_STATUS_ENUM, SCHEDULED_MAINTENANCE_STATUS_ENUM, CATEGORY_ENUM, PRIORITY_ENUM, ASSIGNED_TO_MODEL_ENUM, PAYMENT_STATUS_ENUM, LEASE_STATUS_ENUM, SERVICE_ENUM } = require('../utils/constants/enums'); // Import enums
const { query, body } = require('express-validator'); // For specific query/body validation

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
// All report generation and export routes require Admin, PropertyManager, or Landlord roles.

/**
 * @route GET /api/reports/maintenance-summary
 * @desc Get a comprehensive maintenance summary report.
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.get(
    '/maintenance-summary',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    [
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('status').optional().isIn([...REQUEST_STATUS_ENUM, ...SCHEDULED_MAINTENANCE_STATUS_ENUM]).withMessage(`Invalid status filter. Must be one of: ${[...REQUEST_STATUS_ENUM, ...SCHEDULED_MAINTENANCE_STATUS_ENUM].join(', ')}`),
        query('category').optional().isIn(CATEGORY_ENUM).withMessage(`Invalid category filter. Must be one of: ${CATEGORY_ENUM.join(', ')}`),
        query('assignedToId').optional().isMongoId().withMessage('Invalid Assigned To ID format.'),
        query('assignedToModel').optional().isIn(ASSIGNED_TO_MODEL_ENUM).withMessage(`Invalid Assigned To Type. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}`),
        ...dateRangeValidators,
        validateResult
    ],
    reportController.getMaintenanceSummaryReport
);

/**
 * @route GET /api/reports/vendor-performance
 * @desc Get a report on vendor performance.
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.get(
    '/vendor-performance',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    [
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('vendorId').optional().isMongoId().withMessage('Invalid Vendor ID format.'),
        ...dateRangeValidators, // Using resolvedAt for this report
        validateResult
    ],
    reportController.getVendorPerformanceReport
);

/**
 * @route GET /api/reports/common-issues
 * @desc Get a report on most frequent issue categories.
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.get(
    '/common-issues',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    [
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        ...dateRangeValidators, // Using createdAt for this report
        validateResult
    ],
    reportController.getCommonIssuesReport
);

/**
 * @route GET /api/reports/rent-collection
 * @desc Get a rent collection report.
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.get(
    '/rent-collection',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    [
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        query('status').optional().isIn(PAYMENT_STATUS_ENUM).withMessage(`Invalid payment status filter. Must be one of: ${PAYMENT_STATUS_ENUM.join(', ')}`),
        query('tenantId').optional().isMongoId().withMessage('Invalid Tenant ID format.'),
        query('billingPeriod').optional().matches(/^\d{4}-\d{2}$/).withMessage('Billing period must be in YYYY-MM format.'),
        ...dateRangeValidators, // Using dueDate for this report
        validateResult
    ],
    reportController.getRentCollectionReport
);

/**
 * @route GET /api/reports/lease-expiry
 * @desc Get a lease expiry report.
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.get(
    '/lease-expiry',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    [
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        query('status').optional().isIn(LEASE_STATUS_ENUM).withMessage(`Invalid lease status filter. Must be one of: ${LEASE_STATUS_ENUM.join(', ')}`),
        query('tenantId').optional().isMongoId().withMessage('Invalid Tenant ID format.'),
        query('expiryStartDate').optional().isISO8601().toDate().withMessage('Expiry start date must be a valid ISO 8601 date (YYYY-MM-DD).'),
        query('expiryEndDate').optional().isISO8601().toDate().withMessage('Expiry end date must be a valid ISO 8601 date (YYYY-MM-DD).'),
        query('expiryStartDate').optional().custom((startDate, { req }) => {
            if (req.query.expiryEndDate && new Date(startDate) > new Date(req.query.expiryEndDate)) {
                throw new Error('Expiry start date cannot be after expiry end date.');
            }
            return true;
        }),
        validateResult
    ],
    reportController.getLeaseExpiryReport
);

/**
 * @route GET /api/reports/export
 * @desc Export a report as a PDF or CSV.
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.get(
    '/export',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    [
        query('type').notEmpty().withMessage('Report type is required.').isIn(['maintenance_summary', 'vendor_performance', 'common_issues', 'rent_collection', 'lease_expiry']).withMessage('Invalid report type.'),
        query('format').notEmpty().withMessage('Export format is required.').isIn(['csv', 'pdf']).withMessage('Invalid export format. Must be "csv" or "pdf".'),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('status').optional().isString().trim().withMessage('Status filter must be a string.'), // Generic, specific validation handled by service
        query('category').optional().isString().trim().withMessage('Category filter must be a string.'),
        query('assignedToId').optional().isMongoId().withMessage('Invalid Assigned To ID format.'),
        query('assignedToModel').optional().isIn(ASSIGNED_TO_MODEL_ENUM).withMessage(`Invalid Assigned To Type. Must be one of: ${ASSIGNED_TO_MODEL_ENUM.join(', ')}`),
        query('vendorId').optional().isMongoId().withMessage('Invalid Vendor ID format.'),
        query('unitId').optional().isMongoId().withMessage('Invalid Unit ID format.'),
        query('tenantId').optional().isMongoId().withMessage('Invalid Tenant ID format.'),
        query('billingPeriod').optional().matches(/^\d{4}-\d{2}$/).withMessage('Billing period must be in YYYY-MM format.'),
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
        validateResult
    ],
    reportController.exportReport
);


module.exports = router;
