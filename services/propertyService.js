// src/services/propertyService.js

const mongoose = require('mongoose');
const Property = require('../models/property');
const User = require('../models/user');
const Unit = require('../models/unit');
const PropertyUser = require('../models/propertyUser');
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Notification = require('../models/notification');
const Comment = require('../models/comment');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    PROPERTY_TYPE_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    NOTIFICATION_TYPE_ENUM
} = require('../utils/constants/enums');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Helper to check if a user has specified roles for a property
 * @param {string} userId - User ID
 * @param {string} propertyId - Property ID
 * @param {Array<string>} roles - Array of roles to check
 * @returns {Promise<boolean>} True if user has any of the specified roles
 */
const checkUserHasPropertyRoles = async (userId, propertyId, roles) => {
    try {
        const propertyUser = await PropertyUser.findOne({
            user: userId,
            property: propertyId,
            isActive: true
        });
        
        if (!propertyUser) return false;
        
        // Check if user has any of the specified roles
        return propertyUser.roles.some(role => roles.includes(role));
    } catch (error) {
        logger.error(`PropertyService - Error checking user roles: ${error.message}`, { userId, propertyId });
        return false; // Fail safely
    }
};

/**
 * Creates a new property
 * @param {Object} propertyData - Property data
 * @param {string} propertyData.name - Property name
 * @param {Object} propertyData.address - Address object
 * @param {string} [propertyData.propertyType='residential'] - Property type
 * @param {number} [propertyData.yearBuilt] - Year built
 * @param {number} [propertyData.numberOfUnits=0] - Number of units
 * @param {string} [propertyData.details] - Property details
 * @param {string[]} [propertyData.amenities=[]] - Property amenities
 * @param {number} [propertyData.annualOperatingBudget=0] - Annual budget
 * @param {string} [propertyData.notes] - Notes
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Created property
 * @throws {AppError} If validation fails
 */
