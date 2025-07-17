// src/services/leaseService.js

const Lease = require('../models/lease');
const Property = require('../models/property');
const Unit = require('../models/unit');
const User = require('../models/user');
const PropertyUser = require('../models/propertyUser');
const Rent = require('../models/rent'); // For deleting associated rent records
const Media = require('../models/media'); // For lease documents
const { createAuditLog } = require('./auditService');
const { createInAppNotification } = require('./notificationService');
const { uploadFile, deleteFile } = require('./cloudStorageService'); // For file uploads/downloads
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    ROLE_ENUM, // Now an object
    PROPERTY_USER_ROLES_ENUM,
    LEASE_STATUS_ENUM,
    UNIT_STATUS_ENUM,
    AUDIT_ACTION_ENUM, // Now an object
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM
} = require('../utils/constants/enums');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Helper to check if a user has management permission for a given property.
 * This is used for landlord/PM/admin roles.
 * @param {object} user - The authenticated user object.
 * @param {string} propertyId - The ID of the property to check access for.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkPropertyManagementPermission = async (user, propertyId) => {
    if (user.role === ROLE_ENUM.ADMIN) {
        return true; // Admin has global access
    }

    const hasAccess = await PropertyUser.exists({
        user: user._id,
        property: propertyId,
        isActive: true,
        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
    });
    return hasAccess;
};

/**
 * Helper to check if a user has access to a specific lease record.
 * @param {object} user - The authenticated user object.
 * @param {object} lease - The lease document to check access for.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkLeaseAccess = async (user, lease) => {
    if (user.role === ROLE_ENUM.ADMIN) {
        return true;
    }
    if (lease.tenant && lease.tenant.equals(user._id) && user.role === ROLE_ENUM.TENANT) {
        return true; // Tenant can access their own lease records
    }

    // Landlords/PMs can access if associated with the property
    const hasPropertyAccess = await checkPropertyManagementPermission(user, lease.property);
    if (hasPropertyAccess) {
        return true;
    }
    return false;
};

/**
 * Creates a new lease agreement.
 * @param {object} leaseData - Data for the new lease.
 * @param {object} currentUser - The user creating the lease.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Lease>} The created lease document.
 * @throws {AppError} If property/unit/tenant not found, user not authorized, or unit already has an active lease.
 */
