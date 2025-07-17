// src/services/rentService.js

const Rent = require('../models/rent');
const Lease = require('../models/lease');
const Property = require('../models/property');
const Unit = require('../models/unit');
const User = require('../models/user');
const PropertyUser = require('../models/propertyUser');
const Media = require('../models/media'); // Assuming Media model for paymentProof
const { createAuditLog } = require('./auditService');
const { createInAppNotification } = require('./notificationService');
const { uploadFile, deleteFile } = require('./cloudStorageService'); // For file uploads/downloads
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    PAYMENT_STATUS_ENUM,
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
    // Admin has global access
    if (user.role === ROLE_ENUM.ADMIN) {
        return true;
    }

    // Check if user is explicitly associated with the property in a management role
    const hasAccess = await PropertyUser.exists({
        user: user._id,
        property: propertyId,
        isActive: true,
        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
    });
    return hasAccess;
};

/**
 * Helper to check if a user has access to a specific rent record.
 * @param {object} user - The authenticated user object.
 * @param {object} rent - The rent document to check access for.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkRentRecordAccess = async (user, rent) => {
    // Admin has global access
    if (user.role === ROLE_ENUM.ADMIN) {
        return true;
    }
    // Tenant can access their own rent records
    if (rent.tenant && rent.tenant.equals(user._id) && user.role === ROLE_ENUM.TENANT) {
        return true;
    }

    // Landlords/PMs can access if associated with the property
    const hasPropertyAccess = await checkPropertyManagementPermission(user, rent.property);
    if (hasPropertyAccess) {
        return true;
    }
    return false;
};

/**
 * Creates a new rent record.
 * @param {object} rentData - Data for the new rent record.
 * @param {object} currentUser - The user creating the record.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Rent>} The created rent document.
 * @throws {AppError} If lease/property/unit/tenant not found, user not authorized, or duplicate record exists.
 */
