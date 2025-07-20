// src/services/adminService.js

const mongoose = require('mongoose');
const crypto = require('crypto');
const {
  User,
  Property,
  Unit,
  Vendor,
  Request,
  Lease,
  Rent,
  ScheduledMaintenance,
  Invite,
  Comment,
  Media,
  AuditLog,
  PropertyUser,
} = require('../models');

const {
  ROLE_ENUM,
  SERVICE_ENUM,
  REQUEST_STATUS_ENUM,
  PAYMENT_STATUS_ENUM,
  LEASE_STATUS_ENUM,
  INVITE_STATUS_ENUM,
  AUDIT_ACTION_ENUM,
  AUDIT_RESOURCE_TYPE_ENUM,
  UNIT_STATUS_ENUM,
  FREQUENCY_TYPE_ENUM,
  PROPERTY_USER_ROLES_ENUM,
  REGISTRATION_STATUS_ENUM,
} = require('../utils/constants/enums');

const emailService = require('./emailService');
const { uploadFileBuffer, deleteFile, getFileUrl } = require('./cloudStorageService');
const notificationService = require('./notificationService');
const authService = require('./authService');
const { createAuditLog } = require('./auditService');
const logger = require('../utils/logger');

/**
 * Get dashboard statistics for admin overview
 * @returns {Promise<object>} Statistics for admin dashboard
 */
const getDashboardStats = async () => {
  const [
    totalUsers,
    totalProperties,
    totalUnits,
    totalRequests,
    totalScheduledMaintenance,
    recentUsers,
    totalVendors,
    activeInvites,
    requestsByStatusAgg,
    usersByRoleAgg
  ] = await Promise.all([
    User.countDocuments(),
    Property.countDocuments(),
    Unit.countDocuments(),
    Request.countDocuments(),
    ScheduledMaintenance.countDocuments(),
    User.find().sort({ createdAt: -1 }).limit(5).select('firstName lastName email role createdAt'),
    Vendor.countDocuments(),
    Invite.countDocuments({ status: 'pending', expiresAt: { $gt: new Date() } }),
    Request.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { status: '$_id', count: 1, _id: 0 } }
    ]),
    User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $project: { role: '$_id', count: 1, _id: 0 } }
    ])
  ]);

  return {
    totalUsers,
    totalProperties,
    totalUnits,
    totalRequests,
    totalScheduledMaintenance,
    totalVendors,
    activeInvites,
    recentUsers,
    requestsByStatus: requestsByStatusAgg.reduce((acc, item) => ({ ...acc, [item.status]: item.count }), {}),
    usersByRole: usersByRoleAgg.reduce((acc, item) => ({ ...acc, [item.role]: item.count }), {}),
  };
};

/**
 * Get admin user profile details
 * @param {string} userId - ID of the admin user
 * @returns {Promise<object>} Admin user details
 */
const getAdminUser = async (userId) => {
  const adminUser = await User.findById(userId).select('-passwordHash -resetPasswordToken -resetPasswordExpires');
  if (!adminUser) {
    throw new Error("Admin user not found");
  }
  return adminUser;
};

/**
 * Get all users with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated user results
 */
const getAllUsers = async (filters, page = 1, limit = 10) => {
  const { role, status, search } = filters;
  const query = {};
  
  if (role) query.role = role;
  if (status) query.isActive = status === 'active';
  if (search) {
    query.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }

  const users = await User.find(query)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .sort({ createdAt: -1 });

  const totalUsers = await User.countDocuments(query);

  return {
    users,
    count: users.length,
    total: totalUsers,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get a single user by ID
 * @param {string} userId - ID of the user to retrieve
 * @returns {Promise<object>} User document
 */
const getUserById = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  return user;
};

/**
 * Create a new user
 * @param {object} userData - User data for creation
 * @returns {Promise<object>} Created user document
 */
const createUser = async (userData) => {
  const { firstName, lastName, email, phone, password, role } = userData;
  return await authService.registerUser({
    firstName,
    lastName,
    email,
    phone,
    password,
    role: role || 'tenant' // Default role
  });
};

/**
 * Update a user's details
 * @param {string} userId - ID of the user to update
 * @param {object} updateData - Data to update
 * @returns {Promise<object>} Updated user document
 */
const updateUser = async (userId, updateData) => {
  const { firstName, lastName, phone, email, role, isActive, preferences, registrationStatus } = updateData;

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Check email uniqueness if changing
  if (email && email !== user.email) {
    const emailExists = await User.findOne({ email, _id: { $ne: userId } });
    if (emailExists) {
      throw new Error('Email already in use by another user');
    }
    user.email = email;
  }

  // Update other fields
  if (firstName) user.firstName = firstName;
  if (lastName) user.lastName = lastName;
  if (phone) user.phone = phone;
  if (role && Object.values(ROLE_ENUM).includes(role)) user.role = role;
  if (typeof isActive === 'boolean') user.isActive = isActive;
  if (preferences) user.preferences = { ...user.preferences, ...preferences };
  if (registrationStatus && Object.values(REGISTRATION_STATUS_ENUM).includes(registrationStatus)) {
    user.registrationStatus = registrationStatus;
  }

  await user.save({ validateBeforeSave: true });
  return user;
};

/**
 * Deactivate a user account
 * @param {string} userId - ID of the user to deactivate
 * @returns {Promise<object>} Updated user document
 */
const deactivateUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  if (!user.isActive) {
    throw new Error('User is already deactivated');
  }

  user.isActive = false;
  user.registrationStatus = 'deactivated';
  await user.save();
  return user;
};

/**
 * Activate a user account
 * @param {string} userId - ID of the user to activate
 * @returns {Promise<object>} Updated user document
 */
const activateUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  if (user.isActive) {
    throw new Error('User is already active');
  }

  user.isActive = true;
  // Set appropriate status based on previous state
  if (user.registrationStatus === 'deactivated') {
    // If user was deactivated while pending approval, restore that state
    const wasAwaitingApproval = await AuditLog.findOne({
      'oldValue.registrationStatus': 'pending_admin_approval',
      'newValue.registrationStatus': 'deactivated',
      resourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
      resourceId: user._id
    }).sort({ createdAt: -1 });
    
    if (wasAwaitingApproval) {
      user.registrationStatus = 'pending_admin_approval';
    } else {
      user.registrationStatus = 'active';
    }
  }
  
  await user.save();
  return user;
};

/**
 * Manually approve a user's registration
 * @param {string} userId - ID of the user to approve
 * @returns {Promise<object>} Updated user document
 */
const approveUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  if (user.registrationStatus === 'active') {
    throw new Error('User is already active and approved');
  }
  if (user.registrationStatus !== 'pending_admin_approval') {
    throw new Error(`User status is '${user.registrationStatus}'. Only 'pending_admin_approval' can be approved.`);
  }

  user.registrationStatus = 'active';
  user.isActive = true;
  await user.save();
  
  // Send notification
  await notificationService.sendNotification({
    recipientId: user._id,
    type: 'user_approved',
    message: `Your account for Property Management System has been approved by an administrator. You can now fully access all features.`,
    link: '/dashboard',
    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
    relatedResourceId: user._id,
    emailDetails: {
      subject: 'Your Account Has Been Approved!',
      html: `<p>Dear ${user.firstName},</p><p>Your account for Property Management System has been approved by an administrator. You can now fully access all features.</p><p>Click <a href="${process.env.FRONTEND_URL}/dashboard">here</a> to login.</p><p>Thank you,</p><p>The Property Management Team</p>`
    }
  });
  
  return user;
};

/**
 * Reset a user's password (admin function, doesn't require old password)
 * @param {string} userId - ID of the user
 * @param {string} newPassword - New password to set
 * @returns {Promise<void>}
 */
const resetUserPassword = async (userId, newPassword) => {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters long');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  user.passwordHash = newPassword; // Pre-save hook will hash this
  await user.save();
  
  // Send notification
  await notificationService.sendNotification({
    recipientId: user._id,
    type: 'password_reset',
    message: 'Your password has been reset by an administrator. If this was unexpected, please contact support immediately.',
    link: '/login',
    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
    relatedResourceId: user._id,
    emailDetails: {
      subject: 'Your Password Has Been Reset by Administrator',
      html: `<p>Dear ${user.firstName},</p><p>Your password for Property Management System has been reset by an administrator.</p><p>If you did not request or authorize this change, please contact support immediately.</p><p>Click <a href="${process.env.FRONTEND_URL}/login">here</a> to login with your new password.</p><p>Thank you,</p><p>The Property Management Team</p>`
    }
  });
};

