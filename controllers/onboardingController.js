// src/controllers/onboardingController.js

const asyncHandler = require('../utils/asyncHandler');
const onboardingService = require('../services/onboardingService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Create a new onboarding document
 * @route POST /api/onboarding
 * @access Private (Landlord/Admin, PropertyManager)
 */
const createOnboardingDocument = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new AppError('No file uploaded.', 400);
    }

    const documentData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const newDocument = await onboardingService.createOnboardingDocument(
        req.file, 
        documentData, 
        currentUser, 
        ipAddress
    );

    res.status(201).json({
        success: true,
        message: 'Onboarding document created successfully.',
        data: newDocument
    });
});

/**
 * @desc Get all onboarding documents accessible by the logged-in user
 * @route GET /api/onboarding
 * @access Private (with access control)
 */
const getOnboardingDocuments = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const result = await onboardingService.getOnboardingDocuments(currentUser, filters, page, limit);

    res.status(200).json({
        success: true,
        count: result.documents.length,
        total: result.total,
        page: result.page,
        limit: result.limit,
        data: result.documents
    });
});

/**
 * @desc Get a single onboarding document by ID
 * @route GET /api/onboarding/:id
 * @access Private (Accessible if user is authorized)
 */
const getOnboardingDocumentById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;

    const document = await onboardingService.getOnboardingDocumentById(id, currentUser);

    res.status(200).json({
        success: true,
        data: document
    });
});

/**
 * @desc Update an onboarding document
 * @route PUT /api/onboarding/:id
 * @access Private (Landlord/Admin, PropertyManager)
 */
const updateOnboardingDocument = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedDocument = await onboardingService.updateOnboardingDocument(
        id, 
        updateData, 
        currentUser, 
        ipAddress
    );

    res.status(200).json({
        success: true,
        message: 'Onboarding document updated successfully.',
        data: updatedDocument
    });
});

/**
 * @desc Delete an onboarding document
 * @route DELETE /api/onboarding/:id
 * @access Private (Landlord/Admin, PropertyManager)
 */
const deleteOnboardingDocument = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    await onboardingService.deleteOnboardingDocument(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Onboarding document deleted successfully.'
    });
});

/**
 * @desc Mark an onboarding document as completed by a tenant
 * @route PATCH /api/onboarding/:id/complete
 * @access Private (Tenant only)
 */
const markOnboardingCompleted = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedDocument = await onboardingService.markOnboardingCompleted(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Document marked as completed successfully.',
        data: updatedDocument
    });
});

/**
 * @desc Get download info for an onboarding document
 * @route GET /api/onboarding/:id/download
 * @access Private (Accessible if user is authorized to view)
 */
const getOnboardingDocumentDownloadUrl = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const { downloadUrl, fileName, mimeType } = await onboardingService.getOnboardingDocumentDownloadUrl(
        id, 
        currentUser, 
        ipAddress
    );

    res.status(200).json({
        success: true,
        message: 'Download URL generated successfully.',
        downloadUrl,
        fileName,
        mimeType
    });
});

module.exports = {
    createOnboardingDocument,
    getOnboardingDocuments,
    getOnboardingDocumentById,
    updateOnboardingDocument,
    deleteOnboardingDocument,
    markOnboardingCompleted,
    getOnboardingDocumentDownloadUrl
};