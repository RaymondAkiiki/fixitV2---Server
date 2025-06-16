// backend/controllers/reportController.js

const asyncHandler = require('express-async-handler');
const { validationResult } = require('express-validator');
const Request = require("../models/request"); // Corrected import
const ScheduledMaintenance = require("../models/scheduledMaintenance"); // Corrected import
const PropertyUser = require('../models/propertyUser'); // New import for authorization/filtering
const { Parser } = require("json2csv"); // For CSV export

// Helper for validation errors
const handleValidationErrors = (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
    }
    return null;
};

/**
 * @desc    Generate a comprehensive maintenance summary report
 * @route   GET /api/reports/maintenance-summary
 * @access  Private (Admin, PropertyManager, Landlord)
 * @query   propertyId, status, category, assignedToId, startDate, endDate, format, page, limit
 * @notes   This endpoint will combine data from both Request and ScheduledMaintenance.
 */
exports.generateMaintenanceSummaryReport = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return; // Assuming validation middleware for queries

    const { propertyId, status, category, assignedToId, assignedToModel, startDate, endDate, format, page = 1, limit = 10 } = req.query;

    let requestFilter = {};
    let scheduledMaintenanceFilter = {};
    const userId = req.user._id;
    const userRole = req.user.role;

    // Authorization and filtering based on user role
    if (userRole === 'admin') {
        // Admin can see everything
    } else if (userRole === 'landlord' || userRole === 'propertymanager') {
        // Landlord/PM can only see reports for properties they own/manage
        const userAssociatedProperties = await PropertyUser.find({
            user: userId,
            roles: { $in: ['landlord', 'propertymanager'] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return res.status(200).json({ data: [], pagination: { currentPage: 1, totalItems: 0, itemsPerPage: parseInt(limit) } });
        }
        requestFilter.property = { $in: userAssociatedProperties };
        scheduledMaintenanceFilter.property = { $in: userAssociatedProperties };
    } else {
        res.status(403);
        throw new Error('Not authorized to generate reports.');
    }

    // Apply common filters
    if (propertyId) {
        requestFilter.property = propertyId;
        scheduledMaintenanceFilter.property = propertyId;
    }
    if (status) {
        requestFilter.status = status.toLowerCase(); // Ensure lowercase
        scheduledMaintenanceFilter.status = status.toLowerCase();
    }
    if (category) {
        requestFilter.category = category.toLowerCase(); // Ensure lowercase
        scheduledMaintenanceFilter.category = category.toLowerCase();
    }
    if (assignedToId && assignedToModel) {
        requestFilter.assignedTo = assignedToId;
        requestFilter.assignedToModel = assignedToModel;
        scheduledMaintenanceFilter.assignedTo = assignedToId;
        scheduledMaintenanceFilter.assignedToModel = assignedToModel;
    }
    if (startDate || endDate) {
        requestFilter.createdAt = {};
        scheduledMaintenanceFilter.scheduledDate = {}; // Filter by initial scheduled date for SM

        if (startDate) {
            requestFilter.createdAt.$gte = new Date(startDate);
            scheduledMaintenanceFilter.scheduledDate.$gte = new Date(startDate);
        }
        if (endDate) {
            requestFilter.createdAt.$lte = new Date(endDate);
            scheduledMaintenanceFilter.scheduledDate.$lte = new Date(endDate);
        }
    }

    const parsedLimit = parseInt(limit);
    const skip = (parseInt(page) - 1) * parsedLimit;

    // Fetch Requests
    const requests = await Request.find(requestFilter)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'name email')
        .populate({ path: 'assignedTo', select: 'name email' }) // Populate assigned person
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit);

    // Fetch Scheduled Maintenance
    const scheduledMaintenance = await ScheduledMaintenance.find(scheduledMaintenanceFilter)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'name email')
        .populate({ path: 'assignedTo', select: 'name email' })
        .sort({ scheduledDate: -1 })
        .skip(skip)
        .limit(parsedLimit);

    const combinedData = [
        ...requests.map(item => ({
            type: 'Request',
            id: item._id,
            title: item.title,
            description: item.description,
            category: item.category,
            priority: item.priority,
            status: item.status,
            propertyName: item.property?.name,
            propertyAddress: item.property?.address ? `${item.property.address.street}, ${item.property.address.city}` : '',
            unitName: item.unit?.unitName,
            createdBy: item.createdBy?.name || item.createdBy?.email,
            assignedTo: item.assignedTo?.name || item.assignedTo?.email,
            createdAt: item.createdAt,
            resolvedAt: item.resolvedAt,
            publicLinkEnabled: item.publicLinkEnabled,
            publicToken: item.publicToken,
            feedbackRating: item.feedback?.rating,
            feedbackComment: item.feedback?.comment,
        })),
        ...scheduledMaintenance.map(item => ({
            type: 'Scheduled Maintenance',
            id: item._id,
            title: item.title,
            description: item.description,
            category: item.category,
            priority: 'N/A', // Scheduled Maintenance doesn't have priority field in your model
            status: item.status,
            propertyName: item.property?.name,
            propertyAddress: item.property?.address ? `${item.property.address.street}, ${item.property.address.city}` : '',
            unitName: item.unit?.unitName,
            createdBy: item.createdBy?.name || item.createdBy?.email,
            assignedTo: item.assignedTo?.name || item.assignedTo?.email,
            createdAt: item.createdAt, // Or `scheduledDate` for its primary date
            resolvedAt: item.status === 'completed' ? item.updatedAt : null, // Assuming completion updates updatedAt
            recurring: item.recurring,
            frequency: item.frequency,
            publicLinkEnabled: item.publicLinkEnabled,
            publicLinkToken: item.publicLinkToken,
            // Scheduled maintenance doesn't have feedback
        })),
    ];

    // Sort combined data by creation date descending
    combinedData.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Handle CSV export if requested
    if (format === "csv") {
        const fields = [
            { label: 'Type', value: 'type' },
            { label: 'ID', value: 'id' },
            { label: 'Title', value: 'title' },
            { label: 'Description', value: 'description' },
            { label: 'Category', value: 'category' },
            { label: 'Priority', value: 'priority' },
            { label: 'Status', value: 'status' },
            { label: 'Property Name', value: 'propertyName' },
            { label: 'Property Address', value: 'propertyAddress' },
            { label: 'Unit Name', value: 'unitName' },
            { label: 'Created By', value: 'createdBy' },
            { label: 'Assigned To', value: 'assignedTo' },
            { label: 'Created At', value: (row) => row.createdAt.toISOString() }, // Convert Date to ISO string for CSV
            { label: 'Resolved At', value: (row) => row.resolvedAt ? row.resolvedAt.toISOString() : '' },
            { label: 'Recurring', value: 'recurring' },
            { label: 'Feedback Rating', value: 'feedbackRating' },
            { label: 'Feedback Comment', value: 'feedbackComment' },
        ];
        const parser = new Parser({ fields });
        const csv = parser.parse(combinedData);
        res.header("Content-Type", "text/csv");
        res.attachment("maintenance_report.csv");
        return res.send(csv);
    }

    // Return data as JSON (with pagination metadata)
    // Note: this pagination is simple and assumes combined data fits in memory.
    // For very large datasets, separate pagination for requests and scheduled maintenance, or
    // a more complex aggregation pipeline, would be needed.
    res.status(200).json({
        data: combinedData,
        pagination: {
            currentPage: parseInt(page),
            totalItems: combinedData.length, // This is total items *in the current result set*, not total in DB
            itemsPerPage: parsedLimit,
            // You'd ideally get `totalCount` for requests and scheduled maintenance separately
            // and combine them for a true total across both collections.
        },
    });
});

