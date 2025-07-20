// server/routes/vendorRoutes.js

const express = require('express');
const router = express.Router();
const { query } = require('express-validator');
const vendorController = require('../controllers/vendorController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { validateMongoId, validateVendor, validateResult } = require('../utils/validationUtils');
const { ROLE_ENUM } = require('../utils/constants/enums');

/**
 * @route POST /api/vendors
 * @desc Create a new vendor
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateVendor,
    vendorController.createVendor
);

/**
 * @route GET /api/vendors
 * @desc Get all vendors with filtering, search, pagination, and sorting
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.get(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    [
        query('status').optional().isIn(['active', 'inactive', 'preferred']).withMessage('Invalid status filter.'),
        query('service').optional().isString().trim().withMessage('Service tag must be a string.'),
        query('propertyId').optional().isMongoId().withMessage('Invalid Property ID format.'),
        query('search').optional().isString().trim().withMessage('Search query must be a string.'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
        query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer.'),
        query('sortBy').optional().isString().trim().withMessage('Sort field must be a string.'),
        query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be either "asc" or "desc".'),
        validateResult
    ],
    vendorController.getAllVendors
);

/**
 * @route GET /api/vendors/stats
 * @desc Get vendor statistics
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.get(
    '/stats',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    vendorController.getVendorStats
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
    validateMongoId('id'),
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
    validateMongoId('id'),
    validateVendor,
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
    authorizeRoles(ROLE_ENUM.ADMIN),
    validateMongoId('id'),
    vendorController.deleteVendor
);

/**
 * @route POST /api/vendors/:id/rate
 * @desc Rate a vendor's performance
 * @access Private (Admin, PropertyManager, Landlord)
 */
router.post(
    '/:id/rate',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER, ROLE_ENUM.LANDLORD),
    validateMongoId('id'),
    [
        query('score').isInt({ min: 1, max: 5 }).withMessage('Rating score must be between 1 and 5.'),
        query('comment').optional().isString().trim().withMessage('Comment must be a string.'),
        query('requestId').optional().isMongoId().withMessage('Invalid Request ID format.'),
        validateResult
    ],
    // This is a placeholder - you'll need to implement this controller method
    (req, res) => {
        res.status(501).json({
            success: false,
            message: 'Vendor rating functionality is not yet implemented'
        });
    }
);

/**
 * @route PUT /api/vendors/:id/deactivate
 * @desc Deactivate a vendor
 * @access Private (Admin, PropertyManager who added the vendor)
 */
router.put(
    '/:id/deactivate',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    // This could use the updateVendor controller method with a predefined status
    async (req, res) => {
        try {
            req.body = { status: 'inactive' };
            return await vendorController.updateVendor(req, res);
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Failed to deactivate vendor',
                error: error.message
            });
        }
    }
);

module.exports = router;