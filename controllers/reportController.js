// src/controllers/reportController.js

const asyncHandler = require('../utils/asyncHandler');
const reportService = require('../services/reportService');
const documentGenerationService = require('../services/documentGenerationService');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const fs = require('fs').promises;

/**
 * @desc Get a maintenance summary report.
 * @route GET /api/reports/maintenance-summary
 * @access Private (Admin, PropertyManager, Landlord)
 */
const getMaintenanceSummaryReport = asyncHandler(async (req, res) => {
    const filters = req.query;
    const user = req.user;

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
 * @desc Generate a report document and save it to the system
 * @route POST /api/reports/document
 * @access Private (Admin, PropertyManager, Landlord)
 */
const generateReportDocument = asyncHandler(async (req, res) => {
    const { reportType, filters = {}, options = {} } = req.body;
    const user = req.user;
    const ipAddress = req.ip;

    if (!reportType) {
        throw new AppError('Report type is required.', 400);
    }

    // Call the reportService to generate and upload the document
    const mediaDoc = await reportService.generateReportDocument(
        reportType,
        filters,
        user,
        {
            ...options,
            ipAddress
        }
    );

    res.status(201).json({
        success: true,
        message: `Report document for ${reportType} generated successfully.`,
        data: mediaDoc
    });
});

/**
 * @desc Export a report as a PDF or CSV.
 * @route GET /api/reports/export
 * @access Private (Admin, PropertyManager, Landlord)
 */
const exportReport = asyncHandler(async (req, res, next) => {
    const { type, format } = req.query;
    const user = req.user;
    const filters = req.query;
    const ipAddress = req.ip;

    if (!type || !format) {
        throw new AppError('Report type and format are required for export.', 400);
    }
    
    if (!['pdf', 'csv'].includes(format.toLowerCase())) {
        throw new AppError('Invalid export format. Only "pdf" or "csv" are supported.', 400);
    }

    logger.info(`Exporting report of type '${type}' as '${format}' for user ${user._id}`);

    // For PDF format, use document generation service
    if (format.toLowerCase() === 'pdf') {
        try {
            const mediaDoc = await reportService.generateReportDocument(
                type,
                filters,
                user,
                { ipAddress }
            );

            return res.status(200).json({
                success: true,
                message: `Report document for ${type} generated successfully.`,
                data: mediaDoc
            });
        } catch (error) {
            logger.error(`Error generating PDF report: ${error.message}`, error);
            return next(new AppError(`Failed to generate PDF report: ${error.message}`, 500));
        }
    }

    // For CSV format, use existing export service
    try {
        const { filePath, fileName, mimeType } = await reportService.exportReport(
            type, 
            filters, 
            user, 
            format
        );

        // Set headers for file download
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        // Stream the file back to the client
        res.sendFile(filePath, async (err) => {
            if (err) {
                logger.error(`Error sending exported file ${filePath}: ${err.message}`);
                // Clean up temp file
                try {
                    await fs.unlink(filePath);
                } catch (unlinkErr) {
                    logger.error(`Error deleting temporary file ${filePath}: ${unlinkErr.message}`);
                }
                next(new AppError('Failed to send the exported file.', 500));
            } else {
                // Delete the temporary file after successful sending
                try {
                    await fs.unlink(filePath);
                    logger.info(`Successfully sent and deleted temporary report file: ${fileName}`);
                } catch (unlinkErr) {
                    logger.error(`Error deleting temporary file ${filePath}: ${unlinkErr.message}`);
                }
            }
        });
    } catch (error) {
        logger.error(`Error exporting report as CSV: ${error.message}`, error);
        return next(new AppError(`Failed to export report: ${error.message}`, 500));
    }
});

module.exports = {
    getMaintenanceSummaryReport,
    getVendorPerformanceReport,
    getCommonIssuesReport,
    getRentCollectionReport,
    getLeaseExpiryReport,
    generateReportDocument,
    exportReport
};