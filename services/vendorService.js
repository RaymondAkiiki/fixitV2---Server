const Vendor = require('../models/vendor');
const User = require('../models/user');
const PropertyUser = require('../models/propertyUser');
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const auditService = require('./auditService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const mongoose = require('mongoose');
const {
  ROLE_ENUM,
  PROPERTY_USER_ROLES_ENUM,
  SERVICE_ENUM,
  STATUS_ENUM,
  AUDIT_ACTION_ENUM,
  AUDIT_RESOURCE_TYPE_ENUM
} = require('../utils/constants/enums');

// Create sets for faster lookup
const SERVICE_ENUM_SET = new Set(SERVICE_ENUM.map(s => s.toLowerCase()));
const STATUS_ENUM_SET = new Set(STATUS_ENUM.map(s => s.toLowerCase()));

/**
 * Helper to check if a user has management permission for a given property.
 * @param {Object} user - The user object
 * @param {string} propertyId - The property ID to check permissions for
 * @returns {Promise<boolean>} True if user has management permission
 */
const checkPropertyManagementPermission = async (user, propertyId) => {
  if (user.role === ROLE_ENUM.ADMIN) return true;
  
  const propertyUser = await PropertyUser.findOne({
    user: user._id,
    property: propertyId,
    isActive: true,
    role: { $in: ['landlord', 'propertymanager', 'admin_access'] }
  });
  
  return !!propertyUser;
};

/**
 * Creates a new vendor.
 * @param {Object} vendorData - The vendor data
 * @param {string} createdByUserId - The ID of the user creating the vendor
 * @param {string} [ipAddress] - The IP address of the request
 * @returns {Promise<Object>} The created vendor
 * @throws {AppError} If validation fails or user lacks permission
 */
const createVendor = async (vendorData, createdByUserId, ipAddress) => {
  const {
    name, phone, email, address, contactPerson, services, status, notes,
    associatedProperties, description, fixedCalloutFee, paymentTerms, companyName,
    licenseNumber, insuranceDetails, documents
  } = vendorData;

  // Validation
  if (!name || !phone || !email || !services || services.length === 0) {
    throw new AppError('Name, phone, email, and at least one service are required.', 400);
  }

  // Check for existing vendor
  const existingVendor = await Vendor.findOne({ email: email.toLowerCase() });
  if (existingVendor) {
    throw new AppError(`A vendor with email ${email} already exists.`, 400);
  }

  // Validate services
  const normalizedServices = services.map(s => s.toLowerCase());
  const invalidServices = normalizedServices.filter(s => !SERVICE_ENUM_SET.has(s));
  if (invalidServices.length > 0) {
    throw new AppError(`Invalid service(s): ${invalidServices.join(', ')}. Allowed: ${SERVICE_ENUM.join(', ')}`, 400);
  }

  // Validate status
  let normalizedStatus = status ? status.toLowerCase() : 'active';
  if (!STATUS_ENUM_SET.has(normalizedStatus)) {
    throw new AppError(`Invalid status: ${status}. Allowed: ${STATUS_ENUM.join(', ')}`, 400);
  }

  // Validate permissions for associated properties
  if (associatedProperties && associatedProperties.length > 0) {
    const creator = await User.findById(createdByUserId);
    if (!creator) {
      throw new AppError('Creator user not found.', 404);
    }
    
    for (const propId of associatedProperties) {
      const hasPermission = await checkPropertyManagementPermission(creator, propId);
      if (!hasPermission) {
        throw new AppError(`Not authorized to associate vendor with property ${propId}.`, 403);
      }
    }
  }

  // Create the vendor
  const newVendor = new Vendor({
    name, 
    phone, 
    email: email.toLowerCase(), 
    address, 
    contactPerson,
    services: normalizedServices, 
    status: normalizedStatus, 
    notes,
    associatedProperties, 
    addedBy: createdByUserId, 
    description,
    fixedCalloutFee, 
    paymentTerms, 
    companyName, 
    licenseNumber,
    insuranceDetails, 
    documents
  });

  let createdVendor;
  try {
    createdVendor = await newVendor.save();
  } catch (err) {
    if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
      throw new AppError('A vendor with that email already exists.', 400);
    }
    logger.error(`Error creating vendor: ${err.message}`, { stack: err.stack });
    throw new AppError(`Failed to create vendor: ${err.message}`, 500);
  }

  // Log the action
  await auditService.logActivity(
    AUDIT_ACTION_ENUM.VENDOR_CREATED,
    AUDIT_RESOURCE_TYPE_ENUM[5], // 'Vendor'
    createdVendor._id,
    {
      userId: createdByUserId,
      ipAddress,
      newValue: createdVendor.toObject(),
      description: `Vendor ${createdVendor.name} created by user ${createdByUserId}.`
    }
  );

  logger.info(`VendorService: Vendor ${createdVendor.name} created by ${createdByUserId}.`);
  return createdVendor;
};

