// src/controllers/userController.js

const asyncHandler = require('../utils/asyncHandler');
const userService = require('../services/userService');
const logger = require('../utils/logger');

/**
 * @desc Get authenticated user's profile
 * @route GET /api/users/profile
 * @access Private
 */
const getUserProfile = asyncHandler(async (req, res) => {
    const userProfile = await userService.getUserProfile(req.user._id);
    
    res.status(200).json({
        success: true,
        user: userProfile
    });
});

/**
 * @desc Update authenticated user's profile
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
        user: updatedUser
    });
});

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
 * @desc Get user by ID
 * @route GET /api/users/:id
 * @access Private (Admin, Landlord, Property Manager with access control)
 */
const getUserById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const user = await userService.getUserById(id, req.user, req.ip);
    
    res.status(200).json({
        success: true,
        user
    });
});

/**
 * @desc Create a new user
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
        user: newUser
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
        user: updatedUser
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
        user: updatedUser
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
        user: updatedUser
    });
});

module.exports = {
    getUserProfile,
    updateUserProfile,
    getAllUsers,
    getUserById,
    createUser,
    updateUserById,
    deleteUserById,
    approveUser,
    updateUserRole
};