/**
 * Get all properties with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated property results
 */
const getAllProperties = async (filters, page = 1, limit = 10) => {
  const { search, type, isActive } = filters;
  const query = {};
  
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { 'address.city': { $regex: search, $options: 'i' } },
      { 'address.street': { $regex: search, $options: 'i' } }
    ];
  }
  if (type) query.propertyType = type;
  if (typeof isActive === 'boolean') query.isActive = isActive;

  const properties = await Property.find(query)
    .populate('mainContactUser', 'firstName lastName email')
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  const totalProperties = await Property.countDocuments(query);

  return {
    properties,
    count: properties.length,
    total: totalProperties,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get a single property by ID
 * @param {string} propertyId - ID of the property
 * @returns {Promise<object>} Property document with populated fields
 */
const getPropertyById = async (propertyId) => {
  const property = await Property.findById(propertyId)
    .populate('mainContactUser', 'firstName lastName email')
    .populate('units');
    
  if (!property) {
    throw new Error('Property not found');
  }
  
  return property;
};

/**
 * Create a new property
 * @param {object} propertyData - Property data
 * @param {string} creatorId - ID of the user creating the property
 * @returns {Promise<object>} Created property document
 */
const createProperty = async (propertyData, creatorId) => {
  const { name, address, propertyType, yearBuilt, details, amenities, mainContactUser } = propertyData;

  const newProperty = await Property.create({
    name,
    address,
    propertyType,
    yearBuilt,
    details,
    amenities,
    createdBy: creatorId,
    mainContactUser: mainContactUser || creatorId // Default to creator if not specified
  });

  return newProperty;
};

/**
 * Update an existing property
 * @param {string} propertyId - ID of the property to update
 * @param {object} updateData - Data to update
 * @returns {Promise<object>} Updated property document
 */
const updateProperty = async (propertyId, updateData) => {
  const property = await Property.findById(propertyId);
  if (!property) {
    throw new Error('Property not found');
  }

  Object.assign(property, updateData);
  await property.save({ validateBeforeSave: true });
  
  return property;
};

/**
 * Deactivate a property
 * @param {string} propertyId - ID of the property to deactivate
 * @returns {Promise<object>} Updated property document
 */
const deactivateProperty = async (propertyId) => {
  const property = await Property.findById(propertyId);
  if (!property) {
    throw new Error('Property not found');
  }
  if (!property.isActive) {
    throw new Error('Property is already deactivated');
  }

  property.isActive = false;
  await property.save();
  
  return property;
};

/**
 * Get all units with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated unit results
 */
const getAllUnits = async (filters, page = 1, limit = 10) => {
  const { propertyId, status, search } = filters;
  const query = {};
  
  if (propertyId) query.property = propertyId;
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { unitName: { $regex: search, $options: 'i' } },
      { details: { $regex: search, $options: 'i' } }
    ];
  }

  const units = await Unit.find(query)
    .populate('property', 'name address')
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  const totalUnits = await Unit.countDocuments(query);

  return {
    units,
    count: units.length,
    total: totalUnits,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get a single unit by ID
 * @param {string} unitId - ID of the unit
 * @returns {Promise<object>} Unit document with populated fields
 */
const getUnitById = async (unitId) => {
  const unit = await Unit.findById(unitId)
    .populate('property', 'name address');
    
  if (!unit) {
    throw new Error('Unit not found');
  }
  
  return unit;
};

/**
 * Create a new unit
 * @param {object} unitData - Unit data
 * @returns {Promise<object>} Created unit document
 */
const createUnit = async (unitData) => {
  const { unitName, property, floor, details, numBedrooms, numBathrooms, squareFootage, rentAmount, depositAmount, status, utilityResponsibility, notes, lastInspected } = unitData;

  const propertyExists = await Property.findById(property);
  if (!propertyExists) {
    throw new Error('Associated property not found');
  }

  const newUnit = await Unit.create({
    unitName,
    property,
    floor,
    details,
    numBedrooms,
    numBathrooms,
    squareFootage,
    rentAmount,
    depositAmount,
    status: status || UNIT_STATUS_ENUM[0], // Default status
    utilityResponsibility,
    notes,
    lastInspected
  });

  // Add unit to property's units array
  propertyExists.units.push(newUnit._id);
  propertyExists.numberOfUnits = (propertyExists.numberOfUnits || 0) + 1;
  await propertyExists.save();

  return newUnit;
};

/**
 * Update an existing unit
 * @param {string} unitId - ID of the unit to update
 * @param {object} updateData - Data to update
 * @returns {Promise<object>} Updated unit document
 */
const updateUnit = async (unitId, updateData) => {
  const unit = await Unit.findById(unitId);
  if (!unit) {
    throw new Error('Unit not found');
  }

  Object.assign(unit, updateData);
  await unit.save({ validateBeforeSave: true });
  
  return unit;
};

/**
 * Deactivate a unit (mark as unavailable)
 * @param {string} unitId - ID of the unit to deactivate
 * @returns {Promise<object>} Updated unit document
 */
const deactivateUnit = async (unitId) => {
  const unit = await Unit.findById(unitId);
  if (!unit) {
    throw new Error('Unit not found');
  }
  if (unit.status === 'unavailable') {
    throw new Error('Unit is already unavailable');
  }

  unit.status = 'unavailable';
  await unit.save();
  
  return unit;
};

/**
 * Get all maintenance requests with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated request results
 */
const getAllRequests = async (filters, page = 1, limit = 10) => {
  const { status, priority, category, propertyId, unitId, search } = filters;
  const query = {};

  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (category) query.category = category;
  if (propertyId) query.property = propertyId;
  if (unitId) query.unit = unitId;
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  const requests = await Request.find(query)
    .populate('property', 'name')
    .populate('unit', 'unitName')
    .populate('createdByPropertyUser', {
      path: 'user',
      select: 'firstName lastName email'
    })
    .populate({
      path: 'assignedTo',
      refPath: 'assignedToModel',
      select: 'firstName lastName email name'
    })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .sort({ createdAt: -1 });

  const totalRequests = await Request.countDocuments(query);

  return {
    requests,
    count: requests.length,
    total: totalRequests,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get request analytics data
 * @returns {Promise<object>} Request analytics
 */
const getRequestAnalytics = async () => {
  const statusBreakdown = await Request.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $project: { status: '$_id', count: 1, _id: 0 } }
  ]);

  const priorityBreakdown = await Request.aggregate([
    { $group: { _id: '$priority', count: { $sum: 1 } } },
    { $project: { priority: '$_id', count: 1, _id: 0 } }
  ]);

  // Average resolution time
  const avgResolutionTimeResult = await Request.aggregate([
    { $match: { status: 'completed', resolvedAt: { $ne: null }, createdAt: { $ne: null } } },
    {
      $project: {
        timeDiff: { $subtract: ['$resolvedAt', '$createdAt'] }
      }
    },
    {
      $group: {
        _id: null,
        averageTimeMs: { $avg: '$timeDiff' }
      }
    }
  ]);

  const avgResolutionTimeHours = avgResolutionTimeResult.length > 0
    ? (avgResolutionTimeResult[0].averageTimeMs / (1000 * 60 * 60)).toFixed(2)
    : 'N/A';

  return {
    statusBreakdown: statusBreakdown.reduce((acc, item) => ({ ...acc, [item.status]: item.count }), {}),
    priorityBreakdown: priorityBreakdown.reduce((acc, item) => ({ ...acc, [item.priority]: item.count }), {}),
    averageResolutionTimeHours: avgResolutionTimeHours
  };
};

/**
 * Get a single request by ID
 * @param {string} requestId - ID of the request
 * @returns {Promise<object>} Request document with populated fields
 */
