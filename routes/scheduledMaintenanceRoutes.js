// backend/routes/scheduledMaintenanceRoutes.js

const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const scheduledMaintenanceController = require('../controllers/scheduledMaintenanceController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Assuming this is the correct path
const { uploadCloudinary } = require('../utils/fileUpload'); // Assuming path to your file upload utility

// A helper middleware to handle validation errors from express-validator
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// Reusable validation for ID parameters
const idParamValidation = [
    param('id').isMongoId().withMessage('Invalid ID format.'),
];

// Reusable validation for public token parameters
const publicTokenParamValidation = [
    param('publicToken').isUUID(4).withMessage('Invalid public token format.'),
];


// Validation chain for creating a new scheduled maintenance task
const createScheduledMaintenanceValidation = [
    body('title').notEmpty().withMessage('Title is required.').trim().escape(),
    body('description').notEmpty().withMessage('Description is required.').isLength({ max: 5000 }).trim().escape(),
    body('category').notEmpty().withMessage('Category is required.').isIn(['general', 'plumbing', 'electrical', 'hvac', 'inspection', 'landscaping', 'other']).withMessage('Invalid category.'),
    body('property').isMongoId().withMessage('A valid property ID is required.'),
    body('unit').optional().isMongoId().withMessage('A valid unit ID is required.'),
    body('scheduledDate').isISO8601().toDate().withMessage('A valid scheduled date is required.'),
    body('recurring').isBoolean().withMessage('Recurring must be a boolean value.'),
    // Conditional validation for frequency object if recurring is true
    body('frequency.type').if(body('recurring').equals('true')).isIn(['daily', 'weekly', 'monthly', 'yearly', 'custom_days']).withMessage('Invalid frequency type.'),
    body('frequency.interval').if(body('recurring').equals('true')).isInt({ min: 1 }).withMessage('Frequency interval must be a positive integer.'),
    body('assignedToId').optional().isMongoId().withMessage('Invalid assigned user or vendor ID.'),
    body('assignedToModel').optional().isIn(['User', 'Vendor']).withMessage('assignedToModel must be either "User" or "Vendor".'),
];

// Validation chain for updating a scheduled maintenance task
const updateScheduledMaintenanceValidation = [
    body('title').optional().trim().escape(),
    body('description').optional().isLength({ max: 5000 }).trim().escape(),
    body('category').optional().isIn(['general', 'plumbing', 'electrical', 'hvac', 'inspection', 'landscaping', 'other']).withMessage('Invalid category.'),
    body('scheduledDate').optional().isISO8601().toDate().withMessage('Invalid scheduled date format.'),
    body('recurring').optional().isBoolean(),
    body('frequency.type').optional().if(body('recurring').equals('true')).isIn(['daily', 'weekly', 'monthly', 'yearly', 'custom_days']),
    body('frequency.interval').optional().if(body('recurring').equals('true')).isInt({ min: 1 }),
    body('assignedToId').optional({ nullable: true }).isMongoId(),
    body('assignedToModel').optional({ nullable: true }).isIn(['User', 'Vendor']),
    body('status').optional().isIn(['scheduled', 'in_progress', 'completed', 'cancelled', 'on_hold']).withMessage('Invalid status value.'),
];

// Validation for enabling a public link
const enablePublicLinkValidation = [
    body('expiresInDays').optional().isInt({ min: 1, max: 365 }).withMessage('Expiration must be between 1 and 365 days.'),
];

// Validation for public update
const publicUpdateValidation = [
    body('name').notEmpty().withMessage('Name is required for accountability.').trim().escape(),
    body('phone').notEmpty().withMessage('Phone number is required for accountability.').trim().escape(),
    body('status').optional().isIn(['in_progress', 'completed']).withMessage('Invalid status update.'),
    body('commentMessage').optional().trim().escape(),
];

// --- ROUTES ---

// Create and Get All Scheduled Maintenance Tasks
router.route('/')
    .post(
        protect,
        authorizeRoles('admin', 'propertymanager', 'landlord'),
        uploadCloudinary.array('media', 5), // Handles file uploads, max 5 files
        createScheduledMaintenanceValidation,
        handleValidationErrors,
        scheduledMaintenanceController.createScheduledMaintenance
    )
    .get(
        protect, // Authorization is handled inside the controller based on role
        scheduledMaintenanceController.getAllScheduledMaintenance
    );

// Public-facing routes for external vendors (no 'protect' middleware)
router.get('/public/:publicToken', publicTokenParamValidation, handleValidationErrors, scheduledMaintenanceController.getPublicScheduledMaintenanceView);
router.post('/public/:publicToken/update', publicTokenParamValidation, publicUpdateValidation, handleValidationErrors, scheduledMaintenanceController.publicScheduledMaintenanceUpdate);

// Routes for a specific scheduled maintenance task by ID
router.route('/:id')
    .get(
        protect, // Authorization is handled inside the controller
        idParamValidation,
        handleValidationErrors,
        scheduledMaintenanceController.getScheduledMaintenanceById
    )
    .put(
        protect,
        authorizeRoles('admin', 'propertymanager', 'landlord'),
        idParamValidation,
        updateScheduledMaintenanceValidation,
        handleValidationErrors,
        scheduledMaintenanceController.updateScheduledMaintenance
    )
    .delete(
        protect,
        authorizeRoles('admin', 'propertymanager', 'landlord'),
        idParamValidation,
        handleValidationErrors,
        scheduledMaintenanceController.deleteScheduledMaintenance
    );

// Routes for managing public links
router.post(
    '/:id/enable-public-link',
    protect,
    authorizeRoles('admin', 'propertymanager', 'landlord'),
    idParamValidation,
    enablePublicLinkValidation,
    handleValidationErrors,
    scheduledMaintenanceController.enableScheduledMaintenancePublicLink
);

router.post(
    '/:id/disable-public-link',
    protect,
    authorizeRoles('admin', 'propertymanager', 'landlord'),
    idParamValidation,
    handleValidationErrors,
    scheduledMaintenanceController.disableScheduledMaintenancePublicLink
);


module.exports = router;
