// backend/controllers/commentController.js

const asyncHandler = require('express-async-handler');
const { validationResult } = require('express-validator');
const Comment = require('../models/comment'); // Corrected import: lowercase file name
const Request = require('../models/request'); // For context validation and authorization
const ScheduledMaintenance = require('../models/scheduledMaintenance'); // For context validation
const Property = require('../models/property'); // For context validation
const Unit = require('../models/unit'); // For context validation
const PropertyUser = require('../models/propertyUser'); // For authorization


// Helper for validation errors
const handleValidationErrors = (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }
    return null;
};

/**
 * @desc    Add a comment to a context (request, scheduled maintenance, property, unit)
 * @route   POST /api/comments
 * @access  Private (Authenticated users, with context-specific authorization)
 */
exports.addComment = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return; // Assuming validation middleware is used in route
    const { contextType, contextId, message } = req.body;

    // Validate contextType and contextId
    let contextDocument = null;
    switch (contextType.toLowerCase()) { // Ensure contextType is lowercase for comparison
        case 'request':
            contextDocument = await Request.findById(contextId);
            break;
        case 'scheduledmaintenance':
            contextDocument = await ScheduledMaintenance.findById(contextId);
            break;
        case 'property':
            contextDocument = await Property.findById(contextId);
            break;
        case 'unit':
            contextDocument = await Unit.findById(contextId);
            break;
        default:
            res.status(400);
            throw new Error('Invalid contextType for comment.');
    }

    if (!contextDocument) {
        res.status(404);
        throw new Error(`${contextType} not found.`);
    }

    // --- Authorization Check for Adding Comments ---
    // A user can comment if:
    // 1. They are Admin
    // 2. They are the creator of the context (e.g., their own request)
    // 3. They are assigned to the context (e.g., assigned PM/Vendor for a request)
    // 4. They are a Landlord/PM associated with the property/unit of the context
    // 5. They are a tenant of the unit (for unit/property comments, or their own request)

    let isAuthorized = false;
    const userId = req.user._id;
    const userRole = req.user.role; // Already lowercase from AuthMiddleware

    if (userRole === 'admin') {
        isAuthorized = true; // Admin can comment anywhere
    } else {
        // Logic for request and scheduled maintenance: creator, assignedTo, or property association
        if (contextType.toLowerCase() === 'request' || contextType.toLowerCase() === 'scheduledmaintenance') {
            // If creator or assigned to the request/task
            if (contextDocument.createdBy && contextDocument.createdBy.equals(userId)) {
                isAuthorized = true;
            } else if (contextDocument.assignedTo && contextDocument.assignedTo.equals(userId)) {
                isAuthorized = true;
            } else {
                // Check if user is PM/Landlord/Tenant of the related property/unit
                const propertyId = contextDocument.property;
                const unitId = contextDocument.unit; // Can be null

                const userAssociations = await PropertyUser.find({
                    user: userId,
                    property: propertyId
                });

                if (userAssociations.some(assoc => ['landlord', 'propertymanager'].includes(assoc.roles[0]))) {
                    isAuthorized = true;
                } else if (unitId && userAssociations.some(assoc => assoc.roles.includes('tenant') && assoc.unit && assoc.unit.equals(unitId))) {
                    isAuthorized = true;
                }
            }
        } else if (contextType.toLowerCase() === 'property' || contextType.toLowerCase() === 'unit') {
            const resourcePropertyId = contextType.toLowerCase() === 'property' ? contextId : contextDocument.property;
            const resourceUnitId = contextType.toLowerCase() === 'unit' ? contextId : null; // For property-level comments, unit is null

            const userAssociations = await PropertyUser.find({
                user: userId,
                property: resourcePropertyId
            });

            if (userAssociations.some(assoc => ['landlord', 'propertymanager'].includes(assoc.roles[0]))) {
                isAuthorized = true;
            } else if (resourceUnitId && userAssociations.some(assoc => assoc.roles.includes('tenant') && assoc.unit && assoc.unit.equals(resourceUnitId))) {
                isAuthorized = true;
            }
        }
    }

    if (!isAuthorized) {
        res.status(403);
        throw new Error('Not authorized to add comments to this resource.');
    }

    const comment = await Comment.create({
        contextType: contextType.toLowerCase(), // Ensure lowercase for DB
        contextId,
        sender: req.user._id,
        message
    });

    res.status(201).json(comment);
});

