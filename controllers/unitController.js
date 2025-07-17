// src/controllers/unitController.js

const asyncHandler = require('../utils/asyncHandler'); // For handling async errors
const unitService = require('../services/unitService'); // Import the new unit service
const logger = require('../utils/logger'); // Import logger
const AppError = require('../utils/AppError'); // Import custom AppError

/**
 * @desc Create a new unit within a property
 * @route POST /api/properties/:propertyId/units
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} propertyId - ID of the property from URL params
 * @body {string} unitName, {string} [floor], {string} [details], {number} [numBedrooms],
 * {number} [numBathrooms], {number} [squareFootage], {number} [rentAmount], {number} [depositAmount],
 * {string} [status], {string} [utilityResponsibility], {string} [notes], {Date} [lastInspected],
 * {string[]} [unitImages]
 */
const createUnit = asyncHandler(async (req, res) => {
    const { propertyId } = req.params;
    const unitData = req.body;
    const currentUser = req.user; // From protect middleware
    const ipAddress = req.ip;

    const newUnit = await unitService.createUnit(propertyId, unitData, currentUser, ipAddress);

    res.status(201).json({
        success: true,
        message: 'Unit created successfully.',
        unit: newUnit
    });
});

/**
 * @desc List units for a specific property
 * @route GET /api/properties/:propertyId/units
 * @access Private (with access control)
 * @param {string} propertyId - ID of the property from URL params
 * @query {string} [status] - Filter by unit status
 * @query {number} [numBedrooms] - Filter by number of bedrooms
 * @query {string} [search] - Search by unit name, floor, or details
 * @query {number} [page=1] - Page number
 * @query {number} [limit=10] - Items per page
 */
const getUnitsForProperty = asyncHandler(async (req, res) => {
    const { propertyId } = req.params;
    const filters = req.query; // All query parameters are filters
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;
    const currentUser = req.user;

    const { units, total, page: currentPage, limit: currentLimit } = await unitService.getUnitsForProperty(propertyId, currentUser, filters, page, limit);

    res.status(200).json({
        success: true,
        count: units.length,
        total,
        page: currentPage,
        limit: currentLimit,
        data: units
    });
});

/**
 * @desc Get specific unit details
 * @route GET /api/properties/:propertyId/units/:unitId
 * @access Private (with access control)
 * @param {string} propertyId - ID of the property from URL params
 * @param {string} unitId - ID of the unit from URL params
 */
const getUnitById = asyncHandler(async (req, res) => {
    const { propertyId, unitId } = req.params;
    const currentUser = req.user;

    const unit = await unitService.getUnitById(propertyId, unitId, currentUser);

    res.status(200).json({
        success: true,
        unit: unit
    });
});

/**
 * @desc Update unit details
 * @route PUT /api/properties/:propertyId/units/:unitId
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} propertyId - ID of the property from URL params
 * @param {string} unitId - ID of the unit from URL params
 * @body {string} [unitName], {string} [floor], {string} [details], {number} [numBedrooms],
 * {number} [numBathrooms], {number} [squareFootage], {number} [rentAmount], {number} [depositAmount],
 * {string} [status], {string} [utilityResponsibility], {string} [notes], {Date} [lastInspected],
 * {string[]} [unitImages]
 */
const updateUnit = asyncHandler(async (req, res) => {
    const { propertyId, unitId } = req.params;
    const updateData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedUnit = await unitService.updateUnit(propertyId, unitId, updateData, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Unit updated successfully.',
        unit: updatedUnit
    });
});

/**
 * @desc Delete unit
 * @route DELETE /api/properties/:propertyId/units/:unitId
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} propertyId - ID of the property from URL params
 * @param {string} unitId - ID of the unit from URL params
 */
const deleteUnit = asyncHandler(async (req, res) => {
    const { propertyId, unitId } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await unitService.deleteUnit(propertyId, unitId, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Unit deleted successfully.'
    });
});

/**
 * @desc Assign a tenant to a unit
 * @route POST /api/properties/:propertyId/units/:unitId/assign-tenant
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} propertyId - ID of the property from URL params
 * @param {string} unitId - ID of the unit from URL params
 * @body {string} tenantId - ID of the tenant User to assign
 */
const assignTenantToUnit = asyncHandler(async (req, res) => {
    const { propertyId, unitId } = req.params;
    const { tenantId } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedUnit = await unitService.assignTenantToUnit(propertyId, unitId, tenantId, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Tenant assigned to unit successfully.',
        unit: updatedUnit
    });
});

/**
 * @desc Remove a tenant from a unit
 * @route DELETE /api/properties/:propertyId/units/:unitId/remove-tenant/:tenantId
 * @access Private (PropertyManager, Landlord, Admin)
 * @param {string} propertyId - ID of the property from URL params
 * @param {string} unitId - ID of the unit from URL params
 * @param {string} tenantId - ID of the tenant User to remove from URL params
 */
const removeTenantFromUnit = asyncHandler(async (req, res) => {
    const { propertyId, unitId, tenantId } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedUnit = await unitService.removeTenantFromUnit(propertyId, unitId, tenantId, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Tenant removed from unit successfully.',
        unit: updatedUnit
    });
});

module.exports = {
    createUnit,
    getUnitsForProperty,
    getUnitById,
    updateUnit,
    deleteUnit,
    assignTenantToUnit,
    removeTenantFromUnit,
};
