// backend/controllers/scheduledMaintenanceController.js

const asyncHandler = require('express-async-handler');
const { validationResult } = require('express-validator');
const ScheduledMaintenance = require("../models/scheduledMaintenance"); // Corrected import
const Property = require("../models/property"); // Corrected import
const Unit = require("../models/unit");       // Corrected import
const User = require("../models/user");       // Corrected import
const Vendor = require("../models/vendor");   // Corrected import
const PropertyUser = require("../models/propertyUser"); // New import
const AuditLog = require("../models/auditLog"); // New import
const { createNotification } = require('./notificationController'); // Internal notification helper
const Request = require('../models/request');

// Frontend URL for generating links
const FRONTEND_URL = process.env.VITE_FRONTEND_URL || 'http://localhost:5173';

// Helper for validation errors
const handleValidationErrors = (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }
    return null;
};

/**
 * @desc    Create a new scheduled maintenance task
 * @route   POST /api/scheduled-maintenance
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.createScheduledMaintenance = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return; // Assuming validation middleware in route
    const { title, description, category, property, unit, scheduledDate, recurring, frequency, assignedToId, assignedToModel } = req.body;
    let mediaUrls = [];

    if (req.files && req.files.length > 0) {
        mediaUrls = req.files.map(file => file.path);
    }

    if (!title || !description || !category || !property || !scheduledDate) {
        res.status(400);
        throw new Error('Title, description, category, property, and scheduled date are required.');
    }

    // Authorization: User can create if they are:
    // 1. Admin
    // 2. A Landlord/PM associated with the property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to create scheduled maintenance for this property.');
    }

    // Validate and format assignedTo
    let assigneeRef = null;
    let assigneeModelRef = null;
    if (assignedToId && assignedToModel) {
        if (!['User', 'Vendor'].includes(assignedToModel)) {
            res.status(400);
            throw new Error('Invalid assignedToModel type. Must be User or Vendor.');
        }
        let assigneeExists;
        if (assignedToModel === 'User') {
            assigneeExists = await User.findById(assignedToId);
        } else {
            assigneeExists = await Vendor.findById(assignedToId);
        }
        if (!assigneeExists) {
            res.status(404);
            throw new Error(`Assigned ${assignedToModel} not found.`);
        }
        assigneeRef = assignedToId;
        assigneeModelRef = assignedToModel;
    }

    const newScheduledMaintenance = new ScheduledMaintenance({
        title,
        description,
        category: category.toLowerCase(), // Ensure lowercase
        property,
        unit: unit || null,
        scheduledDate,
        recurring: !!recurring, // Convert to boolean
        frequency: recurring ? {
            type: frequency.type?.toLowerCase(), // Ensure lowercase
            interval: frequency.interval,
            dayOfWeek: frequency.dayOfWeek,
            dayOfMonth: frequency.dayOfMonth,
            monthOfYear: frequency.monthOfYear,
            customDays: frequency.customDays || []
        } : {},
        assignedTo: assigneeRef,
        assignedToModel: assigneeModelRef,
        createdBy: userId,
        media: mediaUrls,
        status: 'scheduled' // Default status
    });

    // For initial scheduled tasks, set nextDueDate to scheduledDate
    newScheduledMaintenance.nextDueDate = newScheduledMaintenance.scheduledDate;

    const createdTask = await newScheduledMaintenance.save();

    await AuditLog.create({
        action: 'CREATE_SCHEDULED_MAINTENANCE',
        user: userId,
        targetModel: 'ScheduledMaintenance',
        targetId: createdTask._id,
        details: { title: createdTask.title, recurring: createdTask.recurring }
    });

    res.status(201).json(createdTask);
});

/**
 * @desc    Get all scheduled maintenance tasks (filtered by user role and query parameters)
 * @route   GET /api/scheduled-maintenance
 * @access  Private
 */
