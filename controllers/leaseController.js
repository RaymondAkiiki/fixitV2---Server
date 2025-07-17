// src/controllers/leaseController.js

const asyncHandler = require('../utils/asyncHandler'); // For handling async errors
const leaseService = require('../services/leaseService'); // Import the new lease service
const logger = require('../utils/logger'); // Import logger
const AppError = require('../utils/AppError'); // Import custom AppError

/**
 * @desc Create a new lease agreement
 * @route POST /api/leases
 * @access Private (Landlord/Admin, or PM with 'manage_leases' permission)
 * @body {string} property - Property ID
 * @body {string} unit - Unit ID
 * @body {string} tenant - Tenant User ID
 * @body {Date} leaseStartDate - Start date of the lease
 * @body {Date} leaseEndDate - End date of the lease
 * @body {number} monthlyRent - Monthly rent amount
 * @body {string} currency - Currency of rent (e.g., 'UGX', 'USD')
 * @body {number} paymentDueDate - Day of the month rent is due (1-31)
 * @body {number} [securityDeposit=0] - Security deposit amount
 * @body {string} [terms] - Lease terms and conditions
 * @body {string} [status='active'] - Initial status of the lease
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
 * @query {string} [status] - Filter by lease status
 * @query {string} [propertyId] - Filter by associated property ID
 * @query {string} [unitId] - Filter by associated unit ID
 * @query {string} [tenantId] - Filter by associated tenant ID
 * @query {Date} [startDate] - Filter by lease start date on or after this date
 * @query {Date} [endDate] - Filter by lease start date on or before this date
 * @query {Date} [expiryStartDate] - Filter by lease end date on or after this date
 * @query {Date} [expiryEndDate] - Filter by lease end date on or before this date
 * @query {string} [sortBy='leaseEndDate'] - Field to sort by
 * @query {string} [sortOrder='asc'] - Sort order ('asc' or 'desc')
 * @query {number} [page=1] - Page number
 * @query {number} [limit=10] - Items per page
 */
const getAllLeases = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;

    const { leases, total, page: currentPage, limit: currentLimit } = await leaseService.getAllLeases(currentUser, filters, page, limit);

    res.status(200).json({
        success: true,
        count: leases.length,
        total,
        page: currentPage,
        limit: currentLimit,
        data: leases
    });
});

/**
 * @desc Get a single lease by ID
 * @route GET /api/leases/:id
 * @access Private (Accessible if user is associated with lease)
 * @param {string} id - Lease ID from URL params
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
 * @access Private (Landlord/Admin, or PM with 'manage_leases' permission)
 * @param {string} id - Lease ID from URL params
 * @body {Date} [leaseStartDate] - New start date
 * @body {Date} [leaseEndDate] - New end date
 * @body {number} [monthlyRent] - New monthly rent
 * @body {string} [currency] - New currency
 * @body {number} [paymentDueDate] - New payment due day
 * @body {number} [securityDeposit] - New security deposit
 * @body {string} [terms] - New terms
 * @body {string} [status] - New status (e.g., 'active', 'pending_renewal', 'terminated', 'expired')
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
 * @access Private (Landlord/Admin, or PM with 'manage_leases' permission)
 * @param {string} id - Lease ID from URL params
 */
const deleteLease = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await leaseService.deleteLease(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Lease and associated rent records deleted successfully.'
    });
});

/**
 * @desc Get upcoming lease expiries for a landlord/PM/tenant
 * @route GET /api/leases/expiring
 * @access Private (Landlord/Admin, Property Manager, Tenant)
 * @query {string} [propertyId] - Filter by associated property ID
 * @query {string} [unitId] - Filter by associated unit ID
 * @query {number} [daysAhead=90] - Number of days into the future to look for expiring leases
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
 * @access Private (Landlord/Admin, or PM with 'manage_leases' permission)
 * @param {string} id - Lease ID from URL params
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
 * @desc Upload a lease document (e.g., signed agreement, amendment)
 * @route POST /api/leases/:id/documents
 * @access Private (Landlord/Admin, or PM with 'manage_leases' permission)
 * @param {string} id - Lease ID from URL params
 * @file {File} file - The file to upload (from multer middleware)
 */
const uploadLeaseDocument = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const file = req.file; // From multer upload middleware
    const currentUser = req.user;
    const ipAddress = req.ip;

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
 * @access Private (Landlord/Admin, PM, or Tenant associated with lease)
 * @param {string} leaseId - Lease ID from URL params
 * @param {string} documentId - Media Document ID from URL params
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
 * @desc Generate a lease-related document (e.g., renewal notice, exit letter)
 * @route POST /api/leases/:id/generate-document
 * @access Private (Landlord/Admin, or PM with 'manage_leases' permission)
 * @param {string} id - Lease ID from URL params
 * @body {string} documentType - Type of document to generate ('renewal_notice', 'exit_letter')
 */
const generateLeaseDocument = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { documentType } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const generatedMediaDoc = await leaseService.generateLeaseDocument(id, documentType, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: `${documentType.replace('_', ' ')} generated and added to lease documents.`,
        downloadUrl: generatedMediaDoc.url
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
};
