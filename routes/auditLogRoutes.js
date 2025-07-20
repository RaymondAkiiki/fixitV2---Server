const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const auditController = require('../controllers/auditLogController');
const asyncHandler = require('../utils/asyncHandler');

/**
 * @route   GET /api/audit-logs
 * @desc    Get all audit logs with filtering and pagination
 * @access  Admin only
 */
router.get(
  '/',
  protect,
  authorizeRoles('admin'),
  auditController.getAuditLogs
);

/**
 * @route   GET /api/audit-logs/:id
 * @desc    Get a single audit log by ID
 * @access  Admin only
 */
router.get(
  '/:id',
  protect,
  authorizeRoles('admin'),
  auditController.getAuditLogById
);

/**
 * @route   GET /api/audit-logs/resources/:resourceType/:resourceId
 * @desc    Get audit history for a specific resource
 * @access  Admin only
 */
router.get(
  '/resources/:resourceType/:resourceId',
  protect,
  authorizeRoles('admin'),
  auditController.getResourceHistory
);

// Enhanced routes for additional functionality

/**
 * @route   GET /api/audit-logs/users/:userId
 * @desc    Get all audit logs for a specific user
 * @access  Admin only
 */
router.get(
  '/users/:userId',
  protect,
  authorizeRoles('admin'),
  asyncHandler(async (req, res) => {
    const options = {
      userId: req.params.userId,
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
  })
);

/**
 * @route   GET /api/audit-logs/actions/:action
 * @desc    Get all audit logs for a specific action type
 * @access  Admin only
 */
router.get(
  '/actions/:action',
  protect,
  authorizeRoles('admin'),
  asyncHandler(async (req, res) => {
    const options = {
      action: req.params.action,
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
  })
);

/**
 * @route   GET /api/audit-logs/dashboard/summary
 * @desc    Get summary statistics for the admin dashboard
 * @access  Admin only
 */
router.get(
  '/dashboard/summary',
  protect,
  authorizeRoles('admin'),
  asyncHandler(async (req, res) => {
    // Get date range from query params or default to last 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (parseInt(req.query.days) || 30));
    
    // Execute aggregation for activity summary
    const activitySummary = await AuditLog.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    // Get total count for the period
    const totalActions = await AuditLog.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    // Get error count
    const errorCount = await AuditLog.countDocuments({
      status: 'failure',
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    res.status(200).json({
      success: true,
      data: {
        totalActions,
        errorCount,
        errorRate: totalActions > 0 ? (errorCount / totalActions * 100).toFixed(2) + '%' : '0%',
        activitySummary,
        period: {
          startDate,
          endDate,
          days: parseInt(req.query.days) || 30
        }
      }
    });
  })
);

module.exports = router;