// src/routes/onboardingRoutes.js

const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/onboardingController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadMiddleware');
const { validateMongoId, validateResult } = require('../utils/validationUtils');
const { ROLE_ENUM, ONBOARDING_CATEGORY_ENUM, ONBOARDING_VISIBILITY_ENUM } = require('../utils/constants/enums');
const { body, query, param } = require('express-validator');

/**
 * @route POST /api/onboarding
 * @desc Create a new onboarding document
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.post(
    '/',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    upload.single('documentFile'),
    [
        body('title')
            .notEmpty().withMessage('Title is required.')
            .trim()
            .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters.'),
            
        body('description')
            .optional()
            .isString().withMessage('Description must be a string.')
            .trim()
            .isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters.'),
            
        body('category')
            .notEmpty().withMessage('Category is required.')
            .isIn(ONBOARDING_CATEGORY_ENUM).withMessage(`Invalid category. Must be one of: ${ONBOARDING_CATEGORY_ENUM.join(', ')}`),
            
        body('visibility')
            .notEmpty().withMessage('Visibility is required.')
            .isIn(ONBOARDING_VISIBILITY_ENUM).withMessage(`Invalid visibility. Must be one of: ${ONBOARDING_VISIBILITY_ENUM.join(', ')}`),
            
        body('propertyId')
            .optional()
            .isMongoId().withMessage('Property ID must be a valid MongoDB ID.'),
            
        body('unitId')
            .optional()
            .isMongoId().withMessage('Unit ID must be a valid MongoDB ID.'),
            
        body('tenantId')
            .optional()
            .isMongoId().withMessage('Tenant ID must be a valid MongoDB ID.'),
            
        validateResult
    ],
    onboardingController.createOnboardingDocument
);

/**
 * @route GET /api/onboarding
 * @desc Get all onboarding documents accessible by the logged-in user
 * @access Private (with access control)
 */
router.get(
    '/',
    protect,
    [
        query('category')
            .optional()
            .isIn(ONBOARDING_CATEGORY_ENUM).withMessage(`Invalid category filter. Must be one of: ${ONBOARDING_CATEGORY_ENUM.join(', ')}`),
            
        query('propertyId')
            .optional()
            .isMongoId().withMessage('Property ID filter must be a valid MongoDB ID.'),
            
        query('unitId')
            .optional()
            .isMongoId().withMessage('Unit ID filter must be a valid MongoDB ID.'),
            
        query('page')
            .optional()
            .isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
            
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
            
        validateResult
    ],
    onboardingController.getOnboardingDocuments
);

/**
 * @route GET /api/onboarding/:id
 * @desc Get a single onboarding document by ID
 * @access Private (Accessible if user is authorized)
 */
router.get(
    '/:id',
    protect,
    validateMongoId('id'),
    onboardingController.getOnboardingDocumentById
);

/**
 * @route PUT /api/onboarding/:id
 * @desc Update an onboarding document
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.put(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    [
        body('title')
            .optional()
            .isString().withMessage('Title must be a string.')
            .trim()
            .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters.'),
            
        body('description')
            .optional()
            .isString().withMessage('Description must be a string.')
            .trim()
            .isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters.'),
            
        body('category')
            .optional()
            .isIn(ONBOARDING_CATEGORY_ENUM).withMessage(`Invalid category. Must be one of: ${ONBOARDING_CATEGORY_ENUM.join(', ')}`),
            
        body('visibility')
            .optional()
            .isIn(ONBOARDING_VISIBILITY_ENUM).withMessage(`Invalid visibility. Must be one of: ${ONBOARDING_VISIBILITY_ENUM.join(', ')}`),
            
        body('propertyId')
            .optional()
            .isMongoId().withMessage('Property ID must be a valid MongoDB ID.'),
            
        body('unitId')
            .optional()
            .isMongoId().withMessage('Unit ID must be a valid MongoDB ID.'),
            
        body('tenantId')
            .optional()
            .isMongoId().withMessage('Tenant ID must be a valid MongoDB ID.'),
            
        validateResult
    ],
    onboardingController.updateOnboardingDocument
);

/**
 * @route DELETE /api/onboarding/:id
 * @desc Delete an onboarding document
 * @access Private (Landlord/Admin, PropertyManager)
 */
router.delete(
    '/:id',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    validateMongoId('id'),
    onboardingController.deleteOnboardingDocument
);

/**
 * @route PATCH /api/onboarding/:id/complete
 * @desc Mark an onboarding document as completed by a tenant
 * @access Private (Tenant only)
 */
router.patch(
    '/:id/complete',
    protect,
    authorizeRoles(ROLE_ENUM.TENANT),
    validateMongoId('id'),
    onboardingController.markOnboardingCompleted
);

/**
 * @route GET /api/onboarding/:id/download
 * @desc Get download URL for an onboarding document
 * @access Private (Accessible if user is authorized to view)
 */
router.get(
    '/:id/download',
    protect,
    validateMongoId('id'),
    onboardingController.getOnboardingDocumentDownloadUrl
);

module.exports = router;