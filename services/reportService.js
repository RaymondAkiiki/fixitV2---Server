// src/services/reportService.js

const Request = require('../models/request');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Lease = require('../models/lease'); // For lease reports
const Rent = require('../models/rent');     // For rent reports
const Property = require('../models/property');
const User = require('../models/user');
const Vendor = require('../models/vendor');
const PropertyUser = require('../models/propertyUser');
const { createAuditLog } = require('./auditService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { Parser } = require('json2csv'); // For CSV export
const fs = require('fs').promises; // For file system operations (temp files)
const path = require('path'); // For path manipulation
const mongoose = require('mongoose'); // For ObjectId in aggregation

const {
    ROLE_ENUM,
    PROPERTY_USER_ROLES_ENUM,
    REQUEST_STATUS_ENUM,
    SCHEDULED_MAINTENANCE_STATUS_ENUM,
    LEASE_STATUS_ENUM,
    PAYMENT_STATUS_ENUM,
    AUDIT_ACTION_ENUM,
    AUDIT_RESOURCE_TYPE_ENUM,
    CATEGORY_ENUM,
    PRIORITY_ENUM,
    SERVICE_ENUM,
    VENDOR_STATUS_ENUM
} = require('../utils/constants/enums');

/**
 * Helper to check if a user has management permission for a given property.
 * @param {object} user - The authenticated user object.
 * @param {string} propertyId - The ID of the property to check access for.
 * @returns {Promise<boolean>} True if authorized, false otherwise.
 */
const checkPropertyManagementPermission = async (user, propertyId) => {
    if (user.role === ROLE_ENUM.ADMIN) {
        return true; // Admin has global access
    }

    const hasAccess = await PropertyUser.exists({
        user: user._id,
        property: propertyId,
        isActive: true,
        roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] }
    });
    return hasAccess;
};

/**
 * Generates a comprehensive maintenance summary report.
 * Combines data from Request and ScheduledMaintenance collections.
 * @param {object} filters - Filtering criteria.
 * @param {object} user - The authenticated user.
 * @returns {Promise<Array<object>>} Array of combined maintenance data.
 * @throws {AppError} If user not authorized.
 */
