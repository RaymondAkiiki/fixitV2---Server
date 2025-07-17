// src/controllers/rentController.js

const asyncHandler = require('../utils/asyncHandler'); // For handling async errors
const rentService = require('../services/rentService'); // Import the new rent service
const logger = require('../utils/logger'); // Import logger
const AppError = require('../utils/AppError'); // Import custom AppError

/**
 * @desc Create a new rent record (typically generated automatically for a lease)
 * @route POST /api/rents
 * @access Private (Landlord/Admin, or PM with 'manage_rents' permission)
 * @body {string} lease - Lease ID
 * @body {number} amountDue - Amount due for this period
 * @body {Date} dueDate - Due date for this rent
 * @body {string} billingPeriod - Billing period (e.g., "2023-01")
 * @body {string} [status='due'] - Initial status of the rent record
 */
const createRentRecord = asyncHandler(async (req, res) => {
    const rentData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const newRent = await rentService.createRentRecord(rentData, currentUser, ipAddress);

    res.status(201).json({
        success: true,
        message: 'Rent record created successfully.',
        data: newRent
    });
});

/**
 * @desc Get all rent records accessible by the logged-in user
 * @route GET /api/rents
 * @access Private (with access control)
 * @query {string} [status] - Filter by payment status
 * @query {string} [billingPeriod] - Filter by billing period (YYYY-MM)
 * @query {string} [leaseId] - Filter by associated lease ID
 * @query {string} [tenantId] - Filter by associated tenant ID
 * @query {string} [propertyId] - Filter by associated property ID
 * @query {string} [unitId] - Filter by associated unit ID
 * @query {Date} [startDate] - Filter by due date on or after this date
 * @query {Date} [endDate] - Filter by due date on or before this date
 * @query {string} [sortBy='dueDate'] - Field to sort by
 * @query {string} [sortOrder='asc'] - Sort order ('asc' or 'desc')
 * @query {number} [page=1] - Page number
 * @query {number} [limit=10] - Items per page
 */
const getAllRentRecords = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;

    const { rents, total, page: currentPage, limit: currentLimit } = await rentService.getAllRentRecords(currentUser, filters, page, limit);

    res.status(200).json({
        success: true,
        count: rents.length,
        total,
        page: currentPage,
        limit: currentLimit,
        data: rents
    });
});

/**
 * @desc Get a single rent record by ID
 * @route GET /api/rents/:id
 * @access Private (Accessible if user is associated with rent record's lease/property)
 * @param {string} id - Rent record ID from URL params
 */
const getRentRecordById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    const rent = await rentService.getRentRecordById(id, currentUser);

    res.status(200).json({
        success: true,
        data: rent
    });
});

/**
 * @desc Update a rent record (e.g., change due date, notes)
 * @route PUT /api/rents/:id
 * @access Private (Landlord/Admin, or PM with 'manage_rents' permission)
 * @param {string} id - Rent record ID from URL params
 * @body {number} [amountDue] - New amount due
 * @body {Date} [dueDate] - New due date
 * @body {string} [billingPeriod] - New billing period
 * @body {string} [notes] - New notes
 */
const updateRentRecord = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedRent = await rentService.updateRentRecord(id, updateData, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Rent record updated successfully.',
        data: updatedRent
    });
});

/**
 * @desc Record a rent payment
 * @route POST /api/rents/:id/pay
 * @access Private (Landlord/Admin, PM with 'manage_rents', or Tenant for self-reporting)
 * @param {string} id - Rent record ID from URL params
 * @body {number} amountPaid - Amount being paid in this transaction
 * @body {Date} paymentDate - Date of payment
 * @body {string} [paymentMethod] - Method of payment
 * @body {string} [transactionId] - Transaction ID
 * @body {string} [notes] - Any notes about the payment
 * @file {File} [paymentProof] - Optional file upload for proof of payment
 */
const recordRentPayment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const paymentData = req.body;
    const file = req.file; // From multer upload middleware
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedRent = await rentService.recordRentPayment(id, paymentData, file, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Rent payment recorded successfully.',
        data: updatedRent
    });
});

/**
 * @desc Delete a rent record
 * @route DELETE /api/rents/:id
 * @access Private (Landlord/Admin, or PM with 'manage_rents' permission)
 * @param {string} id - Rent record ID from URL params
 */
const deleteRentRecord = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await rentService.deleteRentRecord(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Rent record deleted successfully.'
    });
});

/**
 * @desc Get upcoming rent due dates for a landlord/PM/tenant
 * @route GET /api/rents/upcoming
 * @access Private (Landlord/Admin, Property Manager, Tenant)
 * @query {string} [propertyId] - Filter by associated property ID
 * @query {string} [unitId] - Filter by associated unit ID
 * @query {number} [daysAhead=30] - Number of days into the future to look for upcoming rent
 */
const getUpcomingRent = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;

    const upcomingRent = await rentService.getUpcomingRent(currentUser, filters);

    res.status(200).json({
        success: true,
        count: upcomingRent.length,
        data: upcomingRent
    });
});

/**
 * @desc Get rent history for a specific lease or tenant or property
 * @route GET /api/rents/history
 * @access Private (Landlord/Admin, PM, Tenant)
 * @query {string} [leaseId] - Optional lease ID filter
 * @query {string} [tenantId] - Optional tenant ID filter
 * @query {string} [propertyId] - Optional property ID filter
 * @query {Date} [startDate] - Optional filter for due date on or after this date
 * @query {Date} [endDate] - Optional filter for due date on or before this date
 */
const getRentHistory = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;

    const rentHistory = await rentService.getRentHistory(currentUser, filters);

    res.status(200).json({
        success: true,
        count: rentHistory.length,
        data: rentHistory
    });
});

/**
 * @desc Upload payment proof for a rent record
 * @route POST /api/rents/:id/upload-proof
 * @access Private (Landlord/Admin, PM, or Tenant)
 * @param {string} id - Rent record ID from URL params
 * @file {File} file - The file to upload (from multer middleware)
 */
const uploadPaymentProof = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const file = req.file; // From multer middleware
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedRent = await rentService.uploadPaymentProof(id, file, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Payment proof uploaded successfully.',
        data: updatedRent.paymentProof // Returns the Media ID
    });
});

/**
 * @desc Download payment proof for a rent record
 * @route GET /api/rents/:id/download-proof
 * @access Private (Landlord/Admin, PM, or Tenant associated with rent)
 * @param {string} id - Rent record ID from URL params
 */
const downloadPaymentProof = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const { downloadUrl, fileName, mimeType } = await rentService.downloadPaymentProof(id, currentUser, ipAddress);

    // In a real application, you might redirect or send the file directly
    // For now, we return the URL and metadata for the frontend to handle.
    res.status(200).json({
        success: true,
        message: 'Payment proof download link generated.',
        downloadUrl,
        fileName,
        mimeType
    });
});

module.exports = {
    createRentRecord,
    getAllRentRecords,
    getRentRecordById,
    updateRentRecord,
    recordRentPayment,
    deleteRentRecord,
    getUpcomingRent,
    getRentHistory,
    uploadPaymentProof,
    downloadPaymentProof,
};
