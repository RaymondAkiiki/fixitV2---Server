// src/services/leaseService.js

const mongoose = require('mongoose');
const Lease = require('../models/lease');
const Property = require('../models/property');
const Unit = require('../models/unit');
const User = require('../models/user');
const PropertyUser = require('../models/propertyUser');
const Rent = require('../models/rent');
const Media = require('../models/media');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { uploadFile, deleteFile } = require('../utils/fileUpload');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    LEASE_STATUS_ENUM,
    UNIT_STATUS_ENUM,
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
        logger.error(`LeaseService - Error checking property management permission: ${error.message}`, {
            userId: user?._id,
            propertyId
        });
        return false; // Fail safely
    }
};

/**
 * Helper to check if a user has access to a lease
 * @param {Object} user - The authenticated user
 * @param {Object} lease - Lease document
 * @returns {Promise<boolean>} True if authorized
 */
const checkLeaseAccess = async (user, lease) => {
    try {
        if (user.role === ROLE_ENUM.ADMIN) {
            return true;
        }
        
        // Tenant can access their own lease
        if (lease.tenant && lease.tenant.toString() === user._id.toString()) {
            return true;
        }
        
        // Check if user is a landlord or property manager for this property
        return await checkPropertyManagementPermission(user, lease.property);
    } catch (error) {
        logger.error(`LeaseService - Error checking lease access: ${error.message}`, {
            userId: user?._id,
            leaseId: lease?._id
        });
        return false; // Fail safely
    }
};

/**
 * Creates a new lease agreement
 * @param {Object} leaseData - Lease data
 * @param {string} leaseData.property - Property ID
 * @param {string} leaseData.unit - Unit ID
 * @param {string} leaseData.tenant - Tenant User ID
 * @param {Date} leaseData.leaseStartDate - Start date
 * @param {Date} leaseData.leaseEndDate - End date
 * @param {number} leaseData.monthlyRent - Monthly rent
 * @param {string} leaseData.currency - Currency
 * @param {number} leaseData.paymentDueDate - Payment due date
 * @param {number} [leaseData.securityDeposit=0] - Security deposit
 * @param {string} [leaseData.terms] - Lease terms
 * @param {string} [leaseData.status='active'] - Initial status
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Created lease
 * @throws {AppError} If validation fails
 */
