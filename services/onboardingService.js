// src/services/onboardingService.js

const Onboarding = require('../models/onboarding');
const User = require('../models/user');
const Property = require('../models/property');
const Unit = require('../models/unit');
const PropertyUser = require('../models/propertyUser');
const { createAuditLog } = require('./auditService');
const { uploadFile, deleteFile } = require('../lib/cloudinaryClient'); // Assuming cloudinaryClient for file operations
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    ONBOARDING_CATEGORY_ENUM, // Assuming this enum exists
    ONBOARDING_VISIBILITY_ENUM // Assuming this enum exists
} = require('../utils/constants/enums');

/**
 * Helper to check if a user has permission to manage (create/update/delete) onboarding documents.
 * This is typically for Landlords, Admins, or PMs with specific permissions.
 * @param {object} user - The authenticated user object.
 * @param {string} [propertyId] - Optional. The ID of the property the document is associated with.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkOnboardingManagementPermission = async (user, propertyId = null) => {
    if (user.role === ROLE_ENUM.ADMIN) {
        return true;
    }

    if (user.role === ROLE_ENUM.LANDLORD) {
        // Landlord can manage documents they own or for properties they own
        if (!propertyId) return true; // If no property specified, landlord can create global ones
        const ownsProperty = await Property.exists({ _id: propertyId, createdBy: user._id });
        return ownsProperty;
    }

    if (user.role === ROLE_ENUM.PROPERTY_MANAGER) {
        // PMs can manage onboarding for properties they manage AND have the 'manage_onboarding' permission
        if (!propertyId) return false; // PMs cannot create global onboarding without property
        const hasPermission = await PropertyUser.exists({
            user: user._id,
            property: propertyId,
            roles: PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
            permissions: 'manage_onboarding', // Assuming a 'permissions' array in PropertyUser
            isActive: true
        });
        return hasPermission;
    }

    return false;
};

/**
 * Helper to check if a user has permission to view/download an onboarding document.
 * This is based on the document's visibility and the user's roles/associations.
 * @param {object} user - The authenticated user object.
 * @param {object} document - The onboarding document object.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkOnboardingViewPermission = async (user, document) => {
    if (user.role === ROLE_ENUM.ADMIN) {
        return true;
    }

    // Landlord: can view documents they uploaded or for properties they own
    if (user.role === ROLE_ENUM.LANDLORD) {
        if (document.landlord && document.landlord.equals(user._id)) return true;
        if (document.property) {
            const ownsProperty = await Property.exists({ _id: document.property._id, createdBy: user._id });
            if (ownsProperty) return true;
        }
    }

    // Property Manager: can view documents they uploaded or for properties they manage
    if (user.role === ROLE_ENUM.PROPERTY_MANAGER && document.property) {
        const isManagerForProperty = await PropertyUser.exists({
            user: user._id,
            property: document.property._id,
            roles: PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
            isActive: true
        });
        if (isManagerForProperty) return true;
    }

    // Tenant: can view based on document visibility and their associations
    if (user.role === ROLE_ENUM.TENANT) {
        if (document.visibility === ONBOARDING_VISIBILITY_ENUM.find(v => v === 'all_tenants')) {
            return true;
        }
        if (document.visibility === ONBOARDING_VISIBILITY_ENUM.find(v => v === 'specific_tenant') && document.tenant && document.tenant.equals(user._id)) {
            return true;
        }
        if (document.visibility === ONBOARDING_VISIBILITY_ENUM.find(v => v === 'property_tenants') && document.property) {
            const isTenantForProperty = await PropertyUser.exists({
                user: user._id,
                property: document.property._id,
                roles: PROPERTY_USER_ROLES_ENUM.TENANT,
                isActive: true
            });
            if (isTenantForProperty) return true;
        }
        if (document.visibility === ONBOARDING_VISIBILITY_ENUM.find(v => v === 'unit_tenants') && document.unit) {
            const isTenantForUnit = await PropertyUser.exists({
                user: user._id,
                unit: document.unit._id,
                roles: PROPERTY_USER_ROLES_ENUM.TENANT,
                isActive: true
            });
            if (isTenantForUnit) return true;
        }
    }

    return false;
};


/**
 * Uploads and creates a new onboarding document.
 * @param {object} file - The file object from multer (req.file).
 * @param {object} documentData - Data for the new document (title, description, category, propertyId, unitId, tenantId, visibility).
 * @param {object} currentUser - The user uploading the document.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Onboarding>} The created onboarding document.
 * @throws {AppError} If validation fails, user not authorized, or file upload fails.
 */
