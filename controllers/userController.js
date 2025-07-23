// src/controllers/userController.js
// STANDARDIZED USER CONTROLLER - Example Template for All Controllers

// Core dependencies
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// Service layer
const userService = require('../services/userService');

// =====================================================
// PROFILE MANAGEMENT FUNCTIONS
// =====================================================

/**
 * @desc Get authenticated user's own profile
 * @route GET /api/users/profile
 * @access Private
 */
const getUserProfile = asyncHandler(async (req, res) => {
    const userProfile = await userService.getUserProfile(req.user._id);
    
    res.status(200).json({
        success: true,
        data: userProfile
    });
});

/**
 * @desc Update authenticated user's own profile
 * @route PUT /api/users/profile
 * @access Private
 */
const updateUserProfile = asyncHandler(async (req, res) => {
    const { firstName, lastName, phone, avatar, preferences } = req.body;
    
    const updatedUser = await userService.updateUserProfile(
        req.user._id,
        { firstName, lastName, phone, avatar, preferences },
        req.ip
    );
    
    res.status(200).json({
        success: true,
        message: 'Profile updated successfully.',
        data: updatedUser
    });
});

// =====================================================
// USER MANAGEMENT FUNCTIONS
// =====================================================

/**
 * @desc Get all users with filtering and pagination
 * @route GET /api/users
 * @access Private (Admin, Landlord, Property Manager)
 */
const getAllUsers = asyncHandler(async (req, res) => {
    const { role, status, search, propertyId, unitId, page = 1, limit = 10 } = req.query;
    
    const result = await userService.getAllUsers(
        req.user,
        { role, status, search, propertyId, unitId },
        page,
        limit,
        req.ip
    );
    
    res.status(200).json({
        success: true,
        count: result.count,
        total: result.total,
        page: result.page,
        limit: result.limit,
        data: result.users
    });
});

/**
 * @desc Create a new user manually
 * @route POST /api/users
 * @access Private (Admin, Landlord, Property Manager)
 */
const createUser = asyncHandler(async (req, res) => {
    const { firstName, lastName, email, phone, role, propertyId, unitId } = req.body;
    
    const newUser = await userService.createUser(
        { firstName, lastName, email, phone, role, propertyId, unitId },
        req.user,
        req.ip
    );
    
    res.status(201).json({
        success: true,
        message: 'User created successfully. An email has been sent to set their password.',
        data: newUser
    });
});

/**
 * @desc Get user by ID
 * @route GET /api/users/:id
 * @access Private (Admin, Landlord, Property Manager with access control)
 */
const getUserById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const user = await userService.getUserById(id, req.user, req.ip);
    
    res.status(200).json({
        success: true,
        data: user
    });
});

/**
 * @desc Update user by ID
 * @route PUT /api/users/:id
 * @access Private (Admin for full update, Landlord/PM for limited fields)
 */
const updateUserById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, phone, avatar, preferences, role, status } = req.body;
    
    const updatedUser = await userService.updateUserById(
        id,
        { firstName, lastName, phone, avatar, preferences, role, status },
        req.user,
        req.ip
    );
    
    res.status(200).json({
        success: true,
        message: 'User updated successfully.',
        data: updatedUser
    });
});

/**
 * @desc Delete user by ID
 * @route DELETE /api/users/:id
 * @access Private (Admin only)
 */
const deleteUserById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    await userService.deleteUserById(id, req.user, req.ip);
    
    res.status(200).json({
        success: true,
        message: 'User and associated data deleted successfully.'
    });
});

// =====================================================
// USER ACTION FUNCTIONS
// =====================================================

/**
 * @desc Approve a pending user
 * @route PUT /api/users/:id/approve
 * @access Private (Admin, Landlord, Property Manager)
 */
const approveUser = asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const updatedUser = await userService.approveUser(id, req.user, req.ip);
    
    res.status(200).json({
        success: true,
        message: 'User approved successfully.',
        data: updatedUser
    });
});

/**
 * @desc Update a user's global role
 * @route PUT /api/users/:id/role
 * @access Private (Admin only)
 */
const updateUserRole = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    
    const updatedUser = await userService.updateUserRole(id, role, req.user, req.ip);
    
    res.status(200).json({
        success: true,
        message: `User role updated to ${updatedUser.role}.`,
        data: updatedUser
    });
});

// =====================================================
// EXPORT ALL FUNCTIONS
// =====================================================

module.exports = {
    getUserProfile,
    updateUserProfile,
    getAllUsers,
    createUser,
    getUserById,
    updateUserById,
    deleteUserById,
    approveUser,
    updateUserRole
};