const generateMaintenanceSummaryReport = async (filters, user) => {
    let requestFilter = {};
    let scheduledMaintenanceFilter = {};

    // Authorization and filtering based on user role
    if (user.role === ROLE_ENUM.ADMIN) {
        // Admin can see everything
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(user.role)) {
        const userAssociatedProperties = await PropertyUser.find({
            user: user._id,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return []; // No properties managed, no data to show
        }
        requestFilter.property = { $in: userAssociatedProperties };
        scheduledMaintenanceFilter.property = { $in: userAssociatedProperties };
    } else {
        throw new AppError('Not authorized to generate maintenance reports.', 403);
    }

    // Apply common filters
    if (filters.propertyId) {
        // Ensure the user has access to this specific property if filtering
        if (user.role !== ROLE_ENUM.ADMIN && !(await checkPropertyManagementPermission(user, filters.propertyId))) {
            throw new AppError('Not authorized to filter reports by this property.', 403);
        }
        requestFilter.property = filters.propertyId;
        scheduledMaintenanceFilter.property = filters.propertyId;
    }
    if (filters.status) {
        if (!REQUEST_STATUS_ENUM.includes(filters.status.toLowerCase()) && !SCHEDULED_MAINTENANCE_STATUS_ENUM.includes(filters.status.toLowerCase())) {
            throw new AppError(`Invalid status filter: ${filters.status}`, 400);
        }
        requestFilter.status = filters.status.toLowerCase();
        scheduledMaintenanceFilter.status = filters.status.toLowerCase();
    }
    if (filters.category) {
        if (!CATEGORY_ENUM.includes(filters.category.toLowerCase())) {
            throw new AppError(`Invalid category filter: ${filters.category}`, 400);
        }
        requestFilter.category = filters.category.toLowerCase();
        scheduledMaintenanceFilter.category = filters.category.toLowerCase();
    }
    if (filters.assignedToId && filters.assignedToModel) {
        if (!['User', 'Vendor'].includes(filters.assignedToModel)) {
            throw new AppError(`Invalid assignedToModel filter: ${filters.assignedToModel}`, 400);
        }
        requestFilter.assignedTo = filters.assignedToId;
        requestFilter.assignedToModel = filters.assignedToModel;
        scheduledMaintenanceFilter.assignedTo = filters.assignedToId;
        scheduledMaintenanceFilter.assignedToModel = filters.assignedToModel;
    }
    if (filters.startDate || filters.endDate) {
        if (filters.startDate) {
            requestFilter.createdAt = { ...requestFilter.createdAt, $gte: filters.startDate };
            scheduledMaintenanceFilter.scheduledDate = { ...scheduledMaintenanceFilter.scheduledDate, $gte: filters.startDate };
        }
        if (filters.endDate) {
            requestFilter.createdAt = { ...requestFilter.createdAt, $lte: filters.endDate };
            scheduledMaintenanceFilter.scheduledDate = { ...scheduledMaintenanceFilter.scheduledDate, $lte: filters.endDate };
        }
    }

    // Fetch Requests
    const requests = await Request.find(requestFilter)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'firstName lastName email')
        .populate({ path: 'assignedTo', select: 'firstName lastName email name' }); // Populate assigned person (User or Vendor)

    // Fetch Scheduled Maintenance
    const scheduledMaintenance = await ScheduledMaintenance.find(scheduledMaintenanceFilter)
        .populate('property', 'name address')
        .populate('unit', 'unitName')
        .populate('createdBy', 'firstName lastName email')
        .populate({ path: 'assignedTo', select: 'firstName lastName email name' });

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
            propertyAddress: item.property?.address ? `${item.property.address.street}, ${item.property.address.city}, ${item.property.address.country}` : '',
            unitName: item.unit?.unitName,
            createdBy: item.createdBy ? `${item.createdBy.firstName} ${item.createdBy.lastName} (${item.createdBy.email})` : 'N/A',
            assignedTo: item.assignedTo ? (item.assignedTo.name || `${item.assignedTo.firstName} ${item.assignedTo.lastName}`) : 'N/A',
            createdAt: item.createdAt,
            resolvedAt: item.resolvedAt,
            publicLinkEnabled: item.publicLinkEnabled,
            publicToken: item.publicToken,
            feedbackRating: item.feedback?.rating,
            feedbackComment: item.feedback?.comment,
            recurring: 'N/A', // Not applicable for Requests
            frequency: 'N/A', // Not applicable for Requests
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
            propertyAddress: item.property?.address ? `${item.property.address.street}, ${item.property.address.city}, ${item.property.address.country}` : '',
            unitName: item.unit?.unitName,
            createdBy: item.createdBy ? `${item.createdBy.firstName} ${item.createdBy.lastName} (${item.createdBy.email})` : 'N/A',
            assignedTo: item.assignedTo ? (item.assignedTo.name || `${item.assignedTo.firstName} ${item.assignedTo.lastName}`) : 'N/A',
            createdAt: item.createdAt, // Or `scheduledDate` for its primary date
            resolvedAt: item.status === 'completed' ? item.updatedAt : null, // Assuming completion updates updatedAt
            recurring: item.recurring,
            frequency: item.frequency ? JSON.stringify(item.frequency) : 'N/A', // Convert object to string for CSV
            feedbackRating: 'N/A', // Not applicable for Scheduled Maintenance
            feedbackComment: 'N/A', // Not applicable for Scheduled Maintenance
            publicLinkEnabled: item.publicLinkEnabled,
            publicToken: item.publicLinkToken,
        })),
    ];

    // Sort combined data by creation date descending
    combinedData.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.GENERATE_REPORT,
        user: user._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Report,
        description: `User ${user.email} generated maintenance summary report.`,
        status: 'success',
        metadata: { reportType: 'maintenance_summary', filters }
    });

    return combinedData;
};

/**
 * Generates a report on vendor performance.
 * @param {object} filters - Filtering criteria.
 * @param {object} user - The authenticated user.
 * @returns {Promise<Array<object>>} Array of vendor performance data.
 * @throws {AppError} If user not authorized.
 */