const createRentRecord = async (rentData, currentUser, ipAddress) => {
    const { lease: leaseId, amountDue, dueDate, billingPeriod, status = PAYMENT_STATUS_ENUM.find(s => s === 'due') } = rentData;

    const lease = await Lease.findById(leaseId)
        .populate('property')
        .populate('unit')
        .populate('tenant');

    if (!lease) {
        throw new AppError('Lease not found.', 404);
    }
    if (!lease.property || !lease.unit || !lease.tenant) {
        throw new AppError('Associated property, unit, or tenant not found for the lease.', 500);
    }

    // Authorization: Admin, Landlord/PM associated with the lease's property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property._id);
    if (!isAuthorized) {
        throw new AppError('Not authorized to create rent records for this lease.', 403);
    }

    // Prevent duplicate rent records for the same lease and billing period
    const existingRent = await Rent.findOne({
        lease: leaseId,
        billingPeriod: billingPeriod
    });
    if (existingRent) {
        throw new AppError(`Rent record for billing period ${billingPeriod} already exists for this lease.`, 409);
    }

    const newRent = new Rent({
        lease: leaseId,
        tenant: lease.tenant._id,
        property: lease.property._id,
        unit: lease.unit._id,
        amountDue,
        dueDate,
        billingPeriod,
        status: status.toLowerCase()
    });

    const createdRent = await newRent.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.CREATE, // Correctly uses CREATE from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
        resourceId: createdRent._id,
        newValue: createdRent.toObject(),
        ipAddress: ipAddress,
        description: `Rent record created for lease ${leaseId} (Tenant: ${lease.tenant.email}, Period: ${billingPeriod}) by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`RentService: Rent record created for lease ${leaseId} by ${currentUser.email}.`);
    return createdRent;
};

/**
 * Gets all rent records accessible by the logged-in user with filtering and pagination.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Query filters (status, period, leaseId, tenantId, propertyId, unitId).
 * @param {number} page - Page number.
 * @param {number} limit - Items per page.
 * @returns {Promise<object>} Object containing rents array, total count, page, and limit.
 * @throws {AppError} If user not authorized.
 */
const getAllRentRecords = async (currentUser, filters, page = 1, limit = 10) => {
    let query = {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Base filtering based on user role
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin sees all, no additional query filter needed here based on role
    } else if (currentUser.role === ROLE_ENUM.TENANT) {
        query.tenant = currentUser._id; // Tenant sees only their own rent records
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
        const userAssociatedProperties = await PropertyUser.find({
            user: currentUser._id,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return { rents: [], total: 0, page: parseInt(page), limit: parseInt(limit) };
        }
        query.property = { $in: userAssociatedProperties };
    } else {
        throw new AppError('Not authorized to view rent records.', 403);
    }

    // Apply additional filters from query parameters
    if (filters.status) {
        if (!PAYMENT_STATUS_ENUM.includes(filters.status.toLowerCase())) {
            throw new AppError(`Invalid status filter: ${filters.status}`, 400);
        }
        query.status = filters.status.toLowerCase();
    }
    if (filters.billingPeriod) {
        // Assuming billingPeriod is in YYYY-MM format
        const [year, month] = filters.billingPeriod.split('-');
        if (!year || !month || isNaN(parseInt(year)) || isNaN(parseInt(month))) {
            throw new AppError('Invalid billingPeriod format. Use YYYY-MM.', 400);
        }
        const startOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
        const endOfMonth = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
        query.dueDate = { $gte: startOfMonth, $lte: endOfMonth };
    }
    if (filters.leaseId) {
        // Ensure user has access to this lease before applying filter
        const lease = await Lease.findById(filters.leaseId);
        if (!lease) throw new AppError('Lease not found for filtering.', 404);
        const hasAccess = await checkRentRecordAccess(currentUser, { property: lease.property, tenant: lease.tenant });
        if (!hasAccess) throw new AppError('Not authorized to filter by this lease.', 403);
        query.lease = filters.leaseId;
    }
    if (filters.tenantId) {
        // Ensure user has access to this tenant's data
        const tenantUser = await User.findById(filters.tenantId);
        if (!tenantUser) throw new AppError('Tenant not found for filtering.', 404);
        if (currentUser.role === ROLE_ENUM.TENANT && !tenantUser._id.equals(currentUser._id)) {
            throw new AppError('Tenants can only view their own rent records.', 403);
        }
        query.tenant = filters.tenantId;
    }
    if (filters.propertyId) {
        // Ensure user has access to this property
        const hasAccess = await checkPropertyManagementPermission(currentUser, filters.propertyId);
        if (!hasAccess && currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Not authorized to filter by this property.', 403);
        }
        query.property = filters.propertyId;
    }
    if (filters.unitId) {
        const unitExists = await Unit.exists({ _id: filters.unitId, property: query.property });
        if (!unitExists) {
            throw new AppError('Unit not found in the specified property for filtering.', 404);
        }
        query.unit = filters.unitId;
    }
    if (filters.startDate || filters.endDate) {
        query.dueDate = query.dueDate || {};
        if (filters.startDate) query.dueDate.$gte = new Date(filters.startDate); // Ensure Date objects for comparison
        if (filters.endDate) query.dueDate.$lte = new Date(filters.endDate);     // Ensure Date objects for comparison
    }

    const sortBy = filters.sortBy || 'dueDate';
    const sortOrder = filters.sortOrder === 'desc' ? -1 : 1;
    const sortOptions = { [sortBy]: sortOrder };

    const rents = await Rent.find(query)
        .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('tenant', 'firstName lastName email')
        .sort(sortOptions)
        .limit(parseInt(limit))
        .skip(skip);

    const total = await Rent.countDocuments(query);

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.FETCH_ALL_RENTS, // Changed from READ_ALL
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
        ipAddress: currentUser.ip, // Ensure currentUser.ip is populated by middleware
        description: `User ${currentUser.email} fetched list of rent records.`,
        status: 'success',
        metadata: { filters }
    });

    return { rents, total, page: parseInt(page), limit: parseInt(limit) };
};

/**
 * Gets a single rent record by ID.
 * @param {string} rentId - The ID of the rent record.
 * @param {object} currentUser - The authenticated user.
 * @returns {Promise<Rent>} The rent document.
 * @throws {AppError} If rent record not found or user not authorized.
 */
const getRentRecordById = async (rentId, currentUser) => {
    const rent = await Rent.findById(rentId)
        .populate('lease', 'leaseStartDate leaseEndDate monthlyRent landlord tenant')
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('tenant', 'firstName lastName email');

    if (!rent) {
        throw new AppError('Rent record not found.', 404);
    }

    // Authorization:
    const isAuthorized = await checkRentRecordAccess(currentUser, rent);
    if (!isAuthorized) {
        throw new AppError('Not authorized to access this rent record.', 403);
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.READ_ONE_RENT, // Changed from READ
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
        resourceId: rent._id,
        ipAddress: currentUser.ip, // Ensure currentUser.ip is populated by middleware
        description: `User ${currentUser.email} fetched rent record ${rent._id}.`,
        status: 'success'
    });

    return rent;
};

/**
 * Updates a rent record (e.g., change due date, notes).
 * @param {string} rentId - The ID of the rent record to update.
 * @param {object} updateData - Data to update the rent record with.
 * @param {object} currentUser - The user performing the update.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Rent>} The updated rent document.
 * @throws {AppError} If rent record not found, user not authorized, or validation fails.
 */
const updateRentRecord = async (rentId, updateData, currentUser, ipAddress) => {
    const rent = await Rent.findById(rentId);
    if (!rent) {
        throw new AppError('Rent record not found.', 404);
    }

    // Authorization: Admin, Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, rent.property);
    if (!isAuthorized) {
        throw new AppError('Not authorized to update this rent record.', 403);
    }

    const oldRent = rent.toObject(); // Capture old state for audit log

    // Apply updates
    Object.keys(updateData).forEach(key => {
        if (updateData[key] !== undefined) {
            rent[key] = updateData[key];
        }
    });

    const updatedRent = await rent.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.UPDATE, // Correctly uses UPDATE from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
        resourceId: updatedRent._id,
        oldValue: oldRent,
        newValue: updatedRent.toObject(),
        ipAddress: ipAddress,
        description: `Rent record ${updatedRent._id} updated by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`RentService: Rent record ${updatedRent._id} updated by ${currentUser.email}.`);
    return updatedRent;
};