exports.getAllScheduledMaintenance = asyncHandler(async (req, res) => {
    const { status, recurring, propertyId, unitId, category, search, startDate, endDate, page = 1, limit = 10 } = req.query;
    let query = {};
    const userId = req.user._id;
    const userRole = req.user.role;

    // Base filtering by role
    if (userRole === 'admin') {
        // Admin sees all
    } else if (userRole === 'vendor') {
        query.assignedTo = userId; // Vendors only see tasks assigned to them (if assignedToModel is User)
        query.assignedToModel = 'User';
    } else { // Landlord, PropertyManager, Tenant (tenants might not see scheduled tasks unless specific to their unit)
        const associatedProperties = await PropertyUser.find({
            user: userId,
            roles: { $in: ['landlord', 'propertymanager', 'tenant'] },
            isActive: true
        }).distinct('property');

        if (associatedProperties.length === 0) {
            return res.status(200).json([]);
        }
        query.property = { $in: associatedProperties };

        // If tenant, further filter by unit
        if (userRole === 'tenant') {
            const associatedUnits = await PropertyUser.find({ user: userId, roles: 'tenant', isActive: true }).distinct('unit');
            if (associatedUnits.length > 0) {
                query.unit = { $in: associatedUnits };
            } else {
                return res.status(200).json([]); // Tenant not associated with any unit
            }
        }
    }

    // Apply additional filters from query parameters
    if (status) query.status = status.toLowerCase();
    if (recurring !== undefined) query.recurring = (recurring === 'true');
    if (propertyId) query.property = propertyId;
    if (unitId) query.unit = unitId;
    if (category) query.category = category.toLowerCase();
    if (search) {
        query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
        ];
    }
    if (startDate || endDate) {
        query.scheduledDate = {}; // Filter by initial scheduled date
        if (startDate) query.scheduledDate.$gte = new Date(startDate);
        if (endDate) query.scheduledDate.$lte = new Date(endDate);
    }

    const tasks = await ScheduledMaintenance.find(query)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'name email role')
        .populate({
            path: 'assignedTo', // Polymorphic population
            select: 'name email phone', // Select relevant fields for User or Vendor
        })
        .sort({ scheduledDate: 1 }) // Sort by scheduled date ascending
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit));

    const total = await ScheduledMaintenance.countDocuments(query);

    res.status(200).json({ tasks, total, currentPage: parseInt(page), itemsPerPage: parseInt(limit) });
});

/**
 * @desc    Get a single scheduled maintenance task by ID
 * @route   GET /api/scheduled-maintenance/:id
 * @access  Private (with access control)
 */
exports.getScheduledMaintenanceById = asyncHandler(async (req, res) => {
    const taskId = req.params.id;

    const task = await ScheduledMaintenance.findById(taskId)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'name email role')
        .populate({
            path: 'assignedTo',
            select: 'name email phone',
        })
        .populate('comments.user', 'name email role'); // Populate comment users

    if (!task) {
        res.status(404);
        throw new Error("Scheduled maintenance task not found.");
    }

    // Authorization: User can view if they are:
    // - Admin
    // - The creator of the task
    // - Assigned to the task
    // - A Landlord/PM/Tenant associated with the property/unit
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else if (task.createdBy.equals(userId)) {
        isAuthorized = true;
    } else if (task.assignedTo && task.assignedTo.equals(userId)) {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: task.property
        });

        if (userAssociations.some(assoc => ['landlord', 'propertymanager'].includes(assoc.roles[0]))) {
            isAuthorized = true;
        } else if (userRole === 'tenant' && task.unit && userAssociations.some(assoc => assoc.roles.includes('tenant') && assoc.unit && assoc.unit.equals(task.unit))) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to view this scheduled maintenance task.');
    }

    res.status(200).json(task);
});


