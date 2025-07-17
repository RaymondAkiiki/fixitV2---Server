// src/routes/vendorRoutes.js

const express = require('express');
const router = express.Router();
const { query } = require('express-validator');
const vendorController = require('../controllers/vendorController'); // Import vendor controller
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Import auth middleware
const { validateMongoId, validateVendor, validateResult } = require('../utils/validationUtils'); // Import validation utilities
const { ROLE_ENUM } = require('../utils/constants/enums'); // Import enums for roles

/**
 * @route POST /api/vendors
 * @desc Create a new vendor
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateVendor, // Apply comprehensive vendor validation
    vendorController.createVendor
);

/**
 * @route GET /api/vendors
 * @desc Get all vendors with filtering, search, and pagination
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.get(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    // Query parameter validation (optional, but good practice)
    [
        query('status').optional().isIn(['active', 'inactive']).withMessage('Invalid status filter.'),
        query('serviceTag').optional().isString().trim().withMessage('Service tag must be a string.'),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('search').optional().isString().trim().withMessage('Search query must be a string.'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer.'),
        validateResult // Apply validation result handler for queries
    ],
    vendorController.getAllVendors
);

/**
 * @route GET /api/vendors/:id
 * @desc Get a specific vendor by ID
 * @access Private (Admin, PropertyManager, Landlord - with access control)
 */
router.get(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'), // Validate ID in params
    vendorController.getVendorById
);

/**
 * @route PUT /api/vendors/:id
 * @desc Update vendor details
 * @access Private (Admin, PropertyManager, Landlord - for vendors they added/manage)
 */
router.put(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'), // Validate ID in params
    validateVendor, // Reuse vendor validation for updates (optional fields handled by optional())
    vendorController.updateVendor
);

/**
 * @route DELETE /api/vendors/:id
 * @desc Delete a vendor
 * @access Private (Admin only)
 */
router.delete(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN), // Only global admin can delete vendors
    validateMongoId('id'), // Validate ID in params
    vendorController.deleteVendor
);

module.exports = router;