/**
 * @desc    List comments for a specific context
 * @route   GET /api/comments
 * @access  Private (Authenticated users, with context-specific authorization)
 * @query   contextType, contextId
 */
exports.listComments = asyncHandler(async (req, res) => {
    const { contextType, contextId } = req.query;

    if (!contextType || !contextId) {
        res.status(400);
        throw new Error('contextType and contextId are required to list comments.');
    }

    // Validate contextType and contextId, and perform authorization similar to addComment
    let contextDocument = null;
    const lowercaseContextType = contextType.toLowerCase();

    switch (lowercaseContextType) {
        case 'request':
            contextDocument = await Request.findById(contextId).populate('property unit');
            break;
        case 'scheduledmaintenance':
            contextDocument = await ScheduledMaintenance.findById(contextId).populate('property unit');
            break;
        case 'property':
            contextDocument = await Property.findById(contextId);
            break;
        case 'unit':
            contextDocument = await Unit.findById(contextId).populate('property');
            break;
        default:
            res.status(400);
            throw new Error('Invalid contextType for listing comments.');
    }

    if (!contextDocument) {
        res.status(404);
        throw new Error(`${contextType} not found.`);
    }

    // --- Authorization Check for Listing Comments ---
    // Similar logic as `addComment` but perhaps less strict (read-only access)
    let isAuthorizedToView = false;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
        isAuthorizedToView = true;
    } else {
        if (lowercaseContextType === 'request' || lowercaseContextType === 'scheduledmaintenance') {
            if (contextDocument.createdBy && contextDocument.createdBy.equals(userId)) {
                isAuthorizedToView = true;
            } else if (contextDocument.assignedTo && contextDocument.assignedTo.equals(userId)) {
                isAuthorizedToView = true;
            } else {
                const propertyId = contextDocument.property;
                const unitId = contextDocument.unit;

                const userAssociations = await PropertyUser.find({
                    user: userId,
                    property: propertyId
                });

                if (userAssociations.some(assoc => ['landlord', 'propertymanager'].includes(assoc.roles[0]))) {
                    isAuthorizedToView = true;
                } else if (unitId && userAssociations.some(assoc => assoc.roles.includes('tenant') && assoc.unit && assoc.unit.equals(unitId))) {
                    isAuthorizedToView = true;
                }
            }
        } else if (lowercaseContextType === 'property' || lowercaseContextType === 'unit') {
            const resourcePropertyId = lowercaseContextType === 'property' ? contextId : contextDocument.property;
            const resourceUnitId = lowercaseContextType === 'unit' ? contextId : null;

            const userAssociations = await PropertyUser.find({
                user: userId,
                property: resourcePropertyId
            });

            if (userAssociations.some(assoc => ['landlord', 'propertymanager'].includes(assoc.roles[0]))) {
                isAuthorizedToView = true;
            } else if (resourceUnitId && userAssociations.some(assoc => assoc.roles.includes('tenant') && assoc.unit && assoc.unit.equals(resourceUnitId))) {
                isAuthorizedToView = true;
            }
        }
    }

    if (!isAuthorizedToView) {
        res.status(403);
        throw new Error('Not authorized to view comments for this resource.');
    }

    const comments = await Comment.find({ 
        contextType: lowercaseContextType, 
        contextId 
    }).populate('sender', 'name email role'); // Populate sender for display
    res.status(200).json(comments);
});

