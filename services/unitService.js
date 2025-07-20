// src/services/unitService.js

const mongoose = require('mongoose');
const Unit = require('../models/unit');
const Property = require('../models/property');
const User = require('../models/user');
const PropertyUser = require('../models/propertyUser');
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Notification = require('../models/notification');
const Comment = require('../models/comment');
const Lease = require('../models/lease');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    UNIT_STATUS_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM
} = require('../utils/constants/enums');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Helper to check if a user has management permission for a given property
 * @param {Object} user - The authenticated user
 * @param {string} propertyId - The property ID to check access for
 * @returns {Promise<boolean>} True if authorized
 */
const checkPropertyManagementPermission = async (user, propertyId) => {
    try {
        if (user.role === ROLE_ENUM.ADMIN) {
            return true; // Admin has global access
        }

        // Check if user is a landlord, property manager, or has admin access for the property
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
        logger.error(`UnitService - Error checking property management permission: ${error.message}`, {
            userId: user?._id,
            propertyId
        });
        return false; // Fail safely
    }
};

/**
 * Creates a new unit within a property
 * @param {string} propertyId - Property ID
 * @param {Object} unitData - Unit data
 * @param {string} unitData.unitName - Unit name
 * @param {string} [unitData.floor] - Floor
 * @param {string} [unitData.details] - Unit details
 * @param {number} [unitData.numBedrooms] - Number of bedrooms
 * @param {number} [unitData.numBathrooms] - Number of bathrooms
 * @param {number} [unitData.squareFootage] - Square footage
 * @param {number} [unitData.rentAmount] - Rent amount
 * @param {number} [unitData.depositAmount] - Deposit amount
 * @param {string} [unitData.status] - Unit status
 * @param {string} [unitData.utilityResponsibility] - Utility responsibility
 * @param {string} [unitData.notes] - Notes
 * @param {Date} [unitData.lastInspected] - Last inspection date
 * @param {string[]} [unitData.unitImages] - Unit images
 * @param {string[]} [unitData.amenities] - Unit amenities
 * @param {Object[]} [unitData.features] - Unit features
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Created unit
 * @throws {AppError} On validation or authorization error
 */