/**
 * Fetches vendors based on user role and filters with pagination.
 * @param {Object} user - The user requesting the vendors
 * @param {Object} [filters={}] - Filter options
 * @param {number} [page=1] - Page number
 * @param {number} [limit=10] - Results per page
 * @param {string} [ipAddress] - IP address for audit logging
 * @param {string} [sortBy='createdAt'] - Field to sort by
 * @param {string} [sortOrder='desc'] - Sort order ('asc' or 'desc')
 * @returns {Promise<Object>} The vendors data with pagination info
 * @throws {AppError} If user lacks permission
 */
const getVendorsForUser = async (
  user, 
  filters = {}, 
  page = 1, 
  limit = 10, 
  ipAddress,
  sortBy = 'createdAt',
  sortOrder = 'desc'
) => {
  const query = {};
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Authorization check
  if (user.role === ROLE_ENUM.ADMIN) {
    // Admin has full access
  } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(user.role)) {
    // Find properties user can manage
    const managedPropertyIds = await PropertyUser.find({
      user: user._id,
      isActive: true,
      role: { $in: ['landlord', 'propertymanager', 'admin_access'] }
    }).distinct('property');
    
    query.$or = [
      { addedBy: user._id }, 
      { associatedProperties: { $in: managedPropertyIds } }
    ];
  } else {
    throw new AppError('Access denied: You do not have permission to view vendors.', 403);
  }

  // Apply filters
  if (filters.status) {
    query.status = filters.status.toLowerCase();
  }
  
  if (filters.service) {
    query.services = filters.service.toLowerCase();
  }
  
  if (filters.propertyId) {
    if (user.role !== ROLE_ENUM.ADMIN) {
      const hasPermission = await checkPropertyManagementPermission(user, filters.propertyId);
      if (!hasPermission) {
        throw new AppError('Not authorized to filter vendors by this property.', 403);
      }
    }
    query.associatedProperties = filters.propertyId;
  }
  
  if (filters.search) {
    const searchRegex = { $regex: filters.search, $options: 'i' };
    const searchQuery = [
      { name: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
      { companyName: searchRegex }
    ];
    
    query.$or = query.$or 
      ? [...query.$or, ...searchQuery] 
      : searchQuery;
  }

  // Sorting configuration
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Execute query with pagination
  const vendors = await Vendor.find(query)
    .populate('addedBy', 'firstName lastName email')
    .populate('associatedProperties', 'name address')
    .sort(sort)
    .limit(parseInt(limit))
    .skip(skip);

  const totalVendors = await Vendor.countDocuments(query);
  
  // Log the action
  await auditService.logActivity(
    AUDIT_ACTION_ENUM.FETCH_ALL_VENDORS,
    AUDIT_RESOURCE_TYPE_ENUM[5], // 'Vendor'
    null,
    {
      userId: user._id,
      ipAddress,
      description: `User ${user.email || user._id} fetched list of vendors.`,
      metadata: { filters, page, limit }
    }
  );

  return {
    vendors,
    total: totalVendors,
    page: parseInt(page),
    limit: parseInt(limit),
    totalPages: Math.ceil(totalVendors / parseInt(limit))
  };
};

/**
 * Fetches a single vendor by ID, with authorization check.
 * @param {string} vendorId - The ID of the vendor to fetch
 * @param {Object} user - The user requesting the vendor
 * @param {string} [ipAddress] - IP address for audit logging
 * @returns {Promise<Object>} The vendor data
 * @throws {AppError} If vendor not found or user lacks permission
 */
const getVendorById = async (vendorId, user, ipAddress) => {
  const vendor = await Vendor.findById(vendorId)
    .populate('addedBy', 'firstName lastName email')
    .populate('associatedProperties', 'name address')
    .populate('documents');
    
  if (!vendor) {
    throw new AppError('Vendor not found.', 404);
  }

  // Authorization check
  if (user.role === ROLE_ENUM.ADMIN) {
    // Admin has full access
  } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(user.role)) {
    const managedPropertyIds = await PropertyUser.find({
      user: user._id,
      isActive: true,
      role: { $in: ['landlord', 'propertymanager', 'admin_access'] }
    }).distinct('property');
    
    const isAddedByMe = vendor.addedBy && 
      vendor.addedBy._id.toString() === user._id.toString();
      
    const isAssociated = vendor.associatedProperties && 
      vendor.associatedProperties.some(prop => 
        managedPropertyIds.some(id => id.toString() === prop._id.toString())
      );
      
    if (!isAddedByMe && !isAssociated) {
      throw new AppError('Access denied: You are not authorized to view this vendor.', 403);
    }
  } else {
    throw new AppError('Access denied: You do not have permission to view vendors.', 403);
  }

  // Log the action
  await auditService.logActivity(
    AUDIT_ACTION_ENUM.FETCH_ONE_VENDOR,
    AUDIT_RESOURCE_TYPE_ENUM[5], // 'Vendor'
    vendorId,
    {
      userId: user._id,
      ipAddress,
      description: `User ${user.email || user._id} viewed vendor ${vendor.name}.`
    }
  );

  return vendor;
};