/**
 * @desc    Update a scheduled maintenance task
 * @route   PUT /api/scheduled-maintenance/:id
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.updateScheduledMaintenance = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return;
    const taskId = req.params.id;
    const { title, description, category, scheduledDate, recurring, frequency, assignedToId, assignedToModel, status, media } = req.body;

    const task = await ScheduledMaintenance.findById(taskId);
    if (!task) {
        res.status(404);
        throw new Error("Scheduled maintenance task not found.");
    }

    // Authorization: Admin, or PM/Landlord associated with the property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: task.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to update this scheduled maintenance task.');
    }

    // Apply updates
    task.title = title || task.title;
    task.description = description || task.description;
    task.category = category ? category.toLowerCase() : task.category;
    task.scheduledDate = scheduledDate || task.scheduledDate;
    task.recurring = recurring !== undefined ? !!recurring : task.recurring;

    if (task.recurring) { // Update frequency if recurring is true
        task.frequency = {
            type: frequency?.type?.toLowerCase() || task.frequency.type,
            interval: frequency?.interval || task.frequency.interval,
            dayOfWeek: frequency?.dayOfWeek || task.frequency.dayOfWeek,
            dayOfMonth: frequency?.dayOfMonth || task.frequency.dayOfMonth,
            monthOfYear: frequency?.monthOfYear || task.frequency.monthOfYear,
            customDays: frequency?.customDays || task.frequency.customDays || []
        };
    } else {
        task.frequency = {}; // Clear frequency if no longer recurring
    }

    // Handle assignedTo (polymorphic)
    if (assignedToId && assignedToModel) {
        // Validate assignee exists
        let assigneeExists;
        if (assignedToModel === 'User') {
            assigneeExists = await User.findById(assignedToId);
        } else {
            assigneeExists = await Vendor.findById(assignedToId);
        }
        if (!assigneeExists) {
            res.status(404);
            throw new Error(`Assigned ${assignedToModel} not found.`);
        }
        task.assignedTo = assignedToId;
        task.assignedToModel = assignedToModel;
    } else if (assignedToId === null && assignedToModel === null) { // Allow clearing assignment
        task.assignedTo = null;
        task.assignedToModel = null;
    }

    task.status = status ? status.toLowerCase() : task.status; // Ensure lowercase status
    task.media = media || task.media; // Assuming media is an array of URLs.

    const updatedTask = await task.save();

    await AuditLog.create({
        action: 'UPDATE_SCHEDULED_MAINTENANCE',
        user: userId,
        targetModel: 'ScheduledMaintenance',
        targetId: updatedTask._id,
        details: { title: updatedTask.title, status: updatedTask.status }
    });

    res.status(200).json(updatedTask);
});


/**
 * @desc    Delete a scheduled maintenance task
 * @route   DELETE /api/scheduled-maintenance/:id
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.deleteScheduledMaintenance = asyncHandler(async (req, res) => {
    const taskId = req.params.id;

    const task = await ScheduledMaintenance.findById(taskId);
    if (!task) {
        res.status(404);
        throw new Error("Scheduled maintenance task not found.");
    }

    // Authorization: Admin, or PM/Landlord associated with the property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: task.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to delete this scheduled maintenance task.');
    }

    // Check if there are active Requests generated from this schedule, might want to prevent deletion
    // Or allow deletion but update generated requests to remove `scheduledMaintenanceRef`
    const generatedRequestsCount = await Request.countDocuments({ scheduledMaintenanceRef: taskId });
    if (generatedRequestsCount > 0) {
        res.status(400);
        throw new Error('Cannot delete scheduled maintenance with associated requests. Please handle them first.');
    }

    await task.deleteOne(); // Use deleteOne() on the document instance

    // Cleanup related comments and notifications if necessary
    await Comment.deleteMany({ contextId: taskId, contextType: 'scheduledmaintenance' });
    await Notification.deleteMany({ 'relatedResource.item': taskId, 'relatedResource.kind': 'ScheduledMaintenance' });

    res.status(200).json({ message: "Scheduled maintenance task deleted successfully" });
});

/**
 * @desc    Enable public link for a scheduled maintenance task
 * @route   POST /api/scheduled-maintenance/:id/enable-public-link
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.enableScheduledMaintenancePublicLink = asyncHandler(async (req, res) => {
    const taskId = req.params.id;
    const { expiresInDays } = req.body; // Optional: duration in days

    const task = await ScheduledMaintenance.findById(taskId);
    if (!task) {
        res.status(404);
        throw new Error('Scheduled maintenance task not found.');
    }

    // Authorization: PM/Landlord/Admin associated with the property
    let isAuthorized = false;
    if (req.user.role === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: req.user._id,
            property: task.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to enable public link for this scheduled maintenance task.');
    }

    // `publicLinkToken` is generated in pre-save hook if `publicLinkEnabled` is true and no token exists
    task.publicLinkEnabled = true;
    if (expiresInDays) {
        task.publicLinkExpires = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    } else if (!task.publicLinkExpires) {
        task.publicLinkExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days
    }
    await task.save(); // This will trigger the pre-save hook to generate token if needed

    const publicLink = `${FRONTEND_URL}/public/scheduled-maintenance/${task.publicLinkToken}`;

    await AuditLog.create({
        action: 'ENABLE_PUBLIC_LINK_SCHEDULED_MAINTENANCE',
        user: req.user._id,
        targetModel: 'ScheduledMaintenance',
        targetId: task._id,
        details: { publicToken: task.publicLinkToken, publicLinkExpiresAt: task.publicLinkExpires }
    });

    res.status(200).json({ message: 'Public link enabled successfully.', publicLink });
});

/**
 * @desc    Disable public link for a scheduled maintenance task
 * @route   POST /api/scheduled-maintenance/:id/disable-public-link
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.disableScheduledMaintenancePublicLink = asyncHandler(async (req, res) => {
    const taskId = req.params.id;

    const task = await ScheduledMaintenance.findById(taskId);
    if (!task) {
        res.status(404);
        throw new Error('Scheduled maintenance task not found.');
    }

    // Authorization: PM/Landlord/Admin associated with the property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: task.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to disable public link for this scheduled maintenance task.');
    }

    task.publicLinkEnabled = false;
    task.publicLinkToken = undefined; // Clear the token
    task.publicLinkExpires = undefined; // Clear expiry
    await task.save();

    await AuditLog.create({
        action: 'DISABLE_PUBLIC_LINK_SCHEDULED_MAINTENANCE',
        user: userId,
        targetModel: 'ScheduledMaintenance',
        targetId: task._id,
        details: { taskId }
    });

    res.status(200).json({ message: 'Public link disabled successfully.' });
});


/**
 * @desc    Get external vendor view of a scheduled maintenance task
 * @route   GET /api/scheduled-maintenance/public/:publicToken
 * @access  Public
 * @notes   Limited view, no authentication required, but requires valid token.
 */
