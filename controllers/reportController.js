// src/controllers/reportController.js

const asyncHandler = require('../utils/asyncHandler');
const reportService = require('../services/reportService'); // Import the report service
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * @desc Get a maintenance summary report.
 * @route GET /api/reports/maintenance-summary
 * @access Private (Admin, PropertyManager, Landlord)
 * @query {string} [propertyId] - Optional. ID of the property to filter by.
 * @query {string} [status] - Optional. Filter by request/scheduled maintenance status.
 * @query {string} [category] - Optional. Filter by category.
 * @query {string} [assignedToId] - Optional. Filter by assigned user/vendor ID.
 * @query {string} [assignedToModel] - Optional. Filter by assigned type ('User' or 'Vendor').
 * @query {Date} [startDate] - Optional. Start date for the report period.
 * @query {Date} [endDate] - Optional. End date for the report period.
 */
const getMaintenanceSummaryReport = asyncHandler(async (req, res) => {
    const filters = req.query;
    const user = req.user; // User object from auth middleware

    const reportData = await reportService.generateMaintenanceSummaryReport(filters, user);

    res.status(200).json({
        success: true,
        message: 'Maintenance summary report generated successfully.',
        data: reportData
    });
});

/**
 * @desc Get a vendor performance report.
 * @route GET /api/reports/vendor-performance
 * @access Private (Admin, PropertyManager, Landlord)
 * @query {string} [propertyId] - Optional. ID of the property to filter by.
 * @query {string} [vendorId] - Optional. ID of the specific vendor.
 * @query {Date} [startDate] - Optional. Start date for the report period (requests resolved after).
 * @query {Date} [endDate] - Optional. End date for the report period (requests resolved before).
 */
const getVendorPerformanceReport = asyncHandler(async (req, res) => {
    const filters = req.query;
    const user = req.user;

    const reportData = await reportService.generateVendorPerformanceReport(filters, user);

    res.status(200).json({
        success: true,
        message: 'Vendor performance report generated successfully.',
        data: reportData
    });
});

/**
 * @desc Get a common issues report.
 * @route GET /api/reports/common-issues
 * @access Private (Admin, PropertyManager, Landlord)
 * @query {string} [propertyId] - Optional. ID of the property to filter by.
 * @query {Date} [startDate] - Optional. Start date for the report period.
 * @query {Date} [endDate] - Optional. End date for the report period.
 */
const getCommonIssuesReport = asyncHandler(async (req, res) => {
    const filters = req.query;
    const user = req.user;

    const reportData = await reportService.generateCommonIssuesReport(filters, user);

    res.status(200).json({
        success: true,
        message: 'Common issues report generated successfully.',
        data: reportData
    });
});

/**
 * @desc Get a rent collection report.
 * @route GET /api/reports/rent-collection
 * @access Private (Admin, PropertyManager, Landlord)
 * @query {string} [propertyId] - Optional. ID of the property to filter by.
 * @query {string} [unitId] - Optional. ID of the unit to filter by.
 * @query {string} [status] - Optional. Filter by payment status (e.g., 'due', 'paid', 'overdue').
 * @query {string} [tenantId] - Optional. ID of the tenant to filter by.
 * @query {string} [billingPeriod] - Optional. Filter by billing period (YYYY-MM).
 * @query {Date} [startDate] - Optional. Filter by due date on or after this date.
 * @query {Date} [endDate] - Optional. Filter by due date on or before this date.
 */
const getRentCollectionReport = asyncHandler(async (req, res) => {
    const filters = req.query;
    const user = req.user;

    const reportData = await reportService.generateRentCollectionReport(filters, user);

    res.status(200).json({
        success: true,
        message: 'Rent collection report generated successfully.',
        data: reportData
    });
});