const getRequestById = async (requestId) => {
  const request = await Request.findById(requestId)
    .populate('property', 'name address')
    .populate('unit', 'unitName')
    .populate('createdByPropertyUser', {
      path: 'user',
      select: 'firstName lastName email'
    })
    .populate({
      path: 'assignedTo',
      refPath: 'assignedToModel',
      select: 'firstName lastName email name'
    })
    .populate({
      path: 'media',
      select: 'url filename mimeType size description'
    })
    .populate({
      path: 'comments',
      populate: { 
        path: 'sender', 
        select: 'firstName lastName email' 
      }
    });
    
  if (!request) {
    throw new Error('Request not found');
  }
  
  return request;
};

/**
 * Update a request's status
 * @param {string} requestId - ID of the request
 * @param {string} status - New status
 * @param {string} userId - ID of the user making the change
 * @returns {Promise<object>} Updated request document
 */
const updateRequestStatus = async (requestId, status, userId) => {
  if (!status || !Object.values(REQUEST_STATUS_ENUM).includes(status)) {
    throw new Error(`Invalid status provided. Must be one of: ${Object.values(REQUEST_STATUS_ENUM).join(', ')}`);
  }

  const request = await Request.findById(requestId);
  if (!request) {
    throw new Error('Request not found');
  }

  const oldStatus = request.status;
  request.status = status;

  // Handle completion logic
  if (status === 'completed' || status === 'verified') {
    request.resolvedAt = new Date();
    request.completedBy = userId;
    request.completedByModel = 'User';
  } else if (oldStatus === 'completed' || oldStatus === 'verified') {
    // Clear completion data if moving from completed status to non-completed
    request.resolvedAt = undefined;
    request.completedBy = undefined;
    request.completedByModel = undefined;
  }

  await request.save({ validateBeforeSave: true });
  
  // Send notification
  const requester = await User.findById(request.createdBy);
  if (requester) {
    await notificationService.sendNotification({
      recipientId: request.createdBy,
      type: 'status_update',
      message: `The status of your request "${request.title}" has been updated to: ${status}.`,
      link: `/requests/${request._id}`,
      relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
      relatedResourceId: request._id,
      emailDetails: {
        subject: `Request Status Update: ${request.title}`,
        html: `<p>Dear ${requester.firstName},</p><p>The status of your request <strong>"${request.title}"</strong> has been updated to: <strong>${status}</strong>.</p><p>Click <a href="${process.env.FRONTEND_URL}/requests/${request._id}">here</a> to view details.</p><p>Thank you,</p><p>The Property Management Team</p>`
      }
    });
  }
  
  return request;
};

/**
 * Assign a request to a user or vendor
 * @param {string} requestId - ID of the request
 * @param {string} assignedToId - ID of the assignee
 * @param {string} assignedToModel - Type of assignee ('User' or 'Vendor')
 * @param {string} assignerId - ID of the user making the assignment
 * @returns {Promise<object>} Updated request document
 */
const assignRequest = async (requestId, assignedToId, assignedToModel, assignerId) => {
  if (!assignedToId || !assignedToModel || !['User', 'Vendor'].includes(assignedToModel)) {
    throw new Error('Valid assignedToId and assignedToModel (User or Vendor) are required');
  }

  const request = await Request.findById(requestId);
  if (!request) {
    throw new Error('Request not found');
  }

  // Verify assignee exists
  let assignedEntity;
  if (assignedToModel === 'User') {
    assignedEntity = await User.findById(assignedToId);
  } else if (assignedToModel === 'Vendor') {
    assignedEntity = await Vendor.findById(assignedToId);
  }

  if (!assignedEntity) {
    throw new Error(`${assignedToModel} not found`);
  }

  // Update request
  request.assignedTo = assignedToId;
  request.assignedToModel = assignedToModel;
  request.assignedBy = assignerId;
  request.assignedAt = new Date();
  request.status = 'assigned'; // Update status to assigned

  await request.save({ validateBeforeSave: true });
  
  // Send notification
  await notificationService.sendNotification({
    recipientId: assignedToId, // This assumes vendors also have user accounts to receive notifications
    type: 'assignment',
    message: `You have been assigned to request: "${request.title}".`,
    link: assignedToModel === 'User' ? `/requests/${request._id}` : `/vendor-requests/${request._id}`,
    relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
    relatedResourceId: request._id,
    emailDetails: {
      subject: `New Request Assignment: ${request.title}`,
      html: `<p>Dear ${assignedEntity.firstName || assignedEntity.name},</p><p>You have been assigned to a new request: <strong>"${request.title}"</strong>.</p><p>Click <a href="${process.env.FRONTEND_URL}${assignedToModel === 'User' ? `/requests/${request._id}` : `/vendor-requests/${request._id}`}">here</a> to view details.</p><p>Thank you,</p><p>The Property Management Team</p>`
    }
  });
  
  return request;
};

/**
 * Add a comment to a request
 * @param {string} requestId - ID of the request
 * @param {object} commentData - Comment data
 * @param {string} userId - ID of the user adding the comment
 * @returns {Promise<object>} Created comment document
 */
const addCommentToRequest = async (requestId, commentData, userId) => {
  const { message, isInternalNote, mediaFiles } = commentData;

  if (!message) {
    throw new Error('Comment message is required');
  }

  const request = await Request.findById(requestId);
  if (!request) {
    throw new Error('Request not found');
  }

  // Create comment
  const newComment = await Comment.create({
    contextType: 'Request',
    contextId: request._id,
    sender: userId,
    message,
    isInternalNote: isInternalNote || false
  });

  // Process media if provided
  const uploadedMediaIds = [];
  if (mediaFiles && mediaFiles.length > 0) {
    for (const file of mediaFiles) {
      const mediaDoc = await Media.create({
        filename: file.filename,
        originalname: file.originalname || file.filename,
        mimeType: file.mimeType,
        size: file.size,
        url: file.url,
        thumbnailUrl: file.thumbnailUrl || null,
        uploadedBy: userId,
        relatedTo: 'Comment',
        relatedId: newComment._id
      });
      uploadedMediaIds.push(mediaDoc._id);
    }
    
    newComment.media = uploadedMediaIds;
    await newComment.save();
  }

  // Add comment to request
  request.comments.push(newComment._id);
  await request.save();

  // Send notification if not internal note
  if (!isInternalNote && request.createdBy.toString() !== userId.toString()) {
    const requester = await User.findById(request.createdBy);
    if (requester) {
      await notificationService.sendNotification({
        recipientId: request.createdBy,
        type: 'new_comment',
        message: `A new comment has been added to your request "${request.title}".`,
        link: `/requests/${request._id}`,
        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Comment,
        relatedResourceId: newComment._id,
        emailDetails: {
          subject: `New Comment on Your Request: ${request.title}`,
          html: `<p>Dear ${requester.firstName},</p><p>A new comment has been added to your request <strong>"${request.title}"</strong>:</p><p><em>"${message}"</em></p><p>Click <a href="${process.env.FRONTEND_URL}/requests/${request._id}">here</a> to view details.</p><p>Thank you,</p><p>The Property Management Team</p>`
        }
      });
    }
  }

  return newComment;
};

/**
 * Get all vendors with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated vendor results
 */
const getAllVendors = async (filters, page = 1, limit = 10) => {
  const { status, service, search } = filters;
  const query = {};
  
  if (status) query.status = status;
  if (service) query.services = service; // Match any service
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { companyName: { $regex: search, $options: 'i' } }
    ];
  }

  const vendors = await Vendor.find(query)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .sort({ createdAt: -1 });

  const totalVendors = await Vendor.countDocuments(query);

  return {
    vendors,
    count: vendors.length,
    total: totalVendors,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get a single vendor by ID
 * @param {string} vendorId - ID of the vendor
 * @returns {Promise<object>} Vendor document with populated fields
 */
const getVendorById = async (vendorId) => {
  const vendor = await Vendor.findById(vendorId)
    .populate('addedBy', 'firstName lastName email');
    
  if (!vendor) {
    throw new Error('Vendor not found');
  }
  
  return vendor;
};

/**
 * Create a new vendor
 * @param {object} vendorData - Vendor data
 * @param {string} creatorId - ID of the user creating the vendor
 * @returns {Promise<object>} Created vendor document
 */
const createVendor = async (vendorData, creatorId) => {
  const { name, phone, email, address, description, services, contactPerson, fixedCalloutFee, paymentTerms, status, companyName, licenseNumber, insuranceDetails } = vendorData;

  const newVendor = await Vendor.create({
    name, 
    phone, 
    email, 
    address, 
    description, 
    services, 
    contactPerson, 
    fixedCalloutFee, 
    paymentTerms,
    status: status || 'active',
    companyName, 
    licenseNumber, 
    insuranceDetails,
    addedBy: creatorId
  });

  return newVendor;
};

/**
 * Update an existing vendor
 * @param {string} vendorId - ID of the vendor to update
 * @param {object} updateData - Data to update
 * @returns {Promise<object>} Updated vendor document
 */
const updateVendor = async (vendorId, updateData) => {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) {
    throw new Error('Vendor not found');
  }

  Object.assign(vendor, updateData);
  await vendor.save({ validateBeforeSave: true });
  
  return vendor;
};

