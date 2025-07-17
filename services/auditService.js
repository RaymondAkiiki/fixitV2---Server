const AuditLog = require('../models/auditLog');
const logger = require('../utils/logger');

/**
 * Creates a new audit log entry.
 * This service is designed to be called from controllers or services.
 * It is robust and will not throw errors up to the main process.
 *
 * @param {object} logData
 */
const createAuditLog = async (logData) => {
    try {
        const auditLogEntry = new AuditLog({
            action: logData.action,
            user: logData.user || null,
            resourceType: logData.resourceType || null,
            resourceId: logData.resourceId || null,
            oldValue: logData.oldValue || null,
            newValue: logData.newValue || null,
            ipAddress: logData.ipAddress || null,
            userAgent: logData.userAgent || null,
            externalUserIdentifier: logData.externalUserIdentifier || null,
            metadata: logData.metadata || {},
            status: logData.status || 'success',
            errorMessage: logData.errorMessage || null,
            description: typeof logData.description === 'string' ? logData.description : null,
        });
        await auditLogEntry.save();
        logger.info(
            `Audit Log: Action '${auditLogEntry.action}' by user '${auditLogEntry.user || 'System'}' on '${auditLogEntry.resourceType || 'N/A'}:${auditLogEntry.resourceId || 'N/A'}' - Status: ${auditLogEntry.status}`
        );
    } catch (error) {
        logger.error(
            `CRITICAL: Failed to create audit log for action '${logData.action}': ${error && error.message ? error.message : error}`
        );
    }
};

module.exports = {
    createAuditLog,
};