const generateVendorPerformanceReport = async (filters, user) => {
    let requestQuery = {
        status: { $in: [REQUEST_STATUS_ENUM.find(s => s === 'completed'), REQUEST_STATUS_ENUM.find(s => s === 'verified')] },
        assignedTo: { $ne: null },
        assignedToModel: 'Vendor', // Ensure we are looking at vendors
    };

    // Authorization and filtering based on user role
    if (user.role === ROLE_ENUM.ADMIN) {
        // Admin can see everything
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(user.role)) {
        const userAssociatedProperties = await PropertyUser.find({
            user: user._id,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return [];
        }
        requestQuery.property = { $in: userAssociatedProperties };
    } else {
        throw new AppError('Not authorized to view vendor performance reports.', 403);
    }

    // Apply filters
    if (filters.propertyId) {
        if (requestQuery.property && !requestQuery.property.$in.map(id => id.toString()).includes(filters.propertyId)) {
            throw new AppError('Not authorized to view reports for this property.', 403);
        }
        requestQuery.property = filters.propertyId;
    }
    if (filters.vendorId) {
        requestQuery.assignedTo = filters.vendorId;
    }
    if (filters.startDate || filters.endDate) {
        requestQuery.resolvedAt = {}; // Filter by resolution date
        if (filters.startDate) requestQuery.resolvedAt.$gte = filters.startDate;
        if (filters.endDate) requestQuery.resolvedAt.$lte = filters.endDate;
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

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.GENERATE_REPORT,
        user: user._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Report,
        description: `User ${user.email} generated vendor performance report.`,
        status: 'success',
        metadata: { reportType: 'vendor_performance', filters }
    });

    return reportData;
};

/**
 * Generates a report on most frequent issue categories.
 * @param {object} filters - Filtering criteria.
 * @param {object} user - The authenticated user.
 * @returns {Promise<Array<object>>} Array of common issues data.
 * @throws {AppError} If user not authorized.
 */
const generateCommonIssuesReport = async (filters, user) => {
    let matchFilter = {};

    // Authorization and filtering based on user role
    if (user.role === ROLE_ENUM.ADMIN) {
        // Admin can see everything
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(user.role)) {
        const userAssociatedProperties = await PropertyUser.find({
            user: user._id,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return [];
        }
        matchFilter.property = { $in: userAssociatedProperties };
    } else {
        throw new AppError('Not authorized to view common issues reports.', 403);
    }

    if (filters.propertyId) {
        if (matchFilter.property && !matchFilter.property.$in.map(id => id.toString()).includes(filters.propertyId)) {
            throw new AppError('Not authorized to view reports for this property.', 403);
        }
        matchFilter.property = new mongoose.Types.ObjectId(filters.propertyId);
    }

    if (filters.startDate || filters.endDate) {
        matchFilter.createdAt = {};
        if (filters.startDate) matchFilter.createdAt.$gte = filters.startDate;
        if (filters.endDate) matchFilter.createdAt.$lte = filters.endDate;
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

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.GENERATE_REPORT,
        user: user._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Report,
        description: `User ${user.email} generated common issues report.`,
        status: 'success',
        metadata: { reportType: 'common_issues', filters }
    });

    return commonIssues;
};

/**
 * Generates a rent collection report.
 * @param {object} filters - Filtering criteria.
 * @param {object} user - The authenticated user.
 * @returns {Promise<Array<object>>} Array of rent collection data.
 * @throws {AppError} If user not authorized.
 */
