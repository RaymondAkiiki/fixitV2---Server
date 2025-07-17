// src/controllers/documentGenerationController.js

const asyncHandler = require('../utils/asyncHandler');
const documentGenerationService = require('../services/documentGenerationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Generate and upload a document
 * @route POST /api/documents/generate
 * @access Private (Admin, Landlord, PropertyManager - specific permissions can be added)
 * @body {string} documentType - The type of document to generate (e.g., 'lease_notice', 'rent_receipt', 'maintenance_report')
 * @body {object} data - The data required to populate the document (e.g., { tenantName, propertyName, unitName, leaseEndDate })
 * @body {object} [options] - Additional options for document generation (e.g., relatedResourceId, relatedResourceType, customText)
 */
const generateDocument = asyncHandler(async (req, res) => {
    const { documentType, data, options } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    // Merge current user and IP into options for the service
    const serviceOptions = {
        ...options,
        userId: currentUser._id,
        ipAddress: ipAddress,
    };

    const mediaDoc = await documentGenerationService.generateAndUploadDocument(documentType, data, serviceOptions);

    res.status(200).json({
        success: true,
        message: 'Document generated and uploaded successfully.',
        data: mediaDoc // Returns the created Media document
    });
});

module.exports = {
    generateDocument,
};
