const express = require('express');
const router = express.Router();

const AuditLog = require('../models/auditLog');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// List all audit logs, with optional query filters (admin only)
router.get(
  '/',
  protect,
  authorizeRoles('admin'),
  async (req, res) => {
    try {
      // Optional filters: action, user, targetModel, targetId, limit
      const {
        action,
        user,
        targetModel,
        targetId,
        limit = 100,
        skip = 0,
        sort = '-createdAt'
      } = req.query;

      const filter = {};
      if (action) filter.action = action;
      if (user) filter.user = user;
      if (targetModel) filter.targetModel = targetModel;
      if (targetId) filter.targetId = targetId;

      const logs = await AuditLog.find(filter)
        .sort(sort)
        .skip(Number(skip))
        .limit(Number(limit));

      res.json(logs);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
      res.status(500).json({ message: 'Failed to fetch audit logs.' });
    }
  }
);

// Get a single audit log entry by ID (admin only)
router.get(
  '/:id',
  protect,
  authorizeRoles('admin'),
  async (req, res) => {
    try {
      const log = await AuditLog.findById(req.params.id);
      if (!log) {
        return res.status(404).json({ message: 'Audit log not found.' });
      }
      res.json(log);
    } catch (err) {
      console.error('Error fetching audit log:', err);
      res.status(500).json({ message: 'Failed to fetch audit log.' });
    }
  }
);

module.exports = router;