// src/routes/unitRoutes.js

const express = require('express');
const router = express.Router({ mergeParams: true });
const unitController = require('../controllers/unitController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { validateMongoId, validateResult } = require('../utils/validationUtils');
const { ROLE_ENUM, UNIT_STATUS_ENUM, UTILITY_RESPONSIBILITY_ENUM } = require('../utils/constants/enums');
const { body, query } = require('express-validator');

// All unit routes are nested under /api/properties/:propertyId/units
// Note: mergeParams: true allows access to params from parent router

/**
 * Unit validation middleware
 */
const validateUnitData = [
    body('unitName')
        .notEmpty().withMessage('Unit name is required.')
        .trim()
        .isLength({ max: 50 }).withMessage('Unit name cannot exceed 50 characters.'),
    
    body('floor')
        .optional({ nullable: true })
        .trim()
        .isLength({ max: 20 }).withMessage('Floor number/name cannot exceed 20 characters.'),
    
    body('details')
        .optional({ nullable: true })
        .trim()
        .isLength({ max: 1000 }).withMessage('Details cannot exceed 1000 characters.'),
    
    body('numBedrooms')
        .optional({ nullable: true })
        .isInt({ min: 0 }).withMessage('Number of bedrooms must be a non-negative integer.'),
    
    body('numBathrooms')
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage('Number of bathrooms must be a non-negative number.'),
    
    body('squareFootage')
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage('Square footage must be a non-negative number.'),
    
    body('rentAmount')
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage('Rent amount must be a non-negative number.'),
    
    body('depositAmount')
        .optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage('Deposit amount must be a non-negative number.'),
    
    body('status')
        .optional()
        .isIn(UNIT_STATUS_ENUM).withMessage(`Invalid unit status. Must be one of: ${UNIT_STATUS_ENUM.join(', ')}`),
    
    body('utilityResponsibility')
        .optional()
        .isIn(UTILITY_RESPONSIBILITY_ENUM).withMessage(`Invalid utility responsibility. Must be one of: ${UTILITY_RESPONSIBILITY_ENUM.join(', ')}`),
    
    body('notes')
        .optional({ nullable: true })
        .trim()
        .isLength({ max: 2000 }).withMessage('Notes cannot exceed 2000 characters.'),
    
    body('lastInspected')
        .optional({ nullable: true })
        .isISO8601().withMessage('Last inspection date must be a valid date.'),
    
    body('nextInspectionDate')
        .optional({ nullable: true })
        .isISO8601().withMessage('Next inspection date must be a valid date.'),
    
    body('unitImages')
        .optional()
        .isArray().withMessage('Unit images must be an array.')
        .custom(images => !images.length || images.every(id => /^[0-9a-fA-F]{24}$/.test(id)))
        .withMessage('Each image must be a valid MongoDB ID.'),
    
    body('amenities')
        .optional()
        .isArray().withMessage('Amenities must be an array.')
        .custom(amenities => !amenities.length || amenities.every(item => typeof item === 'string'))
        .withMessage('Each amenity must be a string.'),
    
    body('features')
        .optional()
        .isArray().withMessage('Features must be an array.')
        .custom(features => !features.length || features.every(item => 
            typeof item === 'object' && item !== null && 
            typeof item.name === 'string' && 
            (!item.description || typeof item.description === 'string')
        ))
        .withMessage('Each feature must have a name (string) and optional description (string).'),
    
    validateResult
];

/**
 * @route POST /api/properties/:propertyId/units
 * @desc Create a new unit within a property
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('propertyId'),
    validateUnitData,
    unitController.createUnit
);

/**
 * @route GET /api/properties/:propertyId/units
 * @desc List units for a specific property with filtering and pagination
 * @access Private (with access control)
 */
router.get(
    '/',
    protect,
    validateMongoId('propertyId'),
    [
        query('status')
            .optional()
            .isIn(UNIT_STATUS_ENUM).withMessage(`Invalid status filter. Must be one of: ${UNIT_STATUS_ENUM.join(', ')}`),
        
        query('numBedrooms')
            .optional()
            .isInt({ min: 0 }).withMessage('Number of bedrooms must be a non-negative integer.'),
        
        query('search')
            .optional()
            .isString().trim().withMessage('Search query must be a string.'),
        
        query('vacant')
            .optional()
            .isBoolean().withMessage('Vacant filter must be a boolean.'),
        
        query('page')
            .optional()
            .isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
        
        validateResult
    ],
    unitController.getUnitsForProperty
);

/**
 * @route GET /api/properties/:propertyId/units/:unitId
 * @desc Get specific unit details
 * @access Private (with access control)
 */
router.get(
    '/:unitId',
    protect,
    validateMongoId('propertyId'),
    validateMongoId('unitId'),
    unitController.getUnitById
);

/**
 * @route PUT /api/properties/:propertyId/units/:unitId
 * @desc Update unit details
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.put(
    '/:unitId',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('propertyId'),
    validateMongoId('unitId'),
    validateUnitData,
    unitController.updateUnit
);

/**
 * @route DELETE /api/properties/:propertyId/units/:unitId
 * @desc Delete unit
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.delete(
    '/:unitId',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('propertyId'),
    validateMongoId('unitId'),
    unitController.deleteUnit
);

/**
 * @route POST /api/properties/:propertyId/units/:unitId/assign-tenant
 * @desc Assign a tenant to a unit
 * @access Private (PropertyManager, Landlord, Admin)
 */
router.post(
    '/:unitId/assign-tenant',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('propertyId'),
    validateMongoId('unitId'),
    [
        body('tenantId')
            .notEmpty().withMessage('Tenant ID is required.')
            .isMongoId().withMessage('Invalid tenant ID format.'),
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
    '/:unitId/remove-tenant/:tenantId',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('propertyId'),
    validateMongoId('unitId'),
    validateMongoId('tenantId'),
    unitController.removeTenantFromUnit
);

module.exports = router;