const createOnboardingDocument = async (file, documentData, currentUser, ipAddress) => {
    const { title, description, category, propertyId, unitId, tenantId, visibility } = documentData;

    // Validate property, unit, tenant IDs if provided
    let targetProperty = null;
    let targetUnit = null;
    let targetTenant = null;

    if (propertyId) {
        targetProperty = await Property.findById(propertyId);
        if (!targetProperty) throw new AppError('Associated property not found.', 404);
    }
    if (unitId) {
        targetUnit = await Unit.findById(unitId);
        if (!targetUnit) throw new AppError('Associated unit not found.', 404);
        if (targetUnit.property && !targetUnit.property.equals(propertyId)) {
            throw new AppError('Unit does not belong to the specified property.', 400);
        }
    }
    if (tenantId) {
        targetTenant = await User.findById(tenantId);
        if (!targetTenant || targetTenant.role !== ROLE_ENUM.TENANT) throw new AppError('Associated tenant not found or is not a tenant.', 404);
    }

    // Authorization check for management permission
    const isAuthorized = await checkOnboardingManagementPermission(currentUser, propertyId);
    if (!isAuthorized) {
        throw new AppError('Not authorized to upload onboarding documents for this context.', 403);
    }

    // Ensure visibility aligns with provided IDs
    if (visibility === ONBOARDING_VISIBILITY_ENUM.find(v => v === 'property_tenants') && !propertyId) {
        throw new AppError('Property ID is required for "property_tenants" visibility.', 400);
    }
    if (visibility === ONBOARDING_VISIBILITY_ENUM.find(v => v === 'unit_tenants') && (!propertyId || !unitId)) {
        throw new AppError('Property ID and Unit ID are required for "unit_tenants" visibility.', 400);
    }
    if (visibility === ONBOARDING_VISIBILITY_ENUM.find(v => v === 'specific_tenant') && !tenantId) {
        throw new AppError('Tenant ID is required for "specific_tenant" visibility.', 400);
    }

    // Upload file to Cloudinary
    const uploadResult = await uploadFile(file.path, 'onboarding_documents'); // 'onboarding_documents' is the folder
    if (!uploadResult || !uploadResult.url) {
        throw new AppError('Failed to upload file to cloud storage.', 500);
    }

    const newOnboardingDoc = new Onboarding({
        landlord: currentUser.role === ROLE_ENUM.LANDLORD ? currentUser._id : (targetProperty ? targetProperty.createdBy : null), // Link to actual landlord or property creator
        property: propertyId || null,
        unit: unitId || null,
        tenant: tenantId || null,
        title,
        description,
        category: category.toLowerCase(),
        fileName: file.originalname, // Use original filename
        filePath: uploadResult.url, // Store Cloudinary URL
        visibility: visibility.toLowerCase(),
        uploadedBy: currentUser._id // Track who uploaded it
    });

    const createdDocument = await newOnboardingDoc.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
        resourceId: createdDocument._id,
        newValue: createdDocument.toObject(),
        ipAddress: ipAddress,
        description: `Onboarding document "${title}" uploaded by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`OnboardingService: Onboarding document "${title}" created by ${currentUser.email}.`);
    return createdDocument;
};

/**
 * Gets all onboarding documents accessible by the logged-in user with filtering and pagination.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Query filters (category, propertyId, unitId, page, limit).
 * @returns {Promise<object>} Object containing documents array, total count, page, and limit.
 * @throws {AppError} If user not authorized or filter values are invalid.
 */
const getOnboardingDocuments = async (currentUser, filters) => {
    let query = {};
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 10;
    const skip = (page - 1) * limit;

    // Base query for user's accessible documents
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin can see all
    } else if (currentUser.role === ROLE_ENUM.LANDLORD) {
        const ownedProperties = await Property.find({ createdBy: currentUser._id }).distinct('_id');
        query.$or = [
            { uploadedBy: currentUser._id }, // Documents they uploaded
            { property: { $in: ownedProperties }, visibility: { $in: [ONBOARDING_VISIBILITY_ENUM.find(v => v === 'property_tenants'), ONBOARDING_VISIBILITY_ENUM.find(v => v === 'unit_tenants'), ONBOARDING_VISIBILITY_ENUM.find(v => v === 'all_tenants')] } },
            { tenant: currentUser._id, visibility: ONBOARDING_VISIBILITY_ENUM.find(v => v === 'specific_tenant') }
        ];
    } else if (currentUser.role === ROLE_ENUM.PROPERTY_MANAGER) {
        const managedProperties = await PropertyUser.find({
            user: currentUser._id,
            roles: PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
            isActive: true
        }).distinct('property');

        query.$or = [
            { uploadedBy: currentUser._id }, // Documents they uploaded
            { property: { $in: managedProperties }, visibility: { $in: [ONBOARDING_VISIBILITY_ENUM.find(v => v === 'property_tenants'), ONBOARDING_VISIBILITY_ENUM.find(v => v === 'unit_tenants'), ONBOARDING_VISIBILITY_ENUM.find(v => v === 'all_tenants')] } },
            { tenant: currentUser._id, visibility: ONBOARDING_VISIBILITY_ENUM.find(v => v === 'specific_tenant') }
        ];
    } else if (currentUser.role === ROLE_ENUM.TENANT) {
        const tenantAssociations = await PropertyUser.find({
            user: currentUser._id,
            roles: PROPERTY_USER_ROLES_ENUM.TENANT,
            isActive: true
        }).populate('property').populate('unit'); // Populate to get property/unit IDs

        const accessibleProperties = tenantAssociations.map(assoc => assoc.property?._id).filter(Boolean);
        const accessibleUnits = tenantAssociations.map(assoc => assoc.unit?._id).filter(Boolean);

        query.$or = [
            { visibility: ONBOARDING_VISIBILITY_ENUM.find(v => v === 'all_tenants') }, // Global documents
            { visibility: ONBOARDING_VISIBILITY_ENUM.find(v => v === 'property_tenants'), property: { $in: accessibleProperties } }, // Property-specific
            { visibility: ONBOARDING_VISIBILITY_ENUM.find(v => v === 'unit_tenants'), unit: { $in: accessibleUnits } }, // Unit-specific
            { visibility: ONBOARDING_VISIBILITY_ENUM.find(v => v === 'specific_tenant'), tenant: currentUser._id }, // Tenant-specific
        ];
    } else {
        throw new AppError('Not authorized to view onboarding documents.', 403);
    }

    // Apply additional filters
    if (filters.category) {
        if (!ONBOARDING_CATEGORY_ENUM.includes(filters.category.toLowerCase())) {
            throw new AppError(`Invalid category filter: ${filters.category}`, 400);
        }
        query.category = filters.category.toLowerCase();
    }
    if (filters.propertyId) {
        // Ensure user has access to this property if filtering by it
        const hasPropertyAccess = await PropertyUser.exists({ user: currentUser._id, property: filters.propertyId, isActive: true });
        if (!hasPropertyAccess && currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Not authorized to filter documents by this property.', 403);
        }
        query.property = filters.propertyId;
    }
    if (filters.unitId) {
        const unit = await Unit.findById(filters.unitId);
        if (!unit) throw new AppError('Unit not found for filter.', 404);
        // Ensure user has access to this unit's property if filtering by it
        const hasUnitPropertyAccess = await PropertyUser.exists({ user: currentUser._id, property: unit.property._id, isActive: true });
        if (!hasUnitPropertyAccess && currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Not authorized to filter documents by this unit.', 403);
        }
        query.unit = filters.unitId;
    }

    const documents = await Onboarding.find(query)
        .populate('landlord', 'firstName lastName email')
        .populate('property', 'name') // Use 'name' for property
        .populate('unit', 'unitName') // Use 'unitName' for unit
        .populate('tenant', 'firstName lastName email')
        .populate('uploadedBy', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    const total = await Onboarding.countDocuments(query);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ_ALL,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched onboarding documents.`,
        status: 'success',
        metadata: { filters }
    });

    return { documents, total, page, limit };
};

