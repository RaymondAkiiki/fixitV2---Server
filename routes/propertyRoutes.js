// src/routes/propertyRoutes.js

const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/propertyController');
const unitRoutes = require('./unitRoutes');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { validateMongoId, validateResult } = require('../utils/validationUtils');
const { ROLE_ENUM, PROPERTY_TYPE_ENUM, PROPERTY_USER_ROLES_ENUM } = require('../utils/constants/enums');
const { body, query, param } = require('express-validator');

// Mount nested unit routes
router.use('/:propertyId/units', unitRoutes);

/**
 * Property validation middleware
 */
const validatePropertyData = [
    body('name')
        .notEmpty().withMessage('Property name is required.')
        .trim()
        .isLength({ max: 150 }).withMessage('Property name cannot exceed 150 characters.'),
    
    body('address')
        .notEmpty().withMessage('Property address is required.')
        .isObject().withMessage('Address must be an object.'),
    
    body('address.street')
        .optional()
        .isString().trim(),
    
    body('address.city')
        .notEmpty().withMessage('City is required for address.')
        .isString().trim(),
    
    body('address.state')
        .optional()
        .isString().trim(),
    
    body('address.zipCode')
        .optional()
        .isString().trim(),
    
    body('address.country')
        .notEmpty().withMessage('Country is required for address.')
        .isString().trim(),
    
    body('propertyType')
        .optional()
        .isIn(PROPERTY_TYPE_ENUM).withMessage(`Invalid property type. Must be one of: ${PROPERTY_TYPE_ENUM.join(', ')}`),
    
    body('yearBuilt')
        .optional()
        .isInt({ min: 1000, max: new Date().getFullYear() })
        .withMessage(`Year built must be a valid year (e.g., 1000-${new Date().getFullYear()}).`),
    
    body('numberOfUnits')
        .optional()
        .isInt({ min: 0 }).withMessage('Number of units must be a non-negative integer.'),
    
    body('details')
        .optional()
        .isString().trim()
        .isLength({ max: 1000 }).withMessage('Details cannot exceed 1000 characters.'),
    
    body('amenities')
        .optional()
        .isArray().withMessage('Amenities must be an array of strings.')
        .custom(amenities => !amenities.length || amenities.every(item => typeof item === 'string'))
        .withMessage('Each amenity must be a string.'),
    
    body('annualOperatingBudget')
        .optional()
        .isFloat({ min: 0 }).withMessage('Annual operating budget must be a non-negative number.'),
    
    body('notes')
        .optional()
        .isString().trim()
        .isLength({ max: 2000 }).withMessage('Notes cannot exceed 2000 characters.'),
    
    body('mainContactUser')
        .optional()
        .isMongoId().withMessage('Main contact user must be a valid MongoDB ID.'),
    
    body('isActive')
        .optional()
        .isBoolean().withMessage('isActive must be a boolean.'),
    
    body('images')
        .optional()
        .isArray().withMessage('Images must be an array.')
        .custom(images => !images.length || images.every(id => /^[0-9a-fA-F]{24}$/.test(id)))
        .withMessage('Each image must be a valid MongoDB ID.'),
    
    body('location')
        .optional()
        .isObject().withMessage('Location must be an object.'),
    
    body('location.coordinates')
        .optional()
        .isArray({ min: 2, max: 2 }).withMessage('Coordinates must be an array with exactly 2 elements [longitude, latitude].')
        .custom(coords => coords[0] >= -180 && coords[0] <= 180 && coords[1] >= -90 && coords[1] <= 90)
        .withMessage('Coordinates must be valid longitude (-180 to 180) and latitude (-90 to 90) values.'),
    
    validateResult
];

/**
 * @route POST /api/properties
 * @desc Create a new property
 * @access Private (Landlord, PropertyManager, Admin)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validatePropertyData,
    propertyController.createProperty
);

/**
 * @route GET /api/properties
 * @desc Get all properties accessible by the logged-in user
 * @access Private (with access control)
 */