/**
 * Deactivate a vendor
 * @param {string} vendorId - ID of the vendor to deactivate
 * @returns {Promise<object>} Updated vendor document
 */
const deactivateVendor = async (vendorId) => {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) {
    throw new Error('Vendor not found');
  }
  if (vendor.status === 'inactive') {
    throw new Error('Vendor is already inactive');
  }

  vendor.status = 'inactive';
  await vendor.save();
  
  return vendor;
};

/**
 * Get all invites with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated invite results
 */
const getAllInvites = async (filters, page = 1, limit = 10) => {
  const { status, role, search } = filters;
  const query = {};
  
  if (status) query.status = status;
  if (role) query.role = role;
  if (search) {
    query.email = { $regex: search, $options: 'i' };
  }

  const invites = await Invite.find(query)
    .populate('generatedBy', 'firstName lastName email')
    .populate('acceptedBy', 'firstName lastName email')
    .populate('property', 'name')
    .populate('unit', 'unitName')
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .sort({ createdAt: -1 });

  const totalInvites = await Invite.countDocuments(query);

  return {
    invites,
    count: invites.length,
    total: totalInvites,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get a single invite by ID
 * @param {string} inviteId - ID of the invite
 * @returns {Promise<object>} Invite document with populated fields
 */
const getInviteById = async (inviteId) => {
  const invite = await Invite.findById(inviteId)
    .populate('generatedBy', 'firstName lastName email')
    .populate('acceptedBy', 'firstName lastName email')
    .populate('property', 'name')
    .populate('unit', 'unitName');
    
  if (!invite) {
    throw new Error('Invite not found');
  }
  
  return invite;
};

/**
 * Create a new invite
 * @param {object} inviteData - Invite data
 * @param {string} generatorId - ID of the user creating the invite
 * @returns {Promise<object>} Created invite document and invite link
 */
const createInvite = async (inviteData, generatorId) => {
  const { email, role, propertyId, unitId } = inviteData;

  if (!email || !role || !Object.values(PROPERTY_USER_ROLES_ENUM).includes(role)) {
    throw new Error('Email and a valid role are required');
  }

  if (['tenant', 'landlord', 'propertymanager', 'vendor_access'].includes(role) && !propertyId) {
    throw new Error(`Property ID is required for ${role} role invites`);
  }

  if (role === 'tenant' && !unitId) {
    throw new Error('Unit ID is required for tenant role invites');
  }

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new Error(`A user with email ${email} already exists`);
  }

  // Check for existing active invite
  const existingInvite = await Invite.findOne({
    email,
    role,
    property: propertyId,
    unit: unitId || null,
    status: 'pending',
    expiresAt: { $gt: Date.now() }
  });

  if (existingInvite) {
    throw new Error('An active invitation for this email, role, property, and unit already exists');
  }

  // Generate token and create invite
  const token = crypto.randomBytes(20).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const newInvite = await Invite.create({
    email,
    role,
    property: propertyId,
    unit: unitId || null,
    token: token,
    generatedBy: generatorId,
    expiresAt,
    status: 'pending'
  });

  // Construct invitation link
  const inviteLink = `${process.env.FRONTEND_URL}/accept-invite/${token}`;

  // Get property name for email if applicable
  let propertyName = 'the system';
  if (propertyId) {
    const property = await Property.findById(propertyId).select('name');
    if (property) {
      propertyName = property.name;
    }
  }

  // Send invitation email
  const generator = await User.findById(generatorId).select('firstName');
  await emailService.sendInvitationEmail({
    to: email,
    inviteLink,
    role,
    invitedByUserName: generator ? generator.firstName : 'An administrator',
    propertyDisplayName: propertyName
  });

  return {
    invite: newInvite,
    inviteLink
  };
};

/**
 * Resend an existing invite
 * @param {string} inviteId - ID of the invite to resend
 * @param {string} resenderId - ID of the user resending the invite
 * @returns {Promise<object>} Updated invite document and invite link
 */
const resendInvite = async (inviteId, resenderId) => {
  const invite = await Invite.findById(inviteId);
  if (!invite) {
    throw new Error('Invite not found');
  }
  if (invite.status !== 'pending' && invite.status !== 'expired') {
    throw new Error(`Invite status is ${invite.status}. Only 'pending' or 'expired' invites can be resent`);
  }

  // Generate a new token and update expiry
  invite.token = crypto.randomBytes(20).toString('hex');
  invite.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  invite.status = 'pending';
  await invite.save();

  const inviteLink = `${process.env.FRONTEND_URL}/accept-invite/${invite.token}`;

  // Get property name for email if applicable
  let propertyName = 'the system';
  if (invite.property) {
    const property = await Property.findById(invite.property).select('name');
    if (property) {
      propertyName = property.name;
    }
  }

  // Send invitation email
  const resender = await User.findById(resenderId).select('firstName');
  await emailService.sendInvitationEmail({
    to: invite.email,
    inviteLink,
    role: invite.role,
    invitedByUserName: resender ? resender.firstName : 'An administrator',
    propertyDisplayName: propertyName
  });

  return {
    invite,
    inviteLink
  };
};

/**
 * Revoke an invite
 * @param {string} inviteId - ID of the invite to revoke
 * @param {string} revokerId - ID of the user revoking the invite
 * @returns {Promise<object>} Updated invite document
 */
const revokeInvite = async (inviteId, revokerId) => {
  const invite = await Invite.findById(inviteId);
  if (!invite) {
    throw new Error('Invite not found');
  }
  if (invite.status === 'revoked' || invite.status === 'accepted') {
    throw new Error(`Invite is already ${invite.status}`);
  }

  invite.status = 'revoked';
  invite.revokedBy = revokerId;
  invite.revokedAt = new Date();
  await invite.save();
  
  return invite;
};

/**
 * Get all audit logs with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated audit log results
 */
const getAuditLogs = async (filters, page = 1, limit = 20) => {
  const { userId, action, resourceType, status, search } = filters;
  const query = {};

  if (userId) query.user = userId;
  if (action) query.action = action;
  if (resourceType) query.resourceType = resourceType;
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { description: { $regex: search, $options: 'i' } },
      { errorMessage: { $regex: search, $options: 'i' } },
      { ipAddress: { $regex: search, $options: 'i' } },
      { userAgent: { $regex: search, $options: 'i' } }
    ];
  }

  const auditLogs = await AuditLog.find(query)
    .populate('user', 'firstName lastName email')
    .populate('resourceId')
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .sort({ createdAt: -1 });

  const totalLogs = await AuditLog.countDocuments(query);

  return {
    auditLogs,
    count: auditLogs.length,
    total: totalLogs,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get system health status
 * @returns {Promise<object>} System health data
 */
const getSystemHealth = async () => {
  const health = {
    database: {
      status: 'checking',
      message: ''
    },
    emailService: {
      status: 'checking',
      message: ''
    },
    cloudStorageService: {
      status: 'checking',
      message: ''
    },
    envVariables: {
      status: 'checking',
      message: ''
    }
  };

  // Database Check
  try {
    await mongoose.connection.db.admin().ping();
    health.database.status = 'healthy';
    health.database.message = 'Database connection successful.';
  } catch (dbErr) {
    health.database.status = 'unhealthy';
    health.database.message = `Database connection failed: ${dbErr.message}`;
    logger.error('Database health check failed:', dbErr);
  }

  // Email Service Check
  try {
    if (process.env.GMAIL_USER && process.env.OAUTH_CLIENT_ID) {
      health.emailService.status = 'healthy';
      health.emailService.message = 'Email service environment variables configured.';
    } else {
      health.emailService.status = 'unhealthy';
      health.emailService.message = 'Missing Gmail OAuth2 environment variables.';
    }
  } catch (emailErr) {
    health.emailService.status = 'unhealthy';
    health.emailService.message = `Email service check failed: ${emailErr.message}`;
    logger.error('Email service health check failed:', emailErr);
  }

  // Cloud Storage Service Check
  try {
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      health.cloudStorageService.status = 'healthy';
      health.cloudStorageService.message = 'Cloudinary environment variables configured.';
    } else {
      health.cloudStorageService.status = 'unhealthy';
      health.cloudStorageService.message = 'Missing Cloudinary environment variables.';
    }
  } catch (storageErr) {
    health.cloudStorageService.status = 'unhealthy';
    health.cloudStorageService.message = `Cloud storage service check failed: ${storageErr.message}`;
    logger.error('Cloud storage service health check failed:', storageErr);
  }

  // Environment Variables Check
  const requiredEnvVars = [
    'PORT', 'NODE_ENV', 'MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET',
    'GMAIL_USER', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'OAUTH_REFRESH_TOKEN',
    'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
    'FRONTEND_URL'
  ];
  const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missingEnvVars.length > 0) {
    health.envVariables.status = 'unhealthy';
    health.envVariables.message = `Missing environment variables: ${missingEnvVars.join(', ')}`;
  } else {
    health.envVariables.status = 'healthy';
    health.envVariables.message = 'All critical environment variables are present.';
  }

  return health;
};