/**
 * Gets a single onboarding document by ID.
 * @param {string} documentId - The ID of the document.
 * @param {object} currentUser - The authenticated user.
 * @returns {Promise<Onboarding>} The onboarding document.
 * @throws {AppError} If document not found or user not authorized.
 */
const getOnboardingDocumentById = async (documentId, currentUser) => {
    const document = await Onboarding.findById(documentId)
        .populate('landlord', 'firstName lastName email')
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('tenant', 'firstName lastName email')
        .populate('uploadedBy', 'firstName lastName email');

    if (!document) {
        throw new AppError('Onboarding document not found.', 404);
    }

    // Authorization check
    const isAuthorized = await checkOnboardingViewPermission(currentUser, document);
    if (!isAuthorized) {
        throw new AppError('Not authorized to view this onboarding document.', 403);
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
        resourceId: document._id,
        ipAddress: currentUser.ip,
        description: `User ${currentUser.email} fetched onboarding document "${document.title}".`,
        status: 'success'
    });

    return document;
};

/**
 * Updates an onboarding document.
 * @param {string} documentId - The ID of the document to update.
 * @param {object} updateData - Data to update the document with.
 * @param {object} currentUser - The user performing the update.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Onboarding>} The updated onboarding document.
 * @throws {AppError} If document not found, user not authorized, or validation fails.
 */
