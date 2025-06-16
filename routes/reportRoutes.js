// backend/routes/reportRoutes.js

const express = require("express");
const { query } = require('express-validator'); // Import query validation
const router = express.Router();
const reportController = require("../controllers/reportController"); // Corrected import path
const { protect, authorizeRoles } = require("../middleware/authMiddleware"); // Corrected import path

// Validation for report query parameters
const reportQueryValidation = [
    query('propertyId').optional().isMongoId().withMessage('Invalid property ID.'),
    query('status').optional().isString().isIn(['new', 'assigned', 'in_progress', 'completed', 'verified', 'reopened', 'archived']).withMessage('Invalid status.'),
    query('category').optional().isString().isIn(['plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'landscaping', 'other', 'cleaning', 'security', 'pest_control', 'scheduled']).withMessage('Invalid category.'),
    query('assignedToId').optional().isMongoId().withMessage('Invalid assignedTo ID.'),
    query('assignedToModel').optional().isIn(['User', 'Vendor']).withMessage('Invalid assignedTo model type.'),
    query('startDate').optional().isISO8601().toDate().withMessage('Start date must be a valid ISO 8601 date.'),
    query('endDate').optional().isISO8601().toDate().withMessage('End date must be a valid ISO 8601 date.'),
    query('format').optional().isIn(['csv', 'json']).withMessage('Invalid format. Must be "csv" or "json".'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer.'),
];

// Validation for vendor performance report
const vendorPerformanceReportValidation = [
    query('propertyId').optional().isMongoId().withMessage('Invalid property ID.'),
    query('vendorId').optional().isMongoId().withMessage('Invalid vendor ID.'),
    query('startDate').optional().isISO8601().toDate().withMessage('Start date must be a valid ISO 8601 date.'),
    query('endDate').optional().isISO8601().toDate().withMessage('End date must be a valid ISO 8601 date.'),
];

// Validation for common issues report
const commonIssuesReportValidation = [
    query('propertyId').optional().isMongoId().withMessage('Invalid property ID.'),
    query('startDate').optional().isISO8601().toDate().withMessage('Start date must be a valid ISO 8601 date.'),
    query('endDate').optional().isISO8601().toDate().withMessage('End date must be a valid ISO 8601 date.'),
];

// --- ROUTES ---

// GET /api/reports/maintenance-summary - Generate comprehensive maintenance summary report
router.get(
    '/maintenance-summary',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    reportQueryValidation,
    reportController.generateMaintenanceSummaryReport
);

// GET /api/reports/vendor-performance - Report on vendor resolution times, ratings
router.get(
    '/vendor-performance',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    vendorPerformanceReportValidation,
    reportController.getVendorPerformanceReport
);

// GET /api/reports/common-issues - Report on most frequent issue categories
router.get(
    '/common-issues',
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'),
    commonIssuesReportValidation,
    reportController.getCommonIssuesReport
);

module.exports = router;
