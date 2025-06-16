// backend/controllers/requestController.js

const asyncHandler = require('express-async-handler');
const { validationResult } = require('express-validator');
const Request = require("../models/request"); // Corrected import
const AuditLog = require("../models/auditLog"); // Corrected import
const Property = require("../models/property"); // Corrected import
const Unit = require("../models/unit");     // Corrected import
const User = require("../models/user");     // Corrected import
const Vendor = require("../models/vendor"); // Corrected import
const PropertyUser = require('../models/propertyUser'); // New import
const { sendRequestNotificationEmail } = require("../utils/emailService");
const { createNotification } = require('./notificationController'); // Internal notification helper

// Frontend URL from environment variables for generating links
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
 * @desc    Create a new maintenance request
 * @route   POST /api/requests
 * @access  Private (Tenant, PropertyManager, Landlord, Admin)
 */
exports.createRequest = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return; // Assuming validation middleware in route
    const { title, description, category, priority, propertyId, unitId } = req.body;
    let mediaUrls = []; // Array to store URLs from Cloudinary

    // If files are uploaded via Multer/Cloudinary, they will be in req.files
    if (req.files && req.files.length > 0) {
        mediaUrls = req.files.map(file => file.path); // Cloudinary URL is in file.path
    }

    if (!title || !description || !propertyId) {
        // In a real app, if Cloudinary uploads are async and complete before validation fails,
        // you would need to implement a Cloudinary deletion cleanup here for `mediaUrls`.
    res.status(400);
    throw new Error('Please include all required fields: title, description, property.');
}
    // Authorization check for creating a request
    // A user can create a request if they are:
    // 1. Admin
    // 2. A Landlord/PM associated with the property/unit
    // 3. A Tenant associated with the unit
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: propertyId
        });

        if (userAssociations.some(assoc => ['landlord', 'propertymanager'].includes(assoc.roles[0]))) {
            isAuthorized = true; // Landlord/PM creating for their property
        } else if (userRole === 'tenant' && userAssociations.some(assoc => assoc.roles.includes('tenant') && assoc.unit && assoc.unit.equals(unitId))) {
            isAuthorized = true; // Tenant creating for their unit
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to create a request for this property/unit.');
    }

    const newRequest = await Request.create({
        title,
        description,
        category: category ? category.toLowerCase() : 'general', // Ensure lowercase category
        priority: priority ? priority.toLowerCase() : 'low',     // Ensure lowercase priority
        media: mediaUrls, // Store Cloudinary URLs
        createdBy: req.user._id, // User who created the request
        property: propertyId,
        unit: unitId,
        status: 'new', // Initial status is 'new' (lowercase)
    });

    await AuditLog.create({
        action: "CREATE_REQUEST",
        user: req.user._id,
        targetModel: "Request",
        targetId: newRequest._id,
        details: { title: newRequest.title, status: newRequest.status }
    });

    // Notify relevant parties (Landlord/PMs associated with the property)
    const propertyAssociations = await PropertyUser.find({
        property: propertyId,
        roles: { $in: ['landlord', 'propertymanager'] },
        isActive: true
    }).populate('user', 'email'); // Populate user details to get email

    const recipients = propertyAssociations.map(pu => pu.user.email).filter(Boolean); // Get emails

    const requestLink = `${FRONTEND_URL}/requests/${newRequest._id}`;

    // Fetch property and unit details for notification messages
    const property = await Property.findById(propertyId).lean();
    let unit = null;
    if (unitId) {
        unit = await Unit.findById(unitId).lean();
    }

    for (const recipientEmail of [...new Set(recipients)]) { // Use Set for unique emails
        await sendRequestNotificationEmail(recipientEmail, newRequest.title, newRequest.status, requestLink);
        // Also create in-app notification
        const recipientUser = await User.findOne({ email: recipientEmail });
        if (recipientUser) {
            await createNotification(
                recipientUser._id,
                `New request for ${property?.name || propertyId}${unit && unit.unitName ? ` unit ${unit.unitName}` : ''}: ${newRequest.title}`,
                'new_request',
                requestLink,
                { kind: 'Request', item: newRequest._id },
                req.user._id // Sender is the creator of the request
            );
        }
    }

    res.status(201).json(newRequest);
});

