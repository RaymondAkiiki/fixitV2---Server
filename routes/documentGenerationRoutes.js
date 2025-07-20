// src/routes/documentGenerationRoutes.js

const express = require('express');
const router = express.Router();
const documentGenerationController = require('../controllers/documentGenerationController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { validateResult } = require('../utils/validationUtils');
const { ROLE_ENUM, DOCUMENT_TYPE_ENUM } = require('../utils/constants/enums');
const { body } = require('express-validator');

/**
 * @route GET /api/documents/templates
 * @desc Get all available document templates
 * @access Private (Admin, Landlord, PropertyManager)
 */
router.get(
    '/templates',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    documentGenerationController.getTemplates
);

/**
 * @route POST /api/documents/generate
 * @desc Generate and upload a document
 * @access Private (Admin, Landlord, PropertyManager)
 */
router.post(
    '/generate',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    [
        body('documentType')
            .notEmpty().withMessage('Document type is required.')
            .isString().withMessage('Document type must be a string.')
            .custom(value => {
                if (!DOCUMENT_TYPE_ENUM.includes(value)) {
                    throw new Error(`Invalid document type. Must be one of: ${DOCUMENT_TYPE_ENUM.join(', ')}`);
                }
                return true;
            }),
        body('data')
            .notEmpty().withMessage('Document data is required.')
            .isObject().withMessage('Document data must be an object.'),
        body('options')
            .optional()
            .isObject().withMessage('Options must be an object.'),
        body('options.relatedResourceId')
            .optional()
            .isMongoId().withMessage('Related resource ID must be a valid MongoDB ID.'),
        body('options.relatedResourceType')
            .optional()
            .isString().withMessage('Related resource type must be a string.'),
        validateResult
    ],
    documentGenerationController.generateDocument
);

/**
 * @route POST /api/documents/preview
 * @desc Generate a preview document (returns base64 data instead of uploading)
 * @access Private (Admin, Landlord, PropertyManager)
 */
router.post(
    '/preview',
    protect,
    authorizeRoles(ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER),
    [
        body('documentType')
            .notEmpty().withMessage('Document type is required.')
            .isString().withMessage('Document type must be a string.')
            .custom(value => {
                if (!DOCUMENT_TYPE_ENUM.includes(value)) {
                    throw new Error(`Invalid document type. Must be one of: ${DOCUMENT_TYPE_ENUM.join(', ')}`);
                }
                return true;
            }),
        body('data')
            .notEmpty().withMessage('Document data is required.')
            .isObject().withMessage('Document data must be an object.'),
        validateResult
    ],
    documentGenerationController.previewDocument
);

module.exports = router;