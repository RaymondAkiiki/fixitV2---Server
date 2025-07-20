const asyncHandler = require('../utils/asyncHandler');
const vendorService = require('../services/vendorService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * @desc    Create a new vendor
 * @route   POST /api/vendors
 * @access  Private (Admin, PropertyManager, Landlord)
 */
const createVendor = asyncHandler(async (req, res) => {
  const vendorData = req.body;
  const createdByUserId = req.user._id;
  const ipAddress = req.ip;

  const newVendor = await vendorService.createVendor(vendorData, createdByUserId, ipAddress);

  res.status(201).json({
    success: true,
    message: 'Vendor created successfully.',
    data: newVendor
  });
});

/**
 * @desc    Get all vendors with filtering, search, and pagination
 * @route   GET /api/vendors
 * @access  Private (Admin, PropertyManager, Landlord)
 */
const getAllVendors = asyncHandler(async (req, res) => {
  const user = req.user;
  const filters = {
    status: req.query.status,
    service: req.query.service,
    propertyId: req.query.propertyId,
    search: req.query.search
  };
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder || 'desc';
  const ipAddress = req.ip;

  const { vendors, total, page: currentPage, limit: currentLimit, totalPages } =
    await vendorService.getVendorsForUser(user, filters, page, limit, ipAddress, sortBy, sortOrder);

  res.status(200).json({
    success: true,
    count: vendors.length,
    total,
    page: currentPage,
    limit: currentLimit,
    totalPages,
    data: vendors
  });
});

/**
 * @desc    Get a specific vendor by ID
 * @route   GET /api/vendors/:id
 * @access  Private (Admin, PropertyManager, Landlord)
 */
const getVendorById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.user;
  const ipAddress = req.ip;

  const vendor = await vendorService.getVendorById(id, user, ipAddress);

  res.status(200).json({
    success: true,
    data: vendor
  });
});

/**
 * @desc    Update vendor details
 * @route   PUT /api/vendors/:id
 * @access  Private (Admin, PropertyManager, Landlord)
 */
const updateVendor = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  const updatedByUserId = req.user._id;
  const ipAddress = req.ip;

  const updatedVendor = await vendorService.updateVendor(id, updateData, updatedByUserId, ipAddress);

  res.status(200).json({
    success: true,
    message: 'Vendor updated successfully.',
    data: updatedVendor
  });
});

/**
 * @desc    Delete a vendor
 * @route   DELETE /api/vendors/:id
 * @access  Private (Admin only)
 */
const deleteVendor = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.user;
  const ipAddress = req.ip;

  await vendorService.deleteVendor(id, user, ipAddress);

  res.status(200).json({
    success: true,
    message: 'Vendor deleted successfully.'
  });
});

/**
 * @desc    Get vendor statistics
 * @route   GET /api/vendors/stats
 * @access  Private (Admin, PropertyManager, Landlord)
 */
const getVendorStats = asyncHandler(async (req, res) => {
  const user = req.user;
  
  const stats = await vendorService.getVendorStats(user);
  
  res.status(200).json({
    success: true,
    data: stats
  });
});

module.exports = {
  createVendor,
  getAllVendors,
  getVendorById,
  updateVendor,
  deleteVendor,
  getVendorStats
};