/**
 * @desc    Get all requests (filtered by user role and query parameters)
 * @route   GET /api/requests
 * @access  Private
 */
exports.getAllRequests = asyncHandler(async (req, res) => {
    const { status, category, priority, propertyId, unitId, search, startDate, endDate, assignedToId, assignedToType } = req.query;
    let query = {};
    const userId = req.user._id;
    const userRole = req.user.role;

    // Base filtering by role
    if (userRole === 'admin') {
        // Admin sees all requests
    } else if (userRole === 'tenant') {
        query.createdBy = userId; // Tenant sees only their own requests
    } else if (userRole === 'landlord' || userRole === 'propertymanager') {
        // Landlord/PM sees requests for properties they own/manage
        const associatedProperties = await PropertyUser.find({
            user: userId,
            roles: { $in: ['landlord', 'propertymanager'] },
            isActive: true
        }).distinct('property');

        if (associatedProperties.length === 0) {
            return res.status(200).json([]); // No associated properties, no requests to show
        }
        query.property = { $in: associatedProperties };
    } else if (userRole === 'vendor') {
        query.assignedTo = userId; // Vendors see only requests assigned to them
        query.assignedToModel = 'User'; // Assigned to them as a User
    }

    // Apply additional filters from query parameters
    if (status) query.status = status.toLowerCase();
    if (category) query.category = category.toLowerCase();
    if (priority) query.priority = priority.toLowerCase();
    if (propertyId) query.property = propertyId;
    if (unitId) query.unit = unitId;
    if (search) {
        query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
        ];
    }
    if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    if (assignedToId && assignedToType) {
        query.assignedTo = assignedToId;
        query.assignedToModel = assignedToType;
    }


    const requests = await Request.find(query)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'name email role')
        .populate({
            path: 'assignedTo', // Polymorphic population
            select: 'name email phone', // Select relevant fields for User or Vendor
            // No model provided here, relies on assignedToModel
        })
        .sort({ createdAt: -1 });

    res.status(200).json(requests);
});


/**
 * @desc    Get specific request details by ID
 * @route   GET /api/requests/:id
 * @access  Private (with access control)
 */
exports.getRequestDetails = asyncHandler(async (req, res) => {
    const requestId = req.params.id;

    const request = await Request.findById(requestId)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'name email role')
        .populate({
            path: 'assignedTo', // Polymorphic population
            select: 'name email phone', // Select relevant fields for User or Vendor
        })
        .populate('comments.sender', 'name email role'); // Populate comment senders

    if (!request) {
        res.status(404);
        throw new Error('Maintenance request not found.');
    }

    // Authorization: User can view if they are:
    // - Admin
    // - The creator of the request
    // - Assigned to the request
    // - A Landlord/PM/Tenant associated with the property/unit
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else if (request.createdBy.equals(userId)) {
        isAuthorized = true; // Creator can view
    } else if (request.assignedTo && request.assignedTo.equals(userId)) {
        isAuthorized = true; // Assigned person can view
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: request.property
        });

        if (userAssociations.some(assoc => ['landlord', 'propertymanager'].includes(assoc.roles[0]))) {
            isAuthorized = true; // Landlord/PM can view
        } else if (userRole === 'tenant' && request.unit && userAssociations.some(assoc => assoc.roles.includes('tenant') && assoc.unit && assoc.unit.equals(request.unit))) {
            isAuthorized = true; // Tenant of the unit can view
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to view this request.');
    }

    res.status(200).json(request);
});

/**
 * @desc    Update a maintenance request (status, priority, description by authorized users)
 * @route   PUT /api/requests/:id
 * @access  Private (Admin, PropertyManager, Landlord - with access control)
 */
