// src/services/rentService.js

const mongoose = require('mongoose');
const Rent = require('../models/rent');
const RentSchedule = require('../models/rentSchedule');
const Lease = require('../models/lease');
const Property = require('../models/property');
const Unit = require('../models/unit');
const User = require('../models/user');
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
    PAYMENT_STATUS_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM
} = require('../utils/constants/enums');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Helper to check if a user has management permission for a given property
 * @param {Object} user - The authenticated user
 * @param {string} propertyId - Property ID
 * @returns {Promise<boolean>} True if authorized
 */
const checkPropertyManagementPermission = async (user, propertyId) => {
    try {
        if (user.role === ROLE_ENUM.ADMIN) {
            return true; // Admin has global access
        }

        const hasAccess = await PropertyUser.exists({
            user: user._id,
            property: propertyId,
            isActive: true,
            roles: { $in: [
                PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
            ]}
        });
        
        return !!hasAccess;
    } catch (error) {
        logger.error(`RentService - Error checking property management permission: ${error.message}`, {
            userId: user?._id,
            propertyId
        });
        return false; // Fail safely
    }
};

/**
 * Helper to check if a user has access to a rent record
 * @param {Object} user - The authenticated user
 * @param {Object} rent - Rent document
 * @returns {Promise<boolean>} True if authorized
 */
const checkRentRecordAccess = async (user, rent) => {
    try {
        if (user.role === ROLE_ENUM.ADMIN) {
            return true;
        }
        
        // Tenant can access their own rent
        if (rent.tenant && rent.tenant.toString() === user._id.toString()) {
            return true;
        }
        
        // Check if user is a landlord or property manager for this property
        return await checkPropertyManagementPermission(user, rent.property);
    } catch (error) {
        logger.error(`RentService - Error checking rent record access: ${error.message}`, {
            userId: user?._id,
            rentId: rent?._id
        });
        return false; // Fail safely
    }
};

/**
 * Creates a new rent record
 * @param {Object} rentData - Rent data
 * @param {string} rentData.lease - Lease ID
 * @param {number} rentData.amountDue - Amount due
 * @param {Date} rentData.dueDate - Due date
 * @param {string} rentData.billingPeriod - Billing period (YYYY-MM)
 * @param {string} [rentData.status='due'] - Initial status
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Created rent record
 * @throws {AppError} If validation fails
 */