const createLease = async (leaseData, currentUser, ipAddress) => {
    const {
        property: propertyId,
        unit: unitId,
        tenant: tenantId,
        leaseStartDate,
        leaseEndDate,
        monthlyRent,
        currency,
        paymentDueDate,
        securityDeposit,
        terms,
        status = LEASE_STATUS_ENUM.find(s => s === 'active')
    } = leaseData;

    const property = await Property.findById(propertyId);
    const unit = await Unit.findById(unitId);
    const tenant = await User.findById(tenantId);

    if (!property || !unit || !tenant) {
        throw new AppError('Property, unit, or tenant not found.', 404);
    }

    // Authorization: Admin, Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
    if (!isAuthorized) {
        throw new AppError('Not authorized to create leases for this property.', 403);
    }

    // Ensure the tenant is actually associated with this unit/property
    const tenantPropertyUser = await PropertyUser.findOne({
        user: tenantId,
        property: propertyId,
        unit: unitId,
        roles: PROPERTY_USER_ROLES_ENUM.TENANT,
        isActive: true
    });

    if (!tenantPropertyUser) {
        throw new AppError('Tenant is not actively associated with this unit/property. Please ensure they are invited and active.', 400);
    }

    // Check if the unit already has an active lease
    const existingActiveLease = await Lease.findOne({
        unit: unitId,
        status: LEASE_STATUS_ENUM.find(s => s === 'active')
    });
    if (existingActiveLease) {
        throw new AppError(`Unit ${unit.unitName} already has an active lease (ID: ${existingActiveLease._id}). Please terminate it first.`, 409);
    }

    // Determine the landlord (owner of the property)
    const landlord = await User.findById(property.createdBy); // Assuming 'createdBy' on Property is the owner/landlord
    if (!landlord) {
        throw new AppError('Landlord (property creator) not found for this property.', 500);
    }

    const newLease = new Lease({
        property: propertyId,
        unit: unitId,
        tenant: tenantId,
        landlord: landlord._id,
        leaseStartDate,
        leaseEndDate,
        monthlyRent,
        currency,
        paymentDueDate,
        securityDeposit,
        terms,
        status: status.toLowerCase()
    });

    const createdLease = await newLease.save();

    // Update unit status to occupied
    unit.status = UNIT_STATUS_ENUM.find(s => s === 'occupied');
    await unit.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE, // Correctly uses CREATE from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
        resourceId: createdLease._id,
        newValue: createdLease.toObject(),
        ipAddress: ipAddress,
        description: `Lease created for tenant ${tenant.email} (Unit: ${unit.unitName}, Property: ${property.name}) by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`LeaseService: Lease created for tenant ${tenant.email} by ${currentUser.email}.`);
    return createdLease;
};

/**
 * Gets all leases accessible by the logged-in user with filtering and pagination.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Query filters (status, propertyId, unitId, tenantId, sortBy, sortOrder, pagination).
 * @param {number} page - Page number.
 * @param {number} limit - Items per page.
 * @returns {Promise<object>} Object containing leases array, total count, page, and limit.
 * @throws {AppError} If user not authorized.
 */
const getAllLeases = async (currentUser, filters, page = 1, limit = 10) => {
    let query = {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Base filtering based on user role
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin sees all
    } else if (currentUser.role === ROLE_ENUM.TENANT) {
        query.tenant = currentUser._id; // Tenant sees only their own leases
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
        const userAssociatedProperties = await PropertyUser.find({
            user: currentUser._id,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return { leases: [], total: 0, page: parseInt(page), limit: parseInt(limit) };
        }
        query.property = { $in: userAssociatedProperties };
    } else {
        throw new AppError('Not authorized to view leases.', 403);
    }

    // Apply additional filters from query parameters
    if (filters.status) {
        if (!LEASE_STATUS_ENUM.includes(filters.status.toLowerCase())) {
            throw new AppError(`Invalid status filter: ${filters.status}`, 400);
        }
        query.status = filters.status.toLowerCase();
    }
    if (filters.propertyId) {
        const hasAccess = await checkPropertyManagementPermission(currentUser, filters.propertyId);
        if (!hasAccess && currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Not authorized to filter by this property.', 403);
        }
        query.property = filters.propertyId;
    }
    if (filters.unitId) {
        // Ensure unit exists and is part of the authorized property (if property filter is applied)
        const unitQuery = { _id: filters.unitId };
        if (query.property) { // If property filter is already set by role or other filter
            unitQuery.property = query.property;
        }
        const unitExists = await Unit.exists(unitQuery);
        if (!unitExists) {
            throw new AppError('Unit not found in the specified property for filtering.', 404);
        }
        query.unit = filters.unitId;
    }
    if (filters.tenantId) {
        const tenantUser = await User.findById(filters.tenantId);
        if (!tenantUser) throw new AppError('Tenant not found for filtering.', 404);
        if (currentUser.role === ROLE_ENUM.TENANT && !tenantUser._id.equals(currentUser._id)) {
            throw new AppError('Tenants can only view their own leases.', 403);
        }
        query.tenant = filters.tenantId;
    }
    if (filters.startDate || filters.endDate) {
        query.leaseStartDate = query.leaseStartDate || {};
        if (filters.startDate) query.leaseStartDate.$gte = new Date(filters.startDate); // Ensure Date objects
        if (filters.endDate) query.leaseStartDate.$lte = new Date(filters.endDate);     // Ensure Date objects
    }
    if (filters.expiryStartDate || filters.expiryEndDate) {
        query.leaseEndDate = query.leaseEndDate || {};
        if (filters.expiryStartDate) query.leaseEndDate.$gte = new Date(filters.expiryStartDate); // Ensure Date objects
        if (filters.expiryEndDate) query.leaseEndDate.$lte = new Date(filters.expiryEndDate);     // Ensure Date objects
    }

    const sortBy = filters.sortBy || 'leaseEndDate';
    const sortOrder = filters.sortOrder === 'desc' ? -1 : 1;
    const sortOptions = { [sortBy]: sortOrder };

    const leases = await Lease.find(query)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('tenant', 'firstName lastName email')
        .populate('landlord', 'firstName lastName email')
        .sort(sortOptions)
        .limit(parseInt(limit))
        .skip(skip);

    const total = await Lease.countDocuments(query);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.FETCH_ALL_LEASES, // Changed from READ_ALL
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
        ipAddress: currentUser.ip, // Ensure currentUser.ip is populated by middleware
        description: `User ${currentUser.email} fetched list of leases.`,
        status: 'success',
        metadata: { filters }
    });

    return { leases, total, page: parseInt(page), limit: parseInt(limit) };
};

/**
 * Gets a single lease by ID.
 * @param {string} leaseId - The ID of the lease.
 * @param {object} currentUser - The authenticated user.
 * @returns {Promise<Lease>} The lease document.
 * @throws {AppError} If lease not found or user not authorized.
 */
const getLeaseById = async (leaseId, currentUser) => {
    const lease = await Lease.findById(leaseId)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('tenant', 'firstName lastName email')
        .populate('landlord', 'firstName lastName email')
        .populate('documents'); // Populate Media documents

    if (!lease) {
        throw new AppError('Lease not found.', 404);
    }

    // Authorization:
    const isAuthorized = await checkLeaseAccess(currentUser, lease);
    if (!isAuthorized) {
        throw new AppError('Not authorized to access this lease.', 403);
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ_ONE_LEASE, // Changed from READ (assuming you add this to enums)
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
        resourceId: lease._id,
        ipAddress: currentUser.ip, // Ensure currentUser.ip is populated by middleware
        description: `User ${currentUser.email} fetched lease ${lease._id}.`,
        status: 'success'
    });

    return lease;
};

/**
 * Updates a lease agreement.
 * @param {string} leaseId - The ID of the lease to update.
 * @param {object} updateData - Data to update the lease with.
 * @param {object} currentUser - The user performing the update.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Lease>} The updated lease document.
 * @throws {AppError} If lease not found, user not authorized, or validation fails.
 */
const updateLease = async (leaseId, updateData, currentUser, ipAddress) => {
    let lease = await Lease.findById(leaseId);
    if (!lease) {
        throw new AppError('Lease not found.', 404);
    }

    // Authorization: Admin, Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property);
    if (!isAuthorized) {
        throw new AppError('Not authorized to update this lease.', 403);
    }

    const oldLease = lease.toObject(); // Capture old state for audit log

    // Check if unit status needs to be updated due to lease termination
    const oldStatus = oldLease.status;
    const newStatus = updateData.status ? updateData.status.toLowerCase() : oldStatus;

    // Apply updates
    Object.keys(updateData).forEach(key => {
        if (updateData[key] !== undefined) {
            lease[key] = updateData[key];
        }
    });

    const updatedLease = await lease.save();

    // If lease status changes to terminated and unit becomes vacant
    if (oldStatus !== LEASE_STATUS_ENUM.find(s => s === 'terminated') && newStatus === LEASE_STATUS_ENUM.find(s => s === 'terminated')) {
        const remainingActiveLeases = await Lease.countDocuments({
            unit: lease.unit,
            status: LEASE_STATUS_ENUM.find(s => s === 'active')
        });
        if (remainingActiveLeases === 0) {
            await Unit.findByIdAndUpdate(lease.unit, {
                status: UNIT_STATUS_ENUM.find(s => s === 'vacant')
            });
            logger.info(`LeaseService: Unit ${lease.unit} status updated to vacant after lease termination.`);
        }
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE, // Correctly uses UPDATE from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
        resourceId: updatedLease._id,
        oldValue: oldLease,
        newValue: updatedLease.toObject(),
        ipAddress: ipAddress,
        description: `Lease ${updatedLease._id} updated by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`LeaseService: Lease ${updatedLease._id} updated by ${currentUser.email}.`);
    return updatedLease;
};

