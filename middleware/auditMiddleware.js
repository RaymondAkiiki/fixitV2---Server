const AuditLog = require("../models/auditLog");

/**
 * Helper to log user actions for audit trail
 */
exports.logAction = async (action, userId, targetModel, targetId) => {
  try {
    await AuditLog.create({
      action,
      user: userId,
      targetModel,
      targetId,
    });
  } catch (error) {
    console.error("Failed to log action:", error.message);
  }
};