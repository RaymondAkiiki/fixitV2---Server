const Vendor = require('../models/vendor');
const User = require('../models/user');
const PropertyUser = require('../models/propertyUser');
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const { createAuditLog } = require('./auditService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const {
  ROLE_ENUM,
  PROPERTY_USER_ROLES_ENUM,
  SERVICE_ENUM,
  STATUS_ENUM,
  AUDIT_ACTION_ENUM,
  AUDIT_RESOURCE_TYPE_ENUM
} = require('../utils/constants/enums');

const SERVICE_ENUM_SET = new Set(SERVICE_ENUM.map(s => s.toLowerCase()));
const STATUS_ENUM_SET = new Set(STATUS_ENUM.map(s => s.toLowerCase()));

/**
 * Helper to check if a user has management permission for a given property.
 */
const checkPropertyManagementPermission = async (user, propertyId) => {
  if (user.role === 'admin') return true;
  const hasAccess = await PropertyUser.exists({
    user: user._id,
    property: propertyId,
    isActive: true,
    roles: { $in: [
      PROPERTY_USER_ROLES_ENUM[0], // landlord
      PROPERTY_USER_ROLES_ENUM[1], // propertymanager
      PROPERTY_USER_ROLES_ENUM[4], // admin_access
    ]}
  });
  return !!hasAccess;
};

/**
 * Creates a new vendor.
 */
const createVendor = async (vendorData, createdByUserId, ipAddress) => {
  const {
    name, phone, email, address, contactPerson, services, status, notes,
    associatedProperties, description, fixedCalloutFee, paymentTerms, companyName,
    licenseNumber, insuranceDetails, documents
  } = vendorData;

  if (!name || !phone || !email || !services || services.length === 0) {
    throw new AppError('Name, phone, email, and at least one service are required.', 400);
  }

  // Check if vendor with this email already exists
  const existingVendor = await Vendor.findOne({ email: email.toLowerCase() });
  if (existingVendor) throw new AppError(`A vendor with email ${email} already exists.`, 400);

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

  // Validate associatedProperties permissions
  if (associatedProperties && associatedProperties.length > 0) {
    const creator = await User.findById(createdByUserId);
    if (!creator) throw new AppError('Creator user not found.', 404);
    for (const propId of associatedProperties) {
      const hasPermission = await checkPropertyManagementPermission(creator, propId);
      if (!hasPermission) {
        throw new AppError(`Not authorized to associate vendor with property ${propId}.`, 403);
      }
    }
  }

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
    throw err;
  }

  await createAuditLog({
    action: AUDIT_ACTION_ENUM.find(a => a === 'VENDOR_CREATED') || 'CREATE',
    user: createdByUserId,
    resourceType: AUDIT_RESOURCE_TYPE_ENUM.find(r => r === 'Vendor') || 'Vendor',
    resourceId: createdVendor._id,
    newValue: createdVendor.toObject(),
    ipAddress,
    description: `Vendor ${createdVendor.name} created by user ${createdByUserId}.`,
    status: 'success'
  });

  logger.info(`VendorService: Vendor ${createdVendor.name} created by ${createdByUserId}.`);
  return createdVendor;
};

/**
 * Fetches vendors based on user role and filters.
 */