/**
 * Deletes a lease agreement.
 * @param {string} leaseId - The ID of the lease to delete.
 * @param {object} currentUser - The user performing the deletion.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If lease not found or user not authorized.
 */
const deleteLease = async (leaseId, currentUser, ipAddress) => {
    const leaseToDelete = await Lease.findById(leaseId);
    if (!leaseToDelete) {
        throw new AppError('Lease not found.', 404);
    }

    // Authorization: Admin, Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, leaseToDelete.property);
    if (!isAuthorized) {
        throw new AppError('Not authorized to delete this lease.', 403);
    }

    const oldLease = leaseToDelete.toObject(); // Capture old state for audit log

    // Delete associated documents from Cloudinary and Media collection
    if (leaseToDelete.documents && leaseToDelete.documents.length > 0) {
        for (const docId of leaseToDelete.documents) {
            try {
                const mediaDoc = await Media.findById(docId);
                if (mediaDoc) {
                    const publicIdMatch = mediaDoc.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
                    if (publicIdMatch && publicIdMatch[1]) {
                        const publicId = publicIdMatch[1];
                        await deleteFile(publicId); // Delete from Cloudinary
                        logger.info(`LeaseService: Deleted lease document media ${publicId} from Cloudinary.`);
                    } else {
                        logger.warn(`LeaseService: Could not extract public ID from media URL: ${mediaDoc.url}. Skipping Cloudinary deletion.`);
                    }
                    await mediaDoc.deleteOne(); // Delete Media document
                    logger.info(`LeaseService: Deleted Media document for lease document ${mediaDoc._id}.`);
                }
            } catch (error) {
                logger.error(`LeaseService: Failed to delete lease document media for lease ${leaseId}, doc ${docId}: ${error.message}`);
                // Continue with deletion even if media deletion fails
            }
        }
    }

    await leaseToDelete.deleteOne();

    // Update unit status to vacant if no other active leases for this unit
    const remainingActiveLeases = await Lease.countDocuments({
        unit: leaseToDelete.unit,
        status: LEASE_STATUS_ENUM.find(s => s === 'active')
    });
    if (remainingActiveLeases === 0) {
        await Unit.findByIdAndUpdate(leaseToDelete.unit, {
            status: UNIT_STATUS_ENUM.find(s => s === 'vacant')
        });
        logger.info(`LeaseService: Unit ${leaseToDelete.unit} status updated to vacant after lease deletion.`);
    }

    // Also delete associated rent records for this lease
    await Rent.deleteMany({
        lease: leaseToDelete._id
    });
    logger.info(`LeaseService: Associated rent records for lease ${leaseToDelete._id} deleted.`);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE, // Correctly uses DELETE from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
        resourceId: leaseId,
        oldValue: oldLease,
        newValue: null,
        ipAddress: ipAddress,
        description: `Lease ${oldLease._id} (Tenant: ${oldLease.tenant}, Unit: ${oldLease.unit}) deleted by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`LeaseService: Lease ${oldLease._id} deleted by ${currentUser.email}.`);
};

/**
 * Gets upcoming lease expiries for a user.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Optional filters (e.g., propertyId, unitId, daysAhead).
 * @returns {Promise<Array<Lease>>} Array of expiring lease records.
 * @throws {AppError} If user not authorized.
 */
const getExpiringLeases = async (currentUser, filters) => {
    let query = {
        status: LEASE_STATUS_ENUM.find(s => s === 'active'),
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    const daysAhead = filters.daysAhead ? parseInt(filters.daysAhead) : 90; // Default to 90 days
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + daysAhead);
    futureDate.setHours(23, 59, 59, 999); // Normalize to end of day

    query.leaseEndDate = { $gte: today, $lte: futureDate };

    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin sees all
    } else if (currentUser.role === ROLE_ENUM.TENANT) {
        query.tenant = currentUser._id;
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
        const userAssociatedProperties = await PropertyUser.find({
            user: currentUser._id,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return [];
        }
        query.property = { $in: userAssociatedProperties };
    } else {
        throw new AppError('Not authorized to view expiring leases.', 403);
    }

    // Apply specific filters
    if (filters.propertyId) {
        // Ensure that if query.property is an object with $in, we convert it to an array for includes check
        const authorizedPropertyIds = query.property && query.property.$in ? query.property.$in.map(id => id.toString()) : [];
        if (authorizedPropertyIds.length > 0 && !authorizedPropertyIds.includes(filters.propertyId)) {
            throw new AppError('Not authorized to filter by this property.', 403);
        }
        // If no property filter was set by role, or if admin, set it.
        // If a property filter was set by role, this will narrow it down further.
        query.property = filters.propertyId;
    }
    if (filters.unitId) {
        const unitExists = await Unit.exists({ _id: filters.unitId, property: query.property });
        if (!unitExists) {
            throw new AppError('Unit not found in the specified property for filtering.', 404);
        }
        query.unit = filters.unitId;
    }

    const expiringLeases = await Lease.find(query)
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('tenant', 'firstName lastName email')
        .populate('landlord', 'firstName lastName email')
        .sort({ leaseEndDate: 1 }); // Sort by earliest expiry first

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.FETCH_ALL_LEASES, // Changed from READ_ALL
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
        description: `User ${currentUser.email} fetched expiring leases.`,
        status: 'success',
        metadata: { filters }
    });

    return expiringLeases;
};

/**
 * Marks a lease as renewal notice sent.
 * @param {string} leaseId - The ID of the lease.
 * @param {object} currentUser - The user marking the notice.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Lease>} The updated lease document.
 * @throws {AppError} If lease not found or user not authorized.
 */
const markRenewalNoticeSent = async (leaseId, currentUser, ipAddress) => {
    let lease = await Lease.findById(leaseId);
    if (!lease) {
        throw new AppError('Lease not found.', 404);
    }

    // Authorization: Admin, Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property);
    if (!isAuthorized) {
        throw new AppError('Not authorized to mark renewal notice for this lease.', 403);
    }

    const oldLease = lease.toObject(); // Capture old state for audit log

    lease.renewalNoticeSent = true;
    lease.lastRenewalNoticeDate = new Date();
    const updatedLease = await lease.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE, // Correctly uses UPDATE from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
        resourceId: updatedLease._id,
        oldValue: { renewalNoticeSent: oldLease.renewalNoticeSent, lastRenewalNoticeDate: oldLease.lastRenewalNoticeDate },
        newValue: { renewalNoticeSent: updatedLease.renewalNoticeSent, lastRenewalNoticeDate: updatedLease.lastRenewalNoticeDate },
        ipAddress: ipAddress,
        description: `Renewal notice marked as sent for lease ${updatedLease._id} by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`LeaseService: Renewal notice marked as sent for lease ${updatedLease._id} by ${currentUser.email}.`);
    return updatedLease;
};

