// src/routes/unitRoutes.js

const express = require('express');
const router = express.Router();
const unitController = require('../controllers/unitController'); // Import unit controller
const { protect, authorizeRoles, authorizePropertyAccess } = require('../middleware/authMiddleware'); // Import auth middleware
const { validateMongoId, validateUnit, validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { ROLE_ENUM } = require('../utils/constants/enums'); // Import enums for roles
const { body, query } = require('express-validator'); // For specific body/query validation

// All unit routes are nested under /api/properties/:propertyId/units
// The authorizePropertyAccess middleware will ensure the user has permission for the property.

/**
 * @route POST /api/properties/:propertyId/units
 * @desc Create a new unit within a property
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/:propertyId/units',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('propertyId'), // Validate propertyId in params
    validateUnit, // Apply comprehensive unit validation for body
    unitController.createUnit
);

/**
 * @route GET /api/properties/:propertyId/units
 * @desc List units for a specific property with filtering and pagination
 * @access Private (with access control: Admin, Landlord/PM, or Tenant for their unit)
 */
router.get(
    '/:propertyId/units',
    protect,
    // authorizePropertyAccess is handled within the service for more granular tenant access
    validateMongoId('propertyId'), // Validate propertyId in params
    [
        query('status').optional().isIn(['vacant', 'occupied', 'under_maintenance', 'unavailable']).withMessage('Invalid status filter.'), // Adjust enum as per your UNIT_STATUS_ENUM
        query('numBedrooms').optional().isInt({ min: 0 }).withMessage('Number of bedrooms must be a non-negative integer.'),
        query('search').optional().isString().trim().withMessage('Search query must be a string.'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer.'),
        validateResult
    ],
    unitController.getUnitsForProperty
);

/**
 * @route GET /api/properties/:propertyId/units/:unitId
 * @desc Get specific unit details
 * @access Private (with access control: Admin, Landlord/PM, or Tenant for their unit)
 */
router.get(
    '/:propertyId/units/:unitId',
    protect,
    // authorizePropertyAccess is handled within the service for more granular tenant access
    validateMongoId('propertyId'), // Validate propertyId in params
    validateMongoId('unitId'), // Validate unitId in params
    unitController.getUnitById
);

/**
 * @route PUT /api/properties/:propertyId/units/:unitId
 * @desc Update unit details
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.put(
    '/:propertyId/units/:unitId',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('propertyId'), // Validate propertyId in params
    validateMongoId('unitId'), // Validate unitId in params
    validateUnit, // Reuse unit validation for updates (optional fields handled by optional())
    unitController.updateUnit
);

/**
 * @route DELETE /api/properties/:propertyId/units/:unitId
 * @desc Delete unit
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.delete(
    '/:propertyId/units/:unitId',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('propertyId'), // Validate propertyId in params
    validateMongoId('unitId'), // Validate unitId in params
    unitController.deleteUnit
);

/**
 * @route POST /api/properties/:propertyId/units/:unitId/assign-tenant
 * @desc Assign a tenant to a unit
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/:propertyId/units/:unitId/assign-tenant',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('propertyId'),
    validateMongoId('unitId'),
    [
        body('tenantId').notEmpty().withMessage('Tenant ID is required').isMongoId().withMessage('Tenant ID must be a valid MongoDB ID'),
        validateResult
    ],
    unitController.assignTenantToUnit
);

/**
 * @route DELETE /api/properties/:propertyId/units/:unitId/remove-tenant/:tenantId
 * @desc Remove a tenant from a unit
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.delete(
    '/:propertyId/units/:unitId/remove-tenant/:tenantId',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('propertyId'),
    validateMongoId('unitId'),
    validateMongoId('tenantId'),
    unitController.removeTenantFromUnit
);

module.exports = router;