/**
 * Send a system-wide broadcast notification
 * @param {object} notificationData - Notification data
 * @param {string} senderId - ID of the user sending the notification
 * @returns {Promise<object>} Result with count of recipients
 */
const sendBroadcastNotification = async (notificationData, senderId) => {
  const { message, link, type = 'general_alert', emailSubject, emailHtml } = notificationData;

  if (!message) {
    throw new Error('Broadcast message is required');
  }

  const allActiveUsers = await User.find({ isActive: true }).select('_id firstName email preferences');
  const notificationResults = [];

  // Send notification to each user
  for (const user of allActiveUsers) {
    try {
      await notificationService.sendNotification({
        recipientId: user._id,
        type,
        message,
        link,
        relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.System,
        relatedResourceId: senderId,
        emailDetails: {
          subject: emailSubject || `System Broadcast: ${message.substring(0, 50)}...`,
          html: emailHtml || `<p>Dear ${user.firstName},</p><p>${message}</p>${link ? `<p>Click <a href="${process.env.FRONTEND_URL}${link}">here</a> for more details.</p>` : ''}<p>Thank you,</p><p>The Property Management Team</p>`
        }
      });
      
      notificationResults.push({
        userId: user._id,
        email: user.email,
        status: 'success'
      });
    } catch (error) {
      logger.error(`Failed to send broadcast notification to user ${user.email}:`, error);
      notificationResults.push({
        userId: user._id,
        email: user.email,
        status: 'failed',
        error: error.message
      });
    }
  }

  return {
    totalUsers: allActiveUsers.length,
    successCount: notificationResults.filter(r => r.status === 'success').length,
    failedCount: notificationResults.filter(r => r.status === 'failed').length,
    details: notificationResults
  };
};

/**
 * Get all media files with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated media results
 */
