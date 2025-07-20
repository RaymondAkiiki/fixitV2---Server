// src/services/onboardingService.js

const mongoose = require('mongoose');
const Onboarding = require('../models/onboarding');
const User = require('../models/user');
const Property = require('../models/property');
const Unit = require('../models/unit');
const PropertyUser = require('../models/propertyUser');
const Media = require('../models/media');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { uploadFile, deleteFile } = require('../utils/fileUpload');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM,
    ONBOARDING_CATEGORY_ENUM,
    ONBOARDING_VISIBILITY_ENUM
} = require('../utils/constants/enums');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Helper to check if a user has permission to manage onboarding documents
 * @param {Object} user - The authenticated user
 * @param {string} propertyId - Property ID
 * @returns {Promise<boolean>} True if authorized
 */
const checkOnboardingManagementPermission = async (user, propertyId = null) => {
    try {
        if (user.role === ROLE_ENUM.ADMIN) {
            return true; // Admin has global access
        }

        if (user.role === ROLE_ENUM.LANDLORD) {
            // Landlord can manage documents they own or for properties they own
            if (!propertyId) return true; // If no property specified, landlord can create global ones
            
            const ownsProperty = await Property.exists({ 
                _id: propertyId, 
                createdBy: user._id 
            });
            
            return !!ownsProperty;
        }

        if (user.role === ROLE_ENUM.PROPERTY_MANAGER) {
            // PMs can manage onboarding for properties they manage
            if (!propertyId) return false; // PMs cannot create global onboarding without property
            
            const hasAccess = await PropertyUser.exists({
                user: user._id,
                property: propertyId,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            });
            
            return !!hasAccess;
        }

        return false;
    } catch (error) {
        logger.error(`OnboardingService - Error checking management permission: ${error.message}`, {
            userId: user?._id,
            propertyId
        });
        return false; // Fail safely
    }
};

/**
 * Creates a new onboarding document
 * @param {Object} file - File object from multer
 * @param {Object} documentData - Document data
 * @param {string} documentData.title - Title
 * @param {string} [documentData.description] - Description
 * @param {string} documentData.category - Category
 * @param {string} documentData.visibility - Visibility setting
 * @param {string} [documentData.propertyId] - Property ID
 * @param {string} [documentData.unitId] - Unit ID
 * @param {string} [documentData.tenantId] - Tenant ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Created onboarding document
 * @throws {AppError} If validation fails
 */