/**
 * Updates an existing vendor.
 * @param {string} vendorId - The ID of the vendor to update
 * @param {Object} updateData - The data to update
 * @param {string} updatedByUserId - The ID of the user updating the vendor
 * @param {string} [ipAddress] - The IP address of the request
 * @returns {Promise<Object>} The updated vendor
 * @throws {AppError} If vendor not found or user lacks permission
 */
const updateVendor = async (vendorId, updateData, updatedByUserId, ipAddress) => {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) {
    throw new AppError('Vendor not found.', 404);
  }

  const updater = await User.findById(updatedByUserId);
  if (!updater) {
    throw new AppError('Updater user not found.', 404);
  }

  // Authorization check
  if (updater.role !== ROLE_ENUM.ADMIN) {
    const isAddedByMe = vendor.addedBy && 
      vendor.addedBy.toString() === updatedByUserId;
      
    if (!isAddedByMe) {
      // Check if user has management permission for any associated property
      let hasPermission = false;
      if (vendor.associatedProperties && vendor.associatedProperties.length > 0) {
        for (const propId of vendor.associatedProperties) {
          if (await checkPropertyManagementPermission(updater, propId)) {
            hasPermission = true;
            break;
          }
        }
      }
      
      if (!hasPermission) {
        throw new AppError('Access denied: You are not authorized to update this vendor.', 403);
      }
    }
  }

  // Validate services if provided
  if (updateData.services) {
    const normalizedServices = updateData.services.map(s => s.toLowerCase());
    const invalidServices = normalizedServices.filter(s => !SERVICE_ENUM_SET.has(s));
    if (invalidServices.length > 0) {
      throw new AppError(`Invalid service(s): ${invalidServices.join(', ')}. Allowed: ${SERVICE_ENUM.join(', ')}`, 400);
    }
    updateData.services = normalizedServices;
  }

  // Validate status if provided
  if (updateData.status) {
    const normalizedStatus = updateData.status.toLowerCase();
    if (!STATUS_ENUM_SET.has(normalizedStatus)) {
      throw new AppError(`Invalid status: ${updateData.status}. Allowed: ${STATUS_ENUM.join(', ')}`, 400);
    }
    updateData.status = normalizedStatus;
  }

  // Validate permissions for associated properties if provided
  if (updateData.associatedProperties && updateData.associatedProperties.length > 0) {
    for (const propId of updateData.associatedProperties) {
      const hasPermission = await checkPropertyManagementPermission(updater, propId);
      if (!hasPermission) {
        throw new AppError(`Not authorized to associate vendor with property ${propId}.`, 403);
      }
    }
  }

  const oldVendor = vendor.toObject();

  // Update the vendor
  Object.keys(updateData).forEach(key => {
    if (key !== '_id' && key !== 'addedBy' && key !== 'createdAt') {
      vendor[key] = updateData[key];
    }
  });

  let updatedVendor;
  try {
    updatedVendor = await vendor.save();
  } catch (err) {
    if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
      throw new AppError('A vendor with that email already exists.', 400);
    }
    logger.error(`Error updating vendor: ${err.message}`, { stack: err.stack });
    throw new AppError(`Failed to update vendor: ${err.message}`, 500);
  }

  // Log the action
  await auditService.logActivity(
    AUDIT_ACTION_ENUM.VENDOR_UPDATED,
    AUDIT_RESOURCE_TYPE_ENUM[5], // 'Vendor'
    updatedVendor._id,
    {
      userId: updatedByUserId,
      ipAddress,
      oldValue: oldVendor,
      newValue: updatedVendor.toObject(),
      description: `Vendor ${updatedVendor.name} updated by user ${updatedByUserId}.`
    }
  );

  logger.info(`VendorService: Vendor ${updatedVendor.name} updated by ${updatedByUserId}.`);
  return updatedVendor;
};

/**
 * Deletes a vendor and cleans up related references.
 * @param {string} vendorId - The ID of the vendor to delete
 * @param {Object} user - The user deleting the vendor
 * @param {string} [ipAddress] - The IP address of the request
 * @returns {Promise<void>}
 * @throws {AppError} If vendor not found or user lacks permission
 */
