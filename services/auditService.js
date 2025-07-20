const AuditLog = require('../models/auditLog');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * Creates a new audit log entry.
 * This service is designed to be called from controllers or services.
 * It is robust and will not throw errors up to the main process.
 *
 * @param {object} logData - The audit log data
 * @param {string} logData.action - The action being audited (must be from AUDIT_ACTION_ENUM)
 * @param {string|null} [logData.user] - The user ID performing the action (null for system actions)
 * @param {string|null} [logData.resourceType] - The type of resource being acted upon (from AUDIT_RESOURCE_TYPE_ENUM)
 * @param {string|null} [logData.resourceId] - The ID of the resource being acted upon
 * @param {object|null} [logData.oldValue] - The previous state of the resource (for update operations)
 * @param {object|null} [logData.newValue] - The new state of the resource
 * @param {string|null} [logData.ipAddress] - The IP address of the client
 * @param {string|null} [logData.userAgent] - The user agent of the client
 * @param {string|null} [logData.externalUserIdentifier] - For actions by non-authenticated users
 * @param {object} [logData.metadata] - Additional contextual information
 * @param {string} [logData.status='success'] - The status of the action (success/failure)
 * @param {string|null} [logData.errorMessage] - Error message if status is 'failure'
 * @param {string|null} [logData.description] - Human-readable description of the action
 * @returns {Promise<object|null>} The created audit log entry, or null if creation failed
 */
const createAuditLog = async (logData) => {
    try {
        // Validate required fields
        if (!logData.action) {
            logger.warn('Audit log creation attempted without an action');
            return null;
        }

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

        const savedEntry = await auditLogEntry.save();
        
        logger.info(
            `Audit Log: Action '${savedEntry.action}' by ${
                savedEntry.user ? `user '${savedEntry.user}'` : 'System'
            } on '${savedEntry.resourceType || 'N/A'}:${
                savedEntry.resourceId || 'N/A'
            }' - Status: ${savedEntry.status}`
        );
        
        return savedEntry;
    } catch (error) {
        logger.error(
            `CRITICAL: Failed to create audit log for action '${logData.action}': ${
                error && error.message ? error.message : error
            }`
        );
        return null;
    }
};

/**
 * Retrieves audit logs with filtering and pagination.
 * 
 * @param {object} options - Query options
 * @param {string} [options.userId] - Filter by user ID
 * @param {string} [options.resourceType] - Filter by resource type
 * @param {string} [options.resourceId] - Filter by resource ID
 * @param {string} [options.action] - Filter by action
 * @param {string} [options.status] - Filter by status
 * @param {Date|string} [options.startDate] - Filter logs created after this date
 * @param {Date|string} [options.endDate] - Filter logs created before this date
 * @param {number} [options.page=1] - Page number for pagination
 * @param {number} [options.limit=20] - Number of results per page
 * @param {string} [options.sortBy='createdAt'] - Field to sort by
 * @param {string} [options.sortOrder='desc'] - Sort order ('asc' or 'desc')
 * @returns {Promise<{logs: Array, total: number, page: number, limit: number, totalPages: number}>}
 * @throws {AppError} If query fails
 */
