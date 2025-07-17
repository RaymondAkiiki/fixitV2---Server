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

  const existingVendor = await Vendor.findOne({ email: email.toLowerCase() });
  if (existingVendor) throw new AppError(`A vendor with email ${email} already exists.`, 400);

  const normalizedServices = services.map(s => s.toLowerCase());
  const invalidServices = normalizedServices.filter(s => !SERVICE_ENUM_SET.has(s));
  if (invalidServices.length > 0) {
    throw new AppError(`Invalid service(s): ${invalidServices.join(', ')}. Allowed: ${SERVICE_ENUM.join(', ')}`, 400);
  }

  let normalizedStatus = status ? status.toLowerCase() : 'active';
  if (!STATUS_ENUM_SET.has(normalizedStatus)) {
    throw new AppError(`Invalid status: ${status}. Allowed: ${STATUS_ENUM.join(', ')}`, 400);
  }

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
    name, phone, email: email.toLowerCase(), address, contactPerson,
    services: normalizedServices, status: normalizedStatus, notes,
    associatedProperties, addedBy: createdByUserId, description,
    fixedCalloutFee, paymentTerms, companyName, licenseNumber,
    insuranceDetails, documents
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
    action: AUDIT_ACTION_ENUM.VENDOR_CREATED,
    user: createdByUserId,
    resourceType: 'Vendor',
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

  if (user.role === 'admin') {
    // Full access
  } else if (['landlord', 'propertymanager'].includes(user.role)) {
    const managedPropertyIds = await PropertyUser.find({
      user: user._id,
      isActive: true,
      roles: { $in: [PROPERTY_USER_ROLES_ENUM[0], PROPERTY_USER_ROLES_ENUM[1], PROPERTY_USER_ROLES_ENUM[4]] }
    }).distinct('property');
    query.$or = [{ addedBy: user._id }, { associatedProperties: { $in: managedPropertyIds } }];
  } else {
    throw new AppError('Access denied: You do not have permission to view vendors.', 403);
  }

  if (filters.status) {
    query.status = filters.status.toLowerCase();
  }
  if (filters.service) {
    query.services = filters.service.toLowerCase();
  }
  if (filters.propertyId) {
    if (user.role !== 'admin' && !(await checkPropertyManagementPermission(user, filters.propertyId))) {
      throw new AppError('Not authorized to filter vendors by this property.', 403);
    }
    query.associatedProperties = filters.propertyId;
  }
  if (filters.search) {
    query.$or = (query.$or || []).concat([
      { name: { $regex: filters.search, $options: 'i' } },
      { email: { $regex: filters.search, $options: 'i' } },
      { phone: { $regex: filters.search, $options: 'i' } },
    ]);
  }

  const vendors = await Vendor.find(query)
    .populate('addedBy', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip(skip);

  const totalVendors = await Vendor.countDocuments(query);
  
  await createAuditLog({
    action: AUDIT_ACTION_ENUM.FETCH_ALL_VENDORS, // Correctly use the specific enum
    user: user._id,
    resourceType: 'Vendor',
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
            roles: { $in: [ PROPERTY_USER_ROLES_ENUM[0], PROPERTY_USER_ROLES_ENUM[1], PROPERTY_USER_ROLES_ENUM[4] ]}
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

  if (updater.role !== 'admin') {
      const isAddedByMe = vendor.addedBy && vendor.addedBy.toString() === updatedByUserId;
      if (!isAddedByMe) {
          throw new AppError('Access denied: You are not authorized to update this vendor.', 403);
      }
  }

  const oldVendor = vendor.toObject();

  Object.assign(vendor, updateData);

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
    action: AUDIT_ACTION_ENUM.VENDOR_UPDATED,
    user: updatedByUserId,
    resourceType: 'Vendor',
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

  await PropertyUser.deleteMany({ user: vendorId, roles: 'vendor_access' });
  await Request.updateMany({ assignedTo: vendorId, assignedToModel: 'Vendor' }, { $set: { assignedTo: null, assignedToModel: null, status: 'new' } });
  await ScheduledMaintenance.updateMany({ assignedTo: vendorId, assignedToModel: 'Vendor' }, { $set: { assignedTo: null, assignedToModel: null, status: 'scheduled' } });
  
  await vendorToDelete.deleteOne();

  await createAuditLog({
    action: AUDIT_ACTION_ENUM.VENDOR_DEACTIVATED,
    user: user._id,
    resourceType: 'Vendor',
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