exports.updateRequest = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return;
    const requestId = req.params.id;
    const { title, description, category, priority, status } = req.body; // Do not allow changing property/unit via this route

    const request = await Request.findById(requestId);
    if (!request) {
        res.status(404);
        throw new Error('Maintenance request not found.');
    }

    // Authorization: Admin can update any. PM/Landlord associated with property.
    // Tenant can only update description for 'new' status.
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: request.property
        });

        if (userAssociations.some(assoc => ['landlord', 'propertymanager'].includes(assoc.roles[0]))) {
            isAuthorized = true; // Landlord/PM can update most fields
        } else if (request.createdBy.equals(userId) && userRole === 'tenant') {
            // Tenant can update title/description only for 'new' requests they created
            if (request.status === 'new') {
                request.title = title || request.title;
                request.description = description || request.description;
                await request.save();
                await AuditLog.create({
                    action: 'UPDATE_REQUEST_DETAILS',
                    user: userId,
                    targetModel: 'Request',
                    targetId: request._id,
                    details: { changedBy: 'Tenant', fields: ['title', 'description'] }
                });
                return res.status(200).json(request);
            } else {
                res.status(403);
                throw new Error('Tenants can only update new requests.');
            }
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to update this request.');
    }

    // Apply updates for authorized roles (Admin, PM, Landlord)
    request.title = title || request.title;
    request.description = description || request.description;
    request.category = category ? category.toLowerCase() : request.category;
    request.priority = priority ? priority.toLowerCase() : request.priority;

    // Handle status changes
    if (status && request.status !== status.toLowerCase()) {
        const oldStatus = request.status;
        request.status = status.toLowerCase();
        if (request.status === 'completed') {
            request.resolvedAt = new Date();
        } else if (request.status === 'reopened') {
            request.resolvedAt = null; // Clear resolved date if re-opened
        }
        await AuditLog.create({
            action: 'UPDATE_REQUEST_STATUS',
            user: userId,
            targetModel: 'Request',
            targetId: request._id,
            details: { oldStatus, newStatus: request.status }
        });
        // Notify tenant/assignee about status update
        const creator = await User.findById(request.createdBy);
        if (creator && creator.email) {
            const requestLink = `${FRONTEND_URL}/requests/${request._id}`;
            await sendRequestNotificationEmail(creator.email, request.title, request.status, requestLink);
            await createNotification(
                creator._id,
                `Your request "${request.title}" is now ${request.status}.`,
                'status_update',
                requestLink,
                { kind: 'Request', item: request._id },
                userId
            );
        }
    }

    const updatedRequest = await request.save();
    res.status(200).json(updatedRequest);
});

/**
 * @desc    Assign request to vendor or internal staff
 * @route   POST /api/requests/:id/assign
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.assignRequest = asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const { assignedToId, assignedToModel } = req.body; // assignedToModel: 'User' or 'Vendor'

    if (!assignedToId || !assignedToModel || !['User', 'Vendor'].includes(assignedToModel)) {
        res.status(400);
        throw new Error('Please specify who to assign to and their type (User or Vendor).');
    }

    const request = await Request.findById(requestId);
    if (!request) {
        res.status(404);
        throw new Error('Request not found.');
    }

    // Authorization: Admin, PM, Landlord associated with property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: request.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to assign this request.');
    }

    // Check assignee existence and role/type
    let assignee = null;
    if (assignedToModel === 'User') {
        assignee = await User.findById(assignedToId);
        if (assignee && !['propertymanager', 'landlord', 'admin', 'vendor'].includes(assignee.role)) { // Vendors can also be users
            res.status(400);
            throw new Error('Assigned user must be a Property Manager, Landlord, Admin, or an internal Vendor user.');
        }
    } else if (assignedToModel === 'Vendor') {
        assignee = await Vendor.findById(assignedToId);
    }

    if (!assignee) {
        res.status(404);
        throw new Error(`Assignee (${assignedToModel}) not found.`);
    }

    // Update assignment
    request.assignedTo = assignedToId;
    request.assignedToModel = assignedToModel;
    request.assignedBy = userId; // Record who assigned it
    request.status = 'assigned'; // Update status to 'assigned' (lowercase)
    await request.save();

    await AuditLog.create({
        action: 'ASSIGN_REQUEST',
        user: userId,
        targetModel: "Request",
        targetId: request._id,
        details: { assignedTo: assignee.email || assignee.name, status: request.status }
    });

    // Notify assignee
    if (assignee.email) {
        const requestLink = `${FRONTEND_URL}/requests/${request._id}`;
        await sendRequestNotificationEmail(assignee.email, request.title, request.status, requestLink);
        await createNotification(
            assignee._id,
            `You have been assigned to request: "${request.title}"`,
            'assignment',
            requestLink,
            { kind: 'Request', item: request._id },
            userId
        );
    }

    res.status(200).json(request);
});

/**
 * @desc    Add a comment to a request
 * @route   POST /api/requests/:id/comments
 * @access  Private (Authenticated users, with request-specific authorization)
 * @notes   This is an alternative to the general commentsController.addComment.
 * For consistency, use the general commentsController.addComment route
 * which is more flexible. Removed specific `addComment` from here.
 */