exports.getPublicScheduledMaintenanceView = asyncHandler(async (req, res) => {
    const publicToken = req.params.publicToken;

    const task = await ScheduledMaintenance.findOne({
        publicLinkToken: publicToken,
        publicLinkEnabled: true,
        publicLinkExpires: { $gt: new Date() } // Must not be expired
    })
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('comments.user', 'name'); // Only populate sender name for public view

    if (!task) {
        res.status(404);
        throw new Error('Invalid, expired, or disabled public link.');
    }

    // Return a limited set of data for public view
    res.status(200).json({
        _id: task._id,
        title: task.title,
        description: task.description,
        category: task.category,
        scheduledDate: task.scheduledDate,
        recurring: task.recurring,
        frequency: task.frequency,
        status: task.status,
        property: task.property,
        unit: task.unit,
        comments: task.comments, // Public comments (consider filtering internal notes)
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
    });
});

/**
 * @desc    External vendor updates status/comments for a scheduled maintenance task
 * @route   POST /api/scheduled-maintenance/public/:publicToken/update
 * @access  Public (limited functionality)
 * @notes   Requires valid token, name/phone for accountability.
 */
exports.publicScheduledMaintenanceUpdate = asyncHandler(async (req, res) => {
    const publicToken = req.params.publicToken;
    const { status, commentMessage, name, phone } = req.body; // Name and phone for accountability

    if (!name || !phone) {
        res.status(400);
        throw new Error('Name and phone are required for accountability.');
    }

    const task = await ScheduledMaintenance.findOne({
        publicLinkToken: publicToken,
        publicLinkEnabled: true,
        publicLinkExpires: { $gt: new Date() }
    });

    if (!task) {
        res.status(404);
        throw new Error('Invalid, expired, or disabled public link.');
    }

    // Find or create a 'pseudo-user' for this external vendor interaction for audit logging
    let publicUpdater = await User.findOne({ email: `${phone}@external.com`, role: 'vendor' });
    if (!publicUpdater) {
        publicUpdater = await User.create({
            name: name,
            phone: phone,
            email: `${phone}@external.com`, // Dummy email for unique constraint
            role: 'vendor',
            isActive: false,
            approved: true,
        });
    }

    // Update status if provided and valid (e.g., 'in_progress', 'completed')
    const allowedPublicStatuses = ['in_progress', 'completed'];
    if (status && allowedPublicStatuses.includes(status.toLowerCase())) {
        const oldStatus = task.status;
        task.status = status.toLowerCase();
        await AuditLog.create({
            action: 'PUBLIC_SCHEDULED_MAINTENANCE_STATUS_UPDATE',
            user: publicUpdater._id,
            targetModel: 'ScheduledMaintenance',
            targetId: task._id,
            details: { oldStatus, newStatus: task.status, updaterName: name, updaterPhone: phone }
        });
        // Notify PM/Landlord about public status update
        const propertyAssociations = await PropertyUser.find({
            property: task.property,
            roles: { $in: ['landlord', 'propertymanager'] },
            isActive: true
        }).populate('user', 'email');
        for (const assoc of propertyAssociations) {
            if (assoc.user.email) {
                const taskLink = `${FRONTEND_URL}/scheduled-maintenance/${task._id}`;
                await createNotification(
                    assoc.user._id,
                    `External vendor ${name} updated scheduled task "${task.title}" to ${task.status}.`,
                    'status_update',
                    taskLink,
                    { kind: 'ScheduledMaintenance', item: task._id },
                    publicUpdater._id
                );
            }
        }
    }

    // Add comment if provided
    if (commentMessage) {
        task.comments.push({
            user: publicUpdater._id,
            text: commentMessage,
            timestamp: new Date()
        });
        await AuditLog.create({
            action: 'PUBLIC_SCHEDULED_MAINTENANCE_COMMENT_ADD',
            user: publicUpdater._id,
            targetModel: 'ScheduledMaintenance',
            targetId: task._id,
            details: { comment: commentMessage, updaterName: name, updaterPhone: phone }
        });
        // Notify relevant internal users about new comment
        const creator = await User.findById(task.createdBy);
        if (creator && creator.email) {
            const taskLink = `${FRONTEND_URL}/scheduled-maintenance/${task._id}`;
            await createNotification(
                creator._id,
                `New comment on scheduled task "${task.title}" from ${name}.`,
                'new_comment',
                taskLink,
                { kind: 'ScheduledMaintenance', item: task._id },
                publicUpdater._id
            );
        }
        // Also notify assigned PM/Landlord/Vendor
        if (task.assignedTo && task.assignedToModel === 'User') { // Only if assigned to an internal user
            const assignedUser = await User.findById(task.assignedTo);
            if (assignedUser && assignedUser.email) {
                const taskLink = `${FRONTEND_URL}/scheduled-maintenance/${task._id}`;
                await createNotification(
                    assignedUser._id,
                    `New comment on assigned scheduled task "${task.title}" from ${name}.`,
                    'new_comment',
                    taskLink,
                    { kind: 'ScheduledMaintenance', item: task._id },
                    publicUpdater._id
                );
            }
        }
    }

    await task.save();

    res.status(200).json({ message: 'Scheduled maintenance task updated successfully.' });
});
