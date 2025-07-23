// src/controllers/rentController.js

const asyncHandler = require('../utils/asyncHandler');
const rentService = require('../services/rentService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Create a new rent record
 * @route POST /api/rents
 * @access Private (Landlord/Admin, or PM with 'manage_rents' permission)
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
 */
const getAllRentRecords = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const result = await rentService.getAllRentRecords(currentUser, filters, page, limit);

    res.status(200).json({
        success: true,
        count: result.rents.length,
        total: result.total,
        page: result.page,
        limit: result.limit,
        pages: result.pages,
        data: result.rents
    });
});

/**
 * @desc Get a single rent record by ID
 * @route GET /api/rents/:id
 * @access Private (Accessible if user is associated with rent record's lease/property)
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
 * @desc Update a rent record
 * @route PUT /api/rents/:id
 * @access Private (Landlord/Admin, or PM with 'manage_rents' permission)
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
 */
const recordRentPayment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const paymentData = req.body;
    const file = req.file;
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
 * @desc Get upcoming rent due dates
 * @route GET /api/rents/upcoming
 * @access Private (Landlord/Admin, Property Manager, Tenant)
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
 * @desc Get rent history
 * @route GET /api/rents/history
 * @access Private (Landlord/Admin, PM, Tenant)
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
 */
const uploadPaymentProof = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const file = req.file;
    const currentUser = req.user;
    const ipAddress = req.ip;

    if (!file) {
        throw new AppError('No file provided.', 400);
    }

    const updatedRent = await rentService.uploadPaymentProof(id, file, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Payment proof uploaded successfully.',
        data: updatedRent
    });
});

/**
 * @desc Download payment proof
 * @route GET /api/rents/:id/download-proof
 * @access Private (Landlord/Admin, PM, or Tenant associated with rent)
 */
const downloadPaymentProof = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const { downloadUrl, fileName, mimeType } = await rentService.downloadPaymentProof(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Payment proof download link generated.',
        downloadUrl,
        fileName,
        mimeType
    });
});

/**
 * @desc Create a rent schedule
 * @route POST /api/rent-schedules
 * @access Private (Landlord/Admin, PropertyManager)
 */
const createRentSchedule = asyncHandler(async (req, res) => {
    const scheduleData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const newSchedule = await rentService.createRentSchedule(scheduleData, currentUser, ipAddress);

    res.status(201).json({
        success: true,
        message: 'Rent schedule created successfully.',
        data: newSchedule
    });
});

/**
 * @desc Get all rent schedules
 * @route GET /api/rent-schedules
 * @access Private (with access control)
 */
const getRentSchedules = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const result = await rentService.getRentSchedules(currentUser, filters, page, limit);

    res.status(200).json({
        success: true,
        count: result.schedules.length,
        total: result.total,
        page: result.page,
        limit: result.limit,
        pages: result.pages,
        data: result.schedules
    });
});

/**
 * @desc Get a single rent schedule by ID
 * @route GET /api/rent-schedules/:id
 * @access Private (Accessible if user is associated with schedule's lease/property)
 */
const getRentScheduleById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    // Since we don't have a dedicated service method for this, use the getRentSchedules method with a filter
    const result = await rentService.getRentSchedules(currentUser, { scheduleId: id }, 1, 1);
    
    if (!result.schedules.length) {
        throw new AppError('Rent schedule not found.', 404);
    }

    res.status(200).json({
        success: true,
        data: result.schedules[0]
    });
});

/**
 * @desc Update a rent schedule
 * @route PUT /api/rent-schedules/:id
 * @access Private (Landlord/Admin, PropertyManager)
 */
const updateRentSchedule = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedSchedule = await rentService.updateRentSchedule(id, updateData, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Rent schedule updated successfully.',
        data: updatedSchedule
    });
});

/**
 * @desc Delete a rent schedule
 * @route DELETE /api/rent-schedules/:id
 * @access Private (Landlord/Admin, PropertyManager)
 */
const deleteRentSchedule = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await rentService.deleteRentSchedule(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Rent schedule deleted successfully.'
    });
});

/**
 * @desc Generate rent records based on schedules
 * @route POST /api/rents/generate
 * @access Private (Landlord/Admin, PropertyManager)
 */
const generateRentRecords = asyncHandler(async (req, res) => {
    const { forDate, forceGeneration } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const options = {
        forceGeneration: forceGeneration === true
    };
    
    const results = await rentService.generateRentRecords(
        forDate ? new Date(forDate) : new Date(), 
        options, 
        currentUser, 
        ipAddress
    );

    res.status(200).json({
        success: true,
        message: `Rent generation completed. Generated: ${results.generated}, Skipped: ${results.skipped}, Failed: ${results.failed}`,
        data: results
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
    createRentSchedule,
    getRentSchedules,
    getRentScheduleById,
    updateRentSchedule,
    deleteRentSchedule,
    generateRentRecords
};