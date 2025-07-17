// src/controllers/propertyController.js

const asyncHandler = require('../utils/asyncHandler');
const propertyService = require('../services/propertyService'); // Import the new property service
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Create a new property
 * @route POST /api/properties
 * @access Private (Landlord, PropertyManager, Admin)
 * @body {string} name - Name of the property
 * @body {object} address - Address details {street, city, state, zipCode, country}
 * @body {string} [propertyType='residential'] - Type of property (e.g., 'residential', 'commercial')
 * @body {number} [yearBuilt] - Year the property was built
 * @body {number} [numberOfUnits=0] - Total number of units in the property
 * @body {string} [details] - Additional details about the property
 * @body {number} [annualOperatingBudget=0] - Annual operating budget for the property
 * @body {string} [notes] - Internal notes about the property
 * @body {string} [mainContactUser] - ID of the user who is the main contact for this property
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
 * @query {string} [search] - Search by property name
 * @query {string} [city] - Filter by city
 * @query {string} [country] - Filter by country
 * @query {boolean} [isActive] - Filter by active status
 * @query {string} [propertyType] - Filter by property type
 * @query {string} [sortBy='name'] - Field to sort by
 * @query {string} [sortOrder='asc'] - Sort order ('asc' or 'desc')
 * @query {number} [page=1] - Page number
 * @query {number} [limit=10] - Items per page
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
 * @param {string} id - Property ID from URL params
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
 * @param {string} id - Property ID from URL params
 * @body {string} [name] - New name of the property
 * @body {object} [address] - New address details
 * @body {string} [propertyType] - New type of property
 * @body {number} [yearBuilt] - New year built
 * @body {number} [numberOfUnits] - New total number of units
 * @body {string} [details] - New additional details
 * @body {number} [annualOperatingBudget] - New annual operating budget
 * @body {string} [notes] - New internal notes
 * @body {string} [mainContactUser] - New main contact user ID
 * @body {boolean} [isActive] - New active status
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
 * @param {string} id - Property ID from URL params
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
 * @param {string} id - Property ID from URL params
 * @body {string} userIdToAssign - ID of the user to assign
 * @body {Array<string>} roles - Array of roles (e.g., ['propertymanager'], ['tenant'])
 * @body {string} [unitId] - Optional. Required if 'tenant' role is assigned.
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
 * @param {string} propertyId - Property ID from URL params
 * @param {string} userIdToRemove - User ID to remove from URL params
 * @query {Array<string>} rolesToRemove - Array of roles to remove (e.g., ['propertymanager'], ['tenant'])
 * @query {string} [unitId] - Optional. Required if 'tenant' role is being removed.
 */
const removeUserFromProperty = asyncHandler(async (req, res) => {
    const { propertyId, userIdToRemove } = req.params;
    const { rolesToRemove, unitId } = req.query; // Roles to remove are passed as query array
    const currentUser = req.user;
    const ipAddress = req.ip;

    // Ensure rolesToRemove is an array, even if a single string is passed
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
    removeUserFromProperty,
};