/**
 * @desc Get a lease expiry report.
 * @route GET /api/reports/lease-expiry
 * @access Private (Admin, PropertyManager, Landlord)
 * @query {string} [propertyId] - Optional. ID of the property to filter by.
 * @query {string} [unitId] - Optional. ID of the unit to filter by.
 * @query {string} [status] - Optional. Filter by lease status (e.g., 'active', 'pending_renewal', 'expired').
 * @query {string} [tenantId] - Optional. ID of the tenant to filter by.
 * @query {Date} [expiryStartDate] - Optional. Filter by lease end date on or after this date.
 * @query {Date} [expiryEndDate] - Optional. Filter by lease end date on or before this date.
 */
const getLeaseExpiryReport = asyncHandler(async (req, res) => {
    const filters = req.query;
    const user = req.user;

    const reportData = await reportService.generateLeaseExpiryReport(filters, user);

    res.status(200).json({
        success: true,
        message: 'Lease expiry report generated successfully.',
        data: reportData
    });
});


/**
 * @desc Export a report as a PDF or CSV.
 * @route GET /api/reports/export
 * @access Private (Admin, PropertyManager, Landlord)
 * @queryParam {string} type - Required. Type of report (e.g., 'rent_collection', 'lease_expiry', 'maintenance_summary').
 * @queryParam {string} format - Required. Export format ('pdf', 'csv').
 * @queryParam {string} [propertyId] - Optional. ID of the property to filter by.
 * @queryParam {string} [status] - Optional. Filter by status (depends on report type).
 * @queryParam {string} [category] - Optional. Filter by category (for maintenance).
 * @queryParam {string} [assignedToId] - Optional. Filter by assigned user/vendor (for maintenance).
 * @queryParam {string} [assignedToModel] - Optional. Filter by assigned type ('User' or 'Vendor').
 * @queryParam {string} [vendorId] - Optional. ID of the specific vendor (for vendor performance).
 * @queryParam {string} [unitId] - Optional. ID of the unit (for rent/lease).
 * @queryParam {string} [tenantId] - Optional. ID of the tenant (for rent/lease).
 * @queryParam {string} [billingPeriod] - Optional. Filter by billing period (YYYY-MM) (for rent).
 * @queryParam {Date} [startDate] - Optional. Start date for the report period.
 * @queryParam {Date} [endDate] - Optional. End date for the report period.
 * @queryParam {Date} [expiryStartDate] - Optional. Start date for lease expiry (for lease expiry).
 * @queryParam {Date} [expiryEndDate] - Optional. End date for lease expiry (for lease expiry).
 */
const exportReport = asyncHandler(async (req, res, next) => {
    const { type, format } = req.query;
    const user = req.user;
    const filters = req.query; // Pass all query params as filters to the service

    if (!type || !format) {
        throw new AppError('Report type and format are required for export.', 400);
    }
    if (!['pdf', 'csv'].includes(format.toLowerCase())) {
        throw new AppError('Invalid export format. Only "pdf" or "csv" are supported.', 400);
    }

    logger.info(`Exporting report of type '${type}' as '${format}' for user ${user._id}`);

    const { filePath, fileName, mimeType } = await reportService.exportReport(type, filters, user, format);

    // Set headers for file download
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    // Stream the file back to the client
    res.sendFile(filePath, async (err) => {
        if (err) {
            logger.error(`Error sending exported file ${filePath}: ${err.message}`);
            // If file sending fails, try to delete the temp file
            try {
                await fs.unlink(filePath); // Clean up temp file
                logger.info(`Cleaned up temporary file: ${filePath}`);
            } catch (unlinkErr) {
                logger.error(`Error deleting temporary file ${filePath}: ${unlinkErr.message}`);
            }
            next(new AppError('Failed to send the exported file.', 500));
        } else {
            // Delete the temporary file after successful sending
            try {
                await fs.unlink(filePath); // Clean up temp file
                logger.info(`Successfully sent and deleted temporary report file: ${fileName}`);
            } catch (unlinkErr) {
                logger.error(`Error deleting temporary file ${filePath}: ${unlinkErr.message}`);
            }
        }
    });
});

module.exports = {
    getMaintenanceSummaryReport,
    getVendorPerformanceReport,
    getCommonIssuesReport,
    getRentCollectionReport,
    getLeaseExpiryReport,
    exportReport,
};
