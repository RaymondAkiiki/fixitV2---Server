const auditService = require('../services/auditService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

/**
 * Get audit logs with filtering and pagination
 * @route GET /api/audit-logs
 * @access Admin only
 */
const getAuditLogs = asyncHandler(async (req, res) => {
    const options = {
        userId: req.query.userId,
        resourceType: req.query.resourceType,
        resourceId: req.query.resourceId,
        action: req.query.action,
        status: req.query.status,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
        sortBy: req.query.sortBy || 'createdAt',
        sortOrder: req.query.sortOrder || 'desc'
    };

    const result = await auditService.getAuditLogs(options);
    
    res.status(200).json({
        success: true,
        data: result
    });
});

/**
 * Get a single audit log by ID
 * @route GET /api/audit-logs/:id
 * @access Admin only
 */
const getAuditLogById = asyncHandler(async (req, res) => {
    const log = await auditService.getAuditLogById(req.params.id);
    
    if (!log) {
        throw new AppError('Audit log not found', 404);
    }
    
    res.status(200).json({
        success: true,
        data: log
    });
});

/**
 * Get audit history for a specific resource
 * @route GET /api/audit-logs/resources/:resourceType/:resourceId
 * @access Admin only
 */
const getResourceHistory = asyncHandler(async (req, res) => {
    const { resourceType, resourceId } = req.params;
    const { limit } = req.query;
    
    const history = await auditService.getResourceHistory(
        resourceType, 
        resourceId,
        { limit: parseInt(limit) || 50 }
    );
    
    res.status(200).json({
        success: true,
        data: history
    });
});

module.exports = {
    getAuditLogs,
    getAuditLogById,
    getResourceHistory
};