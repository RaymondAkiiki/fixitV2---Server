// src/controllers/propertyController.js

const asyncHandler = require('../utils/asyncHandler');
const propertyService = require('../services/propertyService');
const logger = require('../utils/logger');

/**
 * @desc Create a new property
 * @route POST /api/properties
 * @access Private (Landlord, PropertyManager, Admin)
 */
const createProperty = asyncHandler(async (req, res) => {
    const propertyData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const newProperty = await propertyService.createProperty(propertyData, currentUser, ipAddress);

    res.status(201).json({
        success: true,
        message: 'Property created successfully.',
        data: newProperty
    });
});

/**
 * @desc Get all properties accessible by the logged-in user
 * @route GET /api/properties
 * @access Private (with access control)
 */
const getAllProperties = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;

    const { properties, total, page, limit } = await propertyService.getAllProperties(currentUser, filters);

    res.status(200).json({
        success: true,
        count: properties.length,
        total,
        page,
        limit,
        data: properties
    });
});

/**
 * @desc Get a single property by ID
 * @route GET /api/properties/:id
 * @access Private (Accessible if user is associated with property)
 */
const getPropertyById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    const property = await propertyService.getPropertyById(id, currentUser);

    res.status(200).json({
        success: true,
        data: property
    });
});

/**
 * @desc Update a property's details
 * @route PUT /api/properties/:id
 * @access Private (Landlord, PropertyManager - with ownership/management)
 */
const updateProperty = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedProperty = await propertyService.updateProperty(id, updateData, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Property updated successfully.',
        data: updatedProperty
    });
});

/**
 * @desc Delete a property (and all its associated data)
 * @route DELETE /api/properties/:id
 * @access Private (Admin, Landlord - who owns it)
 */
const deleteProperty = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await propertyService.deleteProperty(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Property and all associated data deleted successfully.'
    });
});


/**
 * @desc Assign a user to a property with specific roles
 * @route POST /api/properties/:id/assign-user
 * @access Private (Landlord, Admin)
 */
const assignUserToProperty = asyncHandler(async (req, res) => {
    const { id: propertyId } = req.params;
    const { userIdToAssign, roles, unitId } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const assignment = await propertyService.assignUserToProperty(propertyId, userIdToAssign, roles, unitId, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'User assigned to property successfully.',
        data: assignment
    });
});

/**
 * @desc Remove (deactivate) a user's association with a property/unit for specific roles
 * @route DELETE /api/properties/:propertyId/remove-user/:userIdToRemove
 * @access Private (Landlord, Admin)
 */
const removeUserFromProperty = asyncHandler(async (req, res) => {
    const { propertyId, userIdToRemove } = req.params;
    const { rolesToRemove, unitId } = req.query;
    const currentUser = req.user;
    const ipAddress = req.ip;

    // Ensure rolesToRemove is an array
    const rolesArray = Array.isArray(rolesToRemove) ? rolesToRemove : (rolesToRemove ? [rolesToRemove] : []);

    await propertyService.removeUserFromProperty(propertyId, userIdToRemove, rolesArray, unitId, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'User association removed successfully.'
    });
});

module.exports = {
    createProperty,
    getAllProperties,
    getPropertyById,
    updateProperty,
    deleteProperty,
    assignUserToProperty,
    removeUserFromProperty
};