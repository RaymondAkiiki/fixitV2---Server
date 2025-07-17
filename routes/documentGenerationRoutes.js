// src/routes/documentGenerationRoutes.js

const express = require('express');
const router = express.Router();
const documentGenerationController = require('../controllers/documentGenerationController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { validateResult } = require('../utils/validationUtils');
const { ROLE_ENUM, DOCUMENT_TYPE_ENUM } = require('../utils/constants/enums');
const { body } = require('express-validator');

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
        body('documentType').notEmpty().withMessage('Document type is required.')
            .isIn(DOCUMENT_TYPE_ENUM).withMessage(`Invalid document type. Must be one of: ${DOCUMENT_TYPE_ENUM.join(', ')}`),
        body('data').notEmpty().withMessage('Document data is required.').isObject().withMessage('Document data must be an object.'),
        body('options').optional().isObject().withMessage('Options must be an object.'),
        body('options.relatedResourceId').optional().isMongoId().withMessage('Related resource ID must be a valid MongoDB ID.'),
        body('options.relatedResourceType').optional().isString().withMessage('Related resource type must be a string.'),
        // Add more specific data validation based on documentType if needed
        // For example, if documentType is 'lease_notice', ensure data.tenantName, data.leaseEndDate are present
        body('data.tenantName').if(body('documentType').equals(DOCUMENT_TYPE_ENUM.find(dt => dt === 'lease_notice'))).notEmpty().withMessage('Tenant name is required for lease notice.'),
        body('data.leaseEndDate').if(body('documentType').equals(DOCUMENT_TYPE_ENUM.find(dt => dt === 'lease_notice'))).isISO8601().toDate().withMessage('Valid lease end date is required for lease notice.'),
        body('data.reportTitle').if(body('documentType').equals(DOCUMENT_TYPE_ENUM.find(dt => dt === 'maintenance_report'))).notEmpty().withMessage('Report title is required for maintenance report.'),
        body('data.rentEntries').if(body('documentType').equals(DOCUMENT_TYPE_ENUM.find(dt => dt === 'rent_report'))).isArray({ min: 1 }).withMessage('Rent entries are required for rent report.'),
        validateResult
    ],
    documentGenerationController.generateDocument
);

module.exports = router;