const updateOnboardingDocument = async (documentId, updateData, currentUser, ipAddress) => {
    let document = await Onboarding.findById(documentId);
    if (!document) {
        throw new AppError('Onboarding document not found.', 404);
    }

    // Authorization check for management permission
    const isAuthorized = await checkOnboardingManagementPermission(currentUser, document.property?._id);
    if (!isAuthorized) {
        throw new AppError('Not authorized to update this onboarding document.', 403);
    }

    const oldDocument = document.toObject(); // Capture old state for audit log

    // Handle file replacement if a new file is uploaded (requires separate upload flow)
    // This service assumes the file is already uploaded and its URL is in updateData.filePath
    // If you want to allow file replacement via this endpoint, you'd need to handle old file deletion.
    // For now, we're assuming file updates are handled by a separate endpoint or process.

    // Apply updates
    Object.assign(document, updateData);
    const updatedDocument = await document.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
        resourceId: updatedDocument._id,
        oldValue: oldDocument,
        newValue: updatedDocument.toObject(),
        ipAddress: ipAddress,
        description: `Onboarding document "${updatedDocument.title}" updated by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`OnboardingService: Onboarding document "${updatedDocument.title}" updated by ${currentUser.email}.`);
    return updatedDocument;
};

/**
 * Deletes an onboarding document and its associated file from cloud storage.
 * @param {string} documentId - The ID of the document to delete.
 * @param {object} currentUser - The user performing the deletion.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If document not found or user not authorized.
 */
const deleteOnboardingDocument = async (documentId, currentUser, ipAddress) => {
    const document = await Onboarding.findById(documentId);
    if (!document) {
        throw new AppError('Onboarding document not found.', 404);
    }

    // Authorization check for management permission
    const isAuthorized = await checkOnboardingManagementPermission(currentUser, document.property?._id);
    if (!isAuthorized) {
        throw new AppError('Not authorized to delete this onboarding document.', 403);
    }

    const oldDocument = document.toObject(); // Capture old state for audit log

    // Delete file from Cloudinary using its public ID
    try {
        const publicIdMatch = document.filePath.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
        if (publicIdMatch && publicIdMatch[1]) {
            const publicId = publicIdMatch[1];
            await deleteFile(publicId);
            logger.info(`OnboardingService: Deleted file ${publicId} from Cloudinary for onboarding document ${documentId}.`);
        } else {
            logger.warn(`OnboardingService: Could not extract public ID from URL: ${document.filePath}`);
        }
    } catch (error) {
        logger.error(`OnboardingService: Failed to delete file from Cloudinary for document ${documentId}: ${error.message}`);
        // Log the error but don't prevent the document from being deleted from DB if file deletion fails
    }

    await document.deleteOne();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
        resourceId: documentId,
        oldValue: oldDocument,
        newValue: null,
        ipAddress: ipAddress,
        description: `Onboarding document "${oldDocument.title}" deleted by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`OnboardingService: Onboarding document "${oldDocument.title}" deleted by ${currentUser.email}.`);
};