/**
 * Records a rent payment.
 * @param {string} rentId - The ID of the rent record.
 * @param {object} paymentData - Data for the payment (amountPaid, paymentDate, paymentMethod, transactionId, notes).
 * @param {object} [file] - Optional file object for payment proof (from multer).
 * @param {object} currentUser - The user recording the payment.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Rent>} The updated rent document.
 * @throws {AppError} If rent record not found, user not authorized, or missing required payment data.
 */
const recordRentPayment = async (rentId, paymentData, file, currentUser, ipAddress) => {
    const { amountPaid, paymentDate, paymentMethod, transactionId, notes } = paymentData;

    if (amountPaid === undefined || !paymentDate) {
        throw new AppError('Amount paid and payment date are required.', 400);
    }

    let rent = await Rent.findById(rentId);
    if (!rent) {
        throw new AppError('Rent record not found.', 404);
    }

    // Authorization: Admin, Landlord/PM associated with property, or Tenant for self-reporting
    const isAuthorized = await checkRentRecordAccess(currentUser, rent);
    if (!isAuthorized) {
        throw new AppError('Not authorized to record payment for this rent record.', 403);
    }

    const oldRent = rent.toObject(); // Capture old state for audit log

    // Update rent record
    rent.amountPaid = (rent.amountPaid || 0) + parseFloat(amountPaid); // Accumulate payments
    rent.paymentDate = paymentDate;
    rent.paymentMethod = paymentMethod || rent.paymentMethod;
    rent.transactionId = transactionId || rent.transactionId;
    rent.notes = notes || rent.notes;

    // Handle payment proof upload
    if (file) {
        try {
            const uploadResult = await uploadFile(file.buffer, file.mimetype, file.originalname, 'payment_proofs');
            const newMedia = await Media.create({
                filename: file.originalname,
                originalname: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                url: uploadResult.url,
                thumbnailUrl: uploadResult.thumbnailUrl || null, // If Cloudinary generates one
                uploadedBy: currentUser._id,
                relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Rent, // Link to Rent model
                relatedId: rent._id,
                description: `Payment proof for rent record ${rent.billingPeriod}`,
                tags: ['payment', 'proof'],
                isPublic: false // Keep payment proofs private
            });
            rent.paymentProof = newMedia._id; // Store reference to the Media document
            logger.info(`RentService: Payment proof uploaded for rent record ${rent._id}. Media ID: ${newMedia._id}`);
        } catch (error) {
            logger.error(`RentService: Failed to upload payment proof for rent record ${rent._id}: ${error.message}`);
            throw new AppError(`Failed to upload payment proof: ${error.message}`, 500);
        }
    }

    // Update status based on payment
    if (rent.amountPaid >= rent.amountDue) {
        rent.status = PAYMENT_STATUS_ENUM.find(s => s === 'paid');
    } else if (rent.amountPaid > 0 && rent.amountPaid < rent.amountDue) {
        rent.status = PAYMENT_STATUS_ENUM.find(s => s === 'partially_paid');
    } else {
        // If amountPaid somehow becomes 0 or less, revert to due/overdue based on date
        rent.status = (new Date() > rent.dueDate) ? PAYMENT_STATUS_ENUM.find(s => s === 'overdue') : PAYMENT_STATUS_ENUM.find(s => s === 'due');
    }

    const updatedRent = await rent.save();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.RECORD_PAYMENT, // Changed from RECORD_PAYMENT (assuming it was undefined before)
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
        resourceId: updatedRent._id,
        oldValue: { amountPaid: oldRent.amountPaid, status: oldRent.status, paymentProof: oldRent.paymentProof },
        newValue: { amountPaid: updatedRent.amountPaid, status: updatedRent.status, paymentDate: updatedRent.paymentDate, paymentProof: updatedRent.paymentProof },
        ipAddress: ipAddress,
        description: `Payment of ${amountPaid} recorded for rent record ${rent._id} by ${currentUser.email}. New status: ${updatedRent.status}.`,
        status: 'success'
    });

    // Notify tenant if payment recorded by someone else
    if (!currentUser._id.equals(rent.tenant)) {
        const tenant = await User.findById(rent.tenant);
        if (tenant) {
            const rentLink = `${FRONTEND_URL}/rents/${rent._id}`;
            await createInAppNotification(
                tenant._id,
                NOTIFICATION_TYPE_ENUM.find(t => t === 'payment_recorded'),
                `A payment of ${rent.currency} ${amountPaid} has been recorded for your rent due on ${new Date(rent.dueDate).toLocaleDateString()}. Your new status is ${updatedRent.status}.`,
                { kind: AUDIT_RESOURCE_TYPE_ENUM.Rent, item: updatedRent._id },
                rentLink,
                { rentId: updatedRent._id, amountPaid, newStatus: updatedRent.status },
                currentUser._id
            );
        }
    }

    logger.info(`RentService: Payment recorded for rent record ${updatedRent._id} by ${currentUser.email}.`);
    return updatedRent;
};