const deleteVendor = async (vendorId, user, ipAddress) => {
  const vendorToDelete = await Vendor.findById(vendorId);
  if (!vendorToDelete) {
    throw new AppError('Vendor not found.', 404);
  }

  // Authorization check - only admins can delete
  if (user.role !== ROLE_ENUM.ADMIN) {
    throw new AppError('Access denied: Only administrators can delete vendors.', 403);
  }

  const oldVendor = vendorToDelete.toObject();
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      // Clean up related references in a transaction
      await PropertyUser.deleteMany({ 
        user: vendorId, 
        role: 'vendor_access' 
      }, { session });
      
      await Request.updateMany(
        { assignedTo: vendorId, assignedToModel: 'Vendor' }, 
        { $set: { assignedTo: null, assignedToModel: null, status: 'new' } },
        { session }
      );
      
      await ScheduledMaintenance.updateMany(
        { assignedTo: vendorId, assignedToModel: 'Vendor' }, 
        { $set: { assignedTo: null, assignedToModel: null, status: 'active' } },
        { session }
      );
      
      // Delete the vendor
      await vendorToDelete.deleteOne({ session });
    });
  } catch (error) {
    logger.error(`Error deleting vendor: ${error.message}`, { stack: error.stack });
    throw new AppError(`Failed to delete vendor: ${error.message}`, 500);
  } finally {
    session.endSession();
  }

  // Log the action
  await auditService.logActivity(
    AUDIT_ACTION_ENUM.VENDOR_DEACTIVATED,
    AUDIT_RESOURCE_TYPE_ENUM[5], // 'Vendor'
    vendorId,
    {
      userId: user._id,
      ipAddress,
      oldValue: oldVendor,
      description: `Vendor ${oldVendor.name} deleted by user ${user.email || user._id}.`
    }
  );

  logger.info(`VendorService: Vendor ${oldVendor.name} deleted by ${user.email || user._id}.`);
};

/**
 * Gets summary statistics about vendors.
 * @param {Object} user - The user requesting the stats
 * @returns {Promise<Object>} Vendor statistics
 */
const getVendorStats = async (user) => {
  // Authorization check
  if (![ROLE_ENUM.ADMIN, ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(user.role)) {
    throw new AppError('Access denied: You do not have permission to view vendor statistics.', 403);
  }

  let propertyFilter = {};
  
  // For non-admins, limit to properties they manage
  if (user.role !== ROLE_ENUM.ADMIN) {
    const managedPropertyIds = await PropertyUser.find({
      user: user._id,
      isActive: true,
      role: { $in: ['landlord', 'propertymanager', 'admin_access'] }
    }).distinct('property');
    
    propertyFilter = { associatedProperties: { $in: managedPropertyIds } };
  }

  // Run aggregations in parallel for better performance
  const [
    totalVendors,
    activeVendors,
    vendorsByService,
    vendorsByProperty,
    topVendorsByCompletedJobs
  ] = await Promise.all([
    // Total vendor count
    Vendor.countDocuments(propertyFilter),
    
    // Active vendor count
    Vendor.countDocuments({ ...propertyFilter, status: 'active' }),
    
    // Vendors grouped by service
    Vendor.aggregate([
      { $match: propertyFilter },
      { $unwind: '$services' },
      { $group: { _id: '$services', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    
    // Vendors grouped by property (with property details)
    Vendor.aggregate([
      { $match: propertyFilter },
      { $unwind: '$associatedProperties' },
      { $group: { 
        _id: '$associatedProperties', 
        count: { $sum: 1 } 
      } },
      { $lookup: {
        from: 'properties',
        localField: '_id',
        foreignField: '_id',
        as: 'propertyDetails'
      } },
      { $unwind: { path: '$propertyDetails', preserveNullAndEmptyArrays: true } },
      { $project: {
        count: 1,
        propertyName: '$propertyDetails.name',
        propertyAddress: '$propertyDetails.address'
      } },
      { $sort: { count: -1 } }
    ]),
    
    // Top vendors by completed jobs
    Vendor.find(propertyFilter)
      .sort({ totalJobsCompleted: -1 })
      .limit(5)
      .select('name totalJobsCompleted averageRating')
  ]);

  return {
    totalVendors,
    activeVendors,
    inactiveVendors: totalVendors - activeVendors,
    vendorsByService,
    vendorsByProperty,
    topVendorsByCompletedJobs
  };
};

module.exports = {
  createVendor,
  getVendorsForUser,
  getVendorById,
  updateVendor,
  deleteVendor,
  getVendorStats
};