const generateRentCollectionReport = async (filters, user) => {
    let rentQuery = {};

    // Authorization and filtering based on user role
    if (user.role === ROLE_ENUM.ADMIN) {
        // Admin can see everything
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(user.role)) {
        const userAssociatedProperties = await PropertyUser.find({
            user: user._id,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return [];
        }
        rentQuery.property = { $in: userAssociatedProperties };
    } else {
        throw new AppError('Not authorized to generate rent collection reports.', 403);
    }

    // Apply filters
    if (filters.propertyId) {
        if (rentQuery.property && !rentQuery.property.$in.map(id => id.toString()).includes(filters.propertyId)) {
            throw new AppError('Not authorized to view reports for this property.', 403);
        }
        rentQuery.property = filters.propertyId;
    }
    if (filters.unitId) {
        rentQuery.unit = filters.unitId;
    }
    if (filters.status) {
        if (!PAYMENT_STATUS_ENUM.includes(filters.status.toLowerCase())) {
            throw new AppError(`Invalid payment status filter: ${filters.status}`, 400);
        }
        rentQuery.status = filters.status.toLowerCase();
    }
    if (filters.tenantId) {
        rentQuery.tenant = filters.tenantId;
    }
    if (filters.billingPeriod) { // e.g., "2023-01"
        const [year, month] = filters.billingPeriod.split('-');
        if (!year || !month || isNaN(parseInt(year)) || isNaN(parseInt(month))) {
            throw new AppError('Invalid billingPeriod format. Use YYYY-MM.', 400);
        }
        const startOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
        const endOfMonth = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
        rentQuery.dueDate = { $gte: startOfMonth, $lte: endOfMonth };
    }
    if (filters.startDate || filters.endDate) {
        rentQuery.dueDate = rentQuery.dueDate || {};
        if (filters.startDate) rentQuery.dueDate.$gte = filters.startDate;
        if (filters.endDate) rentQuery.dueDate.$lte = filters.endDate;
    }

    const rents = await Rent.find(rentQuery)
        .populate('lease', 'leaseStartDate leaseEndDate')
        .populate('tenant', 'firstName lastName email')
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .sort({ dueDate: 1 });

    const reportData = rents.map(rent => {
        const daysLate = rent.status === 'overdue' && rent.dueDate ?
            Math.floor((new Date() - rent.dueDate) / (1000 * 60 * 60 * 24)) :
            (rent.status === 'paid' && rent.paymentDate && rent.paymentDate > rent.dueDate ?
                Math.floor((rent.paymentDate - rent.dueDate) / (1000 * 60 * 60 * 24)) : 0);

        return {
            id: rent._id,
            billingPeriod: rent.billingPeriod,
            tenantName: rent.tenant ? `${rent.tenant.firstName} ${rent.tenant.lastName}` : 'N/A',
            tenantEmail: rent.tenant?.email || 'N/A',
            propertyName: rent.property?.name || 'N/A',
            unitName: rent.unit?.unitName || 'N/A',
            amountDue: rent.amountDue,
            amountPaid: rent.amountPaid,
            dueDate: rent.dueDate,
            paymentDate: rent.paymentDate,
            status: rent.status,
            daysLate: daysLate > 0 ? daysLate : 0,
            paymentMethod: rent.paymentMethod,
            transactionId: rent.transactionId,
            notes: rent.notes,
            createdAt: rent.createdAt,
        };
    });

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.GENERATE_REPORT,
        user: user._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Report,
        description: `User ${user.email} generated rent collection report.`,
        status: 'success',
        metadata: { reportType: 'rent_collection', filters }
    });

    return reportData;
};

/**
 * Generates a lease expiry report.
 * @param {object} filters - Filtering criteria.
 * @param {object} user - The authenticated user.
 * @returns {Promise<Array<object>>} Array of lease expiry data.
 * @throws {AppError} If user not authorized.
 */