const createProperty = async (propertyData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Check if property with same name already exists
        const existingProperty = await Property.findOne({ 
            name: propertyData.name 
        }).session(session);
        
        if (existingProperty) {
            throw new AppError(`Property with name "${propertyData.name}" already exists.`, 400);
        }
        
        // Create property
        const newProperty = new Property({
            name: propertyData.name,
            address: propertyData.address,
            propertyType: propertyData.propertyType || 'residential',
            yearBuilt: propertyData.yearBuilt,
            numberOfUnits: propertyData.numberOfUnits || 0,
            details: propertyData.details,
            amenities: propertyData.amenities || [],
            annualOperatingBudget: propertyData.annualOperatingBudget || 0,
            notes: propertyData.notes,
            isActive: true
        });
        
        const createdProperty = await newProperty.save({ session });
        
        // Create PropertyUser association for the creator
        // Default role depends on the user's global role
        let creatorRole;
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            creatorRole = PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS;
        } else if (currentUser.role === ROLE_ENUM.LANDLORD) {
            creatorRole = PROPERTY_USER_ROLES_ENUM.LANDLORD;
        } else if (currentUser.role === ROLE_ENUM.PROPERTY_MANAGER) {
            creatorRole = PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER;
        } else {
            creatorRole = PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS; // Fallback
        }
        
        const propertyUser = await PropertyUser.create([{
            user: currentUser._id,
            property: createdProperty._id,
            roles: [creatorRole],
            isActive: true,
            startDate: new Date(),
            invitedBy: currentUser._id
        }], { session });
        
        // Update property with the creator's PropertyUser reference
        createdProperty.createdByPropertyUser = propertyUser[0]._id;
        await createdProperty.save({ session });
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.CREATE,
            AUDIT_RESOURCE_TYPE_ENUM.Property,
            createdProperty._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Property "${createdProperty.name}" created by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    propertyType: createdProperty.propertyType,
                    location: `${createdProperty.address.city}, ${createdProperty.address.country}`
                },
                newValue: createdProperty.toObject()
            },
            { session }
        );
        
        // If property manager or landlord is specified and different from creator, create that association
        if (propertyData.mainContactUser && 
            propertyData.mainContactUser !== currentUser._id.toString()) {
            const mainContact = await User.findById(propertyData.mainContactUser).session(session);
            
            if (mainContact) {
                // Determine appropriate role based on the contact's global role
                let contactRole;
                if (mainContact.role === ROLE_ENUM.LANDLORD) {
                    contactRole = PROPERTY_USER_ROLES_ENUM.LANDLORD;
                } else if (mainContact.role === ROLE_ENUM.PROPERTY_MANAGER) {
                    contactRole = PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER;
                } else {
                    contactRole = PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS;
                }
                
                await PropertyUser.create([{
                    user: mainContact._id,
                    property: createdProperty._id,
                    roles: [contactRole],
                    isActive: true,
                    startDate: new Date(),
                    invitedBy: currentUser._id
                }], { session });
                
                // Send notification to the main contact
                try {
                    await notificationService.sendNotification({
                        recipientId: mainContact._id,
                        type: NOTIFICATION_TYPE_ENUM.PROPERTY_ASSIGNED,
                        message: `You have been assigned as ${contactRole} for property "${createdProperty.name}".`,
                        link: `${FRONTEND_URL}/properties/${createdProperty._id}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
                        relatedResourceId: createdProperty._id,
                        emailDetails: {
                            subject: `New Property Assignment: ${createdProperty.name}`,
                            html: `
                                <p>Hello ${mainContact.firstName},</p>
                                <p>You have been assigned as ${contactRole} for property "${createdProperty.name}" located in ${createdProperty.address.city}, ${createdProperty.address.country}.</p>
                                <p><a href="${FRONTEND_URL}/properties/${createdProperty._id}">View Property Details</a></p>
                            `,
                            text: `Hello ${mainContact.firstName}, You have been assigned as ${contactRole} for property "${createdProperty.name}" located in ${createdProperty.address.city}, ${createdProperty.address.country}. View details at: ${FRONTEND_URL}/properties/${createdProperty._id}`
                        },
                        senderId: currentUser._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send property assignment notification: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
        }
        
        await session.commitTransaction();
        
        logger.info(`PropertyService: Property "${createdProperty.name}" created by ${currentUser.email}.`);
        
        // Return populated property
        return Property.findById(createdProperty._id)
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email'
                }
            });
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`PropertyService - Error creating property: ${error.message}`, {
            userId: currentUser?._id,
            propertyName: propertyData?.name
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to create property: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Gets all properties accessible by a user with filtering and pagination
 * @param {Object} currentUser - The authenticated user
 * @param {Object} filters - Query filters
 * @param {string} [filters.search] - Search term
 * @param {string} [filters.city] - Filter by city
 * @param {string} [filters.country] - Filter by country
 * @param {boolean} [filters.isActive] - Filter by active status
 * @param {string} [filters.propertyType] - Filter by property type
 * @param {string} [filters.sortBy='name'] - Sort field
 * @param {string} [filters.sortOrder='asc'] - Sort order
 * @param {number} [filters.page=1] - Page number
 * @param {number} [filters.limit=10] - Items per page
 * @returns {Promise<Object>} Paginated properties
 * @throws {AppError} If filtering or pagination fails
 */
const getAllProperties = async (currentUser, filters) => {
    try {
        // Parse pagination params
        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const skip = (page - 1) * limit;
        
        // Start with base query
        let query = {};
        
        // Apply access control based on user role
        if (currentUser.role === ROLE_ENUM.ADMIN) {
            // Admin can see all properties
        } else {
            // Other roles can only see properties they're associated with
            const userPropertyIds = await PropertyUser.find({
                user: currentUser._id,
                isActive: true
            }).distinct('property');
            
            if (userPropertyIds.length === 0) {
                return {
                    properties: [],
                    total: 0,
                    page,
                    limit
                };
            }
            
            query._id = { $in: userPropertyIds };
        }
        
        // Apply filters
        if (filters.isActive !== undefined) {
            query.isActive = filters.isActive === 'true' || filters.isActive === true;
        }
        
        if (filters.propertyType) {
            if (!PROPERTY_TYPE_ENUM.includes(filters.propertyType.toLowerCase())) {
                throw new AppError(`Invalid property type: ${filters.propertyType}. Allowed values: ${PROPERTY_TYPE_ENUM.join(', ')}`, 400);
            }
            query.propertyType = filters.propertyType.toLowerCase();
        }
        
        if (filters.city) {
            query['address.city'] = { $regex: new RegExp(filters.city, 'i') };
        }
        
        if (filters.country) {
            query['address.country'] = { $regex: new RegExp(filters.country, 'i') };
        }
        
        if (filters.search) {
            query.$or = [
                { name: { $regex: new RegExp(filters.search, 'i') } },
                { 'address.street': { $regex: new RegExp(filters.search, 'i') } },
                { 'address.city': { $regex: new RegExp(filters.search, 'i') } },
                { 'address.zipCode': { $regex: new RegExp(filters.search, 'i') } }
            ];
        }
        
        // Set up sorting
        const sortBy = filters.sortBy || 'name';
        const sortOrder = filters.sortOrder === 'desc' ? -1 : 1;
        const sort = { [sortBy]: sortOrder };
        
        // Count total matching properties
        const total = await Property.countDocuments(query);
        
        // Execute query with pagination
        const properties = await Property.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email'
                }
            });
        
        // Augment properties with user role info
        const propertiesWithRoles = await Promise.all(properties.map(async property => {
            const userRoles = await PropertyUser.findOne({
                user: currentUser._id,
                property: property._id,
                isActive: true
            }).select('roles');
            
            const propertyObj = property.toObject();
            propertyObj.userRoles = userRoles ? userRoles.roles : [];
            
            // Add unit count
            propertyObj.unitCount = propertyObj.units ? propertyObj.units.length : 0;
            
            return propertyObj;
        }));
        
        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ_ALL,
            AUDIT_RESOURCE_TYPE_ENUM.Property,
            null,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} fetched list of properties.`,
                status: 'success',
                metadata: { filters, page, limit }
            }
        );
        
        return {
            properties: propertiesWithRoles,
            total,
            page,
            limit
        };
    } catch (error) {
        logger.error(`PropertyService - Error getting properties: ${error.message}`, {
            userId: currentUser?._id,
            filters
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get properties: ${error.message}`, 500);
    }
};

/**
 * Gets a specific property by ID with details
 * @param {string} propertyId - Property ID
 * @param {Object} currentUser - The authenticated user
 * @returns {Promise<Object>} Property details with associations
 * @throws {AppError} If property not found or unauthorized
 */
const getPropertyById = async (propertyId, currentUser) => {
    try {
        // Find property
        const property = await Property.findById(propertyId)
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email'
                }
            })
            .populate({
                path: 'units',
                options: { sort: { unitName: 1 } }
            });
        
        if (!property) {
            throw new AppError('Property not found.', 404);
        }
        
        // Check authorization
        if (currentUser.role !== ROLE_ENUM.ADMIN) {
            const isAssociated = await PropertyUser.exists({
                user: currentUser._id,
                property: propertyId,
                isActive: true
            });
            
            if (!isAssociated) {
                throw new AppError('You do not have access to this property.', 403);
            }
        }
        
        // Get current user's roles for this property
        const userRoles = await PropertyUser.findOne({
            user: currentUser._id,
            property: propertyId,
            isActive: true
        }).select('roles');
        
        // Get property managers and landlords
        const propertyManagers = await PropertyUser.find({
            property: propertyId,
            roles: PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER,
            isActive: true
        }).populate('user', 'firstName lastName email phone avatar');
        
        const landlords = await PropertyUser.find({
            property: propertyId,
            roles: PROPERTY_USER_ROLES_ENUM.LANDLORD,
            isActive: true
        }).populate('user', 'firstName lastName email phone avatar');
        
        // Get active maintenance requests for this property
        const activeRequests = await Request.find({
            property: propertyId,
            status: { $nin: ['completed', 'cancelled'] }
        })
            .select('title status priority createdAt')
            .sort({ createdAt: -1 })
            .limit(5);
        
        // Get upcoming scheduled maintenance
        const upcomingMaintenance = await ScheduledMaintenance.find({
            property: propertyId,
            status: { $nin: ['completed', 'cancelled'] }
        })
            .select('title status scheduledDate createdAt')
            .sort({ scheduledDate: 1 })
            .limit(5);
        
        // Enhance property object with additional data
        const propertyData = property.toObject();
        propertyData.userRoles = userRoles ? userRoles.roles : [];
        propertyData.propertyManagers = propertyManagers.map(pm => pm.user);
        propertyData.landlords = landlords.map(l => l.user);
        propertyData.activeRequests = activeRequests;
        propertyData.upcomingMaintenance = upcomingMaintenance;
        propertyData.unitCount = propertyData.units ? propertyData.units.length : 0;
        
        // Count tenants
        const tenantCount = await PropertyUser.countDocuments({
            property: propertyId,
            roles: PROPERTY_USER_ROLES_ENUM.TENANT,
            isActive: true
        });
        
        propertyData.tenantCount = tenantCount;
        
        // Log access
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.READ,
            AUDIT_RESOURCE_TYPE_ENUM.Property,
            propertyId,
            {
                userId: currentUser._id,
                description: `User ${currentUser.email} viewed property "${property.name}".`,
                status: 'success'
            }
        );
        
        return propertyData;
    } catch (error) {
        logger.error(`PropertyService - Error getting property: ${error.message}`, {
            userId: currentUser?._id,
            propertyId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to get property: ${error.message}`, 500);
    }
};

/**
 * Updates a property
 * @param {string} propertyId - Property ID
 * @param {Object} updateData - Update data
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated property
 * @throws {AppError} If property not found or unauthorized
 */
const updateProperty = async (propertyId, updateData, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Find property
        const property = await Property.findById(propertyId).session(session);
        if (!property) {
            throw new AppError('Property not found.', 404);
        }
        
        // Check authorization - must be admin, landlord, or property manager
        if (currentUser.role !== ROLE_ENUM.ADMIN) {
            const isAuthorized = await checkUserHasPropertyRoles(
                currentUser._id, 
                propertyId, 
                [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS]
            );
            
            if (!isAuthorized) {
                throw new AppError('You do not have permission to update this property.', 403);
            }
        }
        
        // Check for duplicate name if name is being changed
        if (updateData.name && updateData.name !== property.name) {
            const duplicateName = await Property.findOne({ 
                name: updateData.name,
                _id: { $ne: propertyId }
            }).session(session);
            
            if (duplicateName) {
                throw new AppError(`Property with name "${updateData.name}" already exists.`, 400);
            }
        }
        
        // Store old property for audit log
        const oldProperty = property.toObject();
        
        // Apply updates
        const updatableFields = [
            'name', 'address', 'propertyType', 'yearBuilt', 'details',
            'annualOperatingBudget', 'notes', 'isActive', 'amenities'
        ];
        
        for (const field of updatableFields) {
            if (updateData[field] !== undefined) {
                if (field === 'propertyType' && updateData[field]) {
                    if (!PROPERTY_TYPE_ENUM.includes(updateData[field].toLowerCase())) {
                        throw new AppError(`Invalid property type: ${updateData[field]}. Allowed values: ${PROPERTY_TYPE_ENUM.join(', ')}`, 400);
                    }
                    property[field] = updateData[field].toLowerCase();
                } else {
                    property[field] = updateData[field];
                }
            }
        }
        
        // Save changes
        const updatedProperty = await property.save({ session });
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Property,
            propertyId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Property "${updatedProperty.name}" updated by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldProperty,
                newValue: updatedProperty.toObject()
            },
            { session }
        );
        
        // If main contact user is changed, update PropertyUser records
        if (updateData.mainContactUser && 
            updateData.mainContactUser !== oldProperty.mainContactUser) {
            
            const mainContact = await User.findById(updateData.mainContactUser).session(session);
            
            if (mainContact) {
                // Determine appropriate role based on the contact's global role
                let contactRole;
                if (mainContact.role === ROLE_ENUM.LANDLORD) {
                    contactRole = PROPERTY_USER_ROLES_ENUM.LANDLORD;
                } else if (mainContact.role === ROLE_ENUM.PROPERTY_MANAGER) {
                    contactRole = PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER;
                } else {
                    contactRole = PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS;
                }
                
                // Check if user already has association
                const existingAssociation = await PropertyUser.findOne({
                    user: mainContact._id,
                    property: propertyId,
                    isActive: true
                }).session(session);
                
                if (existingAssociation) {
                    // Update roles if needed
                    if (!existingAssociation.roles.includes(contactRole)) {
                        existingAssociation.roles.push(contactRole);
                        await existingAssociation.save({ session });
                    }
                } else {
                    // Create new association
                    await PropertyUser.create([{
                        user: mainContact._id,
                        property: propertyId,
                        roles: [contactRole],
                        isActive: true,
                        startDate: new Date(),
                        invitedBy: currentUser._id
                    }], { session });
                }
                
                // Send notification to the main contact
                try {
                    await notificationService.sendNotification({
                        recipientId: mainContact._id,
                        type: NOTIFICATION_TYPE_ENUM.PROPERTY_ASSIGNED,
                        message: `You have been assigned as ${contactRole} for property "${updatedProperty.name}".`,
                        link: `${FRONTEND_URL}/properties/${propertyId}`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
                        relatedResourceId: propertyId,
                        emailDetails: {
                            subject: `Property Assignment: ${updatedProperty.name}`,
                            html: `
                                <p>Hello ${mainContact.firstName},</p>
                                <p>You have been assigned as ${contactRole} for property "${updatedProperty.name}" located in ${updatedProperty.address.city}, ${updatedProperty.address.country}.</p>
                                <p><a href="${FRONTEND_URL}/properties/${propertyId}">View Property Details</a></p>
                            `,
                            text: `Hello ${mainContact.firstName}, You have been assigned as ${contactRole} for property "${updatedProperty.name}" located in ${updatedProperty.address.city}, ${updatedProperty.address.country}. View details at: ${FRONTEND_URL}/properties/${propertyId}`
                        },
                        senderId: currentUser._id
                    }, { session });
                } catch (notificationError) {
                    logger.warn(`Failed to send property assignment notification: ${notificationError.message}`);
                    // Continue even if notification fails
                }
            }
        }
        
        // If property is deactivated, update associated entities
        if (oldProperty.isActive && !updatedProperty.isActive) {
            // Mark PropertyUser associations as inactive
            await PropertyUser.updateMany(
                { property: propertyId, isActive: true },
                { isActive: false, endDate: new Date() },
                { session }
            );
            
            // Mark units as inactive
            await Unit.updateMany(
                { property: propertyId, isActive: true },
                { isActive: false },
                { session }
            );
            
            // Send notifications to associated users
            const associatedUsers = await PropertyUser.find({
                property: propertyId,
                isActive: false, // Just deactivated
                endDate: { $gte: new Date(Date.now() - 60000) } // Deactivated in the last minute
            }).distinct('user');
            
            if (associatedUsers.length > 0) {
                const notificationPromises = associatedUsers.map(userId => 
                    notificationService.sendNotification({
                        recipientId: userId,
                        type: NOTIFICATION_TYPE_ENUM.PROPERTY_DEACTIVATED,
                        message: `Property "${updatedProperty.name}" has been deactivated.`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
                        relatedResourceId: propertyId,
                        emailDetails: {
                            subject: `Property Deactivated: ${updatedProperty.name}`,
                            html: `
                                <p>Hello,</p>
                                <p>The property "${updatedProperty.name}" located in ${updatedProperty.address.city}, ${updatedProperty.address.country} has been deactivated.</p>
                                <p>Your association with this property has been ended.</p>
                            `,
                            text: `Hello, The property "${updatedProperty.name}" located in ${updatedProperty.address.city}, ${updatedProperty.address.country} has been deactivated. Your association with this property has been ended.`
                        },
                        senderId: currentUser._id
                    }, { session })
                );
                
                await Promise.allSettled(notificationPromises);
            }
        }
        
        await session.commitTransaction();
        
        logger.info(`PropertyService: Property "${updatedProperty.name}" updated by ${currentUser.email}.`);
        
        // Return populated property
        return Property.findById(updatedProperty._id)
            .populate({
                path: 'createdByPropertyUser',
                populate: {
                    path: 'user',
                    select: 'firstName lastName email'
                }
            })
            .populate({
                path: 'units',
                options: { sort: { unitName: 1 } }
            });
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`PropertyService - Error updating property: ${error.message}`, {
            userId: currentUser?._id,
            propertyId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to update property: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Deletes a property (soft delete if has dependencies)
 * @param {string} propertyId - Property ID
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<void>}
 * @throws {AppError} If property not found or unauthorized
 */
const deleteProperty = async (propertyId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Find property
        const property = await Property.findById(propertyId).session(session);
        if (!property) {
            throw new AppError('Property not found.', 404);
        }
        
        // Check authorization - only admin or landlord can delete
        if (currentUser.role !== ROLE_ENUM.ADMIN) {
            const isLandlord = await checkUserHasPropertyRoles(
                currentUser._id, 
                propertyId, 
                [PROPERTY_USER_ROLES_ENUM.LANDLORD]
            );
            
            if (!isLandlord) {
                throw new AppError('Only administrators or landlords can delete properties.', 403);
            }
        }
        
        // Store property data for audit log
        const propertyData = property.toObject();
        
        // Check for dependencies
        const hasRequests = await Request.countDocuments({ property: propertyId }).session(session);
        const hasMaintenances = await ScheduledMaintenance.countDocuments({ property: propertyId }).session(session);
        const hasUnits = property.units && property.units.length > 0;
        const hasAssociations = await PropertyUser.countDocuments({ property: propertyId }).session(session);
        
        const hasDependencies = hasRequests > 0 || hasMaintenances > 0 || hasUnits || hasAssociations > 1; // > 1 because there's at least one association (the creator)
        
        if (hasDependencies) {
            // Soft delete - mark as inactive
            property.isActive = false;
            await property.save({ session });
            
            // Deactivate associations
            await PropertyUser.updateMany(
                { property: propertyId, isActive: true },
                { 
                    isActive: false, 
                    endDate: new Date() 
                },
                { session }
            );
            
            // Mark units as inactive
            await Unit.updateMany(
                { property: propertyId, isActive: true },
                { isActive: false },
                { session }
            );
            
            logger.info(`PropertyService: Property "${property.name}" soft-deleted (marked inactive) due to dependencies.`);
        } else {
            // Hard delete - remove property and all direct associations
            
            // Delete PropertyUser associations
            await PropertyUser.deleteMany({ property: propertyId }, { session });
            
            // Delete comments
            await Comment.deleteMany({ 
                contextId: propertyId, 
                contextType: AUDIT_RESOURCE_TYPE_ENUM.Property 
            }, { session });
            
            // Delete notifications
            await Notification.deleteMany({ 
                'relatedResource.item': propertyId, 
                'relatedResource.kind': AUDIT_RESOURCE_TYPE_ENUM.Property 
            }, { session });
            
            // Delete the property
            await property.deleteOne({ session });
            
            logger.info(`PropertyService: Property "${property.name}" permanently deleted.`);
        }
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.Property,
            propertyId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Property "${property.name}" ${hasDependencies ? 'deactivated' : 'deleted'} by ${currentUser.email}.`,
                status: 'success',
                oldValue: propertyData,
                newValue: null,
                metadata: {
                    softDelete: hasDependencies,
                    dependencies: {
                        requests: hasRequests,
                        maintenances: hasMaintenances,
                        units: hasUnits ? property.units.length : 0,
                        associations: hasAssociations
                    }
                }
            },
            { session }
        );
        
        // Notify associated users
        if (hasDependencies) {
            const associatedUsers = await PropertyUser.find({
                property: propertyId,
                isActive: false, // Just deactivated
                endDate: { $gte: new Date(Date.now() - 60000) }, // Deactivated in the last minute
                user: { $ne: currentUser._id } // Don't notify the user who performed the deletion
            }).distinct('user');
            
            if (associatedUsers.length > 0) {
                const notificationPromises = associatedUsers.map(userId => 
                    notificationService.sendNotification({
                        recipientId: userId,
                        type: NOTIFICATION_TYPE_ENUM.PROPERTY_DELETED,
                        message: `Property "${property.name}" has been deleted.`,
                        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
                        relatedResourceId: propertyId,
                        emailDetails: {
                            subject: `Property Deleted: ${property.name}`,
                            html: `
                                <p>Hello,</p>
                                <p>The property "${property.name}" located in ${property.address.city}, ${property.address.country} has been deleted.</p>
                                <p>Your association with this property has been ended.</p>
                            `,
                            text: `Hello, The property "${property.name}" located in ${property.address.city}, ${property.address.country} has been deleted. Your association with this property has been ended.`
                        },
                        senderId: currentUser._id
                    }, { session })
                );
                
                await Promise.allSettled(notificationPromises);
            }
        }
        
        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`PropertyService - Error deleting property: ${error.message}`, {
            userId: currentUser?._id,
            propertyId
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to delete property: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Assigns a user to a property with specific roles
 * @param {string} propertyId - Property ID
 * @param {string} userIdToAssign - User ID to assign
 * @param {string[]} roles - Roles to assign
 * @param {string} [unitId] - Unit ID (required for tenant role)
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<Object>} Updated PropertyUser record
 * @throws {AppError} If property/unit not found or unauthorized
 */
const assignUserToProperty = async (propertyId, userIdToAssign, roles, unitId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Normalize roles to lowercase
        const normalizedRoles = roles.map(role => role.toLowerCase());
        
        // Validate roles
        const invalidRoles = normalizedRoles.filter(role => !PROPERTY_USER_ROLES_ENUM.includes(role));
        if (invalidRoles.length > 0) {
            throw new AppError(`Invalid role(s): ${invalidRoles.join(', ')}. Allowed values: ${PROPERTY_USER_ROLES_ENUM.join(', ')}`, 400);
        }
        
        // Find property and user
        const [property, userToAssign] = await Promise.all([
            Property.findById(propertyId).session(session),
            User.findById(userIdToAssign).session(session)
        ]);
        
        if (!property) {
            throw new AppError('Property not found.', 404);
        }
        
        if (!userToAssign) {
            throw new AppError('User to assign not found.', 404);
        }
        
        // Check authorization - only admin or landlord can assign users
        if (currentUser.role !== ROLE_ENUM.ADMIN) {
            const isAuthorized = await checkUserHasPropertyRoles(
                currentUser._id, 
                propertyId, 
                [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS]
            );
            
            if (!isAuthorized) {
                throw new AppError('Only administrators or landlords can assign users to properties.', 403);
            }
        }
        
        // Validate specific roles and permissions
        if (normalizedRoles.includes(PROPERTY_USER_ROLES_ENUM.TENANT)) {
            // Tenant role requires a unit
            if (!unitId) {
                throw new AppError('Unit ID is required when assigning tenant role.', 400);
            }
            
            // Verify unit exists and belongs to this property
            const unit = await Unit.findOne({ 
                _id: unitId, 
                property: propertyId 
            }).session(session);
            
            if (!unit) {
                throw new AppError('Unit not found or does not belong to this property.', 404);
            }
            
            // Check if user's global role is compatible
            if (userToAssign.role !== ROLE_ENUM.TENANT && userToAssign.role !== ROLE_ENUM.ADMIN) {
                throw new AppError(`User has global role '${userToAssign.role}' which is not compatible with tenant assignment.`, 400);
            }
        }
        
        if (normalizedRoles.includes(PROPERTY_USER_ROLES_ENUM.LANDLORD)) {
            // Check if user's global role is compatible
            if (userToAssign.role !== ROLE_ENUM.LANDLORD && userToAssign.role !== ROLE_ENUM.ADMIN) {
                throw new AppError(`User has global role '${userToAssign.role}' which is not compatible with landlord assignment.`, 400);
            }
        }
        
        if (normalizedRoles.includes(PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER)) {
            // Check if user's global role is compatible
            if (userToAssign.role !== ROLE_ENUM.PROPERTY_MANAGER && userToAssign.role !== ROLE_ENUM.ADMIN) {
                throw new AppError(`User has global role '${userToAssign.role}' which is not compatible with property manager assignment.`, 400);
            }
        }
        
        // Check if user already has property association
        let propertyUser = await PropertyUser.findOne({
            user: userIdToAssign,
            property: propertyId
        }).session(session);
        
        if (propertyUser) {
            // Update existing association
            if (!propertyUser.isActive) {
                propertyUser.isActive = true;
                propertyUser.startDate = new Date();
                propertyUser.endDate = null;
            }
            
            // Add new roles
            normalizedRoles.forEach(role => {
                if (!propertyUser.roles.includes(role)) {
                    propertyUser.roles.push(role);
                }
            });
            
            // Update unit if tenant role is being added
            if (normalizedRoles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && unitId) {
                propertyUser.unit = unitId;
                
                // Add tenant to unit's tenants array if not already there
                const unit = await Unit.findById(unitId).session(session);
                if (unit && !unit.tenants.includes(userIdToAssign)) {
                    unit.tenants.push(userIdToAssign);
                    
                    // Update unit status if it was vacant
                    if (unit.status === 'vacant') {
                        unit.status = 'occupied';
                    }
                    
                    await unit.save({ session });
                }
            }
            
            await propertyUser.save({ session });
            
            logger.info(`PropertyService: Updated roles for user ${userToAssign.email} on property "${property.name}": ${propertyUser.roles.join(', ')}`);
        } else {
            // Create new association
            propertyUser = await PropertyUser.create([{
                user: userIdToAssign,
                property: propertyId,
                unit: normalizedRoles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) ? unitId : null,
                roles: normalizedRoles,
                invitedBy: currentUser._id,
                isActive: true,
                startDate: new Date()
            }], { session });
            
            // If tenant role, add to unit's tenants array
            if (normalizedRoles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && unitId) {
                const unit = await Unit.findById(unitId).session(session);
                if (unit) {
                    unit.tenants.push(userIdToAssign);
                    
                    // Update unit status if it was vacant
                    if (unit.status === 'vacant') {
                        unit.status = 'occupied';
                    }
                    
                    await unit.save({ session });
                }
            }
            
            logger.info(`PropertyService: Created new property association for user ${userToAssign.email} on property "${property.name}" with roles: ${normalizedRoles.join(', ')}`);
        }
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.ASSIGN_USER,
            AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            propertyUser._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `User ${userToAssign.email} assigned to property "${property.name}" with roles: ${normalizedRoles.join(', ')} by ${currentUser.email}.`,
                status: 'success',
                metadata: {
                    propertyId,
                    unitId: unitId || null,
                    roles: normalizedRoles
                },
                newValue: propertyUser.toObject()
            },
            { session }
        );
        
        // Send notification to the assigned user
        try {
            const unitName = unitId ? 
                (await Unit.findById(unitId).select('unitName').session(session))?.unitName : 
                null;
                
            const roleText = normalizedRoles.length === 1 ? 
                normalizedRoles[0] : 
                `${normalizedRoles.slice(0, -1).join(', ')} and ${normalizedRoles[normalizedRoles.length - 1]}`;
                
            const unitText = unitName ? ` (Unit: ${unitName})` : '';
            
            await notificationService.sendNotification({
                recipientId: userIdToAssign,
                type: NOTIFICATION_TYPE_ENUM.PROPERTY_ASSIGNED,
                message: `You have been assigned as ${roleText} for property "${property.name}"${unitText}.`,
                link: `${FRONTEND_URL}/properties/${propertyId}${unitId ? `/units/${unitId}` : ''}`,
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
                relatedResourceId: propertyId,
                emailDetails: {
                    subject: `New Assignment: ${property.name}`,
                    html: `
                        <p>Hello ${userToAssign.firstName},</p>
                        <p>You have been assigned as ${roleText} for property "${property.name}"${unitText} located in ${property.address.city}, ${property.address.country}.</p>
                        <p><a href="${FRONTEND_URL}/properties/${propertyId}${unitId ? `/units/${unitId}` : ''}">View Details</a></p>
                    `,
                    text: `Hello ${userToAssign.firstName}, You have been assigned as ${roleText} for property "${property.name}"${unitText} located in ${property.address.city}, ${property.address.country}. View details at: ${FRONTEND_URL}/properties/${propertyId}${unitId ? `/units/${unitId}` : ''}`
                },
                senderId: currentUser._id
            }, { session });
        } catch (notificationError) {
            logger.warn(`Failed to send property assignment notification: ${notificationError.message}`);
            // Continue even if notification fails
        }
        
        await session.commitTransaction();
        
        // Return updated property user record
        return PropertyUser.findById(propertyUser._id)
            .populate('user', 'firstName lastName email')
            .populate('property', 'name address')
            .populate('unit', 'unitName');
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`PropertyService - Error assigning user to property: ${error.message}`, {
            userId: currentUser?._id,
            propertyId,
            userIdToAssign,
            roles
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to assign user to property: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

/**
 * Removes user roles from a property
 * @param {string} propertyId - Property ID
 * @param {string} userIdToRemove - User ID to remove
 * @param {string[]} rolesToRemove - Roles to remove
 * @param {string} [unitId] - Unit ID (for tenant role)
 * @param {Object} currentUser - The authenticated user
 * @param {string} ipAddress - Request IP address
 * @returns {Promise<void>}
 * @throws {AppError} If property not found or unauthorized
 */
const removeUserFromProperty = async (propertyId, userIdToRemove, rolesToRemove, unitId, currentUser, ipAddress) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Normalize roles to lowercase
        const normalizedRoles = rolesToRemove.map(role => role.toLowerCase());
        
        // Validate roles
        const invalidRoles = normalizedRoles.filter(role => !PROPERTY_USER_ROLES_ENUM.includes(role));
        if (invalidRoles.length > 0) {
            throw new AppError(`Invalid role(s): ${invalidRoles.join(', ')}. Allowed values: ${PROPERTY_USER_ROLES_ENUM.join(', ')}`, 400);
        }
        
        // Find property and user
        const [property, userToRemove] = await Promise.all([
            Property.findById(propertyId).session(session),
            User.findById(userIdToRemove).session(session)
        ]);
        
        if (!property) {
            throw new AppError('Property not found.', 404);
        }
        
        if (!userToRemove) {
            throw new AppError('User to remove not found.', 404);
        }
        
        // Check authorization - only admin or landlord can remove users
        if (currentUser.role !== ROLE_ENUM.ADMIN) {
            const isAuthorized = await checkUserHasPropertyRoles(
                currentUser._id, 
                propertyId, 
                [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS]
            );
            
            if (!isAuthorized) {
                throw new AppError('Only administrators or landlords can remove users from properties.', 403);
            }
        }
        
        // Validate specific roles
        if (normalizedRoles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && !unitId) {
            throw new AppError('Unit ID is required when removing tenant role.', 400);
        }
        
        // Find the PropertyUser record
        const propertyUser = await PropertyUser.findOne({
            user: userIdToRemove,
            property: propertyId,
            isActive: true
        }).session(session);
        
        if (!propertyUser) {
            throw new AppError('User is not actively associated with this property.', 404);
        }
        
        // Store old state for audit log
        const oldPropertyUser = propertyUser.toObject();
        
        // Remove specified roles
        const remainingRoles = propertyUser.roles.filter(role => !normalizedRoles.includes(role));
        
        if (remainingRoles.length === 0) {
            // If no roles left, deactivate the entire association
            propertyUser.isActive = false;
            propertyUser.endDate = new Date();
        } else {
            // Otherwise, update the roles list
            propertyUser.roles = remainingRoles;
        }
        
        // If tenant role is being removed, remove from unit
        if (normalizedRoles.includes(PROPERTY_USER_ROLES_ENUM.TENANT) && unitId) {
            // Check if unit exists and matches
            if (propertyUser.unit && propertyUser.unit.toString() === unitId) {
                propertyUser.unit = null;
                
                // Remove from unit's tenants array
                const unit = await Unit.findById(unitId).session(session);
                if (unit) {
                    unit.tenants = unit.tenants.filter(id => id.toString() !== userIdToRemove);
                    
                    // Update unit status if no tenants left
                    if (unit.tenants.length === 0) {
                        unit.status = 'vacant';
                    }
                    
                    await unit.save({ session });
                }
            } else {
                throw new AppError('User is not a tenant of the specified unit.', 400);
            }
        }
        
        await propertyUser.save({ session });
        
        // Create audit log
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.REMOVE_USER,
            AUDIT_RESOURCE_TYPE_ENUM.PropertyUser,
            propertyUser._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `Roles ${normalizedRoles.join(', ')} removed from user ${userToRemove.email} for property "${property.name}" by ${currentUser.email}.`,
                status: 'success',
                oldValue: oldPropertyUser,
                newValue: propertyUser.toObject(),
                metadata: {
                    propertyId,
                    unitId: unitId || null,
                    removedRoles: normalizedRoles,
                    remainingRoles,
                    fullyDeactivated: remainingRoles.length === 0
                }
            },
            { session }
        );
        
        // Send notification to the user
        try {
            const unitName = unitId ? 
                (await Unit.findById(unitId).select('unitName').session(session))?.unitName : 
                null;
                
            const roleText = normalizedRoles.length === 1 ? 
                normalizedRoles[0] : 
                `${normalizedRoles.slice(0, -1).join(', ')} and ${normalizedRoles[normalizedRoles.length - 1]}`;
                
            const unitText = unitName ? ` (Unit: ${unitName})` : '';
            
            await notificationService.sendNotification({
                recipientId: userIdToRemove,
                type: NOTIFICATION_TYPE_ENUM.PROPERTY_ROLE_REMOVED,
                message: `Your role as ${roleText} for property "${property.name}"${unitText} has been removed.`,
                relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Property,
                relatedResourceId: propertyId,
                emailDetails: {
                    subject: `Role Removed: ${property.name}`,
                    html: `
                        <p>Hello ${userToRemove.firstName},</p>
                        <p>Your role as ${roleText} for property "${property.name}"${unitText} located in ${property.address.city}, ${property.address.country} has been removed.</p>
                        ${remainingRoles.length > 0 ? `<p>You still have the following roles: ${remainingRoles.join(', ')}.</p>` : '<p>You no longer have any roles for this property.</p>'}
                    `,
                    text: `Hello ${userToRemove.firstName}, Your role as ${roleText} for property "${property.name}"${unitText} located in ${property.address.city}, ${property.address.country} has been removed. ${remainingRoles.length > 0 ? `You still have the following roles: ${remainingRoles.join(', ')}.` : 'You no longer have any roles for this property.'}`
                },
                senderId: currentUser._id
            }, { session });
        } catch (notificationError) {
            logger.warn(`Failed to send property role removal notification: ${notificationError.message}`);
            // Continue even if notification fails
        }
        
        await session.commitTransaction();
        
        logger.info(`PropertyService: Roles ${normalizedRoles.join(', ')} removed from user ${userToRemove.email} for property "${property.name}" by ${currentUser.email}.`);
    } catch (error) {
        await session.abortTransaction();
        
        logger.error(`PropertyService - Error removing user from property: ${error.message}`, {
            userId: currentUser?._id,
            propertyId,
            userIdToRemove,
            rolesToRemove
        });
        
        throw error instanceof AppError ? error : new AppError(`Failed to remove user from property: ${error.message}`, 500);
    } finally {
        session.endSession();
    }
};

module.exports = {
    createProperty,
    getAllProperties,
    getPropertyById,
    updateProperty,
    deleteProperty,
    assignUserToProperty,
    removeUserFromProperty
};