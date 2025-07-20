// src/controllers/documentGenerationController.js

const asyncHandler = require('../utils/asyncHandler');
const documentGenerationService = require('../services/documentGenerationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Generate and upload a document
 * @route POST /api/documents/generate
 * @access Private
 */
const generateDocument = asyncHandler(async (req, res) => {
    const { documentType, data, options = {} } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    // Validate input
    if (!documentType) {
        throw new AppError('Document type is required.', 400);
    }

    if (!data || typeof data !== 'object') {
        throw new AppError('Document data must be provided as an object.', 400);
    }

    // Enhance options with user context
    const enhancedOptions = {
        ...options,
        userId: currentUser._id,
        ipAddress,
        userName: `${currentUser.firstName} ${currentUser.lastName}`.trim()
    };

    logger.info(`DocumentGenerationController: Generating ${documentType} document for user ${currentUser._id}`);

    // Call the service to generate and upload the document
    const mediaDoc = await documentGenerationService.generateAndUploadDocument(
        documentType, 
        data, 
        enhancedOptions
    );

    // Return success response
    res.status(201).json({
        success: true,
        message: 'Document generated and uploaded successfully.',
        data: mediaDoc
    });
});

/**
 * @desc Get available document templates
 * @route GET /api/documents/templates
 * @access Private
 */
const getTemplates = asyncHandler(async (req, res) => {
    const templates = documentGenerationService.getDocumentTemplates();
    
    res.status(200).json({
        success: true,
        data: templates
    });
});

/**
 * @desc Generate a preview document (returns base64 data)
 * @route POST /api/documents/preview
 * @access Private
 */
const previewDocument = asyncHandler(async (req, res) => {
    // This would be implemented to generate a document and return it as base64
    // instead of uploading it to the cloud storage
    // For now, we'll just return a not implemented response
    res.status(501).json({
        success: false,
        message: 'Document preview functionality is not yet implemented.'
    });
});

module.exports = {
    generateDocument,
    getTemplates,
    previewDocument
};