const generateLeaseExpiryReport = async (filters, user) => {
    let leaseQuery = {};

    // Authorization and filtering based on user role
    if (user.role === ROLE_ENUM.ADMIN) {
        // Admin can see everything
    } else if ([ROLE_ENUM.LANDLORD, ROLE_ENUM.PROPERTY_MANAGER].includes(user.role)) {
        const userAssociatedProperties = await PropertyUser.find({
            user: user._id,
            roles: { $in: [PROPERTY_USER_ROLES_ENUM.LANDLORD, PROPERTY_USER_ROLES_ENUM.PROPERTY_MANAGER, PROPERTY_USER_ROLES_ENUM.ADMIN_ACCESS] },
            isActive: true
        }).distinct('property');

        if (userAssociatedProperties.length === 0) {
            return [];
        }
        leaseQuery.property = { $in: userAssociatedProperties };
    } else {
        throw new AppError('Not authorized to generate lease expiry reports.', 403);
    }

    // Apply filters
    if (filters.propertyId) {
        if (leaseQuery.property && !leaseQuery.property.$in.map(id => id.toString()).includes(filters.propertyId)) {
            throw new AppError('Not authorized to view reports for this property.', 403);
        }
        leaseQuery.property = filters.propertyId;
    }
    if (filters.unitId) {
        leaseQuery.unit = filters.unitId;
    }
    if (filters.status) {
        if (!LEASE_STATUS_ENUM.includes(filters.status.toLowerCase())) {
            throw new AppError(`Invalid lease status filter: ${filters.status}`, 400);
        }
        leaseQuery.status = filters.status.toLowerCase();
    }
    if (filters.tenantId) {
        leaseQuery.tenant = filters.tenantId;
    }
    if (filters.expiryStartDate || filters.expiryEndDate) {
        leaseQuery.leaseEndDate = {};
        if (filters.expiryStartDate) leaseQuery.leaseEndDate.$gte = filters.expiryStartDate;
        if (filters.expiryEndDate) leaseQuery.leaseEndDate.$lte = filters.expiryEndDate;
    }

    const leases = await Lease.find(leaseQuery)
        .populate('tenant', 'firstName lastName email')
        .populate('property', 'name')
        .populate('unit', 'unitName')
        .sort({ leaseEndDate: 1 });

    const reportData = leases.map(lease => {
        const now = new Date();
        const daysUntilExpiry = lease.leaseEndDate ? Math.ceil((lease.leaseEndDate - now) / (1000 * 60 * 60 * 24)) : 'N/A';

        return {
            id: lease._id,
            tenantName: lease.tenant ? `${lease.tenant.firstName} ${lease.tenant.lastName}` : 'N/A',
            tenantEmail: lease.tenant?.email || 'N/A',
            propertyName: lease.property?.name || 'N/A',
            unitName: lease.unit?.unitName || 'N/A',
            leaseStartDate: lease.leaseStartDate,
            leaseEndDate: lease.leaseEndDate,
            monthlyRent: lease.monthlyRent,
            currency: lease.currency,
            status: lease.status,
            daysUntilExpiry: typeof daysUntilExpiry === 'number' ? daysUntilExpiry : 'N/A',
            renewalNoticeSent: lease.renewalNoticeSent,
            lastRenewalNoticeDate: lease.lastRenewalNoticeDate,
            createdAt: lease.createdAt,
        };
    });

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.GENERATE_REPORT,
        user: user._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Report,
        description: `User ${user.email} generated lease expiry report.`,
        status: 'success',
        metadata: { reportType: 'lease_expiry', filters }
    });

    return reportData;
};


/**
 * Exports report data to a specified format (CSV).
 * For PDF, this would typically involve a dedicated PDF generation library.
 * @param {string} reportType - The type of report to export (e.g., 'maintenance_summary', 'rent_collection').
 * @param {object} filters - Filters to apply when generating data.
 * @param {object} user - The user requesting the export.
 * @param {string} format - 'csv' or 'pdf'.
 * @returns {Promise<object>} Object containing filePath, fileName, and mimeType of the generated file.
 * @throws {AppError} If format is unsupported or report generation fails.
 */