const createOnboardingDocument = async (file, documentData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { 
            title, 
            description, 
            category, 
            visibility,
            propertyId,
            unitId,
            tenantId
        } = documentData;

        // Validate property, unit, tenant IDs if provided
        let property = null;
        let unit = null;
        let tenant = null;

        if (propertyId) {
            property = await Property.findById(propertyId).session(session);
            if (!property) {
                throw new AppError('Property not found.', 404);
            }
        }
        
        if (unitId) {
            unit = await Unit.findById(unitId).session(session);
            if (!unit) {
                throw new AppError('Unit not found.', 404);
            }
            
            if (property && !unit.property.equals(property._id)) {
                throw new AppError('Unit does not belong to the specified property.', 400);
            }
        }
        
        if (tenantId) {
            tenant = await User.findById(tenantId).session(session);
            if (!tenant || tenant.role !== ROLE_ENUM.TENANT) {
                throw new AppError('Tenant not found or is not a tenant.', 404);
            }
        }

        // Check authorization
        const isAuthorized = await checkOnboardingManagementPermission(currentUser, propertyId);
        if (!isAuthorized) {
            throw new AppError('Not authorized to create onboarding documents for this context.', 403);
        }

        // Validate visibility requirements
        if (visibility === 'property_tenants' && !propertyId) {
            throw new AppError('Property ID is required for "property_tenants" visibility.', 400);
        }
        
        if (visibility === 'unit_tenants' && (!propertyId || !unitId)) {
            throw new AppError('Property ID and Unit ID are required for "unit_tenants" visibility.', 400);
        }
        
        if (visibility === 'specific_tenant' && !tenantId) {
            throw new AppError('Tenant ID is required for "specific_tenant" visibility.', 400);
        }

        // Upload file and create media record
        let mediaDoc;
        try {
            const uploadResult = await uploadFile(
                file.buffer, 
                file.mimetype, 
                file.originalname, 
                'onboarding_documents'
            );
            
            mediaDoc = new Media({
                filename: file.originalname,
                originalname: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                url: uploadResult.url,
                thumbnailUrl: uploadResult.thumbnailUrl || null,
                uploadedBy: currentUser._id,
                relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
                description: `Onboarding document: ${title}`,
                tags: ['onboarding', category.toLowerCase()],
                isPublic: false
            });
            
            await mediaDoc.save({ session });
        } catch (error) {
            throw new AppError(`Failed to upload file: ${error.message}`, 500);
        }

        // Create onboarding document
        const newOnboarding = new Onboarding({
            title,
            description,
            category: category.toLowerCase(),
            visibility: visibility.toLowerCase(),
            property: propertyId || null,
            unit: unitId || null,
            tenant: tenantId || null,
            media: mediaDoc._id,
            isActive: true,
            createdBy: currentUser._id
        });

        const createdDocument = await newOnboarding.save({ session });

        // Update media with relation
        mediaDoc.relatedId = createdDocument._id;
        await mediaDoc.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
            createdDocument._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Onboarding document "${title}" created by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    category,
                    visibility,
                    propertyId,
                    unitId,
                    tenantId,
                    mediaId: mediaDoc._id
                },
                newValue: createdDocument.toObject()
            },
            { session }
        );

        // Send notification to tenant if document is for a specific tenant
        if (visibility === 'specific_tenant' && tenant) {
            try {
                await notificationService.sendNotification({
                    recipientId: tenant._id,
                    type: NOTIFICATION_TYPE_ENUM.NEW_ONBOARDING_DOCUMENT,
                    message: `A new onboarding document "${title}" has been added for you.`,
                    link: `${FRONTEND_URL}/onboarding/${createdDocument._id}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
                    relatedResourceId: createdDocument._id,
                    emailDetails: {
                        subject: `New Onboarding Document: ${title}`,
                        html: `
                            <p>Hello ${tenant.firstName},</p>
                            <p>A new onboarding document has been added for you:</p>
                            <p><strong>Title:</strong> ${title}</p>
                            <p><strong>Category:</strong> ${category}</p>
                            ${description ? `<p><strong>Description:</strong> ${description}</p>` : ''}
                            <p><a href="${FRONTEND_URL}/onboarding/${createdDocument._id}">View Document</a></p>
                        `,
                        text: `Hello ${tenant.firstName}, A new onboarding document has been added for you: ${title}. View it at: ${FRONTEND_URL}/onboarding/${createdDocument._id}`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send onboarding document notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        await session.commitTransaction();
        
        logger.info(`OnboardingService: Document "${title}" created by ${currentUser.email}.`);

        // Return populated document
        return Onboarding.findById(createdDocument._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('media')
            .populate('createdBy', 'firstName lastName email')
            .populate('completedBy', 'firstName lastName email');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`OnboardingService - Error creating document: ${error.message}`, {
            userId: currentUser?._id,
            title: documentData?.title,
            category: documentData?.category
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to create onboarding document: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets onboarding documents with filtering and pagination
 * @param {Object} currentUser - The authenticated user
 * @param {Object} filters - Query filters
 * @param {string} [filters.category] - Filter by category
 * @param {string} [filters.propertyId] - Filter by property
 * @param {string} [filters.unitId] - Filter by unit
 * @param {number} [page=1] - Page number
 * @param {number} [limit=10] - Items per page
 * @returns {Promise<Object>} Paginated onboarding documents
 * @throws {AppError} If unauthorized
 */
const getOnboardingDocuments = async (currentUser, filters, page = 1, limit = 10) => {
    try {
        let query = { isActive: true };
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Base filtering based on user role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin sees all
        } else if (currentUser.role === ROLE_ENUM.LANDLORD) {
            const ownedProperties = await Property.find({ 
                createdBy: currentUser._id 
            }).distinct('_id');
            
            query.$or = [
                { createdBy: currentUser._id },
                { property: { $in: ownedProperties } },
                { visibility: 'all_tenants' }
            ];
        } else if (currentUser.role === ROLE_ENUM.PROPERTY_MANAGER) {
            const managedProperties = await PropertyUser.find({
                user: currentUser._id,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('property');
            
            if (managedProperties.length === 0) {
                return { 
                    documents: [], 
                    total: 0, 
                    page: parseInt(page), 
                    limit: parseInt(limit) 
                };
            }
            
            query.$or = [
                { createdBy: currentUser._id },
                { property: { $in: managedProperties } },
                { visibility: 'all_tenants' }
            ];
        } else if (currentUser.role === ROLE_ENUM.TENANT) {
            const tenantAssociations = await PropertyUser.find({
                user: currentUser._id,
                roles: PROPERTY_USER_ROLES_ENUM.TENANT,
                isActive: true
            });
            
            const tenantPropertyIds = tenantAssociations.map(assoc => assoc.property).filter(Boolean);
            const tenantUnitIds = tenantAssociations.map(assoc => assoc.unit).filter(Boolean);
            
            query.$or = [
                { visibility: 'all_tenants' },
                { visibility: 'property_tenants', property: { $in: tenantPropertyIds } },
                { visibility: 'unit_tenants', unit: { $in: tenantUnitIds } },
                { visibility: 'specific_tenant', tenant: currentUser._id }
            ];
        } else {
            throw new AppError('Not authorized to view onboarding documents.', 403);
        }

        // Apply additional filters
        if (filters.category) {
            if (!ONBOARDING_CATEGORY_ENUM.includes(filters.category.toLowerCase())) {
                throw new AppError(`Invalid category: ${filters.category}. Allowed values: ${ONBOARDING_CATEGORY_ENUM.join(', ')}`, 400);
            }
            query.category = filters.category.toLowerCase();
        }
        
        if (filters.propertyId) {
            // Check if user has access to property if not admin
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const hasAccess = await PropertyUser.exists({
                    user: currentUser._id,
                    property: filters.propertyId,
                    isActive: true
                });
                
                if (!hasAccess) {
                    throw new AppError('Not authorized to filter by this property.', 403);
                }
            }
            
            if (query.$or) {
                // Add property filter to each $or clause where applicable
                query.$or = query.$or.map(clause => {
                    if (clause.property) {
                        return { ...clause, property: filters.propertyId };
                    }
                    return clause;
                });
            } else {
                query.property = filters.propertyId;
            }
        }
        
        if (filters.unitId) {
            // Ensure unit exists and user has access
            const unit = await Unit.findById(filters.unitId);
            if (!unit) {
                throw new AppError('Unit not found.', 404);
            }
            
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const hasAccess = await PropertyUser.exists({
                    user: currentUser._id,
                    property: unit.property,
                    isActive: true
                });
                
                if (!hasAccess) {
                    throw new AppError('Not authorized to filter by this unit.', 403);
                }
            }
            
            if (query.$or) {
                // Add unit filter to each $or clause where applicable
                query.$or = query.$or.map(clause => {
                    if (clause.unit) {
                        return { ...clause, unit: filters.unitId };
                    }
                    return clause;
                });
            } else {
                query.unit = filters.unitId;
            }
        }

        // Execute query with population
        const [documents, total] = await Promise.all([
            Onboarding.find(query)
                .populate('property', 'name address')
                .populate('unit', 'unitName')
                .populate('tenant', 'firstName lastName email')
                .populate('media')
                .populate('createdBy', 'firstName lastName email')
                .populate('completedBy', 'firstName lastName email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Onboarding.countDocuments(query)
        ]);

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched list of onboarding documents.`,
                status: 'success',
                metadata: { 
                    filters, 
                    page, 
                    limit,
                    count: documents.length
                }
            }
        );

        return { 
            documents, 
            total, 
            page: parseInt(page), 
            limit: parseInt(limit) 
        };
    } catch (error) {
        logger.error(`OnboardingService - Error getting documents: ${error.message}`, {
            userId: currentUser?._id,
            filters
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get onboarding documents: ${error.message}`, 500);
    }
};

/**
 * Gets a specific onboarding document by ID
 * @param {string} documentId - Onboarding document ID
 * @param {Object} currentUser - The authenticated user
 * @returns {Promise<Object>} Onboarding document details
 * @throws {AppError} If document not found or unauthorized
 */
const getOnboardingDocumentById = async (documentId, currentUser) => {
    try {
        const document = await Onboarding.findOne({
            _id: documentId,
            isActive: true
        })
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('media')
            .populate('createdBy', 'firstName lastName email')
            .populate('completedBy', 'firstName lastName email');

        if (!document) {
            throw new AppError('Onboarding document not found.', 404);
        }

        // Check authorization using the model method
        const isAuthorized = await document.isAccessibleBy(currentUser._id, currentUser.role);
        if (!isAuthorized) {
            throw new AppError('You do not have permission to view this document.', 403);
        }

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ,
            AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
            document._id,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} viewed onboarding document "${document.title}".`,
                status: 'success'
            }
        );

        return document;
    } catch (error) {
        logger.error(`OnboardingService - Error getting document: ${error.message}`, {
            userId: currentUser?._id,
            documentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get onboarding document: ${error.message}`, 500);
    }
};

/**
 * Updates an onboarding document
 * @param {string} documentId - Onboarding document ID
 * @param {Object} updateData - Update data
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated onboarding document
 * @throws {AppError} If document not found or unauthorized
 */
const updateOnboardingDocument = async (documentId, updateData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const document = await Onboarding.findOne({
            _id: documentId,
            isActive: true
        }).session(session);
        
        if (!document) {
            throw new AppError('Onboarding document not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkOnboardingManagementPermission(currentUser, document.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to update this onboarding document.', 403);
        }

        // Store old document for audit log
        const oldDocument = document.toObject();

        // Apply updates
        const updatableFields = [
            'title', 'description', 'category', 
            'visibility', 'property', 'unit', 'tenant'
        ];
        
        for (const field of updatableFields) {
            if (updateData[field] !== undefined) {
                if (field === 'category' || field === 'visibility') {
                    document[field] = updateData[field].toLowerCase();
                } else if (field === 'property' && updateData.propertyId) {
                    document[field] = updateData.propertyId;
                } else if (field === 'unit' && updateData.unitId) {
                    document[field] = updateData.unitId;
                } else if (field === 'tenant' && updateData.tenantId) {
                    document[field] = updateData.tenantId;
                } else {
                    document[field] = updateData[field];
                }
            }
        }
        
        // Update tracking fields
        document.updatedBy = currentUser._id;

        const updatedDocument = await document.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
            updatedDocument._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Onboarding document "${updatedDocument.title}" updated by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldDocument,
                newValue: updatedDocument.toObject()
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`OnboardingService: Document "${updatedDocument.title}" updated by ${currentUser.email}.`);
        
        // Return populated document
        return Onboarding.findById(updatedDocument._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('media')
            .populate('createdBy', 'firstName lastName email')
            .populate('completedBy', 'firstName lastName email');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`OnboardingService - Error updating document: ${error.message}`, {
            userId: currentUser?._id,
            documentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to update onboarding document: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Deletes an onboarding document (soft delete)
 * @param {string} documentId - Onboarding document ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<void>}
 * @throws {AppError} If document not found or unauthorized
 */
const deleteOnboardingDocument = async (documentId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const document = await Onboarding.findOne({
            _id: documentId,
            isActive: true
        }).session(session);
        
        if (!document) {
            throw new AppError('Onboarding document not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkOnboardingManagementPermission(currentUser, document.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to delete this onboarding document.', 403);
        }

        // Store old document for audit log
        const oldDocument = document.toObject();

        // Soft delete the document
        document.isActive = false;
        document.updatedBy = currentUser._id;
        await document.save({ session });

        // Delete associated media file if it exists
        if (document.media) {
            try {
                const mediaDoc = await Media.findById(document.media).session(session);
                if (mediaDoc) {
                    const publicIdMatch = mediaDoc.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
                    if (publicIdMatch && publicIdMatch[1]) {
                        await deleteFile(publicIdMatch[1]);
                        logger.info(`OnboardingService: Deleted file ${publicIdMatch[1]} from storage.`);
                    }
                    await mediaDoc.deleteOne({ session });
                }
            } catch (error) {
                logger.warn(`OnboardingService: Error deleting media: ${error.message}`);
                // Continue deletion process even if document removal fails
            }
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
            documentId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Onboarding document "${oldDocument.title}" deleted by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldDocument,
                newValue: null
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`OnboardingService: Document "${oldDocument.title}" deleted by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`OnboardingService - Error deleting document: ${error.message}`, {
            userId: currentUser?._id,
            documentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete onboarding document: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Marks an onboarding document as completed by a tenant
 * @param {string} documentId - Onboarding document ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated onboarding document
 * @throws {AppError} If document not found or unauthorized
 */
const markOnboardingCompleted = async (documentId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        if (currentUser.role !== ROLE_ENUM.TENANT) {
            throw new AppError('Only tenants can mark onboarding documents as completed.', 403);
        }

        const document = await Onboarding.findOne({
            _id: documentId,
            isActive: true
        }).session(session);
        
        if (!document) {
            throw new AppError('Onboarding document not found.', 404);
        }

        // Check authorization using the model method
        const isAuthorized = await document.isAccessibleBy(currentUser._id, currentUser.role);
        if (!isAuthorized) {
            throw new AppError('You do not have permission to mark this document as completed.', 403);
        }

        // If already completed, return current document
        if (document.isCompleted && document.completedBy && document.completedBy.equals(currentUser._id)) {
            return document;
        }

        // Store old completed state for audit log
        const oldCompletedState = {
            isCompleted: document.isCompleted,
            completedBy: document.completedBy,
            completedAt: document.completedAt
        };

        // Mark as completed
        document.isCompleted = true;
        document.completedBy = currentUser._id;
        document.completedAt = new Date();
        document.updatedBy = currentUser._id;
        
        const updatedDocument = await document.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
            updatedDocument._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Onboarding document "${updatedDocument.title}" marked as completed by tenant ${currentUser.email}.`,
                status: 'success',
                oldValue: oldCompletedState,
                newValue: {
                    isCompleted: updatedDocument.isCompleted,
                    completedBy: updatedDocument.completedBy,
                    completedAt: updatedDocument.completedAt
                }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`OnboardingService: Document "${updatedDocument.title}" marked as completed by ${currentUser.email}.`);
        
        // Return populated document
        return Onboarding.findById(updatedDocument._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('media')
            .populate('createdBy', 'firstName lastName email')
            .populate('completedBy', 'firstName lastName email');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`OnboardingService - Error marking document as completed: ${error.message}`, {
            userId: currentUser?._id,
            documentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to mark onboarding document as completed: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets download info for an onboarding document
 * @param {string} documentId - Onboarding document ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Download info
 * @throws {AppError} If document not found or unauthorized
 */
const getOnboardingDocumentDownloadUrl = async (documentId, currentUser, ipAddress) => {
    try {
        const document = await Onboarding.findOne({
            _id: documentId,
            isActive: true
        }).populate('media');
        
        if (!document) {
            throw new AppError('Onboarding document not found.', 404);
        }

        // Check authorization using the model method
        const isAuthorized = await document.isAccessibleBy(currentUser._id, currentUser.role);
        if (!isAuthorized) {
            throw new AppError('You do not have permission to download this document.', 403);
        }

        if (!document.media) {
            throw new AppError('No file associated with this document.', 404);
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.FILE_DOWNLOAD,
            AUDIT_RESOURCE_TYPE_ENUM.Onboarding,
            document._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Onboarding document "${document.title}" downloaded by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    documentId: document._id,
                    mediaId: document.media._id,
                    fileName: document.media.originalname
                }
            }
        );

        logger.info(`OnboardingService: Document "${document.title}" download requested by ${currentUser.email}.`);
        
        return {
            downloadUrl: document.media.url,
            fileName: document.media.originalname,
            mimeType: document.media.mimeType
        };
    } catch (error) {
        logger.error(`OnboardingService - Error generating download URL: ${error.message}`, {
            userId: currentUser?._id,
            documentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to generate document download URL: ${error.message}`, 500);
    }
};

module.exports = {
    createOnboardingDocument,
    getOnboardingDocuments,
    getOnboardingDocumentById,
    updateOnboardingDocument,
    deleteOnboardingDocument,
    markOnboardingCompleted,
    getOnboardingDocumentDownloadUrl
};