const getAuditLogs = async (options = {}) => {
    try {
        const {
            userId,
            resourceType,
            resourceId,
            action,
            status,
            startDate,
            endDate,
            page = 1,
            limit = 20,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = options;

        // Build filter query
        const query = {};
        
        if (userId) query.user = userId;
        if (resourceType) query.resourceType = resourceType;
        if (resourceId) query.resourceId = resourceId;
        if (action) query.action = action;
        if (status) query.status = status;
        
        // Date range filtering
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        // Calculate pagination
        const skip = (Math.max(1, page) - 1) * limit;
        
        // Sort configuration
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Execute query with pagination
        const logs = await AuditLog.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .populate('user', 'firstName lastName email')
            .lean();

        // Get total count for pagination
        const total = await AuditLog.countDocuments(query);
        const totalPages = Math.ceil(total / limit);

        return {
            logs,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages
        };
    } catch (error) {
        logger.error(`Error retrieving audit logs: ${error.message}`, error);
        throw new AppError(`Failed to retrieve audit logs: ${error.message}`, 500);
    }
};

/**
 * Retrieves a single audit log entry by ID.
 * 
 * @param {string} id - The audit log ID
 * @returns {Promise<object|null>} The audit log entry or null if not found
 * @throws {AppError} If query fails
 */
const getAuditLogById = async (id) => {
    try {
        const log = await AuditLog.findById(id)
            .populate('user', 'firstName lastName email')
            .lean();
        
        return log;
    } catch (error) {
        logger.error(`Error retrieving audit log by ID ${id}: ${error.message}`, error);
        throw new AppError(`Failed to retrieve audit log: ${error.message}`, 500);
    }
};

/**
 * Retrieves audit history for a specific resource.
 * 
 * @param {string} resourceType - The type of resource
 * @param {string} resourceId - The ID of the resource
 * @param {object} options - Query options
 * @param {number} [options.limit=50] - Number of results to return
 * @returns {Promise<Array>} Array of audit log entries
 * @throws {AppError} If query fails
 */
const getResourceHistory = async (resourceType, resourceId, options = {}) => {
    try {
        const { limit = 50 } = options;
        
        const history = await AuditLog.find({
            resourceType,
            resourceId
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('user', 'firstName lastName email')
        .lean();
        
        return history;
    } catch (error) {
        logger.error(
            `Error retrieving history for ${resourceType}:${resourceId}: ${error.message}`,
            error
        );
        throw new AppError(`Failed to retrieve resource history: ${error.message}`, 500);
    }
};

/**
 * Creates a standardized audit log entry for CRUD operations.
 * 
 * @param {string} action - The CRUD action (CREATE, UPDATE, DELETE, etc.)
 * @param {string} resourceType - The type of resource
 * @param {string|null} resourceId - The ID of the resource
 * @param {object} context - Request context
 * @param {string|null} [context.userId] - The user ID performing the action
 * @param {string|null} [context.ipAddress] - The IP address
 * @param {string|null} [context.userAgent] - The user agent
 * @param {object|null} [context.oldValue] - Previous state (for updates)
 * @param {object|null} [context.newValue] - New state
 * @param {string|null} [context.description] - Description of the action
 * @param {object} [context.metadata] - Additional metadata
 * @returns {Promise<object|null>} The created audit log entry or null if creation failed
 */
const logActivity = async (action, resourceType, resourceId, context = {}) => {
    const logData = {
        action,
        resourceType,
        resourceId,
        user: context.userId || null,
        ipAddress: context.ipAddress || null,
        userAgent: context.userAgent || null,
        oldValue: context.oldValue || null,
        newValue: context.newValue || null,
        description: context.description || null,
        metadata: context.metadata || {},
        status: context.status || 'success',
        errorMessage: context.errorMessage || null,
        externalUserIdentifier: context.externalUserIdentifier || null,
    };
    
    return await createAuditLog(logData);
};

/**
 * Logs system errors or exceptions.
 * 
 * @param {Error} error - The error object
 * @param {string} context - Context information about where the error occurred
 * @param {string|null} [userId] - The user ID if available
 * @returns {Promise<object|null>} The created audit log entry or null if creation failed
 */
const logError = async (error, context, userId = null) => {
    const logData = {
        action: 'ERROR',
        resourceType: 'System',
        user: userId,
        description: `Error in ${context}: ${error.message}`,
        errorMessage: error.message,
        metadata: {
            stack: error.stack,
            context
        },
        status: 'failure'
    };
    
    return await createAuditLog(logData);
};

module.exports = {
    createAuditLog,
    getAuditLogs,
    getAuditLogById,
    getResourceHistory,
    logActivity,
    logError
};