const exportReport = async (reportType, filters, user, format) => {
    let data = [];
    let fields = [];
    let fileNamePrefix = reportType.replace(/_/g, '-');

    switch (reportType) {
        case 'maintenance_summary':
            data = await generateMaintenanceSummaryReport(filters, user);
            fields = [
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
                { label: 'Created At', value: (row) => row.createdAt ? row.createdAt.toISOString() : '' },
                { label: 'Resolved At', value: (row) => row.resolvedAt ? row.resolvedAt.toISOString() : '' },
                { label: 'Recurring', value: 'recurring' },
                { label: 'Frequency', value: 'frequency' },
                { label: 'Public Link Enabled', value: 'publicLinkEnabled' },
                { label: 'Public Token', value: 'publicToken' },
                { label: 'Feedback Rating', value: 'feedbackRating' },
                { label: 'Feedback Comment', value: 'feedbackComment' },
            ];
            break;
        case 'vendor_performance':
            data = await generateVendorPerformanceReport(filters, user);
            fields = [
                { label: 'Vendor Name', value: 'vendorName' },
                { label: 'Total Requests', value: 'totalRequests' },
                { label: 'Average Resolution Time (Hours)', value: 'averageResolutionTimeHours' },
                { label: 'Average Rating (1-5)', value: 'averageRating' },
            ];
            break;
        case 'common_issues':
            data = await generateCommonIssuesReport(filters, user);
            fields = [
                { label: 'Category', value: 'category' },
                { label: 'Count', value: 'count' },
                { label: 'Average Resolution Time (Hours)', value: 'averageResolutionTimeHours' },
            ];
            break;
        case 'rent_collection':
            data = await generateRentCollectionReport(filters, user);
            fields = [
                { label: 'ID', value: 'id' },
                { label: 'Billing Period', value: 'billingPeriod' },
                { label: 'Tenant Name', value: 'tenantName' },
                { label: 'Tenant Email', value: 'tenantEmail' },
                { label: 'Property Name', value: 'propertyName' },
                { label: 'Unit Name', value: 'unitName' },
                { label: 'Amount Due', value: 'amountDue' },
                { label: 'Amount Paid', value: 'amountPaid' },
                { label: 'Due Date', value: (row) => row.dueDate ? row.dueDate.toISOString().split('T')[0] : '' },
                { label: 'Payment Date', value: (row) => row.paymentDate ? row.paymentDate.toISOString().split('T')[0] : '' },
                { label: 'Status', value: 'status' },
                { label: 'Days Late', value: 'daysLate' },
                { label: 'Payment Method', value: 'paymentMethod' },
                { label: 'Transaction ID', value: 'transactionId' },
                { label: 'Notes', value: 'notes' },
                { label: 'Created At', value: (row) => row.createdAt ? row.createdAt.toISOString() : '' },
            ];
            break;
        case 'lease_expiry':
            data = await generateLeaseExpiryReport(filters, user);
            fields = [
                { label: 'ID', value: 'id' },
                { label: 'Tenant Name', value: 'tenantName' },
                { label: 'Tenant Email', value: 'tenantEmail' },
                { label: 'Property Name', value: 'propertyName' },
                { label: 'Unit Name', value: 'unitName' },
                { label: 'Lease Start Date', value: (row) => row.leaseStartDate ? row.leaseStartDate.toISOString().split('T')[0] : '' },
                { label: 'Lease End Date', value: (row) => row.leaseEndDate ? row.leaseEndDate.toISOString().split('T')[0] : '' },
                { label: 'Monthly Rent', value: 'monthlyRent' },
                { label: 'Currency', value: 'currency' },
                { label: 'Status', value: 'status' },
                { label: 'Days Until Expiry', value: 'daysUntilExpiry' },
                { label: 'Renewal Notice Sent', value: 'renewalNoticeSent' },
                { label: 'Last Renewal Notice Date', value: (row) => row.lastRenewalNoticeDate ? row.lastRenewalNoticeDate.toISOString().split('T')[0] : '' },
                { label: 'Created At', value: (row) => row.createdAt ? row.createdAt.toISOString() : '' },
            ];
            break;
        default:
            throw new AppError('Unsupported report type for export.', 400);
    }

    let filePath;
    let fileName;
    let mimeType;

    if (format.toLowerCase() === 'csv') {
        const parser = new Parser({ fields });
        const csv = parser.parse(data);
        fileName = `${fileNamePrefix}_report_${Date.now()}.csv`;
        filePath = path.join(__dirname, '../../temp', fileName); // Save to a temp directory
        mimeType = 'text/csv';

        await fs.writeFile(filePath, csv);
    } else if (format.toLowerCase() === 'pdf') {
        // Placeholder for PDF generation. This would require a library like 'pdfkit' or 'html-pdf'
        // and a more complex setup to render data into a PDF document.
        // For now, we'll throw an error as it's outside the scope of direct code generation without specific libraries.
        throw new AppError('PDF export is not yet implemented. Please choose CSV format.', 501);
    } else {
        throw new AppError('Invalid export format. Only "csv" is supported at this time.', 400);
    }

    await createAuditLog({
        action: AUDIT_ACTION_ENUM.EXPORT_REPORT,
        user: user._id,
        resourceType: AUDIT_RESOURCE_TYPE_ENUM.Report,
        description: `User ${user.email} exported ${reportType} report as ${format}.`,
        status: 'success',
        metadata: { reportType, format, filters, fileName }
    });

    return { filePath, fileName, mimeType };
};

module.exports = {
    generateMaintenanceSummaryReport,
    generateVendorPerformanceReport,
    generateCommonIssuesReport,
    generateRentCollectionReport,
    generateLeaseExpiryReport,
    exportReport,
};