const getAllMedia = async (filters, page = 1, limit = 10) => {
  const { relatedTo, relatedId, uploadedBy, mimeType, search } = filters;
  const query = {};

  if (relatedTo) query.relatedTo = relatedTo;
  if (relatedId) query.relatedId = relatedId;
  if (uploadedBy) query.uploadedBy = uploadedBy;
  if (mimeType) query.mimeType = { $regex: mimeType, $options: 'i' };
  if (search) {
    query.$or = [
      { filename: { $regex: search, $options: 'i' } },
      { originalname: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { tags: { $regex: search, $options: 'i' } }
    ];
  }

  const mediaFiles = await Media.find(query)
    .populate('uploadedBy', 'firstName lastName email')
    .populate('relatedId')
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .sort({ createdAt: -1 });

  const totalMedia = await Media.countDocuments(query);

  return {
    mediaFiles,
    count: mediaFiles.length,
    total: totalMedia,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get media storage statistics
 * @returns {Promise<object>} Media storage stats
 */
const getMediaStorageStats = async () => {
  const result = await Media.aggregate([
    {
      $group: {
        _id: null,
        totalFiles: { $sum: 1 },
        totalSizeInBytes: { $sum: '$size' }
      }
    }
  ]);

  const stats = {
    totalFiles: 0,
    totalSizeInBytes: 0,
    totalSizeMB: 0,
    notes: ""
  };

  if (result.length > 0) {
    stats.totalFiles = result[0].totalFiles;
    if (result[0].totalSizeInBytes) {
      stats.totalSizeInBytes = result[0].totalSizeInBytes;
      stats.totalSizeMB = (result[0].totalSizeInBytes / (1024 * 1024)).toFixed(2);
    } else {
      stats.notes = "Size calculation requires 'size' field in media documents.";
    }
  } else {
    stats.notes = "No media files found or 'size' field missing for calculation.";
  }

  return stats;
};

/**
 * Delete a media file
 * @param {string} mediaId - ID of the media to delete
 * @returns {Promise<void>}
 */
const deleteMedia = async (mediaId) => {
  const mediaDoc = await Media.findById(mediaId);
  if (!mediaDoc) {
    throw new Error('Media file not found');
  }

  // Get public ID for cloud storage deletion
  const publicId = mediaDoc.public_id || mediaDoc.filename;
  const resourceType = mediaDoc.resource_type || 
    (mediaDoc.mimeType.startsWith('image/') ? 'image' : 
    mediaDoc.mimeType.startsWith('video/') ? 'video' : 'raw');

  // Delete from cloud storage
  await deleteFile(publicId, resourceType);

  // Delete from database
  await mediaDoc.deleteOne();
};

/**
 * Get all leases with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated lease results
 */
const getAllLeases = async (filters, page = 1, limit = 10) => {
  const { status, propertyId, tenantId, search } = filters;
  const query = {};

  if (status) query.status = status;
  if (propertyId) query.property = propertyId;
  if (tenantId) query.tenant = tenantId;
  if (search) {
    query.$or = [
      { terms: { $regex: search, $options: 'i' } }
    ];
  }

  const leases = await Lease.find(query)
    .populate('property', 'name address')
    .populate('unit', 'unitName')
    .populate('tenant', 'firstName lastName email')
    .populate('landlord', 'firstName lastName email')
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .sort({ leaseStartDate: -1 });

  const totalLeases = await Lease.countDocuments(query);

  return {
    leases,
    count: leases.length,
    total: totalLeases,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get a single lease by ID
 * @param {string} leaseId - ID of the lease
 * @returns {Promise<object>} Lease document with populated fields
 */
const getLeaseById = async (leaseId) => {
  const lease = await Lease.findById(leaseId)
    .populate('property', 'name address')
    .populate('unit', 'unitName')
    .populate('tenant', 'firstName lastName email')
    .populate('landlord', 'firstName lastName email')
    .populate('documents', 'url filename mimeType');
    
  if (!lease) {
    throw new Error('Lease not found');
  }
  
  return lease;
};

/**
 * Create a new lease
 * @param {object} leaseData - Lease data
 * @returns {Promise<object>} Created lease document
 */
const createLease = async (leaseData) => {
  const { property, unit, tenant, landlord, leaseStartDate, leaseEndDate, monthlyRent, currency, paymentDueDate, securityDeposit, terms } = leaseData;

  // Validate references
  const propertyExists = await Property.findById(property);
  if (!propertyExists) throw new Error('Property not found');
  
  const unitExists = await Unit.findById(unit);
  if (!unitExists) throw new Error('Unit not found');
  
  const tenantExists = await User.findById(tenant);
  if (!tenantExists) throw new Error('Tenant user not found');
  
  const landlordExists = await User.findById(landlord);
  if (!landlordExists) throw new Error('Landlord user not found');

  // Create the lease
  const newLease = await Lease.create({
    property, 
    unit, 
    tenant, 
    landlord, 
    leaseStartDate, 
    leaseEndDate, 
    monthlyRent, 
    currency, 
    paymentDueDate, 
    securityDeposit, 
    terms
  });

  // Update unit status
  if (unitExists.status !== 'occupied' && unitExists.status !== 'leased') {
    unitExists.status = 'occupied';
    await unitExists.save();
  }

  // Create or update PropertyUser association
  let propertyUser = await PropertyUser.findOne({ 
    user: tenant, 
    property: property, 
    unit: unit 
  });
  
  if (propertyUser) {
    if (!propertyUser.roles.includes('tenant')) {
      propertyUser.roles.push('tenant');
      await propertyUser.save();
    }
  } else {
    propertyUser = await PropertyUser.create({
      user: tenant,
      property: property,
      unit: unit,
      roles: ['tenant'],
      invitedBy: landlord // Use landlord as inviter by default
    });
  }

  return newLease;
};

/**
 * Update an existing lease
 * @param {string} leaseId - ID of the lease to update
 * @param {object} updateData - Data to update
 * @returns {Promise<object>} Updated lease document
 */
const updateLease = async (leaseId, updateData) => {
  const lease = await Lease.findById(leaseId);
  if (!lease) {
    throw new Error('Lease not found');
  }

  Object.assign(lease, updateData);
  await lease.save({ validateBeforeSave: true });
  
  return lease;
};

/**
 * Terminate a lease
 * @param {string} leaseId - ID of the lease to terminate
 * @returns {Promise<object>} Updated lease document
 */
const terminateLease = async (leaseId) => {
  const lease = await Lease.findById(leaseId);
  if (!lease) {
    throw new Error('Lease not found');
  }

  if (lease.status === 'terminated') {
    throw new Error('Lease is already terminated');
  }

  lease.status = 'terminated';
  lease.leaseEndDate = new Date();
  await lease.save();

  // Update unit status
  const unit = await Unit.findById(lease.unit);
  if (unit && unit.status !== 'vacant') {
    unit.status = 'vacant';
    await unit.save();
  }

  // Update PropertyUser association
  const propertyUser = await PropertyUser.findOne({ 
    user: lease.tenant, 
    property: lease.property, 
    unit: lease.unit 
  });
  
  if (propertyUser) {
    if (propertyUser.roles.includes('tenant')) {
      propertyUser.roles = propertyUser.roles.filter(role => role !== 'tenant');
      if (propertyUser.roles.length === 0) {
        propertyUser.isActive = false;
      }
      await propertyUser.save();
    }
  }

  // Send notification to tenant
  const tenant = await User.findById(lease.tenant);
  if (tenant) {
    await notificationService.sendNotification({
      recipientId: lease.tenant,
      type: 'lease_termination',
      message: `Your lease for unit ${unit?.unitName || 'N/A'} at property ${lease.property.name || 'N/A'} has been terminated.`,
      link: `/leases/${lease._id}`,
      relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
      relatedResourceId: lease._id,
      emailDetails: {
        subject: `Lease Termination Notification: ${lease.property.name}`,
        html: `<p>Dear ${tenant.firstName || 'Tenant'},</p><p>This is to inform you that your lease for unit <strong>${unit?.unitName || 'N/A'}</strong> at property <strong>${lease.property.name || 'N/A'}</strong> has been terminated.</p><p>For details, please contact your property manager.</p><p>Thank you,</p><p>The Property Management Team</p>`
      }
    });
  }
  
  return lease;
};


// src/services/adminService.js (continuation)

/**
 * Get all rent records with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated rent results
 */
const getAllRents = async (filters, page = 1, limit = 10) => {
  const { status, tenantId, propertyId, unitId, dueDateBefore, dueDateAfter } = filters;
  const query = {};

  if (status) query.status = status;
  if (tenantId) query.tenant = tenantId;
  if (propertyId) query.property = propertyId;
  if (unitId) query.unit = unitId;
  if (dueDateBefore) query.dueDate = { ...query.dueDate, $lte: new Date(dueDateBefore) };
  if (dueDateAfter) query.dueDate = { ...query.dueDate, $gte: new Date(dueDateAfter) };

  const rents = await Rent.find(query)
    .populate('lease', 'monthlyRent leaseStartDate leaseEndDate')
    .populate('tenant', 'firstName lastName email')
    .populate('property', 'name')
    .populate('unit', 'unitName')
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .sort({ dueDate: -1 });

  const totalRents = await Rent.countDocuments(query);

  return {
    rents,
    count: rents.length,
    total: totalRents,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get a single rent record by ID
 * @param {string} rentId - ID of the rent record
 * @returns {Promise<object>} Rent document with populated fields
 */
const getRentById = async (rentId) => {
  const rent = await Rent.findById(rentId)
    .populate('lease', 'monthlyRent leaseStartDate leaseEndDate')
    .populate('tenant', 'firstName lastName email')
    .populate('property', 'name')
    .populate('unit', 'unitName')
    .populate('paymentProof', 'url filename');
    
  if (!rent) {
    throw new Error('Rent record not found');
  }
  
  return rent;
};

/**
 * Record a new rent payment
 * @param {object} rentData - Rent payment data
 * @returns {Promise<object>} Created rent document
 */
const recordRentPayment = async (rentData) => {
  const { lease, tenant, property, unit, billingPeriod, amountDue, dueDate, amountPaid, paymentDate, status, paymentMethod, transactionId, paymentProofId, notes } = rentData;

  // Basic validation for required fields
  if (!lease || !tenant || !property || !unit || !billingPeriod || !amountDue || !dueDate) {
    throw new Error('Missing required fields for rent payment');
  }

  const newRent = await Rent.create({
    lease, 
    tenant, 
    property, 
    unit, 
    billingPeriod, 
    amountDue, 
    dueDate,
    amountPaid: amountPaid || 0,
    paymentDate: paymentDate || null,
    status: status || 'due',
    paymentMethod, 
    transactionId, 
    paymentProof: paymentProofId || null, 
    notes
  });

  return newRent;
};

/**
 * Update an existing rent payment record
 * @param {string} rentId - ID of the rent to update
 * @param {object} updateData - Data to update
 * @returns {Promise<object>} Updated rent document
 */
const updateRentPayment = async (rentId, updateData) => {
  const rent = await Rent.findById(rentId);
  if (!rent) {
    throw new Error('Rent record not found');
  }

  // Specific logic for updating payment status based on amount
  if (updateData.amountPaid !== undefined) {
    rent.amountPaid = updateData.amountPaid;
    
    if (rent.amountPaid >= rent.amountDue) {
      rent.status = 'paid';
    } else if (rent.amountPaid > 0 && rent.amountPaid < rent.amountDue) {
      rent.status = 'partially_paid';
    } else if (rent.amountPaid === 0 && new Date() > rent.dueDate) {
      rent.status = 'overdue';
    } else {
      rent.status = 'due';
    }
  }
  
  // Override status if explicitly provided
  if (updateData.status && Object.values(PAYMENT_STATUS_ENUM).includes(updateData.status)) {
    rent.status = updateData.status;
  }

  // Apply other updates
  Object.assign(rent, updateData);
  await rent.save({ validateBeforeSave: true });
  
  return rent;
};

/**
 * Get all scheduled maintenances with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated scheduled maintenance results
 */
const getAllScheduledMaintenances = async (filters, page = 1, limit = 10) => {
  const { status, category, propertyId, unitId, recurring, search } = filters;
  const query = {};

  if (status) query.status = status;
  if (category) query.category = category;
  if (propertyId) query.property = propertyId;
  if (unitId) query.unit = unitId;
  if (typeof recurring === 'boolean') query.recurring = recurring;
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  const scheduledMaintenances = await ScheduledMaintenance.find(query)
    .populate('property', 'name address')
    .populate('unit', 'unitName')
    .populate('createdByPropertyUser', {
      path: 'user',
      select: 'firstName lastName email'
    })
    .populate({
      path: 'assignedTo',
      refPath: 'assignedToModel',
      select: 'firstName lastName email name'
    })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .sort({ scheduledDate: -1 });

  const totalScheduledMaintenances = await ScheduledMaintenance.countDocuments(query);

  return {
    scheduledMaintenances,
    count: scheduledMaintenances.length,
    total: totalScheduledMaintenances,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get a single scheduled maintenance by ID
 * @param {string} maintenanceId - ID of the scheduled maintenance
 * @returns {Promise<object>} Scheduled maintenance document with populated fields
 */
const getScheduledMaintenanceById = async (maintenanceId) => {
  const scheduledMaintenance = await ScheduledMaintenance.findById(maintenanceId)
    .populate('property', 'name address')
    .populate('unit', 'unitName')
    .populate('createdByPropertyUser', {
      path: 'user',
      select: 'firstName lastName email'
    })
    .populate({
      path: 'assignedTo',
      refPath: 'assignedToModel',
      select: 'firstName lastName email name'
    })
    .populate('media', 'url filename mimeType');
    
  if (!scheduledMaintenance) {
    throw new Error('Scheduled maintenance not found');
  }
  
  return scheduledMaintenance;
};

/**
 * Create a new scheduled maintenance
 * @param {object} maintenanceData - Scheduled maintenance data
 * @param {string} creatorId - ID of the user creating the maintenance
 * @returns {Promise<object>} Created scheduled maintenance document
 */
const createScheduledMaintenance = async (maintenanceData, creatorId) => {
  const { title, description, category, property, unit, scheduledDate, recurring, frequency, assignedTo, assignedToModel, mediaIds } = maintenanceData;

  // Validate references
  const propertyExists = await Property.findById(property);
  if (!propertyExists) throw new Error('Property not found');
  
  if (unit) {
    const unitExists = await Unit.findById(unit);
    if (!unitExists) throw new Error('Unit not found');
  }

  // Find or create PropertyUser for creator
  let createdByPropertyUser = await PropertyUser.findOne({
    user: creatorId,
    property: property,
    isActive: true
  });
  
  if (!createdByPropertyUser) {
    createdByPropertyUser = await PropertyUser.create({
      user: creatorId,
      property: property,
      unit: unit || null,
      roles: ['admin_access'],
      isActive: true
    });
  }

  const newScheduledMaintenance = await ScheduledMaintenance.create({
    title, 
    description, 
    category, 
    property, 
    unit: unit || null, 
    scheduledDate, 
    recurring: !!recurring,
    frequency: recurring ? frequency : {},
    assignedTo: assignedTo || null,
    assignedToModel: assignedToModel || null,
    createdByPropertyUser: createdByPropertyUser._id,
    media: mediaIds || [],
    status: 'scheduled',
    nextDueDate: scheduledDate,
    nextExecutionAttempt: scheduledDate
  });

  return newScheduledMaintenance;
};

/**
 * Update an existing scheduled maintenance
 * @param {string} maintenanceId - ID of the scheduled maintenance to update
 * @param {object} updateData - Data to update
 * @returns {Promise<object>} Updated scheduled maintenance document
 */
const updateScheduledMaintenance = async (maintenanceId, updateData) => {
  const scheduledMaintenance = await ScheduledMaintenance.findById(maintenanceId);
  if (!scheduledMaintenance) {
    throw new Error('Scheduled maintenance not found');
  }

  // Handle status change special case to add to history
  if (updateData.status && updateData.status !== scheduledMaintenance.status) {
    scheduledMaintenance.statusHistory.push({
      status: updateData.status,
      changedAt: new Date(),
      notes: updateData.statusNotes || `Status changed from ${scheduledMaintenance.status} to ${updateData.status}`
    });
  }

  Object.assign(scheduledMaintenance, updateData);
  
  // Update nextDueDate if date or frequency changed
  if ((updateData.scheduledDate || updateData.frequency) && scheduledMaintenance.recurring) {
    scheduledMaintenance.nextDueDate = scheduledMaintenance.calculateNextDueDate();
    scheduledMaintenance.nextExecutionAttempt = scheduledMaintenance.nextDueDate;
  }

  await scheduledMaintenance.save({ validateBeforeSave: true });
  
  return scheduledMaintenance;
};

/**
 * Pause a scheduled maintenance
 * @param {string} maintenanceId - ID of the scheduled maintenance to pause
 * @returns {Promise<object>} Updated scheduled maintenance document
 */
const pauseScheduledMaintenance = async (maintenanceId) => {
  const scheduledMaintenance = await ScheduledMaintenance.findById(maintenanceId);
  if (!scheduledMaintenance) {
    throw new Error('Scheduled maintenance not found');
  }
  
  if (scheduledMaintenance.status === 'paused') {
    throw new Error('Scheduled maintenance is already paused');
  }

  scheduledMaintenance.status = 'paused';
  scheduledMaintenance.statusHistory.push({
    status: 'paused',
    changedAt: new Date(),
    notes: 'Maintenance task paused by admin'
  });
  
  await scheduledMaintenance.save();
  
  return scheduledMaintenance;
};

/**
 * Resume a scheduled maintenance
 * @param {string} maintenanceId - ID of the scheduled maintenance to resume
 * @returns {Promise<object>} Updated scheduled maintenance document
 */
const resumeScheduledMaintenance = async (maintenanceId) => {
  const scheduledMaintenance = await ScheduledMaintenance.findById(maintenanceId);
  if (!scheduledMaintenance) {
    throw new Error('Scheduled maintenance not found');
  }
  
  if (scheduledMaintenance.status === 'scheduled') {
    throw new Error('Scheduled maintenance is already active');
  }

  scheduledMaintenance.status = 'scheduled';
  scheduledMaintenance.statusHistory.push({
    status: 'scheduled',
    changedAt: new Date(),
    notes: 'Maintenance task resumed by admin'
  });
  
  await scheduledMaintenance.save();
  
  return scheduledMaintenance;
};

/**
 * Get all property user associations with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated property user association results
 */
const getAllPropertyUsers = async (filters, page = 1, limit = 10) => {
  const { userId, propertyId, unitId, role, isActive, search } = filters;
  const query = {};

  if (userId) query.user = userId;
  if (propertyId) query.property = propertyId;
  if (unitId) query.unit = unitId;
  if (role) query.roles = role; // Match if role is in array
  if (typeof isActive === 'boolean') query.isActive = isActive;
  
  if (search) {
    // This requires a more complex approach since we need to search across related collections
    const users = await User.find({
      $or: [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    }).select('_id');
    
    const properties = await Property.find({ 
      name: { $regex: search, $options: 'i' } 
    }).select('_id');
    
    query.$or = [
      { user: { $in: users.map(u => u._id) } },
      { property: { $in: properties.map(p => p._id) } }
    ];
    
    // Add direct ID search if the search term looks like a valid MongoDB ID
    if (mongoose.Types.ObjectId.isValid(search)) {
      query.$or.push({ _id: search });
    }
  }

  const propertyUsers = await PropertyUser.find(query)
    .populate('user', 'firstName lastName email role')
    .populate('property', 'name address')
    .populate('unit', 'unitName')
    .populate('invitedBy', 'firstName lastName email')
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .sort({ createdAt: -1 });

  const totalPropertyUsers = await PropertyUser.countDocuments(query);

  return {
    propertyUsers,
    count: propertyUsers.length,
    total: totalPropertyUsers,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Get a single property user association by ID
 * @param {string} propertyUserId - ID of the property user association
 * @returns {Promise<object>} Property user association document with populated fields
 */
const getPropertyUserById = async (propertyUserId) => {
  const propertyUser = await PropertyUser.findById(propertyUserId)
    .populate('user', 'firstName lastName email role')
    .populate('property', 'name address')
    .populate('unit', 'unitName')
    .populate('invitedBy', 'firstName lastName email');
    
  if (!propertyUser) {
    throw new Error('Property user association not found');
  }
  
  return propertyUser;
};

/**
 * Create a new property user association
 * @param {object} associationData - Property user association data
 * @param {string} creatorId - ID of the user creating the association
 * @returns {Promise<object>} Created property user association document
 */
const createPropertyUser = async (associationData, creatorId) => {
  const { user: userId, property: propertyId, unit: unitId, roles } = associationData;

  if (!userId || !propertyId || !Array.isArray(roles) || roles.length === 0) {
    throw new Error('User ID, Property ID, and at least one role are required');
  }

  // Validate references
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  
  const property = await Property.findById(propertyId);
  if (!property) throw new Error('Property not found');
  
  if (unitId) {
    const unit = await Unit.findById(unitId);
    if (!unit) throw new Error('Unit not found');
    
    if (unit.property.toString() !== propertyId) {
      throw new Error('Unit does not belong to the specified property');
    }
  }

  // Validate roles
  const invalidRoles = roles.filter(role => !Object.values(PROPERTY_USER_ROLES_ENUM).includes(role));
  if (invalidRoles.length > 0) {
    throw new Error(`Invalid roles provided: ${invalidRoles.join(', ')}`);
  }

  // Check for existing association
  let existingAssociation = await PropertyUser.findOne({ 
    user: userId, 
    property: propertyId, 
    unit: unitId || null 
  });
  
  if (existingAssociation) {
    // Update existing association
    const mergedRoles = [...new Set([...existingAssociation.roles, ...roles])];
    existingAssociation.roles = mergedRoles;
    existingAssociation.isActive = true;
    await existingAssociation.save();
    return existingAssociation;
  }

  // Create new association
  const newAssociation = await PropertyUser.create({
    user: userId,
    property: propertyId,
    unit: unitId || null,
    roles,
    invitedBy: creatorId,
    isActive: true
  });

  return newAssociation;
};

/**
 * Update an existing property user association
 * @param {string} propertyUserId - ID of the property user association to update
 * @param {object} updateData - Data to update
 * @returns {Promise<object>} Updated property user association document
 */
const updatePropertyUser = async (propertyUserId, updateData) => {
  const { roles, isActive, startDate, endDate, permissions, unit } = updateData;
  
  const propertyUser = await PropertyUser.findById(propertyUserId);
  if (!propertyUser) {
    throw new Error('Property user association not found');
  }

  if (roles) {
    if (!Array.isArray(roles) || roles.length === 0) {
      throw new Error('Roles must be a non-empty array');
    }
    
    const invalidRoles = roles.filter(role => !Object.values(PROPERTY_USER_ROLES_ENUM).includes(role));
    if (invalidRoles.length > 0) {
      throw new Error(`Invalid roles provided: ${invalidRoles.join(', ')}`);
    }
    
    propertyUser.roles = roles;
  }
  
  if (typeof isActive === 'boolean') propertyUser.isActive = isActive;
  if (startDate) propertyUser.startDate = startDate;
  if (endDate) propertyUser.endDate = endDate;
  if (permissions) propertyUser.permissions = permissions;
  
  if (unit) {
    // Validate unit belongs to the property
    const unitExists = await Unit.findOne({ 
      _id: unit, 
      property: propertyUser.property 
    });
    
    if (!unitExists) {
      throw new Error('Unit not found or does not belong to the associated property');
    }
    
    propertyUser.unit = unit;
  }

  await propertyUser.save({ validateBeforeSave: true });
  
  return propertyUser;
};

/**
 * Deactivate a property user association
 * @param {string} propertyUserId - ID of the property user association to deactivate
 * @returns {Promise<object>} Updated property user association document
 */
const deactivatePropertyUser = async (propertyUserId) => {
  const propertyUser = await PropertyUser.findById(propertyUserId);
  if (!propertyUser) {
    throw new Error('Property user association not found');
  }
  
  if (!propertyUser.isActive) {
    throw new Error('Property user association is already inactive');
  }

  propertyUser.isActive = false;
  await propertyUser.save();
  
  return propertyUser;
};

/**
 * Get all comments with filtering and pagination
 * @param {object} filters - Filter criteria
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {Promise<object>} Paginated comment results
 */
const getAllComments = async (filters, page = 1, limit = 10) => {
  const { contextType, contextId, senderId, isInternalNote, search } = filters;
  const query = {};

  if (contextType) query.contextType = contextType;
  if (contextId) query.contextId = contextId;
  if (senderId) query.sender = senderId;
  if (typeof isInternalNote === 'boolean') query.isInternalNote = isInternalNote;
  
  if (search) {
    query.$or = [
      { message: { $regex: search, $options: 'i' } },
      { externalUserName: { $regex: search, $options: 'i' } },
      { externalUserEmail: { $regex: search, $options: 'i' } }
    ];
  }

  const comments = await Comment.find(query)
    .populate('sender', 'firstName lastName email')
    .populate('contextId')
    .populate('media', 'url filename mimeType')
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .sort({ createdAt: -1 });

  const totalComments = await Comment.countDocuments(query);

  return {
    comments,
    count: comments.length,
    total: totalComments,
    page: parseInt(page),
    limit: parseInt(limit)
  };
};

/**
 * Delete a comment
 * @param {string} commentId - ID of the comment to delete
 * @returns {Promise<void>}
 */
const deleteComment = async (commentId) => {
  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  // Delete any media associated with the comment
  if (comment.media && comment.media.length > 0) {
    for (const mediaId of comment.media) {
      const mediaDoc = await Media.findById(mediaId);
      if (mediaDoc) {
        const publicId = mediaDoc.public_id || mediaDoc.filename;
        const resourceType = mediaDoc.resource_type || 
          (mediaDoc.mimeType.startsWith('image/') ? 'image' : 
          mediaDoc.mimeType.startsWith('video/') ? 'video' : 'raw');
          
        await deleteFile(publicId, resourceType).catch(err => 
          logger.error(`Failed to delete media file ${publicId}:`, err)
        );
        
        await mediaDoc.deleteOne();
      }
    }
  }

  // Remove reference from parent context
  if (comment.contextType === 'Request') {
    await Request.updateOne(
      { _id: comment.contextId }, 
      { $pull: { comments: comment._id } }
    );
  } else if (comment.contextType === 'ScheduledMaintenance') {
    await ScheduledMaintenance.updateOne(
      { _id: comment.contextId }, 
      { $pull: { comments: comment._id } }
    );
  }

  // Delete the comment
  await comment.deleteOne();
};

/**
 * Get currently active users (those who have logged in recently)
 * @param {number} minutesThreshold - Number of minutes to consider "active"
 * @returns {Promise<object>} Active users information
 */
const getCurrentlyActiveUsers = async (minutesThreshold = 15) => {
  const thresholdTime = new Date(Date.now() - minutesThreshold * 60 * 1000);
  
  const users = await User.find({ 
    lastLogin: { $gte: thresholdTime } 
  })
  .select('firstName lastName email role lastLogin')
  .sort({ lastLogin: -1 });
  
  return {
    count: users.length,
    users
  };
};

module.exports = {
  getDashboardStats,
  getAdminUser,
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deactivateUser,
  activateUser,
  approveUser,
  resetUserPassword,
  getAllProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deactivateProperty,
  getAllUnits,
  getUnitById,
  createUnit,
  updateUnit,
  deactivateUnit,
  getAllRequests,
  getRequestAnalytics,
  getRequestById,
  updateRequestStatus,
  assignRequest,
  addCommentToRequest,
  getAllVendors,
  getVendorById,
  createVendor,
  updateVendor,
  deactivateVendor,
  getAllInvites,
  getInviteById,
  createInvite,
  resendInvite,
  revokeInvite,
  getAuditLogs,
  getSystemHealth,
  sendBroadcastNotification,
  getAllMedia,
  getMediaStorageStats,
  deleteMedia,
  getAllLeases,
  getLeaseById,
  createLease,
  updateLease,
  terminateLease,
  getAllRents,
  getRentById,
  recordRentPayment,
  updateRentPayment,
  getAllScheduledMaintenances,
  getScheduledMaintenanceById,
  createScheduledMaintenance,
  updateScheduledMaintenance,
  pauseScheduledMaintenance,
  resumeScheduledMaintenance,
  getAllPropertyUsers,
  getPropertyUserById,
  createPropertyUser,
  updatePropertyUser,
  deactivatePropertyUser,
  getAllComments,
  deleteComment,
  getCurrentlyActiveUsers
};