// This function will now be handled by commentsController.addComment using contextType 'request'
// exports.addComment = ...

/**
 * @desc    Get comments for a request
 * @route   GET /api/requests/:id/comments
 * @access  Private (Authenticated users, with request-specific authorization)
 * @notes   This is an alternative to the general commentsController.listComments.
 * For consistency, use the general commentsController.listComments route.
 * Removed specific `getComments` from here.
 */
// This function will now be handled by commentsController.listComments using contextType 'request'
// exports.getComments = ...


/**
 * @desc    Upload media file(s) for a request
 * @route   POST /api/requests/:id/media
 * @access  Private (Tenant, PropertyManager, Landlord, Admin)
 * @notes   Assumes `uploadCloudinary.array('mediaFiles')` middleware is used on the route.
 */
exports.uploadMedia = asyncHandler(async (req, res) => {
    const requestId = req.params.id;
    const mediaUrls = req.files.map(file => file.path); // Assuming files are already uploaded to Cloudinary

    if (!mediaUrls || mediaUrls.length === 0) {
        res.status(400);
        throw new Error('No media files uploaded.');
    }

    const request = await Request.findById(requestId);
    if (!request) {
        res.status(404);
        throw new Error('Request not found.');
    }

    // Authorization: Creator, assigned, or PM/Landlord of property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else if (request.createdBy.equals(userId)) {
        isAuthorized = true;
    } else if (request.assignedTo && request.assignedTo.equals(userId)) {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: request.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to upload media to this request.');
    }

    // Add new media URLs to the existing array
    request.media = [...request.media, ...mediaUrls];
    await request.save();

    await AuditLog.create({
        action: 'ADD_MEDIA',
        user: userId,
        targetModel: 'Request',
        targetId: request._id,
        details: { mediaCount: mediaUrls.length }
    });

    res.status(200).json({ message: 'Media uploaded successfully.', media: request.media });
});

/**
 * @desc    Delete a media file from a request
 * @route   DELETE /api/requests/:id/media
 * @access  Private (Admin, PropertyManager, Landlord, Creator)
 * @notes   Receives the URL of the media to delete in body/query.
 */
exports.deleteMedia = asyncHandler(async (req, res) => {
    const requestId = req.params.id;
    const { mediaUrl } = req.body; // Or req.query if sent as query parameter

    if (!mediaUrl) {
        res.status(400);
        throw new Error('Media URL is required to delete.');
    }

    const request = await Request.findById(requestId);
    if (!request) {
        res.status(404);
        throw new Error('Request not found.');
    }

    // Authorization: Admin, Creator, assigned, or PM/Landlord of property
    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorized = true;
    } else if (request.createdBy.equals(userId)) {
        isAuthorized = true;
    } else if (request.assignedTo && request.assignedTo.equals(userId)) {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: userId,
            property: request.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to delete media from this request.');
    }

    // Filter out the mediaUrl to be deleted
    const initialMediaCount = request.media.length;
    request.media = request.media.filter(url => url !== mediaUrl);

    if (request.media.length === initialMediaCount) {
        res.status(404);
        throw new Error('Media URL not found in this request.');
    }

    await request.save();

    // TODO: Implement Cloudinary deletion call here (using Cloudinary API)
    // Example: await cloudinary.uploader.destroy(public_id_from_url);

    await AuditLog.create({
        action: 'DELETE_MEDIA',
        user: userId,
        targetModel: 'Request',
        targetId: request._id,
        details: { deletedMediaUrl: mediaUrl }
    });

    res.status(200).json({ message: 'Media deleted successfully.', remainingMedia: request.media });
});

/**
 * @desc    Get external vendor view of a request
 * @route   GET /api/requests/public/:publicToken
 * @access  Public
 * @notes   Limited view, no authentication required, but requires valid token.
 */