const createLease = async (leaseData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const {
            property: propertyId,
            unit: unitId,
            tenant: tenantId,
            leaseStartDate,
            leaseEndDate,
            monthlyRent,
            currency,
            paymentDueDate,
            securityDeposit = 0,
            terms,
            status = 'active'
        } = leaseData;

        // Find entities and validate
        const [property, unit, tenant] = await Promise.all([
            Property.findById(propertyId).session(session),
            Unit.findById(unitId).session(session),
            User.findById(tenantId).session(session)
        ]);

        if (!property) {
            throw new AppError('Property not found.', 404);
        }
        
        if (!unit) {
            throw new AppError('Unit not found.', 404);
        }
        
        if (!tenant) {
            throw new AppError('Tenant not found.', 404);
        }
        
        // Verify unit belongs to property
        if (unit.property.toString() !== propertyId) {
            throw new AppError('Unit does not belong to the specified property.', 400);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
        if (!isAuthorized) {
            throw new AppError('Not authorized to create leases for this property.', 403);
        }

        // Ensure tenant is associated with this unit/property
        const tenantPropertyUser = await PropertyUser.findOne({
            user: tenantId,
            property: propertyId,
            unit: unitId,
            roles: PROPERTY_USER_ROLES_ENUM.TENANT,
            isActive: true
        }).session(session);

        if (!tenantPropertyUser) {
            throw new AppError('Tenant is not actively associated with this unit. Please ensure they are assigned to the unit first.', 400);
        }

        // Check for existing active lease
        const existingActiveLease = await Lease.findOne({
            unit: unitId,
            status: 'active',
            isActive: true
        }).session(session);
        
        if (existingActiveLease) {
            throw new AppError(`Unit ${unit.unitName} already has an active lease. Please terminate it first.`, 409);
        }

        // Find landlord
        const landlordPropertyUser = await PropertyUser.findOne({
            property: propertyId,
            roles: PROPERTY_USER_ROLES_ENUM.LANDLORD,
            isActive: true
        }).populate('user').session(session);
        
        if (!landlordPropertyUser) {
            throw new AppError('No active landlord found for this property.', 400);
        }
        
        const landlord = landlordPropertyUser.user;

        // Create lease
        const newLease = new Lease({
            property: propertyId,
            unit: unitId,
            tenant: tenantId,
            landlord: landlord._id,
            leaseStartDate: new Date(leaseStartDate),
            leaseEndDate: new Date(leaseEndDate),
            monthlyRent,
            currency: currency ? currency.toUpperCase() : 'UGX',
            paymentDueDate,
            securityDeposit,
            terms,
            status: status.toLowerCase(),
            createdBy: currentUser._id
        });

        const createdLease = await newLease.save({ session });

        // Update unit status to occupied
        await Unit.findByIdAndUpdate(
            unitId,
            { status: 'occupied' },
            { session }
        );
        
        // Update PropertyUser with lease info
        await PropertyUser.findByIdAndUpdate(
            tenantPropertyUser._id,
            { 
                'leaseInfo.leaseId': createdLease._id,
                'leaseInfo.leaseStartDate': createdLease.leaseStartDate,
                'leaseInfo.leaseEndDate': createdLease.leaseEndDate
            },
            { session }
        );

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.Lease,
            createdLease._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Lease created for tenant ${tenant.email} (Unit: ${unit.unitName}, Property: ${property.name}) by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    propertyId,
                    unitId,
                    tenantId,
                    monthlyRent,
                    currency,
                    leaseStartDate,
                    leaseEndDate
                },
                newValue: createdLease.toObject()
            },
            { session }
        );

        // Notify tenant
        try {
            await notificationService.sendNotification({
                recipientId: tenant._id,
                type: NOTIFICATION_TYPE_ENUM.LEASE_CREATED,
                message: `Your lease for unit ${unit.unitName} in ${property.name} has been created.`,
                link: `${FRONTEND_URL}/leases/${createdLease._id}`,
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
                relatedResourceId: createdLease._id,
                emailDetails: {
                    subject: `New Lease Agreement: ${property.name} - ${unit.unitName}`,
                    html: `
                        <p>Hello ${tenant.firstName},</p>
                        <p>Your new lease agreement for unit ${unit.unitName} in ${property.name} has been created.</p>
                        <p><strong>Lease Details:</strong></p>
                        <ul>
                            <li>Start Date: ${new Date(leaseStartDate).toLocaleDateString()}</li>
                            <li>End Date: ${new Date(leaseEndDate).toLocaleDateString()}</li>
                            <li>Monthly Rent: ${currency} ${monthlyRent.toLocaleString()}</li>
                            <li>Payment Due Date: Day ${paymentDueDate} of each month</li>
                        </ul>
                        <p><a href="${FRONTEND_URL}/leases/${createdLease._id}">View Lease Details</a></p>
                    `,
                    text: `Hello ${tenant.firstName}, Your new lease agreement for unit ${unit.unitName} in ${property.name} has been created. Lease period: ${new Date(leaseStartDate).toLocaleDateString()} to ${new Date(leaseEndDate).toLocaleDateString()}, Monthly Rent: ${currency} ${monthlyRent.toLocaleString()}, Due on day ${paymentDueDate} of each month. View details at: ${FRONTEND_URL}/leases/${createdLease._id}`
                },
                senderId: currentUser._id
            }, { session });
        } catch (notificationError) {
            logger.warn(`Failed to send lease creation notification: ${notificationError.message}`);
            // Continue even if notification fails
        }

        await session.commitTransaction();
        
        logger.info(`LeaseService: Lease created for tenant ${tenant.email} by ${currentUser.email}.`);
        
        // Return populated lease
        return Lease.findById(createdLease._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('landlord', 'firstName lastName email')
            .populate('documents');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`LeaseService - Error creating lease: ${error.message}`, {
            userId: currentUser?._id,
            propertyId: leaseData?.property,
            unitId: leaseData?.unit,
            tenantId: leaseData?.tenant
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to create lease: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets all leases accessible by a user with filtering and pagination
 * @param {Object} currentUser - The authenticated user
 * @param {Object} filters - Query filters
 * @param {string} [filters.status] - Filter by status
 * @param {string} [filters.propertyId] - Filter by property
 * @param {string} [filters.unitId] - Filter by unit
 * @param {string} [filters.tenantId] - Filter by tenant
 * @param {Date} [filters.startDate] - Filter by start date
 * @param {Date} [filters.endDate] - Filter by end date
 * @param {Date} [filters.expiryStartDate] - Filter by expiry start date
 * @param {Date} [filters.expiryEndDate] - Filter by expiry end date
 * @param {string} [filters.sortBy='leaseEndDate'] - Sort field
 * @param {string} [filters.sortOrder='asc'] - Sort order
 * @param {number} [page=1] - Page number
 * @param {number} [limit=10] - Items per page
 * @returns {Promise<Object>} Paginated leases with metadata
 * @throws {AppError} If unauthorized
 */
const getAllLeases = async (currentUser, filters, page = 1, limit = 10) => {
    try {
        let query = { isActive: true };
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Base filtering based on user role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin sees all
        } else if (currentUser.role === ROLE_ENUM.TENANT) {
            query.tenant = currentUser._id; // Tenant sees only their own leases
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
                return { leases: [], total: 0, page: parseInt(page), limit: parseInt(limit) };
            }
            
            query.property = { $in: userAssociatedProperties };
        } else {
            throw new AppError('Not authorized to view leases.', 403);
        }

        // Apply filters
        if (filters.status) {
            if (!LEASE_STATUS_ENUM.includes(filters.status.toLowerCase())) {
                throw new AppError(`Invalid status filter: ${filters.status}. Allowed values: ${LEASE_STATUS_ENUM.join(', ')}`, 400);
            }
            query.status = filters.status.toLowerCase();
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
            // Ensure unit exists
            const unitQuery = { _id: filters.unitId };
            if (query.property) {
                unitQuery.property = query.property;
            }
            
            const unitExists = await Unit.exists(unitQuery);
            if (!unitExists) {
                throw new AppError('Unit not found or not part of the specified property.', 404);
            }
            
            query.unit = filters.unitId;
        }
        
        if (filters.tenantId) {
            const tenantUser = await User.findById(filters.tenantId);
            if (!tenantUser) {
                throw new AppError('Tenant not found.', 404);
            }
            
            if (currentUser.role === ROLE_ENUM.TENANT && tenantUser._id.toString() !== currentUser._id.toString()) {
                throw new AppError('Tenants can only view their own leases.', 403);
            }
            
            query.tenant = filters.tenantId;
        }
        
        // Date range filters
        if (filters.startDate || filters.endDate) {
            query.leaseStartDate = {};
            if (filters.startDate) {
                query.leaseStartDate.$gte = new Date(filters.startDate);
            }
            if (filters.endDate) {
                query.leaseStartDate.$lte = new Date(filters.endDate);
            }
        }
        
        if (filters.expiryStartDate || filters.expiryEndDate) {
            query.leaseEndDate = {};
            if (filters.expiryStartDate) {
                query.leaseEndDate.$gte = new Date(filters.expiryStartDate);
            }
            if (filters.expiryEndDate) {
                query.leaseEndDate.$lte = new Date(filters.expiryEndDate);
            }
        }

        // Set up sorting
        const sortBy = filters.sortBy || 'leaseEndDate';
        const sortOrder = filters.sortOrder === 'desc' ? -1 : 1;
        const sort = { [sortBy]: sortOrder };

        // Execute query
        const [leases, total] = await Promise.all([
            Lease.find(query)
                .populate('property', 'name address')
                .populate('unit', 'unitName')
                .populate('tenant', 'firstName lastName email avatar')
                .populate('landlord', 'firstName lastName email')
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit)),
            Lease.countDocuments(query)
        ]);

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Lease,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched list of leases.`,
                status: 'success',
                metadata: { filters, page, limit }
            }
        );

        return { 
            leases, 
            total, 
            page: parseInt(page), 
            limit: parseInt(limit),
            pages: Math.ceil(total / parseInt(limit))
        };
    } catch (error) {
        logger.error(`LeaseService - Error getting leases: ${error.message}`, {
            userId: currentUser?._id,
            filters
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get leases: ${error.message}`, 500);
    }
};