router.get(
    '/',
    protect,
    [
        query('search')
            .optional()
            .isString().trim().withMessage('Search query must be a string.'),
        
        query('city')
            .optional()
            .isString().trim().withMessage('City filter must be a string.'),
        
        query('country')
            .optional()
            .isString().trim().withMessage('Country filter must be a string.'),
        
        query('isActive')
            .optional()
            .isBoolean().withMessage('isActive filter must be a boolean.'),
        
        query('propertyType')
            .optional()
            .isIn(PROPERTY_TYPE_ENUM).withMessage(`Invalid property type filter. Must be one of: ${PROPERTY_TYPE_ENUM.join(', ')}`),
        
        query('sortBy')
            .optional()
            .isString().trim().withMessage('Sort by field must be a string.'),
        
        query('sortOrder')
            .optional()
            .isIn(['asc', 'desc']).withMessage('Sort order must be "asc" or "desc".'),
        
        query('page')
            .optional()
            .isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
        
        validateResult
    ],
    propertyController.getAllProperties
);

/**
 * @route GET /api/properties/:id
 * @desc Get a single property by ID
 * @access Private (Accessible if user is associated with property)
 */
router.get(
    '/:id',
    protect,
    validateMongoId('id'),
    propertyController.getPropertyById
);

/**
 * @route PUT /api/properties/:id
 * @desc Update a property's details
 * @access Private (Landlord, PropertyManager - with ownership/management)
 */
router.put(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    validatePropertyData,
    propertyController.updateProperty
);

/**
 * @route DELETE /api/properties/:id
 * @desc Delete a property (and all its associated data)
 * @access Private (Admin, Landlord - who owns it)
 */
router.delete(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    propertyController.deleteProperty
);

/**
 * @route POST /api/properties/:id/assign-user
 * @desc Assign a user to a property with specific roles
 * @access Private (Landlord, Admin)
 */
router.post(
    '/:id/assign-user',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    [
        body('userIdToAssign')
            .notEmpty().withMessage('User ID to assign is required.')
            .isMongoId().withMessage('Invalid User ID format.'),
        
        body('roles')
            .notEmpty().withMessage('Roles are required.')
            .isArray({ min: 1 }).withMessage('At least one role is required.')
            .custom(roles => roles.every(role => PROPERTY_USER_ROLES_ENUM.includes(role.toLowerCase())))
            .withMessage(`Invalid role(s) provided. Must be one of: ${PROPERTY_USER_ROLES_ENUM.join(', ')}`),
        
        body('unitId')
            .optional()
            .isMongoId().withMessage('Unit ID must be a valid MongoDB ID.'),
        
        validateResult
    ],
    propertyController.assignUserToProperty
);

/**
 * @route DELETE /api/properties/:propertyId/remove-user/:userIdToRemove
 * @desc Remove (deactivate) a user's association with a property/unit for specific roles
 * @access Private (Landlord, Admin)
 */
router.delete(
    '/:propertyId/remove-user/:userIdToRemove',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD),
    validateMongoId('propertyId'),
    validateMongoId('userIdToRemove'),
    [
        query('rolesToRemove')
            .notEmpty().withMessage('Roles to remove are required.')
            .custom(roles => {
                // Handle both array and string cases
                const rolesArray = Array.isArray(roles) ? roles : [roles];
                return rolesArray.every(role => PROPERTY_USER_ROLES_ENUM.includes(role.toLowerCase()));
            })
            .withMessage(`Invalid role(s) to remove. Must be one of: ${PROPERTY_USER_ROLES_ENUM.join(', ')}`),
        
        query('unitId')
            .optional()
            .isMongoId().withMessage('Unit ID must be a valid MongoDB ID.'),
        
        validateResult
    ],
    propertyController.removeUserFromProperty
);

module.exports = router;