/**
 * Marks an onboarding document as completed by a tenant.
 * @param {string} documentId - The ID of the document to mark as completed.
 * @param {object} currentUser - The tenant user marking it completed.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Onboarding>} The updated onboarding document.
 * @throws {AppError} If document not found, user not authorized, or already completed.
 */
const markOnboardingCompleted = async (documentId, currentUser, ipAddress) => {
    const document = await Onboarding.findById(documentId);
    if (!document) {
        throw new AppError('Onboarding document not found.', 404);
    }

    // Authorization: Only a tenant who can view the document can mark it complete
    const isAuthorized = await checkOnboardingViewPermission(currentUser, document);
    if (!isAuthorized || currentUser.role !== ROLE_ENUM.TENANT) {
        throw new AppError('Not authorized to mark this document as completed.', 403);
    }

    if (document.isCompleted) {
        return document; // Already completed, return current state
    }

    const oldCompletedState = {
        isCompleted: document.isCompleted,
        completedAt: document.completedAt,
        completedBy: document.completedBy
    };

    document.isCompleted = true;
    document.completedAt = new Date();
    document.completedBy = currentUser._id;
    const updatedDocument = await document.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
        resourceId: updatedDocument._id,
        oldValue: oldCompletedState,
        newValue: {
            isCompleted: updatedDocument.isCompleted,
            completedAt: updatedDocument.completedAt,
            completedBy: updatedDocument.completedBy
        },
        ipAddress: ipAddress,
        description: `Onboarding document "${updatedDocument.title}" marked as completed by tenant ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`OnboardingService: Onboarding document "${updatedDocument.title}" marked as completed by ${currentUser.email}.`);
    return updatedDocument;
};

/**
 * Provides a download URL for an onboarding document.
 * @param {string} documentId - The ID of the document.
 * @param {object} currentUser - The authenticated user.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<object>} Object containing downloadUrl and fileName.
 * @throws {AppError} If document not found or user not authorized.
 */
const getOnboardingDocumentDownloadUrl = async (documentId, currentUser, ipAddress) => {
    const document = await Onboarding.findById(documentId);
    if (!document) {
        throw new AppError('Onboarding document not found.', 404);
    }

    // Authorization check
    const isAuthorized = await checkOnboardingViewPermission(currentUser, document);
    if (!isAuthorized) {
        throw new AppError('Not authorized to download this onboarding document.', 403);
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.FILE_DOWNLOAD,
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
        resourceId: document._id,
        metadata: { documentFileName: document.fileName, filePath: document.filePath },
        ipAddress: ipAddress,
        description: `Onboarding document "${document.fileName}" downloaded by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`OnboardingService: Onboarding document "${document.fileName}" download requested by ${currentUser.email}.`);
    return { downloadUrl: document.filePath, fileName: document.fileName }; // Return the Cloudinary URL
};


module.exports = {
    createOnboardingDocument,
    getOnboardingDocuments,
    getOnboardingDocumentById,
    updateOnboardingDocument,
    deleteOnboardingDocument,
    markOnboardingCompleted,
    getOnboardingDocumentDownloadUrl,
};