const createUnit = async (propertyId, unitData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Verify property exists
        const property = await Property.findById(propertyId).session(session);
        if (!property) {
            throw new AppError('Property not found.', 404);
        }

        // Authorization check
        const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
        if (!isAuthorized) {
            throw new AppError('Not authorized to create units for this property.', 403);
        }

        // Validate status if provided
        if (unitData.status) {
            if (!UNIT_STATUS_ENUM.includes(unitData.status.toLowerCase())) {
                throw new AppError(`Invalid unit status: ${unitData.status}. Allowed values: ${UNIT_STATUS_ENUM.join(', ')}`, 400);
            }
            unitData.status = unitData.status.toLowerCase();
        }

        // Create the unit
        const newUnit = new Unit({
            property: propertyId,
            unitName: unitData.unitName,
            floor: unitData.floor,
            details: unitData.details,
            numBedrooms: unitData.numBedrooms,
            numBathrooms: unitData.numBathrooms,
            squareFootage: unitData.squareFootage,
            rentAmount: unitData.rentAmount,
            depositAmount: unitData.depositAmount,
            status: unitData.status || 'vacant',
            utilityResponsibility: unitData.utilityResponsibility,
            notes: unitData.notes,
            lastInspected: unitData.lastInspected,
            nextInspectionDate: unitData.nextInspectionDate,
            unitImages: unitData.unitImages || [],
            amenities: unitData.amenities || [],
            features: unitData.features || []
        });

        const createdUnit = await newUnit.save({ session });

        // Add unit to the property's units array
        await Property.findByIdAndUpdate(
            propertyId,
            { $push: { units: createdUnit._id } },
            { session }
        );

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.Unit,
            createdUnit._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Unit ${createdUnit.unitName} created in property ${property.name} by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    propertyId,
                    propertyName: property.name
                },
                newValue: createdUnit.toObject()
            },
            { session }
        );

        // Notify property managers and landlords
        const managersAndLandlords = await PropertyUser.find({
            property: propertyId,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER] },
            isActive: true,
            user: { $ne: currentUser._id } // Don't notify the creator
        }).distinct('user');
        
        if (managersAndLandlords.length > 0) {
            const notificationPromises = managersAndLandlords.map(userId => 
                notificationService.sendNotification({
                    recipientId: userId,
                    type: NOTIFICATION_TYPE_ENUM.UNIT_CREATED,
                    message: `New unit ${createdUnit.unitName} has been created in property ${property.name}.`,
                    link: `${FRONTEND_URL}/properties/${propertyId}/units/${createdUnit._id}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
                    relatedResourceId: createdUnit._id,
                    emailDetails: {
                        subject: `New Unit Created: ${createdUnit.unitName}`,
                        html: `
                            <p>A new unit has been created in ${property.name}:</p>
                            <ul>
                                <li><strong>Unit Name:</strong> ${createdUnit.unitName}</li>
                                <li><strong>Bedrooms:</strong> ${createdUnit.numBedrooms || 'N/A'}</li>
                                <li><strong>Bathrooms:</strong> ${createdUnit.numBathrooms || 'N/A'}</li>
                                <li><strong>Status:</strong> ${createdUnit.status}</li>
                            </ul>
                            <p><a href="${FRONTEND_URL}/properties/${propertyId}/units/${createdUnit._id}">View Unit Details</a></p>
                        `,
                        text: `A new unit has been created in ${property.name}: ${createdUnit.unitName}. View details at: ${FRONTEND_URL}/properties/${propertyId}/units/${createdUnit._id}`
                    },
                    senderId: currentUser._id
                }, { session })
            );
            
            await Promise.allSettled(notificationPromises);
        }

        await session.commitTransaction();
        
        logger.info(`UnitService: Unit ${createdUnit.unitName} created in property ${property.name} by ${currentUser.email}.`);
        
        // Return the populated unit
        return Unit.findById(createdUnit._id)
            .populate('property', 'name address')
            .populate('tenants', 'firstName lastName email')
            .populate('unitImages');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`UnitService - Error creating unit: ${error.message}`, {
            userId: currentUser?._id,
            propertyId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to create unit: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Lists units for a specific property with filtering and pagination
 * @param {string} propertyId - Property ID
 * @param {Object} currentUser - The authenticated user
 * @param {Object} filters - Query filters
 * @param {string} [filters.status] - Filter by unit status
 * @param {number} [filters.numBedrooms] - Filter by number of bedrooms
 * @param {string} [filters.search] - Search term
 * @param {boolean} [filters.vacant=false] - Filter for vacant units only
 * @param {number} [page=1] - Page number
 * @param {number} [limit=10] - Items per page
 * @returns {Promise<Object>} Paginated units with metadata
 * @throws {AppError} If property not found or unauthorized
 */
const getUnitsForProperty = async (propertyId, currentUser, filters, page = 1, limit = 10) => {
    try {
        const property = await Property.findById(propertyId);
        if (!property) {
            throw new AppError('Property not found.', 404);
        }

        // Base query for units in this property
        let query = { 
            property: propertyId,
            isActive: true
        };
        
        // Parse pagination params
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Authorization and access control
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin has full access - no additional query filters
        } else {
            const userAssociations = await PropertyUser.find({
                user: currentUser._id,
                property: propertyId,
                isActive: true
            });

            // Check if user is a manager/landlord
            const isManager = userAssociations.some(assoc => 
                [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS].some(
                    role => assoc.roles.includes(role)
                )
            );

            if (isManager) {
                // Managers can view all units - no additional query filters
            } else if (currentUser.role === ROLE_ENUM.TENANT) {
                // Tenant can only view their own unit(s)
                const tenantUnits = userAssociations
                    .filter(assoc => assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && assoc.unit)
                    .map(assoc => assoc.unit);
                
                if (tenantUnits.length === 0) {
                    throw new AppError('Access denied: You are not associated with any unit in this property.', 403);
                }
                
                query._id = { $in: tenantUnits };
            } else {
                // Other roles not authorized
                throw new AppError('Access denied: You do not have permission to list units for this property.', 403);
            }
        }

        // Apply filters
        if (filters.status) {
            if (!UNIT_STATUS_ENUM.includes(filters.status.toLowerCase())) {
                throw new AppError(`Invalid unit status filter: ${filters.status}. Allowed values: ${UNIT_STATUS_ENUM.join(', ')}`, 400);
            }
            query.status = filters.status.toLowerCase();
        }
        
        if (filters.vacant === 'true' || filters.vacant === true) {
            query.status = 'vacant';
        }
        
        if (filters.numBedrooms) {
            query.numBedrooms = parseInt(filters.numBedrooms);
        }
        
        if (filters.search) {
            query.$or = [
                { unitName: { $regex: filters.search, $options: 'i' } },
                { floor: { $regex: filters.search, $options: 'i' } },
                { details: { $regex: filters.search, $options: 'i' } },
                { notes: { $regex: filters.search, $options: 'i' } }
            ];
        }

        // Execute query with pagination
        const units = await Unit.find(query)
            .populate({
                path: 'tenants',
                select: 'firstName lastName email avatar'
            })
            .populate('unitImages')
            .sort({ unitName: 1 })
            .limit(parseInt(limit))
            .skip(skip);

        const totalUnits = await Unit.countDocuments(query);

        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Unit,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched list of units for property ${property.name}.`,
                status: 'success',
                metadata: { propertyId, filters, page, limit }
            }
        );

        return {
            units,
            total: totalUnits,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(totalUnits / parseInt(limit))
        };
    } catch (error) {
        logger.error(`UnitService - Error getting units for property: ${error.message}`, {
            userId: currentUser?._id,
            propertyId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get units: ${error.message}`, 500);
    }
};

/**
 * Gets a specific unit by ID
 * @param {string} propertyId - Property ID
 * @param {string} unitId - Unit ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} [ipAddress] - IP address for audit log
 * @returns {Promise<Object>} Unit details
 * @throws {AppError} If unit not found or unauthorized
 */
const getUnitById = async (propertyId, unitId, currentUser, ipAddress) => {
    try {
        // Find unit and ensure it belongs to the specified property
        const unit = await Unit.findOne({ 
            _id: unitId, 
            property: propertyId,
            isActive: true
        })
            .populate('property', 'name address')
            .populate('tenants', 'firstName lastName email avatar phone')
            .populate('unitImages');

        if (!unit) {
            throw new AppError('Unit not found in the specified property.', 404);
        }

        // Authorization and access control
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin has full access
        } else {
            const userAssociations = await PropertyUser.find({
                user: currentUser._id,
                property: propertyId,
                isActive: true
            });

            // Check if user is a manager/landlord
            const isManager = userAssociations.some(assoc => 
                [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS].some(
                    role => assoc.roles.includes(role)
                )
            );

            if (isManager) {
                // Managers can view all units
            } else if (currentUser.role === ROLE_ENUM.TENANT) {
                // Check if tenant is associated with this unit
                const isTenantOfUnit = userAssociations.some(assoc => 
                    assoc.roles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && 
                    assoc.unit && 
                    assoc.unit.toString() === unitId
                );
                
                if (!isTenantOfUnit) {
                    throw new AppError('Access denied: You are not associated with this unit.', 403);
                }
            } else {
                // Other roles not authorized
                throw new AppError('Access denied: You do not have permission to view this unit.', 403);
            }
        }

        // Get maintenance requests for this unit
        const maintenanceRequests = await Request.find({
            unit: unitId,
            status: { $nin: ['completed', 'cancelled'] }
        })
            .select('title status priority createdAt')
            .sort({ createdAt: -1 })
            .limit(5);

        // Get scheduled maintenance for this unit
        const scheduledMaintenance = await ScheduledMaintenance.find({
            unit: unitId,
            status: { $nin: ['completed', 'cancelled'] }
        })
            .select('title status scheduledDate createdAt')
            .sort({ scheduledDate: 1 })
            .limit(5);

        // Get tenant details with lease information
        const tenantDetails = await Promise.all(unit.tenants.map(async tenant => {
            const propertyUser = await PropertyUser.findOne({
                user: tenant._id,
                property: propertyId,
                unit: unitId,
                roles: PROPERTY_USER_ROLES_ENUM.TENANT,
                isActive: true
            });
            
            return {
                _id: tenant._id,
                firstName: tenant.firstName,
                lastName: tenant.lastName,
                email: tenant.email,
                avatar: tenant.avatar,
                phone: tenant.phone,
                leaseInfo: propertyUser?.leaseInfo || null,
                startDate: propertyUser?.startDate || null
            };
        }));

        // Log access if IP address provided
        if (ipAddress) {
            await auditService.logActivity(
                AUDIT_ACTION_ENUM.READ,
                AUDIT_RESOURCE_TYPE_ENUM.Unit,
                unit._id,
                {
                    userId: currentUser._id,
                    ipAddress,
                    description: `User ${currentUser.email} viewed unit ${unit.unitName} in property ${unit.property.name}.`,
                    status: 'success'
                }
            );
        }

        // Return unit with additional information
        return {
            ...unit.toObject(),
            tenantDetails,
            maintenanceRequests,
            scheduledMaintenance
        };
    } catch (error) {
        logger.error(`UnitService - Error getting unit by ID: ${error.message}`, {
            userId: currentUser?._id,
            propertyId,
            unitId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get unit details: ${error.message}`, 500);
    }
};

/**
 * Updates a unit
 * @param {string} propertyId - Property ID
 * @param {string} unitId - Unit ID
 * @param {Object} updateData - Update data
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated unit
 * @throws {AppError} If unit not found or unauthorized
 */
const updateUnit = async (propertyId, unitId, updateData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Find unit and ensure it belongs to the specified property
        const unit = await Unit.findOne({ 
            _id: unitId, 
            property: propertyId,
            isActive: true
        }).session(session);

        if (!unit) {
            throw new AppError('Unit not found in the specified property.', 404);
        }

        // Authorization check
        const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
        if (!isAuthorized) {
            throw new AppError('Not authorized to update this unit.', 403);
        }

        // Store original unit for audit log
        const oldUnit = unit.toObject();

        // Apply updates with validation
        const updatableFields = [
            'unitName', 'floor', 'details', 'numBedrooms', 'numBathrooms', 
            'squareFootage', 'rentAmount', 'depositAmount', 'status', 
            'utilityResponsibility', 'notes', 'lastInspected', 'nextInspectionDate',
            'unitImages', 'amenities', 'features'
        ];
        
        for (const field of updatableFields) {
            if (updateData[field] !== undefined) {
                // Special handling for enum fields
                if (field === 'status') {
                    if (!UNIT_STATUS_ENUM.includes(updateData[field].toLowerCase())) {
                        throw new AppError(`Invalid unit status: ${updateData[field]}. Allowed values: ${UNIT_STATUS_ENUM.join(', ')}`, 400);
                    }
                    unit[field] = updateData[field].toLowerCase();
                } 
                else if (field === 'utilityResponsibility') {
                    unit[field] = updateData[field].toLowerCase();
                }
                else {
                    unit[field] = updateData[field];
                }
            }
        }

        // Save changes
        const updatedUnit = await unit.save({ session });

        // Check if unit status changed to 'occupied' or 'vacant'
        const statusChanged = oldUnit.status !== updatedUnit.status;
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Unit,
            updatedUnit._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Unit ${updatedUnit.unitName} in property ${propertyId} updated by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldUnit,
                newValue: updatedUnit.toObject(),
                metadata: {
                    statusChanged,
                    oldStatus: oldUnit.status,
                    newStatus: updatedUnit.status
                }
            },
            { session }
        );

        // If status changed to 'occupied' or 'vacant', notify relevant parties
        if (statusChanged) {
            // Get property details for notification
            const property = await Property.findById(propertyId).session(session);
            
            // Get users to notify (property managers & landlords)
            const userIdsToNotify = await PropertyUser.find({
                property: propertyId,
                roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER] },
                isActive: true,
                user: { $ne: currentUser._id } // Don't notify the updater
            }).distinct('user');
            
            if (userIdsToNotify.length > 0) {
                const notificationPromises = userIdsToNotify.map(userId => 
                    notificationService.sendNotification({
                        recipientId: userId,
                        type: NOTIFICATION_TYPE_ENUM.UNIT_STATUS_CHANGED,
                        message: `Unit ${updatedUnit.unitName} in ${property.name} is now ${updatedUnit.status}.`,
                        link: `${FRONTEND_URL}/properties/${propertyId}/units/${unitId}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
                        relatedResourceId: unitId,
                        emailDetails: {
                            subject: `Unit Status Update: ${updatedUnit.unitName}`,
                            html: `
                                <p>The status of unit ${updatedUnit.unitName} in ${property.name} has been changed from "${oldUnit.status}" to "${updatedUnit.status}".</p>
                                <p><a href="${FRONTEND_URL}/properties/${propertyId}/units/${unitId}">View Unit Details</a></p>
                            `,
                            text: `The status of unit ${updatedUnit.unitName} in ${property.name} has been changed from "${oldUnit.status}" to "${updatedUnit.status}". View details at: ${FRONTEND_URL}/properties/${propertyId}/units/${unitId}`
                        },
                        senderId: currentUser._id
                    }, { session })
                );
                
                await Promise.allSettled(notificationPromises);
            }
            
            // Also notify tenants if occupied
            if (updatedUnit.status === 'occupied' && updatedUnit.tenants && updatedUnit.tenants.length > 0) {
                const tenantNotificationPromises = updatedUnit.tenants.map(tenantId => 
                    notificationService.sendNotification({
                        recipientId: tenantId,
                        type: NOTIFICATION_TYPE_ENUM.UNIT_STATUS_CHANGED,
                        message: `Your unit ${updatedUnit.unitName} in ${property.name} is now marked as ${updatedUnit.status}.`,
                        link: `${FRONTEND_URL}/properties/${propertyId}/units/${unitId}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
                        relatedResourceId: unitId,
                        emailDetails: {
                            subject: `Your Unit Status Update: ${updatedUnit.unitName}`,
                            html: `
                                <p>Your unit ${updatedUnit.unitName} in ${property.name} is now marked as ${updatedUnit.status}.</p>
                                <p><a href="${FRONTEND_URL}/properties/${propertyId}/units/${unitId}">View Unit Details</a></p>
                            `,
                            text: `Your unit ${updatedUnit.unitName} in ${property.name} is now marked as ${updatedUnit.status}. View details at: ${FRONTEND_URL}/properties/${propertyId}/units/${unitId}`
                        },
                        senderId: currentUser._id
                    }, { session })
                );
                
                await Promise.allSettled(tenantNotificationPromises);
            }
        }

        await session.commitTransaction();
        
        logger.info(`UnitService: Unit ${updatedUnit.unitName} updated by ${currentUser.email}.`);
        
        // Return populated unit
        return Unit.findById(updatedUnit._id)
            .populate('property', 'name address')
            .populate('tenants', 'firstName lastName email')
            .populate('unitImages');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`UnitService - Error updating unit: ${error.message}`, {
            userId: currentUser?._id,
            propertyId,
            unitId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to update unit: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Deletes a unit (soft delete if has history, hard delete if new)
 * @param {string} propertyId - Property ID
 * @param {string} unitId - Unit ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<void>}
 * @throws {AppError} If unit not found or has dependencies
 */