/**
 * @desc    Report on vendor performance (average resolution times, ratings)
 * @route   GET /api/reports/vendor-performance
 * @access  Private (Admin, PropertyManager, Landlord)
 */
exports.getVendorPerformanceReport = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return;

    const { propertyId, vendorId, startDate, endDate } = req.query;
    const userRole = req.user.role;
    const userId = req.user._id;

    let propertyFilter = {};
    if (userRole === 'landlord' || userRole === 'propertymanager') {
        const userAssociatedProperties = await PropertyUser.find({
            user: userId,
            roles: { $in: ['landlord', 'propertymanager'] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return res.status(200).json([]);
        }
        propertyFilter._id = { $in: userAssociatedProperties };
    } else if (userRole !== 'admin') {
        res.status(403);
        throw new Error('Not authorized to view vendor performance reports.');
    }

    // If propertyId is provided, restrict to that property
    if (propertyId) {
        if (propertyFilter._id && !propertyFilter._id.$in.includes(propertyId)) {
            // User is trying to access a property they don't manage/own
            res.status(403);
            throw new Error('Not authorized to view reports for this property.');
        }
        propertyFilter._id = propertyId;
    }

    // Find all requests that are completed/verified and have a vendor assigned
    const requestQuery = {
        status: { $in: ['completed', 'verified'] },
        assignedTo: { $ne: null },
        assignedToModel: 'Vendor',
        property: propertyFilter._id ? propertyFilter._id.$in || propertyFilter._id : { $exists: true }
    };

    if (vendorId) requestQuery.assignedTo = vendorId;
    if (startDate || endDate) {
        requestQuery.resolvedAt = {}; // Filter by resolution date
        if (startDate) requestQuery.resolvedAt.$gte = new Date(startDate);
        if (endDate) requestQuery.resolvedAt.$lte = new Date(endDate);
    }

    const requests = await Request.find(requestQuery)
        .populate('assignedTo', 'name email') // Populate vendor details
        .select('assignedTo createdAt resolvedAt feedback.rating');

    // Group requests by vendor and calculate metrics
    const vendorPerformance = {};

    requests.forEach(req => {
        const vendorId = req.assignedTo?._id.toString();
        if (!vendorId) return;

        if (!vendorPerformance[vendorId]) {
            vendorPerformance[vendorId] = {
                vendorName: req.assignedTo.name || req.assignedTo.email,
                totalRequests: 0,
                totalResolutionTimeMs: 0,
                totalRating: 0,
                ratedRequests: 0,
            };
        }

        vendorPerformance[vendorId].totalRequests++;

        if (req.createdAt && req.resolvedAt) {
            const resolutionTime = req.resolvedAt.getTime() - req.createdAt.getTime();
            vendorPerformance[vendorId].totalResolutionTimeMs += resolutionTime;
        }

        if (req.feedback && req.feedback.rating) {
            vendorPerformance[vendorId].totalRating += req.feedback.rating;
            vendorPerformance[vendorId].ratedRequests++;
        }
    });

    // Calculate averages and format output
    const reportData = Object.values(vendorPerformance).map(data => ({
        vendorName: data.vendorName,
        totalRequests: data.totalRequests,
        averageResolutionTimeHours: data.totalRequests > 0 ? (data.totalResolutionTimeMs / data.totalRequests / (1000 * 60 * 60)).toFixed(2) : 'N/A', // Convert ms to hours
        averageRating: data.ratedRequests > 0 ? (data.totalRating / data.ratedRequests).toFixed(2) : 'N/A',
    }));

    res.status(200).json(reportData);
});

