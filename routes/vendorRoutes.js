// backend/routes/vendorRoutes.js

const express = require("express");
const { body, param } = require('express-validator');
const router = express.Router();
const vendorController = require("../controllers/vendorController"); // Corrected import
const { protect, authorizeRoles } = require("../middleware/authMiddleware"); // Corrected import

// --- Validation Schemas ---

const vendorBodyValidation = [
    body('name').notEmpty().withMessage('Name is required.'),
    body('phone').notEmpty().withMessage('Phone is required.'),
    body('email').isEmail().withMessage('Valid email required.').normalizeEmail(),
    body('description').optional().isString().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters.'),
    body('services').isArray({ min: 1 }).withMessage('At least one service required.').custom(value => {
        // Custom validation to ensure all services are valid enum values (lowercase)
        const allowedServices = ['plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'landscaping', 'other', 'cleaning', 'security', 'pest_control'];
        if (!value.every(service => allowedServices.includes(service.toLowerCase()))) {
            throw new Error(`Invalid service(s) provided. Allowed: ${allowedServices.join(', ')}`);
        }
        return true;
    }),
    body('address').optional().isString(),
    // Removed `contactPerson` and `photo` as they are not in the current Vendor model.
    // Added back `properties` field if the intention was to link vendors to properties at creation.
    // If not, this field should be removed. For now, it's commented out based on prev discussion.
    // body('properties').optional().isArray().withMessage('Properties must be an array of IDs.'),
    // body('properties.*').optional().isMongoId().withMessage('Invalid property ID in properties array.'),
];

const vendorIdParamValidation = [
    param('id').isMongoId().withMessage('Invalid vendor ID in URL.'),
];

// --- ROUTES ---

// GET /api/vendors - Get all vendors
router.get(
    "/",
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'), // Only authorized roles can list vendors
    vendorController.getAllVendors
);

// GET /api/vendors/:id - Get a specific vendor by ID
router.get(
    "/:id",
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'), // Only authorized roles can view specific vendors
    vendorIdParamValidation,
    vendorController.getVendorById
);

// POST /api/vendors - Add a new vendor
router.post(
    "/",
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'), // Only authorized roles can add vendors
    vendorBodyValidation,
    vendorController.addVendor
);

// PUT /api/vendors/:id - Update vendor details
router.put(
    "/:id",
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'), // Only authorized roles can update vendors
    vendorIdParamValidation,
    vendorBodyValidation, // Use the same validation for update, making fields optional where needed
    vendorController.updateVendor
);

// DELETE /api/vendors/:id - Delete a vendor
router.delete(
    "/:id",
    protect,
    authorizeRoles('admin', 'landlord', 'propertymanager'), // Only authorized roles can delete vendors
    vendorIdParamValidation,
    vendorController.deleteVendor
);

module.exports = router;