const deleteUnit = async (propertyId, unitId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Find unit and ensure it belongs to the specified property
        const unitToDelete = await Unit.findOne({ 
            _id: unitId, 
            property: propertyId 
        }).session(session);

        if (!unitToDelete) {
            throw new AppError('Unit not found in the specified property.', 404);
        }

        // Authorization check
        const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
        if (!isAuthorized) {
            throw new AppError('Not authorized to delete this unit.', 403);
        }

        // Check for dependencies
        const hasRequests = await Request.countDocuments({ unit: unitId }).session(session);
        const hasScheduledMaintenance = await ScheduledMaintenance.countDocuments({ unit: unitId }).session(session);
        const hasActivePropertyUsers = await PropertyUser.countDocuments({ 
            unit: unitId, 
            isActive: true 
        }).session(session);

        // Store unit data for audit log
        const oldUnit = unitToDelete.toObject();

        if (hasRequests > 0 || hasScheduledMaintenance > 0 || hasActivePropertyUsers > 0) {
            // Unit has history - perform soft delete
            unitToDelete.isActive = false;
            await unitToDelete.save({ session });
            
            // Deactivate PropertyUser associations for this unit
            await PropertyUser.updateMany(
                { unit: unitId, isActive: true },
                { 
                    $set: { 
                        isActive: false,
                        endDate: new Date()
                    } 
                },
                { session }
            );
            
            logger.info(`UnitService: Soft deleted unit ${unitToDelete.unitName} and deactivated PropertyUser associations.`);
        } else {
            // No history - perform hard delete
            
            // Remove unit from property's units array
            await Property.findByIdAndUpdate(
                propertyId,
                { $pull: { units: unitId } },
                { session }
            );
            
            // Delete PropertyUser associations for this unit
            await PropertyUser.deleteMany({ unit: unitId }, { session });
            
            // Delete comments associated with this unit
            await Comment.deleteMany({ 
                contextId: unitId, 
                contextType: AUDIT_RESOURCE_TYPE_ENUM.Unit 
            }, { session });
            
            // Delete notifications related to this unit
            await Notification.deleteMany({ 
                'relatedResource.item': unitId, 
                'relatedResource.kind': AUDIT_RESOURCE_TYPE_ENUM.Unit 
            }, { session });
            
            // Delete the unit
            await unitToDelete.deleteOne({ session });
            
            logger.info(`UnitService: Hard deleted unit ${unitToDelete.unitName} and removed all dependencies.`);
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.Unit,
            unitId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Unit ${oldUnit.unitName} in property ${propertyId} deleted by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldUnit,
                newValue: null,
                metadata: {
                    softDelete: hasRequests > 0 || hasScheduledMaintenance > 0 || hasActivePropertyUsers > 0
                }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`UnitService: Unit ${oldUnit.unitName} deleted by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`UnitService - Error deleting unit: ${error.message}`, {
            userId: currentUser?._id,
            propertyId,
            unitId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete unit: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Assigns a tenant to a unit
 * @param {string} propertyId - Property ID
 * @param {string} unitId - Unit ID
 * @param {string} tenantId - Tenant user ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated unit
 * @throws {AppError} If entities not found or unauthorized
 */
const assignTenantToUnit = async (propertyId, unitId, tenantId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Find entities and validate
        const property = await Property.findById(propertyId).session(session);
        const unit = await Unit.findById(unitId).session(session);
        const tenantUser = await User.findById(tenantId).session(session);

        if (!property || !unit || !tenantUser) {
            throw new AppError(`${!property ? 'Property' : !unit ? 'Unit' : 'Tenant user'} not found.`, 404);
        }

        // Ensure unit belongs to the property
        if (unit.property.toString() !== propertyId) {
            throw new AppError('Unit does not belong to the specified property.', 400);
        }

        // Ensure the assigned user is a tenant role
        if (tenantUser.role !== ROLE_ENUM.TENANT) {
            throw new AppError('Assigned user must have the role of "tenant".', 400);
        }

        // Authorization check
        const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
        if (!isAuthorized) {
            throw new AppError('Not authorized to assign tenants to this unit.', 403);
        }

        // Check if tenant is already assigned to this unit
        const alreadyAssigned = unit.tenants && unit.tenants.some(id => id.toString() === tenantId);
        if (alreadyAssigned) {
            throw new AppError('Tenant is already assigned to this unit.', 400);
        }

        // Check for existing tenancy in the same property
        const existingTenancy = await PropertyUser.findOne({
            user: tenantId,
            property: propertyId,
            roles: PROPERTY_USER_ROLES_ENUM.TENANT,
            isActive: true,
            unit: { $ne: null, $ne: unitId }
        }).session(session);

        if (existingTenancy) {
            // Handle tenant reassignment
            const oldUnitId = existingTenancy.unit;
            
            // Remove tenant from old unit
            await Unit.findByIdAndUpdate(
                oldUnitId,
                { $pull: { tenants: tenantId } },
                { session }
            );
            
            logger.info(`UnitService: Removing tenant ${tenantUser.email} from unit ${oldUnitId}.`);
            
            // Update PropertyUser record to point to new unit
            existingTenancy.unit = unitId;
            await existingTenancy.save({ session });
            
            // Notify tenant about unit change
            try {
                const oldUnit = await Unit.findById(oldUnitId).session(session);
                
                await notificationService.sendNotification({
                    recipientId: tenantId,
                    type: NOTIFICATION_TYPE_ENUM.UNIT_REASSIGNED,
                    message: `You have been moved from unit ${oldUnit.unitName} to ${unit.unitName} in ${property.name}.`,
                    link: `${FRONTEND_URL}/properties/${propertyId}/units/${unitId}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
                    relatedResourceId: unitId,
                    emailDetails: {
                        subject: `Unit Change Notification`,
                        html: `
                            <p>Hello ${tenantUser.firstName},</p>
                            <p>Your unit assignment has been changed from ${oldUnit.unitName} to ${unit.unitName} in ${property.name}.</p>
                            <p><a href="${FRONTEND_URL}/properties/${propertyId}/units/${unitId}">View Your New Unit</a></p>
                        `,
                        text: `Hello ${tenantUser.firstName}, Your unit assignment has been changed from ${oldUnit.unitName} to ${unit.unitName} in ${property.name}. View your new unit at: ${FRONTEND_URL}/properties/${propertyId}/units/${unitId}`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send unit reassignment notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        } else {
            // Create a new PropertyUser entry
            await PropertyUser.create([{
                user: tenantId,
                property: propertyId,
                unit: unitId,
                roles: [PROPERTY_USER_ROLES_ENUM.TENANT],
                invitedBy: currentUser._id,
                isActive: true,
                startDate: new Date()
            }], { session });
            
            logger.info(`UnitService: Created PropertyUser association for tenant ${tenantUser.email} to unit ${unit.unitName}.`);
            
            // Notify tenant about new unit assignment
            try {
                await notificationService.sendNotification({
                    recipientId: tenantId,
                    type: NOTIFICATION_TYPE_ENUM.UNIT_ASSIGNED,
                    message: `You have been assigned to unit ${unit.unitName} in ${property.name}.`,
                    link: `${FRONTEND_URL}/properties/${propertyId}/units/${unitId}`,
                    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
                    relatedResourceId: unitId,
                    emailDetails: {
                        subject: `Unit Assignment Notification`,
                        html: `
                            <p>Hello ${tenantUser.firstName},</p>
                            <p>You have been assigned to unit ${unit.unitName} in ${property.name}.</p>
                            <p><a href="${FRONTEND_URL}/properties/${propertyId}/units/${unitId}">View Your Unit</a></p>
                        `,
                        text: `Hello ${tenantUser.firstName}, You have been assigned to unit ${unit.unitName} in ${property.name}. View your unit at: ${FRONTEND_URL}/properties/${propertyId}/units/${unitId}`
                    },
                    senderId: currentUser._id
                }, { session });
            } catch (notificationError) {
                logger.warn(`Failed to send unit assignment notification: ${notificationError.message}`);
                // Continue even if notification fails
            }
        }

        // Add tenant to the unit's tenants array
        if (!unit.tenants) {
            unit.tenants = [];
        }
        
        unit.tenants.push(tenantId);
        
        // If unit was vacant, change status to occupied
        if (unit.status === 'vacant') {
            unit.status = 'occupied';
        }
        
        const updatedUnit = await unit.save({ session });

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.ASSIGN_TENANT,
            AUDIT_RESOURCE_TYPE_ENUM.Unit,
            unitId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Tenant ${tenantUser.email} assigned to unit ${unit.unitName} by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    tenantId,
                    unitId,
                    propertyId,
                    wasReassigned: !!existingTenancy
                },
                newValue: { tenantId, unitId, propertyId }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`UnitService: Tenant ${tenantUser.email} assigned to unit ${unit.unitName} by ${currentUser.email}.`);
        
        // Return populated unit
        return Unit.findById(updatedUnit._id)
            .populate('property', 'name address')
            .populate('tenants', 'firstName lastName email avatar')
            .populate('unitImages');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`UnitService - Error assigning tenant to unit: ${error.message}`, {
            userId: currentUser?._id,
            propertyId,
            unitId,
            tenantId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to assign tenant to unit: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Removes a tenant from a unit
 * @param {string} propertyId - Property ID
 * @param {string} unitId - Unit ID
 * @param {string} tenantId - Tenant user ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated unit
 * @throws {AppError} If entities not found or unauthorized
 */
const removeTenantFromUnit = async (propertyId, unitId, tenantId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Find entities and validate
        const property = await Property.findById(propertyId).session(session);
        const unit = await Unit.findById(unitId).session(session);
        const tenantUser = await User.findById(tenantId).session(session);

        if (!property || !unit || !tenantUser) {
            throw new AppError(`${!property ? 'Property' : !unit ? 'Unit' : 'Tenant user'} not found.`, 404);
        }

        // Ensure unit belongs to the property
        if (unit.property.toString() !== propertyId) {
            throw new AppError('Unit does not belong to the specified property.', 400);
        }

        // Authorization check
        const isAuthorized = await checkPropertyManagementPermission(currentUser, propertyId);
        if (!isAuthorized) {
            throw new AppError('Not authorized to remove tenants from this unit.', 403);
        }

        // Check if tenant is actually assigned to this unit
        const isTenantAssigned = unit.tenants && unit.tenants.some(id => id.toString() === tenantId);
        if (!isTenantAssigned) {
            throw new AppError('Tenant is not assigned to this unit.', 400);
        }

        // Remove tenant from the unit's tenants array
        unit.tenants = unit.tenants.filter(id => id.toString() !== tenantId);
        
        // If no tenants left, change status to vacant
        if (unit.tenants.length === 0) {
            unit.status = 'vacant';
        }
        
        const updatedUnit = await unit.save({ session });

        // Deactivate PropertyUser association
        await PropertyUser.findOneAndUpdate(
            { 
                user: tenantId, 
                property: propertyId, 
                unit: unitId, 
                roles: PROPERTY_USER_ROLES_ENUM.TENANT,
                isActive: true
            },
            { 
                $set: { 
                    isActive: false, 
                    unit: null, 
                    endDate: new Date() 
                } 
            },
            { session }
        );
        
        logger.info(`UnitService: Deactivated PropertyUser association for tenant ${tenantUser.email} from unit ${unit.unitName}.`);

        // Notify tenant about removal
        try {
            await notificationService.sendNotification({
                recipientId: tenantId,
                type: NOTIFICATION_TYPE_ENUM.UNIT_REMOVED,
                message: `You have been removed from unit ${unit.unitName} in ${property.name}.`,
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Unit,
                relatedResourceId: unitId,
                emailDetails: {
                    subject: `Unit Assignment Removed`,
                    html: `
                        <p>Hello ${tenantUser.firstName},</p>
                        <p>You have been removed from unit ${unit.unitName} in ${property.name}.</p>
                        <p>If you have questions about this change, please contact your property manager.</p>
                    `,
                    text: `Hello ${tenantUser.firstName}, You have been removed from unit ${unit.unitName} in ${property.name}. If you have questions about this change, please contact your property manager.`
                },
                senderId: currentUser._id
            }, { session });
        } catch (notificationError) {
            logger.warn(`Failed to send unit removal notification: ${notificationError.message}`);
            // Continue even if notification fails
        }

        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.REMOVE_TENANT,
            AUDIT_RESOURCE_TYPE_ENUM.Unit,
            unitId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Tenant ${tenantUser.email} removed from unit ${unit.unitName} by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    tenantId,
                    unitId,
                    propertyId,
                    statusChanged: updatedUnit.status === 'vacant'
                },
                oldValue: { tenantId, unitId, propertyId }
            },
            { session }
        );

        await session.commitTransaction();
        
        logger.info(`UnitService: Tenant ${tenantUser.email} removed from unit ${unit.unitName} by ${currentUser.email}.`);
        
        // Return populated unit
        return Unit.findById(updatedUnit._id)
            .populate('property', 'name address')
            .populate('tenants', 'firstName lastName email avatar')
            .populate('unitImages');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`UnitService - Error removing tenant from unit: ${error.message}`, {
            userId: currentUser?._id,
            propertyId,
            unitId,
            tenantId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to remove tenant from unit: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

module.exports = {
    createUnit,
    getUnitsForProperty,
    getUnitById,
    updateUnit,
    deleteUnit,
    assignTenantToUnit,
    removeTenantFromUnit
};