/**
 * Gets a specific lease by ID
 * @param {string} leaseId - Lease ID
 * @param {Object} currentUser - The authenticated user
 * @returns {Promise<Object>} Lease details
 * @throws {AppError} If lease not found or unauthorized
 */
const getLeaseById = async (leaseId, currentUser) => {
    try {
        const lease = await Lease.findOne({
            _id: leaseId,
            isActive: true
        })
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email avatar')
            .populate('landlord', 'firstName lastName email avatar')
            .populate('documents')
            .populate('createdBy', 'firstName lastName email')
            .populate('updatedBy', 'firstName lastName email')
            .populate('terminatedBy', 'firstName lastName email')
            .populate({
                path: 'amendments.document',
                model: 'Media'
            })
            .populate({
                path: 'amendments.createdBy',
                model: 'User',
                select: 'firstName lastName email'
            });

        if (!lease) {
            throw new AppError('Lease not found.', 404);
        }

        // Check access authorization
        const isAuthorized = await checkLeaseAccess(currentUser, lease);
        if (!isAuthorized) {
            throw new AppError('You do not have permission to view this lease.', 403);
        }

        // Get payment history
        const payments = await Rent.find({
            lease: leaseId
        })
            .sort({ dueDate: -1 })
            .limit(5);

        // Get unpaid rent count
        const unpaidRentCount = await Rent.countDocuments({
            lease: leaseId,
            status: 'unpaid'
        });

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ,
            AUDIT_RESOURCE_TYPE_ENUM.Lease,
            lease._id,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} viewed lease ${lease._id}.`,
                status: 'success'
            }
        );

        // Return lease with additional context
        return {
            ...lease.toObject(),
            recentPayments: payments,
            unpaidRentCount
        };
    } catch (error) {
        logger.error(`LeaseService - Error getting lease: ${error.message}`, {
            userId: currentUser?._id,
            leaseId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get lease: ${error.message}`, 500);
    }
};

/**
 * Updates a lease
 * @param {string} leaseId - Lease ID
 * @param {Object} updateData - Update data
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated lease
 * @throws {AppError} If lease not found or unauthorized
 */
