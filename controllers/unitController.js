// src/controllers/unitController.js

const asyncHandler = require('../utils/asyncHandler');
const unitService = require('../services/unitService');
const logger = require('../utils/logger');

/**
 * @desc Create a new unit within a property
 * @route POST /api/properties/:propertyId/units
 * @access Private (PropertyManager, Landlord, Admin)
 */
const createUnit = asyncHandler(async (req, res) => {
    const { propertyId } = req.params;
    const unitData = req.body;
    const currentUser = req.user;
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
 */
const getUnitsForProperty = asyncHandler(async (req, res) => {
    const { propertyId } = req.params;
    const filters = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const currentUser = req.user;

    const result = await unitService.getUnitsForProperty(propertyId, currentUser, filters, page, limit);

    res.status(200).json({
        success: true,
        count: result.units.length,
        total: result.total,
        page: result.page,
        limit: result.limit,
        pages: result.pages,
        data: result.units
    });
});

/**
 * @desc Get specific unit details
 * @route GET /api/properties/:propertyId/units/:unitId
 * @access Private (with access control)
 */
const getUnitById = asyncHandler(async (req, res) => {
    const { propertyId, unitId } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const unit = await unitService.getUnitById(propertyId, unitId, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        unit
    });
});

/**
 * @desc Update unit details
 * @route PUT /api/properties/:propertyId/units/:unitId
 * @access Private (PropertyManager, Landlord, Admin)
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
    removeTenantFromUnit
};