const createRentRecord = async (rentData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { 
            lease: leaseId, 
            amountDue, 
            dueDate, 
            billingPeriod, 
            status = 'due',
            notes
        } = rentData;

        // Find and validate lease
        const lease = await Lease.findById(leaseId)
            .populate('property')
            .populate('unit')
            .populate('tenant')
            .session(session);

        if (!lease) {
            throw new AppError('Lease not found.', 404);
        }
        
        if (!lease.property || !lease.unit || !lease.tenant) {
            throw new AppError('Associated property, unit, or tenant not found for the lease.', 500);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property._id);
        if (!isAuthorized) {
            throw new AppError('Not authorized to create rent records for this lease.', 403);
        }

        // Validate billing period format (YYYY-MM)
        if (!billingPeriod.match(/^\d{4}-\d{2}$/)) {
            throw new AppError('Billing period must be in YYYY-MM format.', 400);
        }

        // Check for duplicate rent record
        const existingRent = await Rent.findOne({
            lease: leaseId,
            billingPeriod: billingPeriod,
            isActive: true
        }).session(session);
        
        if (existingRent) {
            throw new AppError(`Rent record for billing period ${billingPeriod} already exists for this lease.`, 409);
        }

        // Create new rent record
        const newRent = new Rent({
            lease: leaseId,
            tenant: lease.tenant._id,
            property: lease.property._id,
            unit: lease.unit._id,
            billingPeriod,
            amountDue,
            currency: lease.currency || 'UGX',
            dueDate: new Date(dueDate),
            status: status.toLowerCase(),
            notes,
            isActive: true,
            createdBy: currentUser._id
        });

        const createdRent = await newRent.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.Rent,
            createdRent._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Rent record created for lease ${leaseId} (Tenant: ${lease.tenant.email}, Period: ${billingPeriod}) by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    leaseId,
                    tenantId: lease.tenant._id,
                    propertyId: lease.property._id,
                    unitId: lease.unit._id,
                    billingPeriod,
                    amountDue,
                    dueDate
                },
                newValue: createdRent.toObject()
            },
            { session }
        );

        // Notify tenant about new rent record
        try {
            await notificationService.sendNotification({
                recipientId: lease.tenant._id,
                type: NOTIFICATION_TYPE_ENUM.RENT_DUE,
                message: `A new rent bill of ${createdRent.currency} ${amountDue.toLocaleString()} has been created for ${billingPeriod}.`,
                link: `${FRONTEND_URL}/rents/${createdRent._id}`,
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
                relatedResourceId: createdRent._id,
                emailDetails: {
                    subject: `New Rent Bill for ${lease.property.name} - ${lease.unit.unitName}`,
                    html: `
                        <p>Hello ${lease.tenant.firstName},</p>
                        <p>A new rent bill has been created for your unit ${lease.unit.unitName} in ${lease.property.name}.</p>
                        <p><strong>Billing Period:</strong> ${billingPeriod}</p>
                        <p><strong>Amount Due:</strong> ${createdRent.currency} ${amountDue.toLocaleString()}</p>
                        <p><strong>Due Date:</strong> ${new Date(dueDate).toLocaleDateString()}</p>
                        <p><a href="${FRONTEND_URL}/rents/${createdRent._id}">View Rent Details</a></p>
                    `,
                    text: `Hello ${lease.tenant.firstName}, A new rent bill has been created for your unit ${lease.unit.unitName} in ${lease.property.name}. Billing Period: ${billingPeriod}, Amount Due: ${createdRent.currency} ${amountDue.toLocaleString()}, Due Date: ${new Date(dueDate).toLocaleDateString()}. View details at: ${FRONTEND_URL}/rents/${createdRent._id}`
                },
                senderId: currentUser._id
            }, { session });
        } catch (notificationError) {
            logger.warn(`Failed to send rent creation notification: ${notificationError.message}`);
            // Continue even if notification fails
        }

        await session.commitTransaction();
        
        logger.info(`RentService: Rent record created for lease ${leaseId} by ${currentUser.email}.`);
        
        // Return populated rent record
        return Rent.findById(createdRent._id)
            .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RentService - Error creating rent record: ${error.message}`, {
            userId: currentUser?._id,
            leaseId: rentData?.lease
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to create rent record: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets rent records with filtering and pagination
 * @param {Object} currentUser - The authenticated user
 * @param {Object} filters - Query filters
 * @param {string} [filters.status] - Filter by status
 * @param {string} [filters.billingPeriod] - Filter by billing period
 * @param {string} [filters.leaseId] - Filter by lease
 * @param {string} [filters.tenantId] - Filter by tenant
 * @param {string} [filters.propertyId] - Filter by property
 * @param {string} [filters.unitId] - Filter by unit
 * @param {Date} [filters.startDate] - Filter by due date on or after
 * @param {Date} [filters.endDate] - Filter by due date on or before
 * @param {string} [filters.sortBy='dueDate'] - Sort field
 * @param {string} [filters.sortOrder='asc'] - Sort order
 * @param {number} [page=1] - Page number
 * @param {number} [limit=10] - Items per page
 * @returns {Promise<Object>} Paginated rent records
 * @throws {AppError} If unauthorized
 */
const getAllRentRecords = async (currentUser, filters, page = 1, limit = 10) => {
    try {
        let query = { isActive: true };
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Base filtering based on user role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin sees all
        } else if (currentUser.role === ROLE_ENUM.TENANT) {
            query.tenant = currentUser._id; // Tenant sees only their own rent
        } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            const userAssociatedProperties = await PropertyUser.find({
                user: currentUser._id,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('property');

            if (userAssociatedProperties.length === 0) {
                return { 
                    rents: [], 
                    total: 0, 
                    page: parseInt(page), 
                    limit: parseInt(limit),
                    pages: 0
                };
            }
            
            query.property = { $in: userAssociatedProperties };
        } else {
            throw new AppError('Not authorized to view rent records.', 403);
        }

        // Apply filters
        if (filters.status) {
            if (!PAYMENT_STATUS_ENUM.includes(filters.status.toLowerCase())) {
                throw new AppError(`Invalid status filter: ${filters.status}. Allowed values: ${PAYMENT_STATUS_ENUM.join(', ')}`, 400);
            }
            query.status = filters.status.toLowerCase();
        }
        
        if (filters.billingPeriod) {
            if (!filters.billingPeriod.match(/^\d{4}-\d{2}$/)) {
                throw new AppError('Billing period must be in YYYY-MM format.', 400);
            }
            query.billingPeriod = filters.billingPeriod;
        }
        
        if (filters.leaseId) {
            const lease = await Lease.findById(filters.leaseId);
            if (!lease) {
                throw new AppError('Lease not found for filtering.', 404);
            }
            
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const hasAccess = await checkRentRecordAccess(currentUser, { 
                    property: lease.property, 
                    tenant: lease.tenant 
                });
                
                if (!hasAccess) {
                    throw new AppError('Not authorized to filter by this lease.', 403);
                }
            }
            
            query.lease = filters.leaseId;
        }
        
        if (filters.tenantId) {
            const tenantUser = await User.findById(filters.tenantId);
            if (!tenantUser) {
                throw new AppError('Tenant not found for filtering.', 404);
            }
            
            if (currentUser.role === ROLE_ENUM.TENANT && tenantUser._id.toString() !== currentUser._id.toString()) {
                throw new AppError('Tenants can only view their own rent records.', 403);
            }
            
            query.tenant = filters.tenantId;
        }
        
        if (filters.propertyId) {
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const hasAccess = await checkPropertyManagementPermission(currentUser, filters.propertyId);
                if (!hasAccess && currentUser.role !== ROLE_ENUM.TENANT) {
                    throw new AppError('Not authorized to filter by this property.', 403);
                }
            }
            
            query.property = filters.propertyId;
        }
        
        if (filters.unitId) {
            if (filters.propertyId) {
                const unitExists = await Unit.exists({ 
                    _id: filters.unitId, 
                    property: filters.propertyId 
                });
                
                if (!unitExists) {
                    throw new AppError('Unit not found in the specified property.', 404);
                }
            }
            
            query.unit = filters.unitId;
        }
        
        if (filters.startDate || filters.endDate) {
            query.dueDate = {};
            if (filters.startDate) {
                query.dueDate.$gte = new Date(filters.startDate);
            }
            if (filters.endDate) {
                query.dueDate.$lte = new Date(filters.endDate);
            }
        }

        // Set up sorting
        const sortBy = filters.sortBy || 'dueDate';
        const sortOrder = filters.sortOrder === 'desc' ? -1 : 1;
        const sort = { [sortBy]: sortOrder };

        // Execute query
        const [rents, total] = await Promise.all([
            Rent.find(query)
                .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
                .populate('property', 'name address')
                .populate('unit', 'unitName')
                .populate('tenant', 'firstName lastName email avatar')
                .populate('paymentProof')
                .populate('createdBy', 'firstName lastName email')
                .populate({
                    path: 'paymentHistory.recordedBy',
                    select: 'firstName lastName email'
                })
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit)),
            Rent.countDocuments(query)
        ]);

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Rent,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched list of rent records.`,
                status: 'success',
                metadata: { filters, page, limit }
            }
        );

        return { 
            rents, 
            total, 
            page: parseInt(page), 
            limit: parseInt(limit),
            pages: Math.ceil(total / parseInt(limit))
        };
    } catch (error) {
        logger.error(`RentService - Error getting rent records: ${error.message}`, {
            userId: currentUser?._id,
            filters
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get rent records: ${error.message}`, 500);
    }
};

/**
 * Gets a specific rent record by ID
 * @param {string} rentId - Rent record ID
 * @param {Object} currentUser - The authenticated user
 * @returns {Promise<Object>} Rent record details
 * @throws {AppError} If rent record not found or unauthorized
 */
const getRentRecordById = async (rentId, currentUser) => {
    try {
        const rent = await Rent.findOne({
            _id: rentId,
            isActive: true
        })
            .populate('lease', 'leaseStartDate leaseEndDate monthlyRent landlord tenant')
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email avatar')
            .populate('paymentProof')
            .populate('createdBy', 'firstName lastName email')
            .populate('updatedBy', 'firstName lastName email')
            .populate({
                path: 'paymentHistory.recordedBy',
                select: 'firstName lastName email'
            });

        if (!rent) {
            throw new AppError('Rent record not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRentRecordAccess(currentUser, rent);
        if (!isAuthorized) {
            throw new AppError('You do not have permission to view this rent record.', 403);
        }

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ,
            AUDIT_RESOURCE_TYPE_ENUM.Rent,
            rent._id,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} viewed rent record ${rent._id}.`,
                status: 'success'
            }
        );

        return rent;
    } catch (error) {
        logger.error(`RentService - Error getting rent record: ${error.message}`, {
            userId: currentUser?._id,
            rentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get rent record: ${error.message}`, 500);
    }
};

/**
 * Updates a rent record
 * @param {string} rentId - Rent record ID
 * @param {Object} updateData - Update data
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated rent record
 * @throws {AppError} If rent record not found or unauthorized
 */
const updateRentRecord = async (rentId, updateData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const rent = await Rent.findOne({
            _id: rentId,
            isActive: true
        }).session(session);
        
        if (!rent) {
            throw new AppError('Rent record not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, rent.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to update this rent record.', 403);
        }

        // Store old rent for audit log
        const oldRent = rent.toObject();

        // Validate billing period if provided
        if (updateData.billingPeriod && !updateData.billingPeriod.match(/^\d{4}-\d{2}$/)) {
            throw new AppError('Billing period must be in YYYY-MM format.', 400);
        }

        // Apply updates
        const updatableFields = [
            'amountDue', 'dueDate', 'billingPeriod', 
            'status', 'notes', 'reminderSent', 
            'lastReminderDate'
        ];
        
        for (const field of updatableFields) {
            if (updateData[field] !== undefined) {
                if (field === 'status') {
                    if (!PAYMENT_STATUS_ENUM.includes(updateData[field].toLowerCase())) {
                        throw new AppError(`Invalid status: ${updateData[field]}. Allowed values: ${PAYMENT_STATUS_ENUM.join(', ')}`, 400);
                    }
                    rent[field] = updateData[field].toLowerCase();
                } else {
                    rent[field] = updateData[field];
                }
            }
        }
        
        // Update tracking fields
        rent.updatedBy = currentUser._id;

        // Save changes
        const updatedRent = await rent.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Rent,
            updatedRent._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Rent record ${updatedRent._id} updated by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldRent,
                newValue: updatedRent.toObject()
            },
            { session }
        );

        // Notify tenant if significant changes were made
        if (
            oldRent.amountDue !== updatedRent.amountDue ||
            oldRent.dueDate?.toISOString() !== updatedRent.dueDate?.toISOString() ||
            oldRent.status !== updatedRent.status
        ) {
            const tenant = await User.findById(rent.tenant).session(session);
            if (tenant) {
                try {
                    await notificationService.sendNotification({
                        recipientId: tenant._id,
                        type: NOTIFICATION_TYPE_ENUM.RENT_UPDATED,
                        message: `Your rent record for ${rent.billingPeriod} has been updated.`,
                        link: `${FRONTEND_URL}/rents/${rent._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
                        relatedResourceId: rent._id,
                        emailDetails: {
                            subject: `Rent Update for ${rent.billingPeriod}`,
                            html: `
                                <p>Hello ${tenant.firstName},</p>
                                <p>Your rent record for ${rent.billingPeriod} has been updated.</p>
                                <ul>
                                    ${oldRent.amountDue !== updatedRent.amountDue ? 
                                        `<li>Amount Due: ${rent.currency} ${oldRent.amountDue.toLocaleString()} → ${rent.currency} ${updatedRent.amountDue.toLocaleString()}</li>` : ''}
                                    ${oldRent.dueDate?.toISOString() !== updatedRent.dueDate?.toISOString() ? 
                                        `<li>Due Date: ${new Date(oldRent.dueDate).toLocaleDateString()} → ${new Date(updatedRent.dueDate).toLocaleDateString()}</li>` : ''}
                                    ${oldRent.status !== updatedRent.status ? 
                                        `<li>Status: ${oldRent.status} → ${updatedRent.status}</li>` : ''}
                                </ul>
                                <p><a href="${FRONTEND_URL}/rents/${rent._id}">View Rent Details</a></p>
                            `,
                            text: `Hello ${tenant.firstName}, Your rent record for ${rent.billingPeriod} has been updated. View details at: ${FRONTEND_URL}/rents/${rent._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send rent update notification: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
        }

        await session.commitTransaction();
        
        logger.info(`RentService: Rent record ${updatedRent._id} updated by ${currentUser.email}.`);
        
        // Return populated rent record
        return Rent.findById(updatedRent._id)
            .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('paymentProof');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RentService - Error updating rent record: ${error.message}`, {
            userId: currentUser?._id,
            rentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to update rent record: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Records a payment for a rent record
 * @param {string} rentId - Rent record ID
 * @param {Object} paymentData - Payment data
 * @param {number} paymentData.amountPaid - Amount paid
 * @param {Date} paymentData.paymentDate - Payment date
 * @param {string} [paymentData.paymentMethod] - Payment method
 * @param {string} [paymentData.transactionId] - Transaction ID
 * @param {string} [paymentData.notes] - Notes
 * @param {Object} [file] - Optional payment proof file
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated rent record
 * @throws {AppError} If rent record not found or unauthorized
 */
const recordRentPayment = async (rentId, paymentData, file, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { amountPaid, paymentDate, paymentMethod, transactionId, notes } = paymentData;

        if (!amountPaid || !paymentDate) {
            throw new AppError('Amount paid and payment date are required.', 400);
        }

        if (amountPaid <= 0) {
            throw new AppError('Amount paid must be greater than zero.', 400);
        }

        const rent = await Rent.findOne({
            _id: rentId,
            isActive: true
        }).session(session);
        
        if (!rent) {
            throw new AppError('Rent record not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRentRecordAccess(currentUser, rent);
        if (!isAuthorized) {
            throw new AppError('Not authorized to record payment for this rent record.', 403);
        }

        // Store old rent for audit log
        const oldRent = rent.toObject();

        // Upload payment proof if provided
        let mediaDoc = null;
        if (file) {
            try {
                const uploadResult = await uploadFile(
                    file.buffer, 
                    file.mimetype, 
                    file.originalname, 
                    'payment_proofs'
                );
                
                mediaDoc = new Media({
                    filename: file.originalname,
                    originalname: file.originalname,
                    mimeType: file.mimetype,
                    size: file.size,
                    url: uploadResult.url,
                    thumbnailUrl: uploadResult.thumbnailUrl || null,
                    uploadedBy: currentUser._id,
                    relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Rent,
                    relatedId: rent._id,
                    description: `Payment proof for rent ${rent.billingPeriod}`,
                    tags: ['payment', 'proof'],
                    isPublic: false
                });
                
                await mediaDoc.save({ session });
            } catch (error) {
                throw new AppError(`Failed to upload payment proof: ${error.message}`, 500);
            }
        }

        // Add payment to history
        rent.paymentHistory.push({
            date: new Date(paymentDate),
            amount: parseFloat(amountPaid),
            method: paymentMethod,
            transactionId,
            notes,
            recordedBy: currentUser._id
        });
        
        // Update payment info
        rent.amountPaid = (rent.amountPaid || 0) + parseFloat(amountPaid);
        rent.paymentDate = new Date(paymentDate);
        rent.paymentMethod = paymentMethod || rent.paymentMethod;
        rent.transactionId = transactionId || rent.transactionId;
        rent.notes = notes || rent.notes;
        
        // Set payment proof if uploaded
        if (mediaDoc) {
            rent.paymentProof = mediaDoc._id;
        }
        
        // Update status based on payment
        if (rent.amountPaid >= rent.amountDue) {
            rent.status = 'paid';
        } else if (rent.amountPaid > 0) {
            rent.status = 'partially_paid';
        }
        
        // Update tracking fields
        rent.updatedBy = currentUser._id;

        // Save changes
        const updatedRent = await rent.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.PAYMENT_RECORDED,
            AUDIT_RESOURCE_TYPE_ENUM.Rent,
            updatedRent._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Payment of ${updatedRent.currency} ${amountPaid.toLocaleString()} recorded for rent ${updatedRent._id} by ${currentUser.email}.`,
                status: 'success',
                oldValue: {
                    amountPaid: oldRent.amountPaid,
                    status: oldRent.status,
                    paymentProof: oldRent.paymentProof
                },
                newValue: {
                    amountPaid: updatedRent.amountPaid,
                    status: updatedRent.status,
                    paymentDate: updatedRent.paymentDate,
                    paymentProof: updatedRent.paymentProof
                },
                metadata: {
                    paymentAmount: amountPaid,
                    newStatus: updatedRent.status,
                    paymentMethod,
                    transactionId
                }
            },
            { session }
        );

        // Notify relevant parties
        const tenant = await User.findById(rent.tenant).session(session);
        const property = await Property.findById(rent.property).populate('name').session(session);
        const unit = await Unit.findById(rent.unit).populate('unitName').session(session);
        
        // If tenant made the payment, notify property managers/landlord
        if (currentUser._id.toString() === tenant._id.toString()) {
            // Find property managers and landlord for notification
            const propertyManagers = await PropertyUser.find({
                property: rent.property,
                roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER] },
                isActive: true
            })
                .populate('user')
                .session(session);
            
            // Send notifications to all property managers and landlord
            for (const pm of propertyManagers) {
                try {
                    await notificationService.sendNotification({
                        recipientId: pm.user._id,
                        type: NOTIFICATION_TYPE_ENUM.PAYMENT_RECEIVED,
                        message: `${tenant.firstName} ${tenant.lastName} has recorded a payment of ${updatedRent.currency} ${amountPaid.toLocaleString()} for ${rent.billingPeriod}.`,
                        link: `${FRONTEND_URL}/rents/${rent._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
                        relatedResourceId: rent._id,
                        emailDetails: {
                            subject: `Rent Payment Recorded: ${property?.name || 'Property'} - ${unit?.unitName || 'Unit'}`,
                            html: `
                                <p>Hello ${pm.user.firstName},</p>
                                <p>${tenant.firstName} ${tenant.lastName} has recorded a payment of ${updatedRent.currency} ${amountPaid.toLocaleString()} for ${rent.billingPeriod}.</p>
                                <p><strong>Payment Details:</strong></p>
                                <ul>
                                    <li>Amount: ${updatedRent.currency} ${amountPaid.toLocaleString()}</li>
                                    <li>Date: ${new Date(paymentDate).toLocaleDateString()}</li>
                                    <li>Method: ${paymentMethod || 'Not specified'}</li>
                                    <li>New Status: ${updatedRent.status}</li>
                                </ul>
                                <p><a href="${FRONTEND_URL}/rents/${rent._id}">View Payment Details</a></p>
                            `,
                            text: `Hello ${pm.user.firstName}, ${tenant.firstName} ${tenant.lastName} has recorded a payment of ${updatedRent.currency} ${amountPaid.toLocaleString()} for ${rent.billingPeriod}. Payment Date: ${new Date(paymentDate).toLocaleDateString()}, Method: ${paymentMethod || 'Not specified'}, New Status: ${updatedRent.status}. View details at: ${FRONTEND_URL}/rents/${rent._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send payment notification to property manager: ${notificationError.message}`);
                    // Continue even if one notification fails
                }
            }
        } 
        // If property manager/landlord recorded payment, notify tenant
        else if (tenant) {
            try {
                await notificationService.sendNotification({
                    recipientId: tenant._id,
                    type: NOTIFICATION_TYPE_ENUM.PAYMENT_RECORDED,
                    message: `A payment of ${updatedRent.currency} ${amountPaid.toLocaleString()} has been recorded for your rent for ${rent.billingPeriod}.`,
                    link: `${FRONTEND_URL}/rents/${rent._id}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
                    relatedResourceId: rent._id,
                    emailDetails: {
                        subject: `Rent Payment Recorded: ${property?.name || 'Property'} - ${unit?.unitName || 'Unit'}`,
                        html: `
                            <p>Hello ${tenant.firstName},</p>
                            <p>A payment of ${updatedRent.currency} ${amountPaid.toLocaleString()} has been recorded for your rent for ${rent.billingPeriod}.</p>
                            <p><strong>Payment Details:</strong></p>
                            <ul>
                                <li>Amount: ${updatedRent.currency} ${amountPaid.toLocaleString()}</li>
                                <li>Date: ${new Date(paymentDate).toLocaleDateString()}</li>
                                <li>Method: ${paymentMethod || 'Not specified'}</li>
                                <li>New Status: ${updatedRent.status}</li>
                            </ul>
                            <p><a href="${FRONTEND_URL}/rents/${rent._id}">View Payment Details</a></p>
                        `,
                        text: `Hello ${tenant.firstName}, A payment of ${updatedRent.currency} ${amountPaid.toLocaleString()} has been recorded for your rent for ${rent.billingPeriod}. Payment Date: ${new Date(paymentDate).toLocaleDateString()}, Method: ${paymentMethod || 'Not specified'}, New Status: ${updatedRent.status}. View details at: ${FRONTEND_URL}/rents/${rent._id}`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send payment notification to tenant: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        await session.commitTransaction();
        
        logger.info(`RentService: Payment of ${updatedRent.currency} ${amountPaid.toLocaleString()} recorded for rent ${updatedRent._id} by ${currentUser.email}.`);
        
        // Return populated rent record
        return Rent.findById(updatedRent._id)
            .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('paymentProof')
            .populate({
                path: 'paymentHistory.recordedBy',
                select: 'firstName lastName email'
            });
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RentService - Error recording payment: ${error.message}`, {
            userId: currentUser?._id,
            rentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to record payment: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Deletes a rent record (soft delete)
 * @param {string} rentId - Rent record ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<void>}
 * @throws {AppError} If rent record not found or unauthorized
 */
const deleteRentRecord = async (rentId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const rent = await Rent.findOne({
            _id: rentId,
            isActive: true
        }).session(session);
        
        if (!rent) {
            throw new AppError('Rent record not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, rent.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to delete this rent record.', 403);
        }

        // Store old rent for audit log
        const oldRent = rent.toObject();

        // Soft delete the rent record
        rent.isActive = false;
        rent.updatedBy = currentUser._id;
        await rent.save({ session });

        // Delete associated payment proof if it exists
        if (rent.paymentProof) {
            try {
                const mediaDoc = await Media.findById(rent.paymentProof).session(session);
                if (mediaDoc) {
                    const publicIdMatch = mediaDoc.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
                    if (publicIdMatch && publicIdMatch[1]) {
                        await deleteFile(publicIdMatch[1]);
                        logger.info(`RentService: Deleted payment proof media ${publicIdMatch[1]} from storage.`);
                    }
                    await mediaDoc.deleteOne({ session });
                }
            } catch (error) {
                logger.warn(`RentService: Error deleting payment proof: ${error.message}`);
                // Continue deletion process even if document removal fails
            }
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.Rent,
            rentId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Rent record ${rentId} deleted by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldRent,
                newValue: null
            },
            { session }
        );

        // Notify tenant about deletion
        const tenant = await User.findById(rent.tenant).session(session);
        if (tenant) {
            try {
                await notificationService.sendNotification({
                    recipientId: tenant._id,
                    type: NOTIFICATION_TYPE_ENUM.RENT_DELETED,
                    message: `Your rent record for ${rent.billingPeriod} has been deleted.`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
                    relatedResourceId: rentId,
                    emailDetails: {
                        subject: `Rent Record Deleted: ${rent.billingPeriod}`,
                        html: `
                            <p>Hello ${tenant.firstName},</p>
                            <p>Your rent record for ${rent.billingPeriod} has been deleted.</p>
                            <p>If you have any questions, please contact your property manager.</p>
                        `,
                        text: `Hello ${tenant.firstName}, Your rent record for ${rent.billingPeriod} has been deleted. If you have any questions, please contact your property manager.`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send rent deletion notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        await session.commitTransaction();
        
        logger.info(`RentService: Rent record ${rentId} deleted by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RentService - Error deleting rent record: ${error.message}`, {
            userId: currentUser?._id,
            rentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete rent record: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets upcoming rent due dates
 * @param {Object} currentUser - The authenticated user
 * @param {Object} filters - Query filters
 * @param {string} [filters.propertyId] - Filter by property
 * @param {string} [filters.unitId] - Filter by unit
 * @param {number} [filters.daysAhead=30] - Days ahead to look
 * @returns {Promise<Array<Object>>} Upcoming rent records
 * @throws {AppError} If unauthorized
 */
const getUpcomingRent = async (currentUser, filters) => {
    try {
        let query = {
            isActive: true,
            status: { $in: ['due', 'partially_paid', 'overdue'] }
        };

        // Calculate date range
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const daysAhead = filters.daysAhead ? parseInt(filters.daysAhead) : 30;
        
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + daysAhead);
        futureDate.setHours(23, 59, 59, 999);
        
        query.dueDate = { $gte: today, $lte: futureDate };

        // Apply role-based access control
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin can see all
        } else if (currentUser.role === ROLE_ENUM.TENANT) {
            query.tenant = currentUser._id;
        } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            const userAssociatedProperties = await PropertyUser.find({
                user: currentUser._id,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('property');

            if (userAssociatedProperties.length === 0) {
                return [];
            }
            
            query.property = { $in: userAssociatedProperties };
        } else {
            throw new AppError('Not authorized to view upcoming rent records.', 403);
        }

        // Apply additional filters
        if (filters.propertyId) {
            if (query.property && query.property.$in) {
                // If already filtered by properties, check if requested property is in allowed list
                const allowedProperties = query.property.$in.map(id => id.toString());
                if (!allowedProperties.includes(filters.propertyId) && currentUser.role !== ROLE_ENUM.ADMIN) {
                    throw new AppError('Not authorized to access this property.', 403);
                }
            } else if (currentUser.role !== ROLE_ENUM.ADMIN && currentUser.role !== ROLE_ENUM.TENANT) {
                // If not admin or tenant and not already filtered, check permission
                const hasAccess = await checkPropertyManagementPermission(currentUser, filters.propertyId);
                if (!hasAccess) {
                    throw new AppError('Not authorized to access this property.', 403);
                }
            }
            
            // Set or override property filter
            query.property = filters.propertyId;
        }
        
        if (filters.unitId) {
            if (filters.propertyId) {
                const unitExists = await Unit.exists({ 
                    _id: filters.unitId, 
                    property: filters.propertyId 
                });
                
                if (!unitExists) {
                    throw new AppError('Unit not found in the specified property.', 404);
                }
            }
            
            query.unit = filters.unitId;
        }

        // Get upcoming rent records
        const upcomingRent = await Rent.find(query)
            .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email avatar')
            .sort({ dueDate: 1 });

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Rent,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched upcoming rent records.`,
                status: 'success',
                metadata: { 
                    filters,
                    daysAhead,
                    count: upcomingRent.length
                }
            }
        );

        return upcomingRent;
    } catch (error) {
        logger.error(`RentService - Error getting upcoming rent: ${error.message}`, {
            userId: currentUser?._id,
            filters
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get upcoming rent: ${error.message}`, 500);
    }
};

/**
 * Gets rent history with filtering
 * @param {Object} currentUser - The authenticated user
 * @param {Object} filters - Query filters
 * @param {string} [filters.leaseId] - Filter by lease
 * @param {string} [filters.tenantId] - Filter by tenant
 * @param {string} [filters.propertyId] - Filter by property
 * @param {Date} [filters.startDate] - Filter by start date
 * @param {Date} [filters.endDate] - Filter by end date
 * @returns {Promise<Array<Object>>} Rent history records
 * @throws {AppError} If unauthorized
 */
const getRentHistory = async (currentUser, filters) => {
    try {
        let query = { isActive: true };

        // Base filtering based on user role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin can see all
        } else if (currentUser.role === ROLE_ENUM.TENANT) {
            query.tenant = currentUser._id; // Tenant sees only their own rent history
        } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            const userAssociatedProperties = await PropertyUser.find({
                user: currentUser._id,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('property');

            if (userAssociatedProperties.length === 0) {
                return [];
            }
            
            query.property = { $in: userAssociatedProperties };
        } else {
            throw new AppError('Not authorized to view rent history.', 403);
        }

        // Apply filters
        if (filters.leaseId) {
            const lease = await Lease.findById(filters.leaseId);
            if (!lease) {
                throw new AppError('Lease not found for history query.', 404);
            }
            
            // Check if user has access to this lease
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const hasAccess = await checkRentRecordAccess(currentUser, { 
                    property: lease.property, 
                    tenant: lease.tenant 
                });
                
                if (!hasAccess) {
                    throw new AppError('Not authorized to view history for this lease.', 403);
                }
            }
            
            query.lease = filters.leaseId;
        }
        
        if (filters.tenantId) {
            const tenantUser = await User.findById(filters.tenantId);
            if (!tenantUser) {
                throw new AppError('Tenant not found for history query.', 404);
            }
            
            // Tenants can only view their own rent history
            if (currentUser.role === ROLE_ENUM.TENANT && tenantUser._id.toString() !== currentUser._id.toString()) {
                throw new AppError('Tenants can only view their own rent history.', 403);
            }
            
            query.tenant = filters.tenantId;
        }
        
        if (filters.propertyId) {
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const hasAccess = await checkPropertyManagementPermission(currentUser, filters.propertyId);
                if (!hasAccess && currentUser.role !== ROLE_ENUM.TENANT) {
                    throw new AppError('Not authorized to view history for this property.', 403);
                }
            }
            
            query.property = filters.propertyId;
        }
        
        if (filters.startDate || filters.endDate) {
            query.dueDate = {};
            if (filters.startDate) {
                query.dueDate.$gte = new Date(filters.startDate);
            }
            if (filters.endDate) {
                query.dueDate.$lte = new Date(filters.endDate);
            }
        }

        // Execute query
        const rentHistory = await Rent.find(query)
            .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email avatar')
            .populate('paymentProof')
            .sort({ dueDate: -1 }); // Most recent first

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Rent,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched rent history.`,
                status: 'success',
                metadata: { 
                    filters,
                    count: rentHistory.length
                }
            }
        );

        return rentHistory;
    } catch (error) {
        logger.error(`RentService - Error getting rent history: ${error.message}`, {
            userId: currentUser?._id,
            filters
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get rent history: ${error.message}`, 500);
    }
};

/**
 * Uploads payment proof for a rent record
 * @param {string} rentId - Rent record ID
 * @param {Object} file - File object from multer
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated rent record
 * @throws {AppError} If rent record not found or unauthorized
 */
const uploadPaymentProof = async (rentId, file, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        if (!file) {
            throw new AppError('No file provided for payment proof upload.', 400);
        }

        const rent = await Rent.findOne({
            _id: rentId,
            isActive: true
        }).session(session);
        
        if (!rent) {
            throw new AppError('Rent record not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRentRecordAccess(currentUser, rent);
        if (!isAuthorized) {
            throw new AppError('Not authorized to upload payment proof for this rent record.', 403);
        }

        // Store old payment proof ID for potential deletion
        const oldPaymentProofId = rent.paymentProof;

        // Upload new file to storage
        let newMediaDoc;
        try {
            const uploadResult = await uploadFile(
                file.buffer, 
                file.mimetype, 
                file.originalname, 
                'payment_proofs'
            );
            
            // Create media record
            newMediaDoc = new Media({
                filename: file.originalname,
                originalname: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                url: uploadResult.url,
                thumbnailUrl: uploadResult.thumbnailUrl || null,
                uploadedBy: currentUser._id,
                relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Rent,
                relatedId: rent._id,
                description: `Payment proof for rent ${rent.billingPeriod}`,
                tags: ['payment', 'proof'],
                isPublic: false
            });
            
            await newMediaDoc.save({ session });
        } catch (error) {
            throw new AppError(`Failed to upload payment proof: ${error.message}`, 500);
        }

        // Update rent record
        rent.paymentProof = newMediaDoc._id;
        rent.updatedBy = currentUser._id;
        
        const updatedRent = await rent.save({ session });

        // Delete old payment proof if it exists
        if (oldPaymentProofId) {
            try {
                const oldMediaDoc = await Media.findById(oldPaymentProofId).session(session);
                if (oldMediaDoc) {
                    // Extract public ID from URL
                    const publicIdMatch = oldMediaDoc.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
                    if (publicIdMatch && publicIdMatch[1]) {
                        await deleteFile(publicIdMatch[1]);
                        logger.info(`RentService: Deleted old payment proof ${publicIdMatch[1]} from storage.`);
                    }
                    
                    await oldMediaDoc.deleteOne({ session });
                }
            } catch (error) {
                logger.warn(`RentService: Error deleting old payment proof: ${error.message}`);
                // Continue even if old document removal fails
            }
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.FILE_UPLOAD,
            AUDIT_RESOURCE_TYPE_ENUM.Rent,
            updatedRent._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Payment proof "${file.originalname}" uploaded for rent ${updatedRent._id} by ${currentUser.email}.`,
                status: 'success',
                oldValue: { paymentProof: oldPaymentProofId },
                newValue: { 
                    paymentProof: newMediaDoc._id, 
                    fileName: file.originalname, 
                    url: newMediaDoc.url 
                }
            },
            { session }
        );

        // Notify relevant parties
        if (currentUser.role === ROLE_ENUM.TENANT) {
            // If tenant uploaded proof, notify property managers
            const propertyManagers = await PropertyUser.find({
                property: rent.property,
                roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER] },
                isActive: true
            })
                .populate('user')
                .session(session);
            
            // Get tenant info for the notification message
            const tenant = await User.findById(rent.tenant).session(session);
            
            // Send notifications to property managers
            for (const pm of propertyManagers) {
                try {
                    await notificationService.sendNotification({
                        recipientId: pm.user._id,
                        type: NOTIFICATION_TYPE_ENUM.PAYMENT_PROOF_UPLOADED,
                        message: `${tenant.firstName} ${tenant.lastName} has uploaded payment proof for rent ${rent.billingPeriod}.`,
                        link: `${FRONTEND_URL}/rents/${rent._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
                        relatedResourceId: rent._id,
                        emailDetails: {
                            subject: `Payment Proof Uploaded: Rent ${rent.billingPeriod}`,
                            html: `
                                <p>Hello ${pm.user.firstName},</p>
                                <p>${tenant.firstName} ${tenant.lastName} has uploaded payment proof for rent ${rent.billingPeriod}.</p>
                                <p><a href="${FRONTEND_URL}/rents/${rent._id}">View Rent Details</a></p>
                            `,
                            text: `Hello ${pm.user.firstName}, ${tenant.firstName} ${tenant.lastName} has uploaded payment proof for rent ${rent.billingPeriod}. View details at: ${FRONTEND_URL}/rents/${rent._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send payment proof notification to property manager: ${notificationError.message}`);
                    // Continue even if one notification fails
                }
            }
        } else {
            // If property manager uploaded proof, notify tenant
            const tenant = await User.findById(rent.tenant).session(session);
            if (tenant) {
                try {
                    await notificationService.sendNotification({
                        recipientId: tenant._id,
                        type: NOTIFICATION_TYPE_ENUM.PAYMENT_PROOF_UPLOADED,
                        message: `Payment proof has been uploaded for your rent ${rent.billingPeriod}.`,
                        link: `${FRONTEND_URL}/rents/${rent._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
                        relatedResourceId: rent._id,
                        emailDetails: {
                            subject: `Payment Proof Uploaded: Rent ${rent.billingPeriod}`,
                            html: `
                                <p>Hello ${tenant.firstName},</p>
                                <p>Payment proof has been uploaded for your rent ${rent.billingPeriod}.</p>
                                <p><a href="${FRONTEND_URL}/rents/${rent._id}">View Rent Details</a></p>
                            `,
                            text: `Hello ${tenant.firstName}, Payment proof has been uploaded for your rent ${rent.billingPeriod}. View details at: ${FRONTEND_URL}/rents/${rent._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send payment proof notification to tenant: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
        }

        await session.commitTransaction();
        
        logger.info(`RentService: Payment proof uploaded for rent ${updatedRent._id} by ${currentUser.email}.`);
        
        // Return updated rent with populated fields
        return Rent.findById(updatedRent._id)
            .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('paymentProof');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RentService - Error uploading payment proof: ${error.message}`, {
            userId: currentUser?._id,
            rentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to upload payment proof: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets download info for a payment proof
 * @param {string} rentId - Rent record ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Download info
 * @throws {AppError} If rent record not found or unauthorized
 */
const downloadPaymentProof = async (rentId, currentUser, ipAddress) => {
    try {
        const rent = await Rent.findOne({
            _id: rentId,
            isActive: true
        });
        
        if (!rent) {
            throw new AppError('Rent record not found.', 404);
        }

        if (!rent.paymentProof) {
            throw new AppError('No payment proof found for this rent record.', 404);
        }

        // Check authorization
        const isAuthorized = await checkRentRecordAccess(currentUser, rent);
        if (!isAuthorized) {
            throw new AppError('Not authorized to download payment proof for this rent record.', 403);
        }

        // Get media document
        const mediaDoc = await Media.findById(rent.paymentProof);
        if (!mediaDoc) {
            throw new AppError('Payment proof not found in storage.', 404);
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.FILE_DOWNLOAD,
            AUDIT_RESOURCE_TYPE_ENUM.Media,
            mediaDoc._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Payment proof "${mediaDoc.originalname}" downloaded for rent ${rent._id} by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    rentId: rent._id,
                    mediaId: mediaDoc._id,
                    fileName: mediaDoc.originalname
                }
            }
        );

        // Return download info
        return {
            downloadUrl: mediaDoc.url,
            fileName: mediaDoc.originalname,
            mimeType: mediaDoc.mimeType
        };
    } catch (error) {
        logger.error(`RentService - Error downloading payment proof: ${error.message}`, {
            userId: currentUser?._id,
            rentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to download payment proof: ${error.message}`, 500);
    }
};

/**
 * Creates a rent schedule for automatic rent generation
 * @param {Object} scheduleData - Schedule data
 * @param {string} scheduleData.lease - Lease ID
 * @param {number} scheduleData.amount - Rent amount
 * @param {string} [scheduleData.currency='UGX'] - Currency
 * @param {number} scheduleData.dueDateDay - Day of month rent is due
 * @param {string} scheduleData.billingPeriod - Billing period
 * @param {Date} scheduleData.effectiveStartDate - When schedule becomes effective
 * @param {Date} [scheduleData.effectiveEndDate] - When schedule ends
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Created rent schedule
 * @throws {AppError} If validation fails
 */
const createRentSchedule = async (scheduleData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const {
            lease: leaseId,
            amount,
            currency = 'UGX',
            dueDateDay,
            billingPeriod,
            effectiveStartDate,
            effectiveEndDate,
            notes,
            autoGenerateRent = true
        } = scheduleData;

        // Find and validate lease
        const lease = await Lease.findById(leaseId)
            .populate('property')
            .populate('unit')
            .populate('tenant')
            .session(session);

        if (!lease) {
            throw new AppError('Lease not found.', 404);
        }
        
        if (!lease.property || !lease.unit || !lease.tenant) {
            throw new AppError('Associated property, unit, or tenant not found for the lease.', 500);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property._id);
        if (!isAuthorized) {
            throw new AppError('Not authorized to create rent schedules for this lease.', 403);
        }

        // Validate billing period
        if (!['monthly', 'quarterly', 'semi_annual', 'annual'].includes(billingPeriod.toLowerCase())) {
            throw new AppError(`Invalid billing period: ${billingPeriod}. Must be one of: monthly, quarterly, semi_annual, annual`, 400);
        }

        // Check for overlapping schedules
        const overlappingSchedule = await RentSchedule.findOne({
            lease: leaseId,
            isActive: true,
            $or: [
                // New schedule starts during existing schedule
                {
                    effectiveStartDate: { $lte: new Date(effectiveStartDate) },
                    $or: [
                        { effectiveEndDate: null },
                        { effectiveEndDate: { $gte: new Date(effectiveStartDate) } }
                    ]
                },
                // New schedule ends during existing schedule
                {
                    effectiveStartDate: { $lte: effectiveEndDate ? new Date(effectiveEndDate) : new Date('2099-12-31') },
                    $or: [
                        { effectiveEndDate: null },
                        { effectiveEndDate: { $gte: new Date(effectiveStartDate) } }
                    ]
                }
            ]
        }).session(session);
        
        if (overlappingSchedule) {
            throw new AppError(`There is already an active rent schedule for this lease that overlaps with the provided date range.`, 409);
        }

        // Create rent schedule
        const newSchedule = new RentSchedule({
            lease: leaseId,
            tenant: lease.tenant._id,
            property: lease.property._id,
            unit: lease.unit._id,
            amount,
            currency: currency.toUpperCase(),
            dueDateDay,
            billingPeriod: billingPeriod.toLowerCase(),
            effectiveStartDate: new Date(effectiveStartDate),
            effectiveEndDate: effectiveEndDate ? new Date(effectiveEndDate) : null,
            autoGenerateRent,
            notes,
            isActive: true,
            createdBy: currentUser._id
        });

        const createdSchedule = await newSchedule.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.RentSchedule,
            createdSchedule._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Rent schedule created for lease ${leaseId} by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    leaseId,
                    tenantId: lease.tenant._id,
                    propertyId: lease.property._id,
                    unitId: lease.unit._id,
                    billingPeriod,
                    amount,
                    effectiveStartDate,
                    effectiveEndDate
                },
                newValue: createdSchedule.toObject()
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`RentService: Rent schedule created for lease ${leaseId} by ${currentUser.email}.`);
        
        // Return populated rent schedule
        return RentSchedule.findById(createdSchedule._id)
            .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('createdBy', 'firstName lastName email');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RentService - Error creating rent schedule: ${error.message}`, {
            userId: currentUser?._id,
            leaseId: scheduleData?.lease
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to create rent schedule: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets rent schedules with filtering
 * @param {Object} currentUser - The authenticated user
 * @param {Object} filters - Query filters
 * @param {number} [page=1] - Page number
 * @param {number} [limit=10] - Items per page
 * @returns {Promise<Object>} Paginated rent schedules
 * @throws {AppError} If unauthorized
 */
const getRentSchedules = async (currentUser, filters, page = 1, limit = 10) => {
    try {
        let query = { isActive: true };
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Base filtering based on user role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin sees all
        } else if (currentUser.role === ROLE_ENUM.TENANT) {
            query.tenant = currentUser._id; // Tenant sees only their own schedules
        } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            const userAssociatedProperties = await PropertyUser.find({
                user: currentUser._id,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('property');

            if (userAssociatedProperties.length === 0) {
                return { 
                    schedules: [], 
                    total: 0, 
                    page: parseInt(page), 
                    limit: parseInt(limit),
                    pages: 0
                };
            }
            
            query.property = { $in: userAssociatedProperties };
        } else {
            throw new AppError('Not authorized to view rent schedules.', 403);
        }

        // Apply filters (similar to rent records filtering)
        if (filters.leaseId) {
            const lease = await Lease.findById(filters.leaseId);
            if (!lease) {
                throw new AppError('Lease not found for filtering.', 404);
            }
            
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const hasAccess = await checkRentRecordAccess(currentUser, { 
                    property: lease.property, 
                    tenant: lease.tenant 
                });
                
                if (!hasAccess) {
                    throw new AppError('Not authorized to filter by this lease.', 403);
                }
            }
            
            query.lease = filters.leaseId;
        }
        
        if (filters.tenantId) {
            const tenantUser = await User.findById(filters.tenantId);
            if (!tenantUser) {
                throw new AppError('Tenant not found for filtering.', 404);
            }
            
            if (currentUser.role === ROLE_ENUM.TENANT && tenantUser._id.toString() !== currentUser._id.toString()) {
                throw new AppError('Tenants can only view their own rent schedules.', 403);
            }
            
            query.tenant = filters.tenantId;
        }
        
        if (filters.propertyId) {
            if (currentUser.role !== ROLE_ENUM.ADMIN) {
                const hasAccess = await checkPropertyManagementPermission(currentUser, filters.propertyId);
                if (!hasAccess && currentUser.role !== ROLE_ENUM.TENANT) {
                    throw new AppError('Not authorized to filter by this property.', 403);
                }
            }
            
            query.property = filters.propertyId;
        }
        
        if (filters.unitId) {
            if (filters.propertyId) {
                const unitExists = await Unit.exists({ 
                    _id: filters.unitId, 
                    property: filters.propertyId 
                });
                
                if (!unitExists) {
                    throw new AppError('Unit not found in the specified property.', 404);
                }
            }
            
            query.unit = filters.unitId;
        }
        
        if (filters.billingPeriod) {
            query.billingPeriod = filters.billingPeriod.toLowerCase();
        }

        // Execute query
        const [schedules, total] = await Promise.all([
            RentSchedule.find(query)
                .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
                .populate('property', 'name address')
                .populate('unit', 'unitName')
                .populate('tenant', 'firstName lastName email avatar')
                .populate('createdBy', 'firstName lastName email')
                .sort({ effectiveStartDate: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            RentSchedule.countDocuments(query)
        ]);

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.RentSchedule,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched list of rent schedules.`,
                status: 'success',
                metadata: { filters, page, limit }
            }
        );

        return { 
            schedules, 
            total, 
            page: parseInt(page), 
            limit: parseInt(limit),
            pages: Math.ceil(total / parseInt(limit))
        };
    } catch (error) {
        logger.error(`RentService - Error getting rent schedules: ${error.message}`, {
            userId: currentUser?._id,
            filters
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get rent schedules: ${error.message}`, 500);
    }
};

/**
 * Updates a rent schedule
 * @param {string} scheduleId - Rent schedule ID
 * @param {Object} updateData - Update data
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated rent schedule
 * @throws {AppError} If rent schedule not found or unauthorized
 */
const updateRentSchedule = async (scheduleId, updateData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const schedule = await RentSchedule.findOne({
            _id: scheduleId,
            isActive: true
        }).session(session);
        
        if (!schedule) {
            throw new AppError('Rent schedule not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, schedule.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to update this rent schedule.', 403);
        }

        // Store old schedule for audit log
        const oldSchedule = schedule.toObject();

        // Apply updates
        const updatableFields = [
            'amount', 'currency', 'dueDateDay', 'billingPeriod',
            'effectiveStartDate', 'effectiveEndDate', 'autoGenerateRent', 'notes'
        ];
        
        for (const field of updatableFields) {
            if (updateData[field] !== undefined) {
                if (field === 'billingPeriod') {
                    const period = updateData[field].toLowerCase();
                    if (!['monthly', 'quarterly', 'semi_annual', 'annual'].includes(period)) {
                        throw new AppError(`Invalid billing period: ${updateData[field]}. Must be one of: monthly, quarterly, semi_annual, annual`, 400);
                    }
                    schedule[field] = period;
                } else if (field === 'currency') {
                    schedule[field] = updateData[field].toUpperCase();
                } else {
                    schedule[field] = updateData[field];
                }
            }
        }
        
        // Check for overlapping schedules if dates changed
        if (updateData.effectiveStartDate || updateData.effectiveEndDate) {
            const startDate = updateData.effectiveStartDate 
                ? new Date(updateData.effectiveStartDate) 
                : schedule.effectiveStartDate;
                
            const endDate = updateData.effectiveEndDate 
                ? new Date(updateData.effectiveEndDate) 
                : schedule.effectiveEndDate;
            
            const overlappingSchedule = await RentSchedule.findOne({
                _id: { $ne: scheduleId },
                lease: schedule.lease,
                isActive: true,
                $or: [
                    // Schedule starts during existing schedule
                    {
                        effectiveStartDate: { $lte: startDate },
                        $or: [
                            { effectiveEndDate: null },
                            { effectiveEndDate: { $gte: startDate } }
                        ]
                    },
                    // Schedule ends during existing schedule
                    {
                        effectiveStartDate: { $lte: endDate || new Date('2099-12-31') },
                        $or: [
                            { effectiveEndDate: null },
                            { effectiveEndDate: { $gte: startDate } }
                        ]
                    }
                ]
            }).session(session);
            
            if (overlappingSchedule) {
                throw new AppError(`There is already an active rent schedule for this lease that overlaps with the provided date range.`, 409);
            }
        }
        
        // Update tracking fields
        schedule.updatedBy = currentUser._id;

        // Save changes
        const updatedSchedule = await schedule.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.RentSchedule,
            updatedSchedule._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Rent schedule ${updatedSchedule._id} updated by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldSchedule,
                newValue: updatedSchedule.toObject()
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`RentService: Rent schedule ${updatedSchedule._id} updated by ${currentUser.email}.`);
        
        // Return populated rent schedule
        return RentSchedule.findById(updatedSchedule._id)
            .populate('lease', 'leaseStartDate leaseEndDate monthlyRent')
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('createdBy', 'firstName lastName email')
            .populate('updatedBy', 'firstName lastName email');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RentService - Error updating rent schedule: ${error.message}`, {
            userId: currentUser?._id,
            scheduleId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to update rent schedule: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Deletes a rent schedule (soft delete)
 * @param {string} scheduleId - Rent schedule ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<void>}
 * @throws {AppError} If rent schedule not found or unauthorized
 */
const deleteRentSchedule = async (scheduleId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const schedule = await RentSchedule.findOne({
            _id: scheduleId,
            isActive: true
        }).session(session);
        
        if (!schedule) {
            throw new AppError('Rent schedule not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, schedule.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to delete this rent schedule.', 403);
        }

        // Store old schedule for audit log
        const oldSchedule = schedule.toObject();

        // Soft delete the schedule
        schedule.isActive = false;
        schedule.updatedBy = currentUser._id;
        await schedule.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.RentSchedule,
            scheduleId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Rent schedule ${scheduleId} deleted by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldSchedule,
                newValue: null
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`RentService: Rent schedule ${scheduleId} deleted by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RentService - Error deleting rent schedule: ${error.message}`, {
            userId: currentUser?._id,
            scheduleId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete rent schedule: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Generates rent records based on schedules
 * @param {Date} [forDate=new Date()] - Date to generate rent for
 * @param {Object} [options={}] - Generation options
 * @param {boolean} [options.forceGeneration=false] - Force generation even if already generated
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Generation results
 * @throws {AppError} If unauthorized
 */
const generateRentRecords = async (forDate = new Date(), options = {}, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Only admin, landlord, or property manager can generate rent
        if (![ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(currentUser.role)) {
            throw new AppError('Not authorized to generate rent records.', 403);
        }

        const targetDate = new Date(forDate);
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth() + 1;
        const billingPeriod = `${year}-${month.toString().padStart(2, '0')}`;
        
        // Find applicable schedules
        let scheduleQuery = {
            isActive: true,
            autoGenerateRent: true,
            effectiveStartDate: { $lte: targetDate },
            $or: [
                { effectiveEndDate: null },
                { effectiveEndDate: { $gte: targetDate } }
            ]
        };
        
        // If not admin, limit to properties user has access to
        if (currentUser.role !== ROLE_ENUM.ADMIN) {
            const userAssociatedProperties = await PropertyUser.find({
                user: currentUser._id,
                roles: { $in: [
                    PROPERTY_USER_ROLES_ENUM.LANDLORD, 
                    PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, 
                    PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS
                ]},
                isActive: true
            }).distinct('property');

            if (userAssociatedProperties.length === 0) {
                return { 
                    generated: 0,
                    skipped: 0,
                    failed: 0,
                    details: []
                };
            }
            
            scheduleQuery.property = { $in: userAssociatedProperties };
        }
        
        // Get applicable schedules
        const schedules = await RentSchedule.find(scheduleQuery)
            .populate('lease')
            .populate('property')
            .populate('unit')
            .populate('tenant')
            .session(session);
        
        // Track results
        const results = {
            generated: 0,
            skipped: 0,
            failed: 0,
            details: []
        };
        
        // Process each schedule
        for (const schedule of schedules) {
            try {
                // Skip if lease is not active
                if (schedule.lease.status !== 'active') {
                    results.skipped++;
                    results.details.push({
                        lease: schedule.lease._id,
                        tenant: schedule.tenant._id,
                        property: schedule.property._id,
                        unit: schedule.unit._id,
                        billingPeriod,
                        status: 'skipped',
                        reason: 'Lease is not active'
                    });
                    continue;
                }
                
                // Check if rent record already exists for this period
                const existingRent = await Rent.findOne({
                    lease: schedule.lease._id,
                    billingPeriod,
                    isActive: true
                }).session(session);
                
                if (existingRent && !options.forceGeneration) {
                    results.skipped++;
                    results.details.push({
                        lease: schedule.lease._id,
                        tenant: schedule.tenant._id,
                        property: schedule.property._id,
                        unit: schedule.unit._id,
                        billingPeriod,
                        status: 'skipped',
                        reason: 'Rent record already exists for this period'
                    });
                    continue;
                }
                
                // Calculate due date based on dueDateDay
                const dueDate = new Date(year, month - 1, schedule.dueDateDay);
                
                // Create new rent record
                const rentData = {
                    lease: schedule.lease._id,
                    tenant: schedule.tenant._id,
                    property: schedule.property._id,
                    unit: schedule.unit._id,
                    billingPeriod,
                    amountDue: schedule.amount,
                    currency: schedule.currency,
                    dueDate,
                    status: 'due',
                    notes: `Auto-generated rent for ${billingPeriod}`,
                    isActive: true,
                    createdBy: currentUser._id
                };
                
                // If a record already exists and we're forcing generation, update it
                if (existingRent && options.forceGeneration) {
                    Object.assign(existingRent, rentData);
                    existingRent.updatedBy = currentUser._id;
                    await existingRent.save({ session });
                } else {
                    // Create new record
                    const newRent = new Rent(rentData);
                    await newRent.save({ session });
                }
                
                // Update schedule's lastGeneratedDate
                schedule.lastGeneratedDate = new Date();
                await schedule.save({ session });
                
                results.generated++;
                results.details.push({
                    lease: schedule.lease._id,
                    tenant: schedule.tenant._id,
                    property: schedule.property._id,
                    unit: schedule.unit._id,
                    billingPeriod,
                    status: 'generated',
                    amount: schedule.amount,
                    dueDate
                });
            } catch (error) {
                results.failed++;
                results.details.push({
                    lease: schedule.lease._id,
                    tenant: schedule.tenant._id,
                    property: schedule.property._id,
                    unit: schedule.unit._id,
                    billingPeriod,
                    status: 'failed',
                    reason: error.message
                });
                
                logger.error(`RentService - Error generating rent for lease ${schedule.lease._id}: ${error.message}`);
                // Continue processing other schedules
            }
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.GENERATE_RENT,
            AUDIT_RESOURCE_TYPE_ENUM.Rent,
            null,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Rent generation for ${billingPeriod} by ${currentUser.email}. Generated: ${results.generated}, Skipped: ${results.skipped}, Failed: ${results.failed}`,
                status: 'success',
                metadata: {
                    billingPeriod,
                    forDate: targetDate,
                    results
                }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`RentService: Rent generation for ${billingPeriod} completed by ${currentUser.email}. Generated: ${results.generated}, Skipped: ${results.skipped}, Failed: ${results.failed}`);
        
        return results;
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`RentService - Error generating rent records: ${error.message}`, {
            userId: currentUser?._id,
            forDate
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to generate rent records: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
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
    createRentSchedule,
    getRentSchedules,
    updateRentSchedule,
    deleteRentSchedule,
    generateRentRecords
};