exports.getPublicRequestView = asyncHandler(async (req, res) => {
    const publicToken = req.params.publicToken;

    const request = await Request.findOne({
        publicToken: publicToken,
        publicLinkEnabled: true,
        publicLinkExpiresAt: { $gt: new Date() } // Must not be expired
    })
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('comments.sender', 'name'); // Only populate sender name for public view

    if (!request) {
        res.status(404);
        throw new Error('Invalid, expired, or disabled public link.');
    }

    // Return a limited set of data for public view
    res.status(200).json({
        _id: request._id,
        title: request.title,
        description: request.description,
        category: request.category,
        priority: request.priority,
        media: request.media, // URLs are safe to share
        status: request.status,
        property: request.property,
        unit: request.unit,
        comments: request.comments, // Public comments (consider filtering internal notes if added)
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
    });
});

/**
 * @desc    External vendor updates status/comments for a request
 * @route   POST /api/requests/public/:publicToken/update
 * @access  Public (limited functionality)
 * @notes   Requires valid token, name/phone for accountability.
 */
exports.publicRequestUpdate = asyncHandler(async (req, res) => {
    const publicToken = req.params.publicToken;
    const { status, commentMessage, name, phone } = req.body; // Name and phone for accountability

    if (!name || !phone) {
        res.status(400);
        throw new Error('Name and phone are required for accountability.');
    }

    const request = await Request.findOne({
        publicToken: publicToken,
        publicLinkEnabled: true,
        publicLinkExpiresAt: { $gt: new Date() }
    });

    if (!request) {
        res.status(404);
        throw new Error('Invalid, expired, or disabled public link.');
    }

    // Find or create a 'pseudo-user' for this external vendor interaction for audit logging
    // This is a simplified approach. A dedicated "ExternalVendorUser" or similar might be better.
    let publicUpdater = await User.findOne({ email: `${phone}@external.com`, role: 'vendor' }); // Using phone as part of unique identifier
    if (!publicUpdater) {
        publicUpdater = await User.create({
            name: name,
            phone: phone,
            email: `${phone}@external.com`, // Dummy email for unique constraint
            role: 'vendor', // Mark as vendor
            isActive: false, // Not a full internal user
            approved: true,
            // You might add an isExternal: true field to User model
        });
    }

    // Update status if provided and valid (e.g., 'in_progress', 'completed')
    const allowedPublicStatuses = ['in_progress', 'completed']; // Restrict what external vendors can set
    if (status && allowedPublicStatuses.includes(status.toLowerCase())) {
        const oldStatus = request.status;
        request.status = status.toLowerCase();
        if (request.status === 'completed') {
            request.resolvedAt = new Date();
        }
        await AuditLog.create({
            action: 'PUBLIC_STATUS_UPDATE',
            user: publicUpdater._id, // Log with the pseudo-user
            targetModel: 'Request',
            targetId: request._id,
            details: { oldStatus, newStatus: request.status, updaterName: name, updaterPhone: phone }
        });
        // Notify PM/Landlord about public status update
        const propertyAssociations = await PropertyUser.find({
            property: request.property,
            roles: { $in: ['landlord', 'propertymanager'] },
            isActive: true
        }).populate('user', 'email');
        for (const assoc of propertyAssociations) {
            if (assoc.user.email) {
                const requestLink = `${FRONTEND_URL}/requests/${request._id}`;
                await sendRequestNotificationEmail(assoc.user.email, request.title, request.status, requestLink);
                await createNotification(
                    assoc.user._id,
                    `External vendor ${name} updated request "${request.title}" to ${request.status}.`,
                    'status_update',
                    requestLink,
                    { kind: 'Request', item: request._id },
                    publicUpdater._id
                );
            }
        }
    }

    // Add comment if provided
    if (commentMessage) {
        request.comments.push({
            sender: publicUpdater._id,
            message: commentMessage,
            timestamp: new Date()
        });
        await AuditLog.create({
            action: 'PUBLIC_COMMENT_ADD',
            user: publicUpdater._id,
            targetModel: 'Request',
            targetId: request._id,
            details: { comment: commentMessage, updaterName: name, updaterPhone: phone }
        });
        // Notify relevant internal users about new comment
        const creator = await User.findById(request.createdBy);
        if (creator && creator.email) {
             const requestLink = `${FRONTEND_URL}/requests/${request._id}`;
             await createNotification(
                creator._id,
                `New comment on your request "${request.title}" from ${name}.`,
                'new_comment',
                requestLink,
                { kind: 'Request', item: request._id },
                publicUpdater._id
            );
        }
        // Also notify assigned PM/Landlord/Vendor
        if (request.assignedTo && request.assignedToModel === 'User') { // Only if assigned to an internal user
             const assignedUser = await User.findById(request.assignedTo);
             if (assignedUser && assignedUser.email) {
                const requestLink = `${FRONTEND_URL}/requests/${request._id}`;
                await createNotification(
                   assignedUser._id,
                   `New comment on assigned request "${request.title}" from ${name}.`,
                   'new_comment',
                   requestLink,
                   { kind: 'Request', item: request._id },
                   publicUpdater._id
               );
             }
        }
    }

    await request.save();

    res.status(200).json({ message: 'Request updated successfully.' });
});