const updateLease = async (leaseId, updateData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const lease = await Lease.findOne({
            _id: leaseId,
            isActive: true
        }).session(session);
        
        if (!lease) {
            throw new AppError('Lease not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to update this lease.', 403);
        }

        // Store old lease for audit log
        const oldLease = lease.toObject();

        // Check if status change requires additional actions
        const oldStatus = lease.status;
        const newStatus = updateData.status ? updateData.status.toLowerCase() : oldStatus;
        
        // Status validation
        if (updateData.status && !LEASE_STATUS_ENUM.includes(newStatus)) {
            throw new AppError(`Invalid status: ${updateData.status}. Allowed values: ${LEASE_STATUS_ENUM.join(', ')}`, 400);
        }

        // Ensure lease dates are valid if provided
        if (updateData.leaseStartDate && updateData.leaseEndDate) {
            const startDate = new Date(updateData.leaseStartDate);
            const endDate = new Date(updateData.leaseEndDate);
            
            if (endDate <= startDate) {
                throw new AppError('Lease end date must be after start date.', 400);
            }
        } else if (updateData.leaseStartDate && !updateData.leaseEndDate) {
            const startDate = new Date(updateData.leaseStartDate);
            const currentEndDate = new Date(lease.leaseEndDate);
            
            if (currentEndDate <= startDate) {
                throw new AppError('New start date would be after current end date. Please update end date as well.', 400);
            }
        } else if (!updateData.leaseStartDate && updateData.leaseEndDate) {
            const currentStartDate = new Date(lease.leaseStartDate);
            const endDate = new Date(updateData.leaseEndDate);
            
            if (endDate <= currentStartDate) {
                throw new AppError('New end date would be before current start date. Please update start date as well.', 400);
            }
        }

        // Apply updates
        const updatableFields = [
            'leaseStartDate', 'leaseEndDate', 'monthlyRent', 'currency',
            'paymentDueDate', 'securityDeposit', 'terms', 'status'
        ];
        
        for (const field of updatableFields) {
            if (updateData[field] !== undefined) {
                if (field === 'status') {
                    lease[field] = updateData[field].toLowerCase();
                } else if (field === 'currency') {
                    lease[field] = updateData[field].toUpperCase();
                } else {
                    lease[field] = updateData[field];
                }
            }
        }
        
        // Add termination info if status changed to terminated
        if (oldStatus !== 'terminated' && newStatus === 'terminated') {
            lease.terminatedAt = new Date();
            lease.terminatedBy = currentUser._id;
            lease.terminationReason = updateData.terminationReason || 'Lease terminated by property manager.';
        }
        
        // Update tracking fields
        lease.updatedBy = currentUser._id;

        // Save changes
        const updatedLease = await lease.save({ session });

        // Update unit status if lease status changed to terminated and was active before
        if (oldStatus === 'active' && newStatus === 'terminated') {
            // Check if there are other active leases for this unit
            const activeLeaseCount = await Lease.countDocuments({
                unit: lease.unit,
                status: 'active',
                isActive: true,
                _id: { $ne: leaseId }
            }).session(session);
            
            if (activeLeaseCount === 0) {
                // No other active leases, update unit status to vacant
                await Unit.findByIdAndUpdate(
                    lease.unit,
                    { status: 'vacant' },
                    { session }
                );
                
                logger.info(`LeaseService: Unit ${lease.unit} status updated to vacant after lease termination.`);
            }
            
            // Update PropertyUser record for tenant
            await PropertyUser.updateOne(
                {
                    user: lease.tenant,
                    property: lease.property,
                    unit: lease.unit,
                    roles: PROPERTY_USER_ROLES_ENUM.TENANT,
                    isActive: true,
                    'leaseInfo.leaseId': lease._id
                },
                {
                    $set: {
                        'leaseInfo.leaseEndDate': new Date()
                    }
                },
                { session }
            );
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Lease,
            updatedLease._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Lease ${updatedLease._id} updated by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldLease,
                newValue: updatedLease.toObject(),
                metadata: {
                    statusChanged: oldStatus !== newStatus,
                    oldStatus,
                    newStatus
                }
            },
            { session }
        );

        // Notify tenant if significant changes were made
        const tenant = await User.findById(lease.tenant).session(session);
        const property = await Property.findById(lease.property).session(session);
        const unit = await Unit.findById(lease.unit).session(session);
        
        if (tenant && property && unit) {
            let notificationMessage = '';
            let emailSubject = '';
            let emailBody = '';
            
            if (oldStatus !== newStatus) {
                notificationMessage = `Your lease for unit ${unit.unitName} has been updated to status: ${newStatus}.`;
                emailSubject = `Lease Status Update: ${property.name} - ${unit.unitName}`;
                emailBody = `
                    <p>Hello ${tenant.firstName},</p>
                    <p>Your lease for unit ${unit.unitName} in ${property.name} has been updated.</p>
                    <p><strong>Status Change:</strong> ${oldStatus} → ${newStatus}</p>
                `;
                
                if (newStatus === 'terminated') {
                    emailBody += `
                        <p><strong>Termination Reason:</strong> ${lease.terminationReason}</p>
                        <p><strong>Termination Date:</strong> ${new Date().toLocaleDateString()}</p>
                    `;
                }
            } else if (updateData.monthlyRent !== undefined || 
                      updateData.leaseEndDate !== undefined ||
                      updateData.paymentDueDate !== undefined) {
                notificationMessage = `Your lease terms for unit ${unit.unitName} have been updated.`;
                emailSubject = `Lease Terms Update: ${property.name} - ${unit.unitName}`;
                emailBody = `
                    <p>Hello ${tenant.firstName},</p>
                    <p>Your lease terms for unit ${unit.unitName} in ${property.name} have been updated:</p>
                    <ul>
                `;
                
                if (updateData.monthlyRent !== undefined) {
                    emailBody += `<li>Monthly Rent: ${lease.currency} ${oldLease.monthlyRent.toLocaleString()} → ${lease.currency} ${lease.monthlyRent.toLocaleString()}</li>`;
                }
                
                if (updateData.leaseEndDate !== undefined) {
                    emailBody += `<li>Lease End Date: ${new Date(oldLease.leaseEndDate).toLocaleDateString()} → ${new Date(lease.leaseEndDate).toLocaleDateString()}</li>`;
                }
                
                if (updateData.paymentDueDate !== undefined) {
                    emailBody += `<li>Payment Due Date: Day ${oldLease.paymentDueDate} → Day ${lease.paymentDueDate}</li>`;
                }
                
                emailBody += `</ul>`;
            }
            
            if (notificationMessage) {
                try {
                    await notificationService.sendNotification({
                        recipientId: tenant._id,
                        type: NOTIFICATION_TYPE_ENUM.LEASE_UPDATED,
                        message: notificationMessage,
                        link: `${FRONTEND_URL}/leases/${lease._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
                        relatedResourceId: lease._id,
                        emailDetails: {
                            subject: emailSubject,
                            html: `
                                ${emailBody}
                                <p><a href="${FRONTEND_URL}/leases/${lease._id}">View Lease Details</a></p>
                            `,
                            text: `${notificationMessage} View details at: ${FRONTEND_URL}/leases/${lease._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send lease update notification: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
        }

        await session.commitTransaction();
        
        logger.info(`LeaseService: Lease ${updatedLease._id} updated by ${currentUser.email}.`);
        
        // Return populated lease
        return Lease.findById(updatedLease._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email avatar')
            .populate('landlord', 'firstName lastName email')
            .populate('documents')
            .populate('createdBy', 'firstName lastName email')
            .populate('updatedBy', 'firstName lastName email')
            .populate('terminatedBy', 'firstName lastName email');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`LeaseService - Error updating lease: ${error.message}`, {
            userId: currentUser?._id,
            leaseId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to update lease: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Deletes a lease (soft delete)
 * @param {string} leaseId - Lease ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<void>}
 * @throws {AppError} If lease not found or unauthorized
 */
const deleteLease = async (leaseId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const lease = await Lease.findOne({
            _id: leaseId,
            isActive: true
        }).session(session);
        
        if (!lease) {
            throw new AppError('Lease not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to delete this lease.', 403);
        }

        // Store old lease for audit log
        const oldLease = lease.toObject();

        // Delete associated documents from storage
        if (lease.documents && lease.documents.length > 0) {
            for (const docId of lease.documents) {
                try {
                    const mediaDoc = await Media.findById(docId).session(session);
                    
                    if (mediaDoc) {
                        // Extract public ID from URL
                        const publicIdMatch = mediaDoc.url.match(/\/upload\/(?:v\d+\/)?([^\/]+)\.[a-zA-Z0-9]+$/);
                        
                        if (publicIdMatch && publicIdMatch[1]) {
                            await deleteFile(publicIdMatch[1]); // Delete from storage
                            logger.info(`LeaseService: Deleted document ${publicIdMatch[1]} from storage.`);
                        }
                        
                        await mediaDoc.deleteOne({ session }); // Delete media record
                    }
                } catch (error) {
                    logger.warn(`LeaseService: Error deleting document ${docId}: ${error.message}`);
                    // Continue deletion process even if document removal fails
                }
            }
        }

        // Soft delete lease
        lease.isActive = false;
        lease.status = 'terminated';
        lease.terminatedAt = new Date();
        lease.terminatedBy = currentUser._id;
        lease.terminationReason = 'Lease deleted by administrator.';
        lease.updatedBy = currentUser._id;
        
        await lease.save({ session });

        // Update unit status if this was an active lease
        if (lease.status === 'active') {
            // Check if there are other active leases for this unit
            const activeLeaseCount = await Lease.countDocuments({
                unit: lease.unit,
                status: 'active',
                isActive: true,
                _id: { $ne: leaseId }
            }).session(session);
            
            if (activeLeaseCount === 0) {
                // No other active leases, update unit status to vacant
                await Unit.findByIdAndUpdate(
                    lease.unit,
                    { status: 'vacant' },
                    { session }
                );
                
                logger.info(`LeaseService: Unit ${lease.unit} status updated to vacant after lease deletion.`);
            }
        }

        // Update PropertyUser record
        await PropertyUser.updateOne(
            {
                user: lease.tenant,
                property: lease.property,
                unit: lease.unit,
                roles: PROPERTY_USER_ROLES_ENUM.TENANT,
                isActive: true,
                'leaseInfo.leaseId': lease._id
            },
            {
                $set: {
                    'leaseInfo.leaseId': null,
                    'leaseInfo.leaseStartDate': null,
                    'leaseInfo.leaseEndDate': null
                }
            },
            { session }
        );

        // Delete or deactivate associated rent records
        await Rent.updateMany(
            { lease: leaseId },
            { isActive: false },
            { session }
        );

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.Lease,
            leaseId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Lease ${leaseId} deleted by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldLease,
                newValue: null
            },
            { session }
        );

        // Notify tenant about lease deletion
        const tenant = await User.findById(lease.tenant).session(session);
        const property = await Property.findById(lease.property).session(session);
        const unit = await Unit.findById(lease.unit).session(session);
        
        if (tenant && property && unit) {
            try {
                await notificationService.sendNotification({
                    recipientId: tenant._id,
                    type: NOTIFICATION_TYPE_ENUM.LEASE_TERMINATED,
                    message: `Your lease for unit ${unit.unitName} in ${property.name} has been terminated.`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
                    relatedResourceId: leaseId,
                    emailDetails: {
                        subject: `Lease Terminated: ${property.name} - ${unit.unitName}`,
                        html: `
                            <p>Hello ${tenant.firstName},</p>
                            <p>Your lease for unit ${unit.unitName} in ${property.name} has been terminated.</p>
                            <p>Reason: Lease deleted by administrator.</p>
                            <p>Termination Date: ${new Date().toLocaleDateString()}</p>
                        `,
                        text: `Hello ${tenant.firstName}, Your lease for unit ${unit.unitName} in ${property.name} has been terminated. Reason: Lease deleted by administrator. Termination Date: ${new Date().toLocaleDateString()}`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send lease termination notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        await session.commitTransaction();
        
        logger.info(`LeaseService: Lease ${leaseId} deleted by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`LeaseService - Error deleting lease: ${error.message}`, {
            userId: currentUser?._id,
            leaseId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete lease: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets leases that are expiring soon
 * @param {Object} currentUser - The authenticated user
 * @param {Object} filters - Query filters
 * @param {string} [filters.propertyId] - Filter by property
 * @param {string} [filters.unitId] - Filter by unit
 * @param {number} [filters.daysAhead=90] - Days ahead to look
 * @returns {Promise<Array<Object>>} Expiring leases
 * @throws {AppError} If unauthorized
 */
const getExpiringLeases = async (currentUser, filters) => {
    try {
        // Build base query
        let query = {
            status: 'active',
            isActive: true
        };

        // Calculate date range
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const daysAhead = filters.daysAhead ? parseInt(filters.daysAhead) : 90;
        
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + daysAhead);
        futureDate.setHours(23, 59, 59, 999);
        
        query.leaseEndDate = { $gte: today, $lte: futureDate };

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
            throw new AppError('Not authorized to view expiring leases.', 403);
        }

        // Apply additional filters
        if (filters.propertyId) {
            if (query.property && query.property.$in) {
                // If we already have a property filter from role, check if requested property is in allowed list
                const allowedProperties = query.property.$in.map(id => id.toString());
                if (!allowedProperties.includes(filters.propertyId)) {
                    throw new AppError('Not authorized to access this property.', 403);
                }
            }
            
            // Set or override property filter
            query.property = filters.propertyId;
        }
        
        if (filters.unitId) {
            const unitQuery = { _id: filters.unitId };
            if (query.property) {
                if (typeof query.property === 'object' && query.property.$in) {
                    unitQuery.property = { $in: query.property.$in };
                } else {
                    unitQuery.property = query.property;
                }
            }
            
            const unitExists = await Unit.exists(unitQuery);
            if (!unitExists) {
                throw new AppError('Unit not found or not in your authorized properties.', 404);
            }
            
            query.unit = filters.unitId;
        }

        // Get expiring leases
        const expiringLeases = await Lease.find(query)
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email avatar')
            .populate('landlord', 'firstName lastName email')
            .sort({ leaseEndDate: 1 });

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Lease,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched expiring leases.`,
                status: 'success',
                metadata: { 
                    filters,
                    daysAhead,
                    count: expiringLeases.length
                }
            }
        );

        return expiringLeases;
    } catch (error) {
        logger.error(`LeaseService - Error getting expiring leases: ${error.message}`, {
            userId: currentUser?._id,
            filters
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get expiring leases: ${error.message}`, 500);
    }
};

/**
 * Marks a lease as having renewal notice sent
 * @param {string} leaseId - Lease ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated lease
 * @throws {AppError} If lease not found or unauthorized
 */
const markRenewalNoticeSent = async (leaseId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const lease = await Lease.findOne({
            _id: leaseId,
            isActive: true
        }).session(session);
        
        if (!lease) {
            throw new AppError('Lease not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to update this lease.', 403);
        }

        // Store old lease for audit log
        const oldLease = lease.toObject();

        // Update lease
        lease.renewalNoticeSent = true;
        lease.lastRenewalNoticeDate = new Date();
        lease.updatedBy = currentUser._id;
        
        const updatedLease = await lease.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Lease,
            updatedLease._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Renewal notice marked as sent for lease ${updatedLease._id} by ${currentUser.email}.`,
                status: 'success',
                oldValue: { 
                    renewalNoticeSent: oldLease.renewalNoticeSent, 
                    lastRenewalNoticeDate: oldLease.lastRenewalNoticeDate 
                },
                newValue: { 
                    renewalNoticeSent: updatedLease.renewalNoticeSent, 
                    lastRenewalNoticeDate: updatedLease.lastRenewalNoticeDate 
                }
            },
            { session }
        );

        // Notify tenant
        const tenant = await User.findById(lease.tenant).session(session);
        const property = await Property.findById(lease.property).session(session);
        const unit = await Unit.findById(lease.unit).session(session);
        
        if (tenant && property && unit) {
            try {
                await notificationService.sendNotification({
                    recipientId: tenant._id,
                    type: NOTIFICATION_TYPE_ENUM.RENEWAL_NOTICE,
                    message: `Renewal notice for your lease at ${unit.unitName} in ${property.name}.`,
                    link: `${FRONTEND_URL}/leases/${lease._id}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
                    relatedResourceId: lease._id,
                    emailDetails: {
                        subject: `Lease Renewal Notice: ${property.name} - ${unit.unitName}`,
                        html: `
                            <p>Hello ${tenant.firstName},</p>
                            <p>This is a notice regarding the upcoming expiration of your lease for unit ${unit.unitName} in ${property.name}.</p>
                            <p><strong>Current Lease End Date:</strong> ${new Date(lease.leaseEndDate).toLocaleDateString()}</p>
                            <p>Please contact your property manager to discuss renewal options.</p>
                            <p><a href="${FRONTEND_URL}/leases/${lease._id}">View Lease Details</a></p>
                        `,
                        text: `Hello ${tenant.firstName}, This is a notice regarding the upcoming expiration of your lease for unit ${unit.unitName} in ${property.name}. Current Lease End Date: ${new Date(lease.leaseEndDate).toLocaleDateString()}. Please contact your property manager to discuss renewal options.`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send renewal notice notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        await session.commitTransaction();
        
        logger.info(`LeaseService: Renewal notice marked as sent for lease ${updatedLease._id} by ${currentUser.email}.`);
        
        // Return populated lease
        return Lease.findById(updatedLease._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('landlord', 'firstName lastName email')
            .populate('documents');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`LeaseService - Error marking renewal notice: ${error.message}`, {
            userId: currentUser?._id,
            leaseId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to mark renewal notice: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Uploads a document to a lease
 * @param {string} leaseId - Lease ID
 * @param {Object} file - File object from multer
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Created media document
 * @throws {AppError} If lease not found or unauthorized
 */
const uploadLeaseDocument = async (leaseId, file, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        if (!file) {
            throw new AppError('No file provided.', 400);
        }

        const lease = await Lease.findOne({
            _id: leaseId,
            isActive: true
        }).session(session);
        
        if (!lease) {
            throw new AppError('Lease not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to upload documents to this lease.', 403);
        }

        // Upload file to storage
        let newMediaDoc;
        try {
            const uploadResult = await uploadFile(
                file.buffer, 
                file.mimetype, 
                file.originalname, 
                'lease_documents'
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
                relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Lease,
                relatedId: lease._id,
                description: `Lease document for lease ${lease._id}`,
                tags: ['lease', 'document'],
                isPublic: false
            });
            
            await newMediaDoc.save({ session });
        } catch (error) {
            throw new AppError(`Failed to upload document: ${error.message}`, 500);
        }

        // Add document to lease
        lease.documents.push(newMediaDoc._id);
        await lease.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.Media,
            newMediaDoc._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Document "${file.originalname}" uploaded to lease ${lease._id} by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    leaseId: lease._id,
                    fileName: file.originalname,
                    fileSize: file.size,
                    mimeType: file.mimetype
                },
                newValue: newMediaDoc.toObject()
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`LeaseService: Document uploaded for lease ${lease._id} by ${currentUser.email}.`);
        
        return newMediaDoc;
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`LeaseService - Error uploading document: ${error.message}`, {
            userId: currentUser?._id,
            leaseId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to upload document: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets download info for a lease document
 * @param {string} leaseId - Lease ID
 * @param {string} documentId - Document ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Download info
 * @throws {AppError} If document not found or unauthorized
 */
const downloadLeaseDocument = async (leaseId, documentId, currentUser, ipAddress) => {
    try {
        const lease = await Lease.findOne({
            _id: leaseId,
            isActive: true,
            documents: documentId
        });
        
        if (!lease) {
            throw new AppError('Lease or document not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkLeaseAccess(currentUser, lease);
        if (!isAuthorized) {
            throw new AppError('Not authorized to download this document.', 403);
        }

        // Get media document
        const mediaDoc = await Media.findById(documentId);
        if (!mediaDoc) {
            throw new AppError('Document not found.', 404);
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ,
            AUDIT_RESOURCE_TYPE_ENUM.Media,
            documentId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Document "${mediaDoc.originalname}" downloaded from lease ${leaseId} by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    leaseId,
                    fileName: mediaDoc.originalname,
                    fileSize: mediaDoc.size,
                    mimeType: mediaDoc.mimeType
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
        logger.error(`LeaseService - Error downloading document: ${error.message}`, {
            userId: currentUser?._id,
            leaseId,
            documentId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to download document: ${error.message}`, 500);
    }
};

/**
 * Generates a lease document from a template
 * @param {string} leaseId - Lease ID
 * @param {string} documentType - Document type
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Created media document
 * @throws {AppError} If lease not found or unauthorized
 */
const generateLeaseDocument = async (leaseId, documentType, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Validate document type
        if (!['renewal_notice', 'exit_letter', 'termination_notice', 'lease_notice'].includes(documentType)) {
            throw new AppError(`Invalid document type: ${documentType}. Allowed types: renewal_notice, exit_letter, termination_notice, lease_notice`, 400);
        }

        // Get lease with all needed relations
        const lease = await Lease.findOne({
            _id: leaseId,
            isActive: true
        })
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('landlord', 'firstName lastName email')
            .session(session);
        
        if (!lease) {
            throw new AppError('Lease not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property._id);
        if (!isAuthorized) {
            throw new AppError('Not authorized to generate documents for this lease.', 403);
        }

        // Prepare data for document generation
        const tenantName = `${lease.tenant.firstName} ${lease.tenant.lastName}`;
        const landlordName = `${lease.landlord.firstName} ${lease.landlord.lastName}`;
        
        const documentData = {
            tenantName,
            unitName: lease.unit.unitName,
            propertyName: lease.property.name,
            leaseStartDate: lease.leaseStartDate,
            leaseEndDate: lease.leaseEndDate,
            monthlyRent: lease.monthlyRent,
            currency: lease.currency,
            paymentDueDate: lease.paymentDueDate,
            landlordOrPmName: landlordName,
            contactEmail: lease.landlord.email
        };
        
        // Add document-specific data
        switch (documentType) {
            case 'renewal_notice':
                // Calculate new dates and rent for renewal
                const endDate = new Date(lease.leaseEndDate);
                const newStartDate = new Date(endDate);
                newStartDate.setDate(newStartDate.getDate() + 1);
                
                const newEndDate = new Date(newStartDate);
                newEndDate.setFullYear(newEndDate.getFullYear() + 1);
                
                // Assume 5% rent increase for renewal
                const newRent = Math.round(lease.monthlyRent * 1.05);
                
                documentData.subject = 'Lease Renewal Offer';
                documentData.newRentAmount = newRent;
                documentData.newLeaseStartDate = newStartDate;
                documentData.newLeaseEndDate = newEndDate;
                documentData.content = `We are pleased to offer you the opportunity to renew your lease agreement for Unit ${lease.unit.unitName} at ${lease.property.name}. Your current lease is set to expire on ${new Date(lease.leaseEndDate).toLocaleDateString()}.`;
                break;
                
            case 'exit_letter':
                documentData.subject = 'Lease Exit Instructions';
                documentData.content = `We are writing to confirm the end of your lease agreement for Unit ${lease.unit.unitName} at ${lease.property.name}. Your lease will expire on ${new Date(lease.leaseEndDate).toLocaleDateString()}.`;
                documentData.moveOutInstructions = 
                    "Move-Out Instructions:\n" +
                    "1. Schedule a move-out inspection with the property management office.\n" +
                    "2. Remove all personal belongings from the unit.\n" +
                    "3. Clean the unit thoroughly.\n" +
                    "4. Return all keys and access cards to the property management office.";
                documentData.depositInfo = `Security Deposit: Your security deposit of ${lease.currency} ${lease.securityDeposit.toLocaleString()} will be returned within 30 days of your move-out date, less any charges for damages, unpaid rent, or other charges as specified in your lease agreement.`;
                break;
                
            case 'termination_notice':
                documentData.subject = 'Lease Termination Notice';
                documentData.terminationDate = new Date();
                documentData.terminationReason = 'Lease termination as requested by property management';
                documentData.content = `This letter serves as formal notice that your lease agreement for Unit ${lease.unit.unitName} at ${lease.property.name} is being terminated.`;
                documentData.legalDisclosure = "Legal Disclosure: This termination is in accordance with the terms of your lease agreement and applicable laws. If you have questions about your rights, please consult with legal counsel.";
                break;
                
            case 'lease_notice':
                documentData.subject = 'Important Information About Your Lease';
                documentData.content = `This notice contains important information regarding your lease for Unit ${lease.unit.unitName} at ${lease.property.name}.`;
                break;
        }

        // Use document generation service to create the document
        const documentOptions = {
            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            relatedResourceId: leaseId,
            userId: currentUser._id,
            ipAddress
        };
        
        const mediaDoc = await documentGenerationService.generateAndUploadDocument(
            documentType, 
            documentData, 
            documentOptions
        );

        // Add document to lease (if not already added by the document service)
        if (!lease.documents.includes(mediaDoc._id)) {
            lease.documents.push(mediaDoc._id);
            await lease.save({ session });
        }

        // If this is a renewal notice, mark the lease as renewal notice sent
        if (documentType === 'renewal_notice') {
            lease.renewalNoticeSent = true;
            lease.lastRenewalNoticeDate = new Date();
            await lease.save({ session });
        }

        // Notify tenant about the document
        const tenant = await User.findById(lease.tenant).session(session);
        if (tenant) {
            try {
                const notificationMessages = {
                    renewal_notice: 'A lease renewal notice has been generated for your review',
                    exit_letter: 'An exit letter has been generated for your upcoming lease end',
                    termination_notice: 'A termination notice has been issued for your lease',
                    lease_notice: 'A notice regarding your lease has been generated'
                };
                
                await notificationService.sendNotification({
                    recipientId: tenant._id,
                    type: NOTIFICATION_TYPE_ENUM.DOCUMENT_GENERATED,
                    message: notificationMessages[documentType] || 'A lease document has been generated',
                    link: `${FRONTEND_URL}/leases/${leaseId}/documents/${mediaDoc._id}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
                    relatedResourceId: leaseId,
                    emailDetails: {
                        subject: `Lease Document: ${documentData.subject}`,
                        html: `
                            <p>Hello ${tenant.firstName},</p>
                            <p>A lease document has been generated for your unit ${lease.unit.unitName} in ${lease.property.name}.</p>
                            <p><a href="${FRONTEND_URL}/leases/${leaseId}/documents/${mediaDoc._id}">View Document</a></p>
                        `,
                        text: `Hello ${tenant.firstName}, A lease document (${documentData.subject}) has been generated for your unit ${lease.unit.unitName} in ${lease.property.name}. View it at: ${FRONTEND_URL}/leases/${leaseId}/documents/${mediaDoc._id}`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send document notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        await session.commitTransaction();
        
        logger.info(`LeaseService: Generated ${documentType} document for lease ${leaseId} by ${currentUser.email}.`);
        
        return mediaDoc;
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`LeaseService - Error generating document: ${error.message}`, {
            userId: currentUser?._id,
            leaseId,
            documentType
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to generate document: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Adds an amendment to a lease
 * @param {string} leaseId - Lease ID
 * @param {Object} amendmentData - Amendment data
 * @param {string} amendmentData.description - Amendment description
 * @param {string} [amendmentData.documentId] - Optional document ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated lease
 * @throws {AppError} If lease not found or unauthorized
 */
const addLeaseAmendment = async (leaseId, amendmentData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const lease = await Lease.findOne({
            _id: leaseId,
            isActive: true
        }).session(session);
        
        if (!lease) {
            throw new AppError('Lease not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkPropertyManagementPermission(currentUser, lease.property);
        if (!isAuthorized) {
            throw new AppError('Not authorized to amend this lease.', 403);
        }

        // Validate amendment data
        if (!amendmentData.description) {
            throw new AppError('Amendment description is required.', 400);
        }

        // If document ID is provided, ensure it exists and is associated with the lease
        if (amendmentData.documentId) {
            const documentExists = await Media.exists({
                _id: amendmentData.documentId,
                relatedTo: AUDIT_RESOURCE_TYPE_ENUM.Lease,
                relatedId: leaseId
            }).session(session);
            
            if (!documentExists) {
                throw new AppError('Document not found or not associated with this lease.', 404);
            }
        }

        // Create the amendment
        const amendment = {
            amendmentDate: new Date(),
            description: amendmentData.description,
            document: amendmentData.documentId || null,
            createdBy: currentUser._id
        };
        
        // Add amendment to lease
        lease.amendments.push(amendment);
        
        // Increment version number
        lease.version = (lease.version || 1) + 1;
        
        // Update tracking fields
        lease.updatedBy = currentUser._id;
        
        // Save changes
        const updatedLease = await lease.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Lease,
            updatedLease._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Amendment added to lease ${updatedLease._id} by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    amendmentDescription: amendmentData.description,
                    documentId: amendmentData.documentId,
                    newVersion: updatedLease.version
                }
            },
            { session }
        );

        // Notify tenant about the amendment
        const tenant = await User.findById(lease.tenant).populate('firstName').session(session);
        const property = await Property.findById(lease.property).session(session);
        const unit = await Unit.findById(lease.unit).session(session);
        
        if (tenant && property && unit) {
            try {
                await notificationService.sendNotification({
                    recipientId: tenant._id,
                    type: NOTIFICATION_TYPE_ENUM.LEASE_UPDATED,
                    message: `An amendment has been added to your lease for unit ${unit.unitName}.`,
                    link: `${FRONTEND_URL}/leases/${lease._id}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
                    relatedResourceId: lease._id,
                    emailDetails: {
                        subject: `Lease Amendment: ${property.name} - ${unit.unitName}`,
                        html: `
                            <p>Hello ${tenant.firstName},</p>
                            <p>An amendment has been added to your lease for unit ${unit.unitName} in ${property.name}.</p>
                            <p><strong>Amendment Details:</strong> ${amendmentData.description}</p>
                            <p><a href="${FRONTEND_URL}/leases/${lease._id}">View Lease Details</a></p>
                        `,
                        text: `Hello ${tenant.firstName}, An amendment has been added to your lease for unit ${unit.unitName} in ${property.name}. Amendment Details: ${amendmentData.description}. View details at: ${FRONTEND_URL}/leases/${lease._id}`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send lease amendment notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        await session.commitTransaction();
        
        logger.info(`LeaseService: Amendment added to lease ${updatedLease._id} by ${currentUser.email}.`);
        
        // Return populated lease
        return Lease.findById(updatedLease._id)
            .populate('property', 'name address')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email')
            .populate('landlord', 'firstName lastName email')
            .populate('documents')
            .populate({
                path: 'amendments.document',
                model: 'Media'
            })
            .populate({
                path: 'amendments.createdBy',
                model: 'User',
                select: 'firstName lastName email'
            });
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`LeaseService - Error adding amendment: ${error.message}`, {
            userId: currentUser?._id,
            leaseId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to add amendment: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets rent report for a lease
 * @param {string} leaseId - Lease ID
 * @param {Object} params - Report parameters
 * @param {Date} [params.startDate] - Start date for report
 * @param {Date} [params.endDate] - End date for report
 * @param {Object} currentUser - The authenticated user
 * @returns {Promise<Object>} Rent report data
 * @throws {AppError} If lease not found or unauthorized
 */
const getLeaseRentReport = async (leaseId, params, currentUser) => {
    try {
        const lease = await Lease.findOne({
            _id: leaseId,
            isActive: true
        })
            .populate('property', 'name')
            .populate('unit', 'unitName')
            .populate('tenant', 'firstName lastName email');
        
        if (!lease) {
            throw new AppError('Lease not found.', 404);
        }

        // Check authorization
        const isAuthorized = await checkLeaseAccess(currentUser, lease);
        if (!isAuthorized) {
            throw new AppError('Not authorized to view rent report for this lease.', 403);
        }

        // Determine date range
        const startDate = params.startDate ? new Date(params.startDate) : new Date(lease.leaseStartDate);
        const endDate = params.endDate ? new Date(params.endDate) : new Date();
        
        // Get rent records for this lease within the date range
        const rentRecords = await Rent.find({
            lease: leaseId,
            dueDate: { $gte: startDate, $lte: endDate }
        })
            .sort({ dueDate: 1 });
        
        // Calculate summaries
        const totalDue = rentRecords.reduce((sum, record) => sum + record.amount, 0);
        const totalPaid = rentRecords.reduce((sum, record) => sum + (record.amountPaid || 0), 0);
        
        // Group by status
        const statusSummary = rentRecords.reduce((summary, record) => {
            const status = record.status || 'unknown';
            summary[status] = (summary[status] || 0) + record.amount;
            return summary;
        }, {});

        // Format rent records for response
        const formattedRecords = rentRecords.map(record => ({
            id: record._id,
            dueDate: record.dueDate,
            amount: record.amount,
            amountPaid: record.amountPaid || 0,
            balance: record.amount - (record.amountPaid || 0),
            status: record.status,
            isPaid: record.status === 'paid',
            paymentDate: record.paymentDate,
            paymentMethod: record.paymentMethod,
            notes: record.notes
        }));

        // Create report object
        const report = {
            leaseId,
            propertyName: lease.property.name,
            unitName: lease.unit.unitName,
            tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
            startDate,
            endDate,
            totalDue,
            totalPaid,
            balance: totalDue - totalPaid,
            statusSummary,
            rentRecords: formattedRecords,
            currency: lease.currency
        };

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ,
            AUDIT_RESOURCE_TYPE_ENUM.Lease,
            leaseId,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} generated rent report for lease ${leaseId}.`,
                status: 'success',
                metadata: {
                    startDate,
                    endDate,
                    recordCount: rentRecords.length
                }
            }
        );

        return report;
    } catch (error) {
        logger.error(`LeaseService - Error generating rent report: ${error.message}`, {
            userId: currentUser?._id,
            leaseId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to generate rent report: ${error.message}`, 500);
    }
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
    addLeaseAmendment,
    getLeaseRentReport
};