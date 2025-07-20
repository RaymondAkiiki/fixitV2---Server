// src/controllers/leaseController.js

const asyncHandler = require('../utils/asyncHandler');
const leaseService = require('../services/leaseService');
const documentGenerationService = require('../services/documentGenerationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Create a new lease agreement
 * @route POST /api/leases
 * @access Private (Landlord/Admin, Property Manager)
 */
const createLease = asyncHandler(async (req, res) => {
    const leaseData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const newLease = await leaseService.createLease(leaseData, currentUser, ipAddress);

    res.status(201).json({
        success: true,
        message: 'Lease created successfully.',
        data: newLease
    });
});

/**
 * @desc Get all leases accessible by the logged-in user
 * @route GET /api/leases
 * @access Private (with access control)
 */
const getAllLeases = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const result = await leaseService.getAllLeases(currentUser, filters, page, limit);

    res.status(200).json({
        success: true,
        count: result.leases.length,
        total: result.total,
        page: result.page,
        limit: result.limit,
        pages: result.pages,
        data: result.leases
    });
});

/**
 * @desc Get a single lease by ID
 * @route GET /api/leases/:id
 * @access Private (Accessible if user is associated with lease)
 */
const getLeaseById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    const lease = await leaseService.getLeaseById(id, currentUser);

    res.status(200).json({
        success: true,
        data: lease
    });
});

/**
 * @desc Update a lease agreement
 * @route PUT /api/leases/:id
 * @access Private (Landlord/Admin, Property Manager)
 */
const updateLease = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedLease = await leaseService.updateLease(id, updateData, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Lease updated successfully.',
        data: updatedLease
    });
});

/**
 * @desc Delete a lease agreement
 * @route DELETE /api/leases/:id
 * @access Private (Landlord/Admin, Property Manager)
 */
const deleteLease = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await leaseService.deleteLease(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Lease and associated records deleted successfully.'
    });
});

/**
 * @desc Get upcoming lease expiries
 * @route GET /api/leases/expiring
 * @access Private (Landlord/Admin, Property Manager, Tenant)
 */
const getExpiringLeases = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;

    const expiringLeases = await leaseService.getExpiringLeases(currentUser, filters);

    res.status(200).json({
        success: true,
        count: expiringLeases.length,
        data: expiringLeases
    });
});

/**
 * @desc Mark a lease as renewal notice sent
 * @route PUT /api/leases/:id/mark-renewal-sent
 * @access Private (Landlord/Admin, Property Manager)
 */
const markRenewalNoticeSent = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedLease = await leaseService.markRenewalNoticeSent(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Lease renewal notice marked as sent successfully.',
        data: updatedLease
    });
});

/**
 * @desc Upload a lease document
 * @route POST /api/leases/:id/documents
 * @access Private (Landlord/Admin, Property Manager)
 */
const uploadLeaseDocument = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const file = req.file;
    const currentUser = req.user;
    const ipAddress = req.ip;

    if (!file) {
        throw new AppError('No file provided.', 400);
    }

    const newMediaDoc = await leaseService.uploadLeaseDocument(id, file, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Document uploaded successfully.',
        data: newMediaDoc
    });
});

/**
 * @desc Download a lease document
 * @route GET /api/leases/:leaseId/documents/:documentId/download
 * @access Private (Landlord/Admin, Property Manager, or Tenant associated with lease)
 */
const downloadLeaseDocument = asyncHandler(async (req, res) => {
    const { leaseId, documentId } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const { downloadUrl, fileName, mimeType } = await leaseService.downloadLeaseDocument(leaseId, documentId, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Document download link generated.',
        downloadUrl,
        fileName,
        mimeType
    });
});

/**
 * @desc Generate a lease document
 * @route POST /api/leases/:id/generate-document
 * @access Private (Landlord/Admin, Property Manager)
 */
const generateLeaseDocument = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { documentType } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    if (!documentType) {
        throw new AppError('Document type is required.', 400);
    }

    const generatedMediaDoc = await leaseService.generateLeaseDocument(id, documentType, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: `${documentType.replace('_', ' ')} generated and added to lease documents.`,
        data: generatedMediaDoc
    });
});

/**
 * @desc Add an amendment to a lease
 * @route POST /api/leases/:id/amendments
 * @access Private (Landlord/Admin, Property Manager)
 */
const addLeaseAmendment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const amendmentData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    if (!amendmentData.description) {
        throw new AppError('Amendment description is required.', 400);
    }

    const updatedLease = await leaseService.addLeaseAmendment(id, amendmentData, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Amendment added successfully.',
        data: updatedLease
    });
});

/**
 * @desc Get rent report for a lease
 * @route GET /api/leases/:id/rent-report
 * @access Private (Landlord/Admin, Property Manager, Tenant)
 */
const getLeaseRentReport = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const params = req.query;
    const currentUser = req.user;

    const report = await leaseService.getLeaseRentReport(id, params, currentUser);

    res.status(200).json({
        success: true,
        data: report
    });
});

/**
 * @desc Generate and download a rent report PDF
 * @route POST /api/leases/:id/rent-report/generate
 * @access Private (Landlord/Admin, Property Manager, Tenant)
 */
const generateRentReportDocument = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const params = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    // First get the report data
    const reportData = await leaseService.getLeaseRentReport(id, params, currentUser);
    
    // Prepare data for document generation
    const documentData = {
        startDate: reportData.startDate,
        endDate: reportData.endDate,
        propertyName: reportData.propertyName,
        totalDue: reportData.totalDue,
        totalCollected: reportData.totalPaid,
        currency: reportData.currency,
        statusSummary: reportData.statusSummary,
        rentEntries: reportData.rentRecords.map(record => ({
            unitName: reportData.unitName,
            tenantName: reportData.tenantName,
            dueDate: record.dueDate,
            amountDue: record.amount,
            amountPaid: record.amountPaid,
            status: record.status
        }))
    };
    
    // Generate the document
    const documentOptions = {
        relatedResourceType: 'Lease',
        relatedResourceId: id,
        userId: currentUser._id,
        ipAddress,
        userName: `${currentUser.firstName} ${currentUser.lastName}`.trim()
    };
    
    const mediaDoc = await documentGenerationService.generateAndUploadDocument(
        'rent_report', 
        documentData, 
        documentOptions
    );

    res.status(200).json({
        success: true,
        message: 'Rent report generated successfully.',
        data: mediaDoc
    });
});

module.exports = {
    createLease,
    getAllLeases,
    getLeaseById,
    updateLease,
    deleteLease,
    getExpiringLeases,
    markRenewalNoticeSent,
    uploadLeaseDocument,
    downloadLeaseDocument,
    generateLeaseDocument,
    addLeaseAmendment,
    getLeaseRentReport,
    generateRentReportDocument
};