/**
 * Deletes a rent record.
 * @param {string} rentId - The ID of the rent record to delete.
 * @param {object} currentUser - The user performing the deletion.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<void>}
 * @throws {AppError} If rent record not found or user not authorized.
 */
const deleteRentRecord = async (rentId, currentUser, ipAddress) => {
    const rentToDelete = await Rent.findById(rentId);
    if (!rentToDelete) {
        throw new AppError('Rent record not found.', 404);
    }

    // Authorization: Admin, Landlord/PM associated with the property
    const isAuthorized = await checkPropertyManagementPermission(currentUser, rentToDelete.property);
    if (!isAuthorized) {
        throw new AppError('Not authorized to delete this rent record.', 403);
    }

    const oldRent = rentToDelete.toObject(); // Capture old state for audit log

    // Delete associated payment proof media if it exists
    if (rentToDelete.paymentProof) {
        try {
            const mediaDoc = await Media.findById(rentToDelete.paymentProof);
            if (mediaDoc) {
                // Extract public ID from Cloudinary URL
                const publicIdMatch = mediaDoc.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
                if (publicIdMatch && publicIdMatch[1]) {
                    const publicId = publicIdMatch[1];
                    await deleteFile(publicId); // Delete from Cloudinary
                    logger.info(`RentService: Deleted payment proof media ${publicId} from Cloudinary.`);
                } else {
                    logger.warn(`RentService: Could not extract public ID from media URL: ${mediaDoc.url}. Skipping Cloudinary deletion.`);
                }
                await mediaDoc.deleteOne(); // Delete Media document
                logger.info(`RentService: Deleted Media document for payment proof ${mediaDoc._id}.`);
            }
        } catch (error) {
            logger.error(`RentService: Failed to delete payment proof media for rent record ${rentId}: ${error.message}`);
            // Continue with deletion even if media deletion fails
        }
    }

    await rentToDelete.deleteOne();

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.DELETE, // Correctly uses DELETE from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
        resourceId: rentId,
        oldValue: oldRent,
        newValue: null,
        ipAddress: ipAddress,
        description: `Rent record ${oldRent._id} (Tenant: ${oldRent.tenant}, Period: ${oldRent.billingPeriod}) deleted by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`RentService: Rent record ${oldRent._id} deleted by ${currentUser.email}.`);
};

/**
 * Gets upcoming rent due dates for a user.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Optional filters (e.g., propertyId, unitId, daysAhead).
 * @returns {Promise<Array<Rent>>} Array of upcoming rent records.
 * @throws {AppError} If user not authorized.
 */
const getUpcomingRent = async (currentUser, filters) => {
    let query = {
        status: { $in: [PAYMENT_STATUS_ENUM.find(s => s === 'due'), PAYMENT_STATUS_ENUM.find(s => s === 'partially_paid'), PAYMENT_STATUS_ENUM.find(s => s === 'overdue')] },
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    const daysAhead = filters.daysAhead ? parseInt(filters.daysAhead) : 30; // Default to 30 days
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + daysAhead);
    futureDate.setHours(23, 59, 59, 999); // Normalize to end of day

    query.dueDate = { $gte: today, $lte: futureDate };

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
        throw new AppError('Not authorized to view upcoming rent.', 403);
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

    const upcomingRent = await Rent.find(query)
        .populate('lease', 'monthlyRent')
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('tenant', 'firstName lastName email')
        .sort({ dueDate: 1 }); // Sort by earliest due date first

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.FETCH_ALL_RENTS, // Changed from READ_ALL
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
        description: `User ${currentUser.email} fetched upcoming rent records.`,
        status: 'success',
        metadata: { filters }
    });

    return upcomingRent;
};

/**
 * Gets rent history for a specific lease, tenant, or property.
 * @param {object} currentUser - The authenticated user.
 * @param {object} filters - Filters (leaseId, tenantId, propertyId, startDate, endDate).
 * @returns {Promise<Array<Rent>>} Array of rent history records.
 * @throws {AppError} If user not authorized or invalid filters.
 */
const getRentHistory = async (currentUser, filters) => {
    let query = {};

    // Base filtering based on user role
    if (currentUser.role === ROLE_ENUM.ADMIN) {
        // Admin can see all
    } else if (currentUser.role === ROLE_ENUM.TENANT) {
        query.tenant = currentUser._id; // Tenant sees only their own history
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
        throw new AppError('Not authorized to view rent history.', 403);
    }

    // Apply additional filters if provided and authorized
    if (filters.leaseId) {
        const lease = await Lease.findById(filters.leaseId);
        if (!lease) throw new AppError('Lease not found for history query.', 404);
        const hasAccess = await checkRentRecordAccess(currentUser, { property: lease.property, tenant: lease.tenant });
        if (!hasAccess) throw new AppError('Not authorized to view history for this lease.', 403);
        query.lease = filters.leaseId;
    }

    if (filters.tenantId) {
        const tenantUser = await User.findById(filters.tenantId);
        if (!tenantUser) throw new AppError('Tenant not found for history query.', 404);
        if (currentUser.role === ROLE_ENUM.TENANT && !tenantUser._id.equals(currentUser._id)) {
            throw new AppError('Tenants can only view their own rent history.', 403);
        }
        // For landlords/PMs, ensure tenant is associated with their properties
        if (currentUser.role !== ROLE_ENUM.ADMIN && currentUser.role !== ROLE_ENUM.TENANT) {
            const tenantPropertyAssociations = await PropertyUser.find({
                user: filters.tenantId,
                roles: PROPERTY_USER_ROLES_ENUM.TENANT,
                isActive: true
            }).distinct('property');

            const authorizedProperties = query.property ? query.property.$in.map(id => id.toString()) : [];
            const intersection = tenantPropertyAssociations.filter(propId =>
                authorizedProperties.includes(propId.toString())
            );

            if (intersection.length === 0 && (!query.property || query.property.$in.length === 0)) {
                // If no property filter, check if any overlap with user's managed properties
                const userManagedProperties = await PropertyUser.find({
                    user: currentUser._id,
                    roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
                    isActive: true
                }).distinct('property');
                const hasAccess = tenantPropertyAssociations.some(propId =>
                    userManagedProperties.some(managedPropId => managedPropId.equals(propId))
                );
                if (!hasAccess) {
                    throw new AppError('Not authorized to view history for this tenant.', 403);
                }
            } else if (intersection.length === 0 && query.property) {
                throw new AppError('Not authorized to view history for this tenant in the specified property.', 403);
            }
        }
        query.tenant = filters.tenantId;
    }

    if (filters.propertyId) {
        const property = await Property.findById(filters.propertyId);
        if (!property) throw new AppError('Property not found for history query.', 404);
        const hasAccess = await checkPropertyManagementPermission(currentUser, filters.propertyId);
        if (!hasAccess && currentUser.role !== ROLE_ENUM.ADMIN) {
            throw new AppError('Not authorized to view history for this property.', 403);
        }
        query.property = filters.propertyId;
    }

    if (filters.startDate || filters.endDate) {
        query.dueDate = query.dueDate || {};
        if (filters.startDate) query.dueDate.$gte = new Date(filters.startDate);
        if (filters.endDate) query.dueDate.$lte = new Date(filters.endDate);
    }

    const rentHistory = await Rent.find(query)
        .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .populate('tenant', 'firstName lastName email')
        .sort({ dueDate: -1 }); // Most recent first

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.FETCH_ALL_RENTS, // Changed from READ_ALL
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
        description: `User ${currentUser.email} fetched rent history.`,
        status: 'success',
        metadata: { filters }
    });

    return rentHistory;
};

/**
 * Uploads payment proof for a rent record.
 * @param {string} rentId - The ID of the rent record.
 * @param {object} file - The file object (from multer, containing buffer/path).
 * @param {object} currentUser - The user uploading the proof.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<Rent>} The updated rent document with paymentProof reference.
 * @throws {AppError} If rent record not found, user not authorized, or file missing.
 */
const uploadPaymentProof = async (rentId, file, currentUser, ipAddress) => {
    if (!file) {
        throw new AppError('No file provided for payment proof upload.', 400);
    }

    let rent = await Rent.findById(rentId);
    if (!rent) {
        throw new AppError('Rent record not found.', 404);
    }

    // Authorization: Admin, Landlord/PM, or Tenant for their own record
    const isAuthorized = await checkRentRecordAccess(currentUser, rent);
    if (!isAuthorized) {
        throw new AppError('Not authorized to upload payment proof for this rent record.', 403);
    }

    const oldPaymentProofId = rent.paymentProof; // Capture old for potential deletion

    // Upload new file to Cloudinary
    let newMediaDoc;
    try {
        const uploadResult = await uploadFile(file.buffer, file.mimetype, file.originalname, 'payment_proofs');
        newMediaDoc = await Media.create({
            filename: file.originalname,
            originalname: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            url: uploadResult.url,
            thumbnailUrl: uploadResult.thumbnailUrl || null,
            uploadedBy: currentUser._id,
            relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Rent, // Link to Rent model
            relatedId: rent._id,
            description: `Payment proof for rent record ${rent.billingPeriod}`,
            tags: ['payment', 'proof'],
            isPublic: false
        });
    } catch (error) {
        logger.error(`RentService: Failed to upload payment proof for rent record ${rentId}: ${error.message}`);
        throw new AppError(`Failed to upload payment proof: ${error.message}`, 500);
    }

    // Update rent record with new payment proof reference
    rent.paymentProof = newMediaDoc._id;
    const updatedRent = await rent.save();

    // If an old payment proof existed, delete it from Cloudinary and Media collection
    if (oldPaymentProofId) {
        try {
            const oldMediaDoc = await Media.findById(oldPaymentProofId);
            if (oldMediaDoc) {
                const publicIdMatch = oldMediaDoc.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
                if (publicIdMatch && publicIdMatch[1]) {
                    const publicId = publicIdMatch[1];
                    await deleteFile(publicId); // Delete from Cloudinary
                    logger.info(`RentService: Deleted old payment proof media ${publicId} from Cloudinary.`);
                }
                await oldMediaDoc.deleteOne(); // Delete Media document
                logger.info(`RentService: Deleted old Media document for payment proof ${oldMediaDoc._id}.`);
            }
        } catch (error) {
            logger.error(`RentService: Failed to delete old payment proof media ${oldPaymentProofId}: ${error.message}`);
            // Log error but don't block the main operation
        }
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.FILE_UPLOAD, // Correctly uses FILE_UPLOAD from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
        resourceId: rent._id,
        oldValue: { paymentProof: oldPaymentProofId },
        newValue: { paymentProof: newMediaDoc._id, fileName: file.originalname, url: newMediaDoc.url },
        ipAddress: ipAddress,
        description: `Payment proof "${file.originalname}" uploaded for rent record ${rent._id} by ${currentUser.email}.`,
        status: 'success'
    });

    logger.info(`RentService: Payment proof uploaded for rent record ${rent._id} by ${currentUser.email}.`);
    return updatedRent;
};

/**
 * Provides a download URL for a rent payment proof.
 * @param {string} rentId - The ID of the rent record.
 * @param {object} currentUser - The user requesting the download.
 * @param {string} ipAddress - IP address of the request.
 * @returns {Promise<object>} Object containing downloadUrl, fileName, and mimeType.
 * @throws {AppError} If rent record not found, no proof found, or user not authorized.
 */
const downloadPaymentProof = async (rentId, currentUser, ipAddress) => {
    const rent = await Rent.findById(rentId);
    if (!rent) {
        throw new AppError('Rent record not found.', 404);
    }

    if (!rent.paymentProof) {
        throw new AppError('No payment proof found for this rent record.', 404);
    }

    // Authorization: Admin, Landlord/PM, or Tenant associated with rent
    const isAuthorized = await checkRentRecordAccess(currentUser, rent);
    if (!isAuthorized) {
        throw new AppError('Not authorized to download this payment proof.', 403);
    }

    const mediaDoc = await Media.findById(rent.paymentProof);
    if (!mediaDoc) {
        throw new AppError('Payment proof media not found in storage.', 404);
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.FILE_DOWNLOAD, // Correctly uses FILE_DOWNLOAD from object enum
        user: currentUser._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
        resourceId: rent._id,
        metadata: {
            documentFileName: mediaDoc.originalname,
            documentUrl: mediaDoc.url
        },
        ipAddress: ipAddress,
        status: 'success',
        description: `Payment proof "${mediaDoc.originalname}" downloaded from rent record ${rent._id} by ${currentUser.email}.`
    });

    return {
        downloadUrl: mediaDoc.url, // Directly return the Cloudinary URL
        fileName: mediaDoc.originalname,
        mimeType: mediaDoc.mimeType
    };
};


module.exports = {
    createRentRecord,
    getAllRentRecords,
    getRentRecordById,
    updateRentRecord,
    recordRentPayment,
    deleteRentRecord,
    getUpcomingRent,
    getRentHistory,
    uploadPaymentProof,
    downloadPaymentProof,
};