/**
 * @desc    Submit feedback for a completed request (Tenant only)
 * @route   POST /api/requests/:id/feedback
 * @access  Private (Tenant)
 */
exports.submitFeedback = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return;
    const { id: requestId } = req.params;
    const { rating, comment } = req.body;

    const request = await Request.findById(requestId);
    if (!request) {
        res.status(404);
        throw new Error("Request not found.");
    }

    // Authorization: Only the creator of the request can submit feedback.
    // And only if their role is 'tenant'.
    if (!request.createdBy.equals(req.user._id) || req.user.role !== 'tenant') {
        res.status(403);
        throw new Error("You can only submit feedback for your own requests.");
    }

    // Feedback can only be submitted for completed or verified requests
    if (!['completed', 'verified'].includes(request.status)) {
        res.status(400);
        throw new Error("Feedback can only be submitted after the request is completed or verified.");
    }

    // Prevent submitting feedback multiple times
    if (request.feedback && request.feedback.submittedAt) {
        res.status(400);
        throw new Error("Feedback has already been submitted for this request.");
    }

    request.feedback = {
        rating,
        comment,
        submittedAt: new Date(),
    };
    await request.save();

    await AuditLog.create({
        action: 'SUBMIT_FEEDBACK',
        user: req.user._id,
        targetModel: 'Request',
        targetId: request._id,
        details: { rating, comment }
    });

    res.status(200).json({ message: "Feedback submitted successfully." });
});

