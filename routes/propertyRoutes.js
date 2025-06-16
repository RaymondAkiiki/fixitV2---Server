// backend/routes/propertyRoutes.js

const express = require('express');
const { body, query, param } = require('express-validator'); // Import validation functions
const router = express.Router();
const propertyController = require('../controllers/propertyController'); // Corrected import path
const unitController = require('../controllers/unitController');     // New import for unit management
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Corrected import path

// --- Validation Schemas ---

const createPropertyValidation = [
    body('name').notEmpty().withMessage('Property name is required.'),
    body('address.street').optional().isString().trim(),
    body('address.city').notEmpty().withMessage('City is required for property address.').trim(),
    body('address.state').optional().isString().trim(),
    body('address.country').notEmpty().withMessage('Country is required for property address.').trim(),
    body('details').optional().isString().isLength({ max: 1000 }).withMessage('Details cannot exceed 1000 characters.'),
];

const updatePropertyValidation = [
    param('id').isMongoId().withMessage('Invalid property ID.'),
    body('name').optional().notEmpty().withMessage('Property name cannot be empty.'),
    body('address.street').optional().isString().trim(),
    body('address.city').optional().notEmpty().withMessage('City cannot be empty.').trim(),
    body('address.state').optional().isString().trim(),
    body('address.country').optional().notEmpty().withMessage('Country cannot be empty.').trim(),
    body('details').optional().isString().isLength({ max: 1000 }).withMessage('Details cannot exceed 1000 characters.'),
];

const propertyIdParamValidation = [
    param('propertyId').isMongoId().withMessage('Invalid property ID in URL.'),
];
const unitIdParamValidation = [
    param('unitId').isMongoId().withMessage('Invalid unit ID in URL.'),
];
const tenantIdParamValidation = [
    param('tenantId').isMongoId().withMessage('Invalid tenant ID in URL.'),
];

const createUnitValidation = [
    body('unitName').notEmpty().withMessage('Unit name is required.'),
    body('floor').optional().isString().trim(),
    body('details').optional().isString().isLength({ max: 1000 }).withMessage('Details cannot exceed 1000 characters.'),
    body('numBedrooms').optional().isInt({ min: 0 }).withMessage('Number of bedrooms must be a non-negative integer.'),
    body('numBathrooms').optional().isInt({ min: 0 }).withMessage('Number of bathrooms must be a non-negative integer.'),
    body('squareFootage').optional().isFloat({ min: 0 }).withMessage('Square footage must be a non-negative number.'),
    body('rentAmount').optional().isFloat({ min: 0 }).withMessage('Rent amount must be a non-negative number.'),
];

const updateUnitValidation = [
    param('propertyId').isMongoId().withMessage('Invalid property ID.'),
    param('unitId').isMongoId().withMessage('Invalid unit ID.'),
    // Allow partial updates, so fields are optional
    body('unitName').optional().notEmpty().withMessage('Unit name cannot be empty.'),
    body('floor').optional().isString().trim(),
    body('details').optional().isString().isLength({ max: 1000 }).withMessage('Details cannot exceed 1000 characters.'),
    body('numBedrooms').optional().isInt({ min: 0 }).withMessage('Number of bedrooms must be a non-negative integer.'),
    body('numBathrooms').optional().isInt({ min: 0 }).withMessage('Number of bathrooms must be a non-negative integer.'),
    body('squareFootage').optional().isFloat({ min: 0 }).withMessage('Square footage must be a non-negative number.'),
    body('rentAmount').optional().isFloat({ min: 0 }).withMessage('Rent amount must be a non-negative number.'),
    body('status').optional().isIn(['occupied', 'vacant', 'under_maintenance', 'unavailable']).withMessage('Invalid unit status.'),
];

const assignTenantValidation = [
    body('tenantId').isMongoId().withMessage('Tenant ID is required and must be a valid Mongo ID.'),
];

// --- Property Routes ---

// POST /api/properties - Create new property
router.post(
    '/',
    protect,
    authorizeRoles('landlord', 'propertymanager', 'admin'), // Admins can also create properties
    createPropertyValidation,
    propertyController.createProperty
);

// GET /api/properties - List properties (filtered by user role/association)
router.get('/', protect, propertyController.listProperties);

// GET /api/properties/:id - Get specific property details (including units, requests summary)
router.get('/:id', protect, propertyIdParamValidation, propertyController.getPropertyDetails);

// PUT /api/properties/:id - Update property details
router.put(
    '/:id',
    protect,
    authorizeRoles('landlord', 'propertymanager', 'admin'),
    updatePropertyValidation,
    propertyController.updateProperty
);

// DELETE /api/properties/:id - Delete property
router.delete(
    '/:id',
    protect,
    authorizeRoles('landlord', 'admin'), // Only landlord (who owns it) or admin
    propertyIdParamValidation,
    propertyController.deleteProperty
);

// --- Unit Routes (Nested under /api/properties/:propertyId/units) ---

// POST /api/properties/:propertyId/units - Create a unit within a property
router.post(
    '/:propertyId/units',
    protect,
    authorizeRoles('landlord', 'propertymanager', 'admin'),
    propertyIdParamValidation, // Validate propertyId in URL
    createUnitValidation, // Validate unit body
    unitController.createUnit
);

// GET /api/properties/:propertyId/units - List units for a property
router.get(
    '/:propertyId/units',
    protect,
    propertyIdParamValidation,
    unitController.listUnits
);

// GET /api/properties/:propertyId/units/:unitId - Get specific unit details
router.get(
    '/:propertyId/units/:unitId',
    protect,
    propertyIdParamValidation,
    unitIdParamValidation,
    unitController.getUnitDetails
);

// PUT /api/properties/:propertyId/units/:unitId - Update unit details
router.put(
    '/:propertyId/units/:unitId',
    protect,
    authorizeRoles('landlord', 'propertymanager', 'admin'),
    updateUnitValidation, // Includes propertyId and unitId param validation
    unitController.updateUnit
);

// DELETE /api/properties/:propertyId/units/:unitId - Delete unit
router.delete(
    '/:propertyId/units/:unitId',
    protect,
    authorizeRoles('landlord', 'propertymanager', 'admin'),
    propertyIdParamValidation,
    unitIdParamValidation,
    unitController.deleteUnit
);

// POST /api/properties/:propertyId/units/:unitId/assign-tenant - Assign a tenant to a unit
router.post(
    '/:propertyId/units/:unitId/assign-tenant',
    protect,
    authorizeRoles('landlord', 'propertymanager', 'admin'),
    propertyIdParamValidation,
    unitIdParamValidation,
    assignTenantValidation,
    unitController.assignTenantToUnit
);

// DELETE /api/properties/:propertyId/units/:unitId/remove-tenant/:tenantId - Remove a tenant from a unit
router.delete(
    '/:propertyId/units/:unitId/remove-tenant/:tenantId',
    protect,
    authorizeRoles('landlord', 'propertymanager', 'admin'),
    propertyIdParamValidation,
    unitIdParamValidation,
    tenantIdParamValidation,
    unitController.removeTenantFromUnit
);

// Removed: requestToJoin, approveTenant as these are handled by inviteController/PropertyUser management

module.exports = router;