/**
 * Uploads a lease document (e.g., signed agreement, amendment).
 * @param {string} leaseId - The ID of the lease.
 * @param {object} file - The file object (from multer, containing buffer/path).
 * @param {object} currentUser - The user uploading the document.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Media>} The created Media document.
 * @throws {AppError} If lease not found, user not authorized, or file missing.
 */
const uploadLeaseDocument = async (leaseId, file, currentUser, ipAddress) => {
    if (!file) {
        throw new AppError('No file provided for lease document upload.', 400);
    }

    let lease = await Lease.findById(leaseId);
    if (!lease) {
        throw new AppError('Lease not found.', 404);
    }

    // Authorization: Admin, Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property);
    if (!isAuthorized) {
        throw new AppError('Not authorized to upload documents for this lease.', 403);
    }

    // Upload file to Cloudinary
    let newMediaDoc;
    try {
        const uploadResult = await uploadFile(file.buffer, file.mimetype, file.originalname, 'lease_documents');
        newMediaDoc = await Media.create({
            filename: file.originalname,
            originalname: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            url: uploadResult.url,
            thumbnailUrl: uploadResult.thumbnailUrl || null,
            uploadedBy: currentUser._id,
            relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Lease, // Link to Lease model
            relatedId: lease._id,
            description: `Lease document for lease ${lease._id}`,
            tags: ['lease', 'document'],
            isPublic: false // Lease documents are typically private
        });
    } catch (error) {
        logger.error(`LeaseService: Failed to upload lease document for lease ${leaseId}: ${error.message}`);
        throw new AppError(`Failed to upload lease document: ${error.message}`, 500);
    }

    // Add the new Media document's ID to the lease's documents array
    lease.documents.push(newMediaDoc._id);
    await lease.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.FILE_UPLOAD, // Correctly uses FILE_UPLOAD from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
        resourceId: lease._id,
        newValue: { documentId: newMediaDoc._id, fileName: file.originalname, url: newMediaDoc.url },
        ipAddress: ipAddress,
        description: `Document "${file.originalname}" uploaded to lease ${lease._id} by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`LeaseService: Document uploaded for lease ${lease._id} by ${currentUser.email}. Media ID: ${newMediaDoc._id}`);
    return newMediaDoc;
};

/**
 * Provides a download URL for a lease document.
 * @param {string} leaseId - The ID of the lease.
 * @param {string} documentId - The ID of the Media document.
 * @param {object} currentUser - The user requesting the download.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<object>} Object containing downloadUrl, fileName, and mimeType.
 * @throws {AppError} If lease/document not found, or user not authorized.
 */
const downloadLeaseDocument = async (leaseId, documentId, currentUser, ipAddress) => {
    const lease = await Lease.findById(leaseId);
    if (!lease) {
        throw new AppError('Lease not found.', 404);
    }

    // Ensure the document ID is actually part of this lease's documents
    if (!lease.documents.includes(documentId)) {
        throw new AppError('Document not found for this lease.', 404);
    }

    // Authorization: Admin, Landlord/PM, or Tenant associated with lease
    const isAuthorized = await checkLeaseAccess(currentUser, lease);
    if (!isAuthorized) {
        throw new AppError('Not authorized to download this document.', 403);
    }

    const mediaDoc = await Media.findById(documentId);
    if (!mediaDoc) {
        throw new AppError('Lease document media not found in storage.', 404);
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.FILE_DOWNLOAD, // Correctly uses FILE_DOWNLOAD from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
        resourceId: leaseId,
        metadata: {
            documentFileName: mediaDoc.originalname,
            documentUrl: mediaDoc.url
        },
        ipAddress: ipAddress,
        description: `Document "${mediaDoc.originalname}" downloaded from lease ${leaseId} by ${currentUser.email}.`,
        status: 'success'
    });

    return {
        downloadUrl: mediaDoc.url, // Directly return the Cloudinary URL
        fileName: mediaDoc.originalname,
        mimeType: mediaDoc.mimeType
    };
};

/**
 * Generates a lease-related document (e.g., renewal notice, exit letter).
 * This is a placeholder for actual PDF generation logic.
 * @param {string} leaseId - The ID of the lease.
 * @param {string} documentType - Type of document to generate ('renewal_notice', 'exit_letter').
 * @param {object} currentUser - The user generating the document.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Media>} The created Media document for the generated file.
 * @throws {AppError} If lease not found, user not authorized, or document generation fails.
 */
const generateLeaseDocument = async (leaseId, documentType, currentUser, ipAddress) => {
    const lease = await Lease.findById(leaseId)
        .populate('property')
        .populate('unit')
        .populate('tenant')
        .populate('landlord');

    if (!lease) {
        throw new AppError('Lease not found.', 404);
    }

    // Authorization: Admin, Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property._id);
    if (!isAuthorized) {
        throw new AppError('Not authorized to generate documents for this lease.', 403);
    }

    // --- Placeholder for actual document generation logic ---
    // In a real application, this would involve:
    // 1. Fetching comprehensive data related to the lease, property, unit, tenant, landlord.
    // 2. Using a document generation library (e.g., 'pdfkit', 'html-pdf', 'docx-templater')
    //    to create the document based on a template and the fetched data.
    // 3. The output would be a Buffer.
    // For demonstration, we'll simulate a file buffer and upload it.

    const simulatedContent = `This is a generated ${documentType.replace('_', ' ')} for Lease ID: ${lease._id}.
    Tenant: ${lease.tenant.firstName} ${lease.tenant.lastName}
    Property: ${lease.property.name}, Unit: ${lease.unit.unitName}
    Lease Dates: ${new Date(lease.leaseStartDate).toLocaleDateString()} to ${new Date(lease.leaseEndDate).toLocaleDateString()}`;

    const generatedBuffer = Buffer.from(simulatedContent, 'utf-8');
    const generatedFileName = `${lease.property.name.replace(/\s/g, '-')}-${lease.unit.unitName}-${documentType}-${Date.now()}.pdf`;
    const mimeType = 'application/pdf'; // Assuming PDF output

    let newMediaDoc;
    try {
        const uploadResult = await uploadFile(generatedBuffer, mimeType, generatedFileName, 'generated_lease_documents');
        newMediaDoc = await Media.create({
            filename: generatedFileName,
            originalname: generatedFileName,
            mimeType: mimeType,
            size: generatedBuffer.length,
            url: uploadResult.url,
            thumbnailUrl: uploadResult.thumbnailUrl || null,
            uploadedBy: currentUser._id,
            relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            relatedId: lease._id,
            description: `Generated ${documentType.replace('_', ' ')} for lease ${lease._id}`,
            tags: ['generated', 'lease', documentType],
            isPublic: false
        });
    } catch (error) {
        logger.error(`LeaseService: Failed to upload generated document for lease ${leaseId}: ${error.message}`);
        throw new AppError(`Failed to generate and upload document: ${error.message}`, 500);
    }

    // Add the generated document to the lease's documents array
    lease.documents.push(newMediaDoc._id);
    await lease.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE, // Treat generation as creation of a new resource
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
        resourceId: lease._id,
        metadata: {
            documentType,
            generatedFileName,
            generatedMediaId: newMediaDoc._id
        },
        ipAddress: ipAddress,
        description: `Generated ${documentType.replace('_', ' ')} for lease ${lease._id} by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`LeaseService: Generated ${documentType} for lease ${lease._id} by ${currentUser.email}. Media ID: ${newMediaDoc._id}`);
    return newMediaDoc;
};

module.exports = {
    createLease,
    getAllLeases,
    getLeaseById,
    updateLease,
    deleteLease,
    getExpiringLeases,
    markRenewalNoticeSent,
    uploadLeaseDocument,
    downloadLeaseDocument,
    generateLeaseDocument,
};
