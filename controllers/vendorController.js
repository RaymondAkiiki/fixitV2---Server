// backend/controllers/vendorController.js

const asyncHandler = require('express-async-handler');
const { validationResult } = require('express-validator');
const Vendor = require("../models/vendor"); // Corrected import: lowercase file name
const User = require('../models/user'); // For populating addedBy user details
const PropertyUser = require('../models/propertyUser'); // To manage vendor associations
const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');


// Helper for validation errors
const handleValidationErrors = (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }
    return null;
};

/**
 * @desc    Get all vendors
 * @route   GET /api/vendors
 * @access  Private (Admin, PropertyManager, Landlord)
 * @notes   PMs/Landlords should only see vendors they have added or are associated with their properties.
 */
exports.getAllVendors = asyncHandler(async (req, res) => {
    let query = {};

    // Filter vendors based on user role
    if (req.user.role === 'propertymanager' || req.user.role === 'landlord') {
        // Find properties managed/owned by the current user
        const userAssociatedProperties = await PropertyUser.find({
            user: req.user._id,
            $or: [{ roles: 'propertymanager' }, { roles: 'landlord' }]
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return res.status(200).json([]); // No properties, no associated vendors
        }

        // Find vendors who were added by the current user OR
        // who are explicitly linked to these properties via PropertyUser model (e.g., if vendors are added as 'vendor' role to a property)
        // OR who are assigned to requests within these properties
        // For simplicity, let's filter by `addedBy` for now and assume `properties` array is for primary assignment (removed from Vendor model)
        // A more robust approach would be to find distinct vendors from requests or PropertyUser if they can be generally associated.
        query.$or = [
            { addedBy: req.user._id },
            // If you want to show vendors assigned to *any* request in their properties:
            // { _id: { $in: await Request.distinct('assignedTo', { property: { $in: userAssociatedProperties }, assignedToModel: 'Vendor' }) } }
        ];
    }

    const vendors = await Vendor.find(query).populate('addedBy', 'name email'); // Populate who added the vendor
    res.status(200).json(vendors);
});

/**
 * @desc    Get a specific vendor by ID
 * @route   GET /api/vendors/:id
 * @access  Private (Admin, PropertyManager, Landlord - with access control)
 */
exports.getVendorById = asyncHandler(async (req, res) => {
    const vendor = await Vendor.findById(req.params.id).populate('addedBy', 'name email');

    if (!vendor) {
        res.status(404);
        throw new Error('Vendor not found.');
    }

    // Authorization check: Admin can access any vendor
    if (req.user.role === 'admin') {
        return res.status(200).json(vendor);
    }

    // PMs/Landlords can only view vendors they added or are associated with their properties
    if (req.user.role === 'propertymanager' || req.user.role === 'landlord') {
        const userAssociatedProperties = await PropertyUser.find({
            user: req.user._id,
            $or: [{ roles: 'propertymanager' }, { roles: 'landlord' }]
        }).distinct('property');

        const isAssociated = await PropertyUser.exists({
            user: vendor._id, // If vendors can be users
            property: { $in: userAssociatedProperties },
            roles: 'vendor' // Check if this vendor is explicitly linked as a 'vendor' role
        }) || vendor.addedBy.toString() === req.user._id.toString(); // Or if the current user added them

        // You might also check if this vendor has been assigned to any request in the user's properties.
        const wasAssignedToProperty = await Request.exists({
            assignedTo: vendor._id,
            assignedToModel: 'Vendor',
            property: { $in: userAssociatedProperties }
        });


        if (isAssociated || wasAssignedToProperty) {
            return res.status(200).json(vendor);
        } else {
            res.status(403);
            throw new Error('You are not authorized to view this vendor.');
        }
    }

    res.status(403);
    throw new Error('Not authorized to view this vendor.');
});

/**
 * @desc    Add a new vendor
 * @route   POST /api/vendors
 * @access  Private (PropertyManager, Landlord, Admin)
 */
exports.addVendor = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return; // Assuming validation middleware is used in route
    const { name, phone, email, address, description, services } = req.body;

    // Ensure services array values are lowercase to match enum

    const vendor = new Vendor({
        name,
        phone,
        email,
        address,
        description,
        services: services,
        addedBy: req.user._id, // Link to the user who added this vendor
    });

    const createdVendor = await vendor.save();
    res.status(201).json(createdVendor);
});

/**
 * @desc    Update vendor details
 * @route   PUT /api/vendors/:id
 * @access  Private (Admin, PropertyManager, Landlord - for vendors they added/manage)
 */
exports.updateVendor = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return;
    const vendorId = req.params.id;
    const { services, ...updateData } = req.body;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
        res.status(404);
        throw new Error('Vendor not found.');
    }

    // Authorization: Admin can update any vendor. PM/Landlord can update vendors they added.
    // Future: PM/Landlord might update any vendor if they are associated with the vendor's primary property.
    if (req.user.role !== 'admin' && vendor.addedBy.toString() !== req.user._id.toString()) {
        // More complex auth: Check if req.user manages a property that this vendor is associated with
        const userAssociatedProperties = await PropertyUser.find({
            user: req.user._id,
            $or: [{ roles: 'propertymanager' }, { roles: 'landlord' }]
        }).distinct('property');

        const isAssociated = await PropertyUser.exists({
            user: vendor._id, // If vendor is a User
            property: { $in: userAssociatedProperties },
            roles: 'vendor'
        });

        if (!isAssociated) {
            res.status(403);
            throw new Error('You are not authorized to update this vendor.');
        }
    }

    // Apply updates
    Object.assign(vendor, updateData);
    if (services && Array.isArray(services)) {
        vendor.services = services.map(s => s.toLowerCase()); // Ensure services are lowercase
    }

    const updatedVendor = await vendor.save();
    res.status(200).json(updatedVendor);
});

/**
 * @desc    Delete a vendor
 * @route   DELETE /api/vendors/:id
 * @access  Private (Admin, PropertyManager, Landlord - for vendors they added/manage)
 * @notes   Consider repercussions of deleting vendors (e.g., past assignments).
 */
exports.deleteVendor = asyncHandler(async (req, res) => {
    const vendorId = req.params.id;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
        res.status(404);
        throw new Error('Vendor not found.');
    }

    // Authorization: Admin can delete any. PM/Landlord can delete vendors they added.
    if (req.user.role !== 'admin' && vendor.addedBy.toString() !== req.user._id.toString()) {
        res.status(403);
        throw new Error('You are not authorized to delete this vendor.');
    }

    await vendor.deleteOne(); // Use deleteOne() on the document instance

    // --- Cleanup related data (crucial) ---
    // 1. Remove associated PropertyUser entries (if vendors are also in PropertyUser)
    await PropertyUser.deleteMany({ user: vendorId, roles: 'vendor' });

    // 2. Update requests where this vendor was assignedTo (set to null or 'unassigned')
    await Request.updateMany(
        { assignedTo: vendorId, assignedToModel: 'Vendor' },
        { $set: { assignedTo: null, assignedToModel: null, status: 'new' } } // Mark as new/unassigned
    );
    // 3. Update ScheduledMaintenance where this vendor was assignedTo
    await ScheduledMaintenance.updateMany(
        { assignedTo: vendorId, assignedToModel: 'Vendor' },
        { $set: { assignedTo: null, assignedToModel: null, status: 'scheduled' } } // Mark as scheduled/unassigned
    );

    res.status(200).json({ message: 'Vendor deleted successfully.' });
});
