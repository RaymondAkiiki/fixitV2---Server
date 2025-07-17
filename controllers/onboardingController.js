// src/controllers/onboardingController.js

const asyncHandler = require('../utils/asyncHandler');
const onboardingService = require('../services/onboardingService'); // Import the new onboarding service
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc Upload and create a new onboarding document
 * @route POST /api/onboarding
 * @access Private (Landlord/Admin, or PM with 'manage_onboarding' permission)
 * @body {string} title - Title of the document
 * @body {string} [description] - Description of the document
 * @body {string} category - Category of the document (e.g., 'SOP', 'Training')
 * @body {string} visibility - Visibility setting ('all_tenants', 'property_tenants', 'unit_tenants', 'specific_tenant')
 * @body {string} [propertyId] - Optional. Required for 'property_tenants' or 'unit_tenants' visibility.
 * @body {string} [unitId] - Optional. Required for 'unit_tenants' visibility.
 * @body {string} [tenantId] - Optional. Required for 'specific_tenant' visibility.
 * @file file - The actual file to upload (handled by upload middleware)
 */
const createOnboardingDocument = asyncHandler(async (req, res) => {
    // req.file is populated by upload middleware (e.g., uploadSingleDocument)
    if (!req.file) {
        throw new AppError('No file uploaded.', 400);
    }

    const documentData = req.body; // Contains title, description, category, propertyId, unitId, tenantId, visibility
    const currentUser = req.user;
    const ipAddress = req.ip;

    const newDocument = await onboardingService.createOnboardingDocument(req.file, documentData, currentUser, ipAddress);

    res.status(201).json({
        success: true,
        message: 'Onboarding document uploaded successfully.',
        data: newDocument
    });
});

/**
 * @desc Get all onboarding documents accessible by the logged-in user
 * @route GET /api/onboarding
 * @access Private
 * @query {string} [category] - Filter by category
 * @query {string} [propertyId] - Filter by property ID
 * @query {string} [unitId] - Filter by unit ID
 * @query {number} [page=1] - Page number
 * @query {number} [limit=10] - Items per page
 */
const getOnboardingDocuments = asyncHandler(async (req, res) => {
    const currentUser = req.user;
    const filters = req.query;

    const { documents, total, page, limit } = await onboardingService.getOnboardingDocuments(currentUser, filters);

    res.status(200).json({
        success: true,
        count: documents.length,
        total,
        page,
        limit,
        data: documents
    });
});

/**
 * @desc Get a single onboarding document by ID
 * @route GET /api/onboarding/:id
 * @access Private (Accessible if user is authorized)
 * @param {string} id - Document ID from URL params
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
 * @access Private (Landlord/Admin, or PM with 'manage_onboarding' permission)
 * @param {string} id - Document ID from URL params
 * @body {string} [title] - New title
 * @body {string} [description] - New description
 * @body {string} [category] - New category
 * @body {string} [visibility] - New visibility setting
 * @body {string} [propertyId] - New property ID
 * @body {string} [unitId] - New unit ID
 * @body {string} [tenantId] - New tenant ID
 * // Note: File updates are typically handled via a separate upload endpoint
 */
const updateOnboardingDocument = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedDocument = await onboardingService.updateOnboardingDocument(id, updateData, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: 'Onboarding document updated successfully.',
        data: updatedDocument
    });
});

/**
 * @desc Delete an onboarding document
 * @route DELETE /api/onboarding/:id
 * @access Private (Landlord/Admin, or PM with 'manage_onboarding' permission)
 * @param {string} id - Document ID from URL params
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
 * @param {string} id - Document ID from URL params
 */
const markOnboardingCompleted = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const updatedDocument = await onboardingService.markOnboardingCompleted(id, currentUser, ipAddress);

    res.status(200).json({
        success: true,
        message: updatedDocument.isCompleted ? 'Document marked as completed successfully.' : 'Document is already marked as completed.',
        data: updatedDocument
    });
});

/**
 * @desc Get download URL for an onboarding document
 * @route GET /api/onboarding/:id/download
 * @access Private (Accessible if user is authorized to view)
 * @param {string} id - Document ID from URL params
 */
const getOnboardingDocumentDownloadUrl = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user;
    const ipAddress = req.ip;

    const { downloadUrl, fileName } = await onboardingService.getOnboardingDocumentDownloadUrl(id, currentUser, ipAddress);

    // In a real application, you might redirect or set headers for file download
    // For now, we return the URL for the frontend to handle.
    res.status(200).json({
        success: true,
        message: 'Download URL generated.',
        downloadUrl,
        fileName
    });
});

module.exports = {
    createOnboardingDocument,
    getOnboardingDocuments,
    getOnboardingDocumentById,
    updateOnboardingDocument,
    deleteOnboardingDocument,
    markOnboardingCompleted,
    getOnboardingDocumentDownloadUrl,
};