const getVendorsForUser = async (user, filters = {}, page = 1, limit = 10, ipAddress = undefined) => {
  const query = {};
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Role-based access control
  if (user.role === 'admin') {
    // Full access
  } else if (['landlord', 'propertymanager'].includes(user.role)) {
    // Only vendors they added or associated with properties they manage
    const managedPropertyIds = await PropertyUser.find({
      user: user._id,
      isActive: true,
      roles: { $in: [
        PROPERTY_USER_ROLES_ENUM[0], // landlord
        PROPERTY_USER_ROLES_ENUM[1], // propertymanager
        PROPERTY_USER_ROLES_ENUM[4], // admin_access
      ]}
    }).distinct('property');

    // Vendors associated with those properties
    query.$or = [
      { addedBy: user._id },
      { associatedProperties: { $in: managedPropertyIds } }
    ];
  } else {
    throw new AppError('Access denied: You do not have permission to view vendors.', 403);
  }

  // Filters
  if (filters.status) {
    const statusFilter = filters.status.toLowerCase();
    if (!STATUS_ENUM_SET.has(statusFilter)) {
      throw new AppError(`Invalid vendor status filter: ${filters.status}`, 400);
    }
    query.status = statusFilter;
  }
  if (filters.service) {
    const serviceFilter = filters.service.toLowerCase();
    if (!SERVICE_ENUM_SET.has(serviceFilter)) {
      throw new AppError(`Invalid service filter: ${filters.service}`, 400);
    }
    query.services = serviceFilter;
  }
  if (filters.propertyId) {
    if (user.role !== 'admin' && !(await checkPropertyManagementPermission(user, filters.propertyId))) {
      throw new AppError('Not authorized to filter vendors by this property.', 403);
    }
    query.associatedProperties = filters.propertyId;
  }
  if (filters.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { email: { $regex: filters.search, $options: 'i' } },
      { phone: { $regex: filters.search, $options: 'i' } },
      { contactPerson: { $regex: filters.search, $options: 'i' } },
      { companyName: { $regex: filters.search, $options: 'i' } },
      { description: { $regex: filters.search, $options: 'i' } }
    ];
  }

  const vendors = await Vendor.find(query)
    .populate('addedBy', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip(skip);

  const totalVendors = await Vendor.countDocuments(query);

  await createAuditLog({
    action: AUDIT_ACTION_ENUM.find(a => a === 'READ_ALL') || 'READ_ALL',
    user: user._id,
    resourceType: AUDIT_RESOURCE_TYPE_ENUM.find(r => r === 'Vendor') || 'Vendor',
    ipAddress,
    description: `User ${user.email} fetched list of vendors.`,
    status: 'success',
    metadata: { filters }
  });

  return {
    vendors,
    total: totalVendors,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Fetches a single vendor by ID, with authorization check.
 */
const getVendorById = async (vendorId, user) => {
  const vendor = await Vendor.findById(vendorId).populate('addedBy', 'firstName lastName email');
  if (!vendor) throw new AppError('Vendor not found.', 404);

  if (user.role === 'admin') {
    return vendor;
  } else if (['landlord', 'propertymanager'].includes(user.role)) {
    const managedPropertyIds = await PropertyUser.find({
      user: user._id,
      isActive: true,
      roles: { $in: [
        PROPERTY_USER_ROLES_ENUM[0],
        PROPERTY_USER_ROLES_ENUM[1],
        PROPERTY_USER_ROLES_ENUM[4],
      ]}
    }).distinct('property');
    const isAddedByMe = vendor.addedBy && vendor.addedBy._id.toString() === user._id.toString();
    const isAssociated = vendor.associatedProperties && vendor.associatedProperties.some(pid =>
      managedPropertyIds.map(id => id.toString()).includes(pid.toString())
    );
    if (isAddedByMe || isAssociated) {
      return vendor;
    } else {
      throw new AppError('Access denied: You are not authorized to view this vendor.', 403);
    }
  } else {
    throw new AppError('Access denied: You do not have permission to view vendors.', 403);
  }
};

/**
 * Updates an existing vendor.
 */
const updateVendor = async (vendorId, updateData, updatedByUserId, ipAddress) => {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw new AppError('Vendor not found.', 404);

  const updater = await User.findById(updatedByUserId);
  if (!updater) throw new AppError('Updater user not found.', 404);

  // Authorization
  if (updater.role === 'admin') {
    // Admin has full access
  } else if (['landlord', 'propertymanager'].includes(updater.role)) {
    const managedPropertyIds = await PropertyUser.find({
      user: updater._id,
      isActive: true,
      roles: { $in: [
        PROPERTY_USER_ROLES_ENUM[0],
        PROPERTY_USER_ROLES_ENUM[1],
        PROPERTY_USER_ROLES_ENUM[4],
      ]}
    }).distinct('property');
    const isAddedByMe = vendor.addedBy && vendor.addedBy.toString() === updatedByUserId;
    const isAssociated = vendor.associatedProperties && vendor.associatedProperties.some(pid =>
      managedPropertyIds.map(id => id.toString()).includes(pid.toString())
    );
    if (!isAddedByMe && !isAssociated) {
      throw new AppError('Access denied: You are not authorized to update this vendor.', 403);
    }
    // Prevent PM/Landlord from deactivating
    if (updateData.status && updateData.status.toLowerCase() === 'inactive' && updater.role !== 'admin') {
      throw new AppError('Only administrators can deactivate vendors.', 403);
    }
    // Prevent PM/Landlord from changing email
    if (updateData.email && updateData.email !== vendor.email) {
      throw new AppError('Landlords/Property Managers cannot change vendor email addresses.', 403);
    }
  } else {
    throw new AppError('Access denied: You do not have permission to update vendors.', 403);
  }

  const oldVendor = vendor.toObject();

  // Update fields
  for (const key of Object.keys(updateData)) {
    if (updateData[key] !== undefined) {
      if (key === 'services' && Array.isArray(updateData[key])) {
        const normalizedServices = updateData[key].map(s => s.toLowerCase());
        const invalidServices = normalizedServices.filter(s => !SERVICE_ENUM_SET.has(s));
        if (invalidServices.length > 0) {
          throw new AppError(`Invalid service(s): ${invalidServices.join(', ')}. Allowed: ${SERVICE_ENUM.join(', ')}`, 400);
        }
        vendor.services = normalizedServices;
      } else if (key === 'status') {
        const normalizedStatus = updateData[key].toLowerCase();
        if (!STATUS_ENUM_SET.has(normalizedStatus)) {
          throw new AppError(`Invalid vendor status: ${updateData[key]}. Allowed: ${STATUS_ENUM.join(', ')}`, 400);
        }
        vendor.status = normalizedStatus;
      } else if (key === 'associatedProperties') {
        vendor.associatedProperties = updateData.associatedProperties;
      } else {
        vendor[key] = updateData[key];
      }
    }
  }

  let updatedVendor;
  try {
    updatedVendor = await vendor.save();
  } catch (err) {
    if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
      throw new AppError('A vendor with that email already exists.', 400);
    }
    throw err;
  }

  await createAuditLog({
    action: AUDIT_ACTION_ENUM.find(a => a === 'VENDOR_UPDATED') || 'UPDATE',
    user: updatedByUserId,
    resourceType: AUDIT_RESOURCE_TYPE_ENUM.find(r => r === 'Vendor') || 'Vendor',
    resourceId: updatedVendor._id,
    oldValue: oldVendor,
    newValue: updatedVendor.toObject(),
    ipAddress,
    description: `Vendor ${updatedVendor.name} updated by user ${updatedByUserId}.`,
    status: 'success'
  });

  logger.info(`VendorService: Vendor ${updatedVendor.name} updated by ${updatedByUserId}.`);
  return updatedVendor;
};

/**
 * Deletes a vendor and cleans up related references.
 */
const deleteVendor = async (vendorId, user, ipAddress) => {
  const vendorToDelete = await Vendor.findById(vendorId);
  if (!vendorToDelete) throw new AppError('Vendor not found.', 404);

  if (user.role !== 'admin') {
    throw new AppError('Access denied: Only administrators can delete vendors.', 403);
  }

  const oldVendor = vendorToDelete.toObject();

  // 1. Remove PropertyUser associations
  await PropertyUser.deleteMany({ user: vendorId, roles: PROPERTY_USER_ROLES_ENUM[3] }); // vendor_access
  logger.info(`VendorService: Deleted PropertyUser associations for vendor ${vendorToDelete.name}.`);

  // 2. Update Requests assigned to this vendor
  await Request.updateMany(
    { assignedTo: vendorId, assignedToModel: 'Vendor' },
    { $set: { assignedTo: null, assignedToModel: null, status: 'new' } }
  );
  logger.info(`VendorService: Updated Request assignments for vendor ${vendorToDelete.name}.`);

  // 3. Update ScheduledMaintenance assigned to this vendor
  await ScheduledMaintenance.updateMany(
    { assignedTo: vendorId, assignedToModel: 'Vendor' },
    { $set: { assignedTo: null, assignedToModel: null, status: 'scheduled' } }
  );
  logger.info(`VendorService: Updated ScheduledMaintenance assignments for vendor ${vendorToDelete.name}.`);

  // 4. Delete the vendor
  await vendorToDelete.deleteOne();

  await createAuditLog({
    action: AUDIT_ACTION_ENUM.find(a => a === 'VENDOR_DEACTIVATED') || 'DELETE',
    user: user._id,
    resourceType: AUDIT_RESOURCE_TYPE_ENUM.find(r => r === 'Vendor') || 'Vendor',
    resourceId: vendorId,
    oldValue: oldVendor,
    newValue: null,
    ipAddress,
    description: `Vendor ${oldVendor.name} deleted by user ${user.email}.`,
    status: 'success'
  });

  logger.info(`VendorService: Vendor ${oldVendor.name} deleted by ${user.email}.`);
};

module.exports = {
  createVendor,
  getVendorsForUser,
  getVendorById,
  updateVendor,
  deleteVendor,
};