/**
 * @desc    Report on most frequent issue categories
 * @route   GET /api/reports/common-issues
 * @access  Private (Admin, PropertyManager, Landlord)
 */
exports.getCommonIssuesReport = asyncHandler(async (req, res) => {
    // if (handleValidationErrors(req, res)) return;

    const { propertyId, startDate, endDate } = req.query;
    const userRole = req.user.role;
    const userId = req.user._id;

    let matchFilter = {};
    if (userRole === 'landlord' || userRole === 'propertymanager') {
        const userAssociatedProperties = await PropertyUser.find({
            user: userId,
            roles: { $in: ['landlord', 'propertymanager'] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return res.status(200).json([]);
        }
        matchFilter.property = { $in: userAssociatedProperties };
    } else if (userRole !== 'admin') {
        res.status(403);
        throw new Error('Not authorized to view common issues reports.');
    }

    if (propertyId) {
        if (matchFilter.property && !matchFilter.property.$in.includes(propertyId)) {
             res.status(403);
             throw new Error('Not authorized to view reports for this property.');
        }
        matchFilter.property = mongoose.Types.ObjectId(propertyId); // Ensure ObjectId for aggregation pipeline
    }

    if (startDate || endDate) {
        matchFilter.createdAt = {};
        if (startDate) matchFilter.createdAt.$gte = new Date(startDate);
        if (endDate) matchFilter.createdAt.$lte = new Date(endDate);
    }

    const commonIssues = await Request.aggregate([
        { $match: matchFilter },
        {
            $group: {
                _id: '$category', // Group by category
                count: { $sum: 1 }, // Count requests in each category
                averageResolutionTimeMs: {
                    $avg: {
                        $cond: [
                            { $and: ['$createdAt', '$resolvedAt'] },
                            { $subtract: ['$resolvedAt', '$createdAt'] },
                            null
                        ]
                    }
                }
            }
        },
        { $sort: { count: -1 } }, // Sort by most frequent
        {
            $project: {
                _id: 0, // Exclude _id
                category: '$_id',
                count: 1,
                averageResolutionTimeHours: { $divide: ['$averageResolutionTimeMs', 1000 * 60 * 60] } // Convert ms to hours
            }
        }
    ]);

    res.status(200).json(commonIssues);
});