/**
 * @desc    Enable public link for a request
 * @route   POST /api/requests/:id/enable-public-link
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.enablePublicLink = asyncHandler(async (req, res) => {
    const requestId = req.params.id;
    const { expiresInDays } = req.body; // Optional: duration in days

    const request = await Request.findById(requestId);
    if (!request) {
        res.status(404);
        throw new Error('Request not found.');
    }

    // Authorization: PM/Landlord/Admin associated with the property
    let isAuthorized = false;
    if (req.user.role === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: req.user._id,
            property: request.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to enable public link for this request.');
    }

    const expiryDate = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;
    const publicToken = await request.enablePublicLink(expiryDate);

    const publicLink = `${FRONTEND_URL}/public/requests/${publicToken}`;

    await AuditLog.create({
        action: 'ENABLE_PUBLIC_LINK_REQUEST',
        user: req.user._id,
        targetModel: 'Request',
        targetId: request._id,
        details: { publicToken, publicLinkExpiresAt: request.publicLinkExpiresAt }
    });

    res.status(200).json({
        message: 'Public link enabled successfully.',
        publicLink,
        publicLinkExpiresAt: expiryDate
    });
});

/**
 * @desc    Disable public link for a request
 * @route   POST /api/requests/:id/disable-public-link
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.disablePublicLink = asyncHandler(async (req, res) => {
    const requestId = req.params.id;

    const request = await Request.findById(requestId);
    if (!request) {
        res.status(404);
        throw new Error('Request not found.');
    }

    // Authorization: PM/Landlord/Admin associated with the property
    let isAuthorized = false;
    if (req.user.role === 'admin') {
        isAuthorized = true;
    } else {
        const userAssociations = await PropertyUser.find({
            user: req.user._id,
            property: request.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to disable public link for this request.');
    }

    request.publicLinkEnabled = false;
    request.publicToken = undefined; // Clear the token
    request.publicLinkExpiresAt = undefined; // Clear expiry
    await request.save();

    await AuditLog.create({
        action: 'DISABLE_PUBLIC_LINK_REQUEST',
        user: req.user._id,
        targetModel: 'Request',
        targetId: request._id,
        details: { requestId }
    });

    res.status(200).json({ message: 'Public link disabled successfully.' });
});

/**
 * @desc    Verify a completed request (PM/Landlord)
 * @route   PUT /api/requests/:id/verify
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.verifyRequest = asyncHandler(async (req, res) => {
    const requestId = req.params.id;

    const request = await Request.findById(requestId);
    if (!request) {
        res.status(404);
        throw new Error('Request not found.');
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
            property: request.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to verify this request.');
    }

    if (request.status !== 'completed') {
        res.status(400);
        throw new Error('Only completed requests can be verified.');
    }

    request.status = 'verified'; // Set status to 'verified' (lowercase)
    request.verifiedBy = userId; // Record who verified it
    await request.save();

    await AuditLog.create({
        action: 'VERIFY_REQUEST',
        user: userId,
        targetModel: 'Request',
        targetId: request._id,
        details: { newStatus: request.status }
    });

    // Notify tenant about verification
    const creator = await User.findById(request.createdBy);
    if (creator && creator.email) {
        const requestLink = `${FRONTEND_URL}/requests/${request._id}`;
        await sendRequestNotificationEmail(creator.email, request.title, request.status, requestLink);
        await createNotification(
            creator._id,
            `Your request "${request.title}" has been verified.`,
            'task_verified',
            requestLink,
            { kind: 'Request', item: request._id },
            userId
        );
    }

    res.status(200).json({ message: 'Request verified successfully.', request });
});

/**
 * @desc    Reopen a request (PM/Landlord)
 * @route   PUT /api/requests/:id/reopen
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.reopenRequest = asyncHandler(async (req, res) => {
    const requestId = req.params.id;

    const request = await Request.findById(requestId);
    if (!request) {
        res.status(404);
        throw new Error('Request not found.');
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
            property: request.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to reopen this request.');
    }

    if (!['completed', 'verified'].includes(request.status)) {
        res.status(400);
        throw new Error('Only completed or verified requests can be reopened.');
    }

    request.status = 'reopened'; // Set status to 'reopened' (lowercase)
    request.resolvedAt = null; // Clear resolved date
    request.verifiedBy = null; // Clear verified by
    await request.save();

    await AuditLog.create({
        action: 'REOPEN_REQUEST',
        user: userId,
        targetModel: 'Request',
        targetId: request._id,
        details: { newStatus: request.status }
    });

    // Notify tenant about reopening
    const creator = await User.findById(request.createdBy);
    if (creator && creator.email) {
        const requestLink = `${FRONTEND_URL}/requests/${request._id}`;
        await sendRequestNotificationEmail(creator.email, request.title, request.status, requestLink);
        await createNotification(
            creator._id,
            `Your request "${request.title}" has been reopened.`,
            'status_update',
            requestLink,
            { kind: 'Request', item: request._id },
            userId
        );
    }

    res.status(200).json({ message: 'Request reopened successfully.', request });
});

/**
 * @desc    Archive a request (PM/Landlord/Admin)
 * @route   PUT /api/requests/:id/archive
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.archiveRequest = asyncHandler(async (req, res) => {
    const requestId = req.params.id;

    const request = await Request.findById(requestId);
    if (!request) {
        res.status(404);
        throw new Error('Request not found.');
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
            property: request.property,
            roles: { $in: ['landlord', 'propertymanager'] }
        });
        if (userAssociations.length > 0) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to archive this request.');
    }

    if (!['completed', 'verified', 'reopened'].includes(request.status)) {
        res.status(400);
        throw new Error('Only completed, verified, or reopened requests can be archived.');
    }

    request.status = 'archived'; // Set status to 'archived' (lowercase)
    await request.save();

    await AuditLog.create({
        action: 'ARCHIVE_REQUEST',
        user: userId,
        targetModel: 'Request',
        targetId: request._id,
        details: { newStatus: request.status }
    });

    res.status(200).json({ message: 'Request archived successfully.', request });
});
