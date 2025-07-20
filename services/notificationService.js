// src/services/notificationService.js

const emailService = require('./emailService');
const smsService = require('./smsService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const Notification = require('../models/notification');
const User = require('../models/user');
const PropertyUser = require('../models/propertyUser');
const { NOTIFICATION_TYPE_ENUM, AUDIT_RESOURCE_TYPE_ENUM, AUDIT_ACTION_ENUM } = require('../utils/constants/enums');
const auditService = require('./auditService');

/**
 * Fetches notifications for a given user, with optional filters and pagination.
 * @param {string} userId - The ID of the user whose notifications to fetch
 * @param {Object} [filters={}] - Optional filters
 * @param {string} [filters.readStatus] - Filter by read status ('read', 'unread')
 * @param {string} [filters.type] - Filter by notification type
 * @param {Date|string} [filters.startDate] - Filter by start date
 * @param {Date|string} [filters.endDate] - Filter by end date
 * @param {number} [page=1] - Page number for pagination
 * @param {number} [limit=10] - Number of items per page
 * @returns {Promise<Object>} Object with notifications, total count, page, and limit
 * @throws {AppError} If userId is missing or invalid filters are provided
 */
async function getNotifications(userId, filters = {}, page = 1, limit = 10) {
    if (!userId) {
        throw new AppError('User ID is required to fetch notifications.', 400);
    }

    // Build the query
    let query = { recipient: userId };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Apply filters
    if (filters.readStatus) {
        if (filters.readStatus === 'read') {
            query.read = true;
        } else if (filters.readStatus === 'unread') {
            query.read = false;
        }
    }
    
    if (filters.type) {
        if (!NOTIFICATION_TYPE_ENUM.includes(filters.type)) {
            throw new AppError(`Invalid notification type filter: ${filters.type}`, 400);
        }
        query.type = filters.type;
    }
    
    if (filters.startDate || filters.endDate) {
        query.sentAt = {};
        if (filters.startDate) {
            query.sentAt.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
            query.sentAt.$lte = new Date(filters.endDate);
        }
    }

    try {
        // Execute query with pagination
        const notifications = await Notification.find(query)
            .sort({ sentAt: -1 }) // Most recent first
            .limit(parseInt(limit))
            .skip(skip)
            .populate('sender', 'firstName lastName email')
            .lean();

        const total = await Notification.countDocuments(query);
        const unreadCount = await Notification.countDocuments({
            ...query,
            read: false
        });

        logger.info(`Fetched ${notifications.length} notifications for user ${userId}`);
        
        return {
            notifications,
            total,
            unreadCount,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / parseInt(limit))
        };
    } catch (error) {
        logger.error(`Failed to fetch notifications for user ${userId}: ${error.message}`, error);
        throw new AppError('Failed to retrieve notifications.', 500);
    }
}

/**
 * Get a single notification by ID
 * @param {string} notificationId - Notification ID
 * @param {Object} currentUser - Current authenticated user
 * @returns {Promise<Object>} The notification document
 * @throws {AppError} If notification not found or user not authorized
 */
async function getNotificationById(notificationId, currentUser) {
    try {
        const notification = await Notification.findById(notificationId)
            .populate('sender', 'firstName lastName email')
            .lean();
        
        if (!notification) {
            throw new AppError('Notification not found.', 404);
        }
        
        // Authorization check - user can only view their own notifications unless admin
        if (notification.recipient.toString() !== currentUser._id.toString() && 
            currentUser.role !== 'admin') {
            throw new AppError('Not authorized to view this notification.', 403);
        }
        
        return notification;
    } catch (error) {
        if (error instanceof AppError) throw error;
        logger.error(`Failed to get notification ${notificationId}: ${error.message}`);
        throw new AppError('Failed to retrieve notification.', 500);
    }
}

/**
 * Mark a notification as read
 * @param {string} notificationId - Notification ID
 * @param {Object} currentUser - Current authenticated user
 * @param {string} [ipAddress] - IP address for audit log
 * @returns {Promise<Object>} Updated notification
 * @throws {AppError} If notification not found or user not authorized
 */
async function markNotificationAsRead(notificationId, currentUser, ipAddress) {
    try {
        const notification = await Notification.findById(notificationId);
        
        if (!notification) {
            throw new AppError('Notification not found.', 404);
        }
        
        // Authorization check - user can only mark their own notifications as read
        if (notification.recipient.toString() !== currentUser._id.toString()) {
            throw new AppError('Not authorized to modify this notification.', 403);
        }
        
        // If already read, return without updating
        if (notification.read) {
            return notification;
        }
        
        // Mark as read and save
        notification.read = true;
        notification.readAt = new Date();
        
        const updatedNotification = await notification.save();
        
        // Log the action
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Notification,
            notification._id,
            {
                userId: currentUser._id,
                ipAddress,
                description: `User marked notification as read`,
                metadata: { notificationId, type: notification.type }
            }
        );
        
        return updatedNotification;
    } catch (error) {
        if (error instanceof AppError) throw error;
        logger.error(`Failed to mark notification ${notificationId} as read: ${error.message}`);
        throw new AppError('Failed to update notification.', 500);
    }
}

/**
 * Mark all notifications as read for a user
 * @param {string} userId - User ID
 * @param {Object} currentUser - Current authenticated user
 * @param {string} [ipAddress] - IP address for audit log
 * @returns {Promise<Object>} Result with modified count
 * @throws {AppError} If user not authorized or operation fails
 */
async function markAllNotificationsAsRead(userId, currentUser, ipAddress) {
    try {
        // Authorization check - user can only mark their own notifications as read
        if (userId.toString() !== currentUser._id.toString() && currentUser.role !== 'admin') {
            throw new AppError('Not authorized to modify notifications for this user.', 403);
        }
        
        // Update all unread notifications
        const result = await Notification.updateMany(
            { recipient: userId, read: false },
            { $set: { read: true, readAt: new Date() } }
        );
        
        // Log the action
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.UPDATE,
            AUDIT_RESOURCE_TYPE_ENUM.Notification,
            null,
            {
                userId: currentUser._id,
                ipAddress,
                description: `User marked all notifications as read`,
                metadata: { modifiedCount: result.modifiedCount }
            }
        );
        
        return result;
    } catch (error) {
        if (error instanceof AppError) throw error;
        logger.error(`Failed to mark all notifications as read for user ${userId}: ${error.message}`);
        throw new AppError('Failed to update notifications.', 500);
    }
}

/**
 * Delete a notification
 * @param {string} notificationId - Notification ID
 * @param {Object} currentUser - Current authenticated user
 * @param {string} [ipAddress] - IP address for audit log
 * @returns {Promise<void>}
 * @throws {AppError} If notification not found or user not authorized
 */
async function deleteNotification(notificationId, currentUser, ipAddress) {
    try {
        const notification = await Notification.findById(notificationId);
        
        if (!notification) {
            throw new AppError('Notification not found.', 404);
        }
        
        // Authorization check - user can only delete their own notifications unless admin
        if (notification.recipient.toString() !== currentUser._id.toString() && 
            currentUser.role !== 'admin') {
            throw new AppError('Not authorized to delete this notification.', 403);
        }
        
        // Store notification data for audit log
        const notificationData = notification.toObject();
        
        // Delete the notification
        await notification.deleteOne();
        
        // Log the action
        await auditService.logActivity(
            AUDIT_ACTION_ENUM.DELETE,
            AUDIT_RESOURCE_TYPE_ENUM.Notification,
            notificationId,
            {
                userId: currentUser._id,
                ipAddress,
                description: `User deleted notification`,
                metadata: { 
                    notificationType: notification.type,
                    sentAt: notification.sentAt
                },
                oldValue: notificationData
            }
        );
    } catch (error) {
        if (error instanceof AppError) throw error;
        logger.error(`Failed to delete notification ${notificationId}: ${error.message}`);
        throw new AppError('Failed to delete notification.', 500);
    }
}

/**
 * Creates an in-app notification.
 * @param {string} recipientId - The ID of the user receiving the notification
 * @param {string} type - Notification type from NOTIFICATION_TYPE_ENUM
 * @param {string} message - The notification message
 * @param {Object} relatedResource - Object with kind and item properties
 * @param {string} [link=null] - Optional link for the notification
 * @param {Object} [contextData={}] - Optional additional context data
 * @param {string} [senderId=null] - Optional ID of the user who initiated the notification
 * @returns {Promise<Object>} The created notification document
 * @throws {AppError} If validation fails or there's a database error
 */
async function createInAppNotification(
    recipientId,
    type,
    message,
    relatedResource,
    link = null,
    contextData = {},
    senderId = null
) {
    try {
        // Basic validation
        if (!recipientId || !type || !message || !relatedResource || !relatedResource.kind || !relatedResource.item) {
            throw new AppError('Missing required fields for in-app notification.', 400);
        }

        // Ensure the type is a valid enum value
        if (!NOTIFICATION_TYPE_ENUM.includes(type)) {
            logger.warn(`Invalid notification type "${type}" provided for in-app notification.`);
        }

        // Ensure relatedResource.kind is a valid enum value
        if (!Object.values(AUDIT_RESOURCE_TYPE_ENUM).includes(relatedResource.kind)) {
            logger.warn(`Invalid related resource kind "${relatedResource.kind}" provided for in-app notification.`);
        }

        const newNotification = new Notification({
            recipient: recipientId,
            sender: senderId,
            message: message,
            link: link,
            type: type,
            relatedResource: {
                kind: relatedResource.kind,
                item: relatedResource.item,
            },
            contextData: contextData,
            sentAt: new Date(), // Mark as sent immediately upon creation
            read: false,
            readAt: null
        });

        const createdNotification = await newNotification.save();
        logger.info(`In-app notification created for recipient ${recipientId} with type "${type}".`);
        return createdNotification;
    } catch (err) {
        logger.error(`Failed to create in-app notification for recipient ${recipientId}: ${err.message}`);
        if (err.name === 'ValidationError') {
            throw new AppError(`Notification validation failed: ${err.message}`, 400);
        }
        throw err;
    }
}

/**
 * Send a notification via email, SMS, and/or in-app based on user preferences
 * @param {Object} options - Notification options
 * @param {string} options.recipientId - User ID to notify
 * @param {string} options.type - Notification type from NOTIFICATION_TYPE_ENUM
 * @param {string} options.message - Notification message for in-app
 * @param {string} [options.link] - Optional link for notification
 * @param {string} options.relatedResourceType - Related resource type
 * @param {string} options.relatedResourceId - Related resource ID
 * @param {Object} [options.emailDetails] - Email details if sending email
 * @param {string} [options.emailDetails.subject] - Email subject
 * @param {string} [options.emailDetails.html] - Email HTML content
 * @param {string} [options.emailDetails.text] - Email text content
 * @param {Object} [options.smsDetails] - SMS details if sending SMS
 * @param {string} [options.smsDetails.message] - SMS message text
 * @param {string} [options.senderId] - ID of user sending the notification
 * @param {string[]} [options.channels] - Override notification channels
 * @returns {Promise<Object>} Result with success status and channel results
 */
async function sendNotification({
    recipientId,
    type,
    message,
    link,
    relatedResourceType,
    relatedResourceId,
    emailDetails,
    smsDetails,
    senderId = null,
    channels = null
}) {
    try {
        const results = {
            inApp: null,
            email: null,
            sms: null,
            success: false
        };
        
        // Get recipient information
        const recipient = await User.findById(recipientId).select('email phone preferences');
        
        if (!recipient) {
            logger.warn(`Cannot send notification: Recipient ${recipientId} not found`);
            throw new AppError('Recipient not found.', 404);
        }
        
        // Determine channels to use based on user preferences or override
        const userChannels = channels || 
                            (recipient.preferences?.notificationChannels || ['in_app', 'email']);
        
        const useInApp = userChannels.includes('in_app');
        const useEmail = userChannels.includes('email') && recipient.email && emailDetails;
        const useSms = userChannels.includes('sms') && recipient.phone && smsDetails;
        
        // Create in-app notification
        if (useInApp) {
            try {
                results.inApp = await createInAppNotification(
                    recipientId,
                    type,
                    message,
                    { kind: relatedResourceType, item: relatedResourceId },
                    link,
                    {},
                    senderId
                );
                logger.info(`In-app notification sent to user ${recipientId}`);
            } catch (error) {
                logger.error(`Failed to create in-app notification: ${error.message}`);
                results.inApp = { error: error.message };
            }
        }
        
        // Send email notification
        if (useEmail) {
            try {
                results.email = await emailService.sendEmail({
                    to: recipient.email,
                    subject: emailDetails.subject,
                    html: emailDetails.html,
                    text: emailDetails.text || (emailDetails.html ? emailDetails.html.replace(/<[^>]*>?/gm, '') : message)
                });
                logger.info(`Email notification sent to ${recipient.email}`);
            } catch (error) {
                logger.error(`Failed to send email notification: ${error.message}`);
                results.email = { error: error.message };
            }
        }
        
        // Send SMS notification
        if (useSms) {
            try {
                results.sms = await smsService.sendSms(
                    recipient.phone, 
                    smsDetails.message || message
                );
                logger.info(`SMS notification sent to ${recipient.phone}`);
            } catch (error) {
                logger.error(`Failed to send SMS notification: ${error.message}`);
                results.sms = { error: error.message };
            }
        }
        
        // Set overall success
        results.success = (useInApp && !results.inApp?.error) || 
                          (useEmail && !results.email?.error) || 
                          (useSms && !results.sms?.error);
        
        return results;
    } catch (error) {
        logger.error(`Failed to send notification to ${recipientId}: ${error.message}`);
        throw new AppError(`Failed to send notification: ${error.message}`, 500);
    }
}

/**
 * Send a bulk notification to multiple recipients
 * @param {Object} options - Bulk notification options
 * @param {string} options.type - Notification type
 * @param {string} options.message - Notification message
 * @param {string} [options.link] - Optional link
 * @param {string} options.relatedResourceType - Related resource type
 * @param {string} options.relatedResourceId - Related resource ID
 * @param {Object} [options.emailDetails] - Email details
 * @param {Object} [options.smsDetails] - SMS details
 * @param {Array<string>} options.recipientIds - Array of recipient user IDs
 * @param {string} [options.senderId] - ID of sender
 * @param {string[]} [options.channels] - Override channels for all recipients
 * @returns {Promise<Object>} Results summary
 */
async function sendBulkNotification({
    type,
    message,
    link,
    relatedResourceType,
    relatedResourceId,
    emailDetails,
    smsDetails,
    recipientIds,
    senderId = null,
    channels = null
}) {
    if (!type || !message || !relatedResourceType || !relatedResourceId || !recipientIds || !Array.isArray(recipientIds)) {
        throw new AppError('Required parameters missing for bulk notification.', 400);
    }
    
    const results = {
        total: recipientIds.length,
        successful: 0,
        failed: 0,
        details: []
    };
    
    // Process each recipient sequentially to avoid rate limiting
    for (const recipientId of recipientIds) {
        try {
            const notificationResult = await sendNotification({
                recipientId,
                type,
                message,
                link,
                relatedResourceType,
                relatedResourceId,
                emailDetails,
                smsDetails,
                senderId,
                channels
            });
            
            results.details.push({
                recipientId,
                success: notificationResult.success,
                channels: {
                    inApp: notificationResult.inApp ? true : false,
                    email: notificationResult.email ? true : false,
                    sms: notificationResult.sms ? true : false
                }
            });
            
            if (notificationResult.success) {
                results.successful++;
            } else {
                results.failed++;
            }
        } catch (error) {
            logger.error(`Failed to send notification to recipient ${recipientId}: ${error.message}`);
            results.details.push({
                recipientId,
                success: false,
                error: error.message
            });
            results.failed++;
        }
        
        // Add small delay between sends if large batch
        if (recipientIds.length > 10) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    return results;
}

/**
 * Get user's notification preferences
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User's notification preferences
 */
async function getUserNotificationPreferences(userId) {
    try {
        const user = await User.findById(userId).select('preferences');
        
        if (!user) {
            throw new AppError('User not found', 404);
        }
        
        return {
            channels: user.preferences?.notificationChannels || ['in_app', 'email'],
            emailSettings: user.preferences?.emailNotifications || {},
            smsSettings: user.preferences?.smsNotifications || {}
        };
    } catch (error) {
        logger.error(`Error getting notification preferences for user ${userId}: ${error.message}`);
        if (error instanceof AppError) throw error;
        throw new AppError('Failed to retrieve notification preferences', 500);
    }
}

/**
 * Update user's notification preferences
 * @param {string} userId - User ID
 * @param {Object} preferences - New preferences
 * @param {string[]} [preferences.channels] - Notification channels
 * @param {Object} [preferences.emailSettings] - Email notification settings
 * @param {Object} [preferences.smsSettings] - SMS notification settings
 * @returns {Promise<Object>} Updated preferences
 */
async function updateNotificationPreferences(userId, preferences) {
    try {
        const user = await User.findById(userId);
        
        if (!user) {
            throw new AppError('User not found', 404);
        }
        
        // Initialize preferences object if it doesn't exist
        if (!user.preferences) {
            user.preferences = {};
        }
        
        // Update channels if provided
        if (preferences.channels) {
            user.preferences.notificationChannels = preferences.channels;
        }
        
        // Update email settings if provided
        if (preferences.emailSettings) {
            user.preferences.emailNotifications = {
                ...user.preferences.emailNotifications,
                ...preferences.emailSettings
            };
        }
        
        // Update SMS settings if provided
        if (preferences.smsSettings) {
            user.preferences.smsNotifications = {
                ...user.preferences.smsNotifications,
                ...preferences.smsSettings
            };
        }
        
        await user.save();
        
        return {
            channels: user.preferences.notificationChannels,
            emailSettings: user.preferences.emailNotifications,
            smsSettings: user.preferences.smsNotifications
        };
    } catch (error) {
        logger.error(`Error updating notification preferences for user ${userId}: ${error.message}`);
        if (error instanceof AppError) throw error;
        throw new AppError('Failed to update notification preferences', 500);
    }
}

// --- Specialized notification methods ---

/**
 * Sends a daily digest via email and SMS.
 * @param {Object} options - Digest options
 * @param {Object} options.user - User document
 * @param {string} options.subject - Email subject
 * @param {string} options.html - Email HTML content
 * @param {string} options.text - Email text content
 * @param {string} options.smsText - SMS text
 * @returns {Promise<Object>} Send results
 */
async function sendDailyDigest({ user, subject, html, text, smsText }) {
    try {
        return await sendNotification({
            recipientId: user._id,
            type: 'daily_digest',
            message: text || subject,
            link: null,
            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.User,
            relatedResourceId: user._id,
            emailDetails: {
                subject,
                html,
                text
            },
            smsDetails: {
                message: smsText
            },
            channels: ['email', 'sms'] // Daily digest is typically email/SMS only
        });
    } catch (err) {
        logger.error(`Failed to send daily digest to ${user.email || user.phone}: ${err.message}`);
        throw err;
    }
}

/**
 * Sends a rent reminder to the tenant.
 * @param {Object} options - Reminder options
 * @param {Object} options.tenant - Tenant user document
 * @param {Object} options.property - Property document
 * @param {Object} options.unit - Unit document
 * @param {string} options.billingPeriod - Billing period
 * @param {number} options.amountDue - Amount due
 * @param {Date} options.dueDate - Due date
 * @param {string} options.rentLink - Link to rent details
 * @param {string} options.type - 'due' or 'overdue'
 * @returns {Promise<Object>} Send results
 */
async function sendRentReminder({
    tenant,
    property,
    unit,
    billingPeriod,
    amountDue,
    dueDate,
    rentLink,
    type,
}) {
    try {
        // Generate email content using email templates
        const emailContent = emailService.generateRentReminderEmailContent({
            tenantName: `${tenant.firstName} ${tenant.lastName}`,
            propertyName: property.name,
            unitNumber: unit.unitName,
            billingPeriod,
            amountDue,
            dueDate,
            rentLink,
            type
        });
        
        // Generate SMS content using SMS templates
        const smsMessage = smsTemplates.generateRentReminderSms({
            propertyName: property.name,
            unitNumber: unit.unitName,
            amountDue,
            dueDate,
            type,
            rentLink
        });
        
        return await sendNotification({
            recipientId: tenant._id,
            type: type === 'due' ? 'rent_due' : 'rent_overdue',
            message: `Your rent of ${amountDue} is ${type} for ${property.name} Unit ${unit.unitName}`,
            link: rentLink,
            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Rent,
            relatedResourceId: unit._id, // Using unit ID as we may not have a rent ID
            emailDetails: {
                subject: emailContent.subject,
                html: emailContent.html,
                text: emailContent.text
            },
            smsDetails: {
                message: smsMessage
            }
        });
    } catch (err) {
        logger.error(`Failed to send rent reminder to ${tenant.email || tenant.phone}: ${err.message}`);
        throw err;
    }
}

/**
 * Sends lease expiry notifications to tenant, landlord, and PMs.
 * @param {Object} options - Expiry options
 * @param {Object} options.lease - Lease document (populated)
 * @param {string} options.leaseLink - Link to lease details
 * @returns {Promise<Object>} Results summary
 */
async function sendLeaseExpiry({ lease, leaseLink }) {
    try {
        const { tenant, landlord, property, unit } = lease;
        const propertyName = property?.name || '';
        const unitName = unit?.unitName || '';
        const recipientIds = [];
        
        // Collect recipient IDs
        if (tenant?._id) {
            recipientIds.push(tenant._id.toString());
        }
        
        if (landlord?._id) {
            recipientIds.push(landlord._id.toString());
        }
        
        // Add property managers
        if (property?._id) {
            const PropertyUser = require('../models/propertyUser');
            const pms = await PropertyUser.find({
                property: property._id,
                roles: 'propertymanager',
                isActive: true,
            }).populate('user');
            
            for (const pmEntry of pms) {
                if (pmEntry.user?._id) {
                    recipientIds.push(pmEntry.user._id.toString());
                }
            }
        }
        
        // Generate email content
        const emailContent = emailService.generateLeaseExpiryReminderEmailContent({
            tenantName: tenant ? `${tenant.firstName} ${tenant.lastName}` : 'Tenant',
            propertyName,
            unitNumber: unitName,
            leaseEndDate: lease.leaseEndDate,
            leaseLink
        });
        
        // Generate SMS content
        const smsMessage = smsTemplates.generateLeaseExpirySms({
            propertyName,
            unitNumber: unitName,
            expiryDate: lease.leaseEndDate,
            leaseLink
        });
        
        // Send bulk notification
        return await sendBulkNotification({
            type: 'lease_expiry',
            message: `Lease expiry notice for ${propertyName} Unit ${unitName}`,
            link: leaseLink,
            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Lease,
            relatedResourceId: lease._id,
            emailDetails: {
                subject: emailContent.subject,
                html: emailContent.html,
                text: emailContent.text
            },
            smsDetails: {
                message: smsMessage
            },
            recipientIds
        });
    } catch (err) {
        logger.error(`Failed to send lease expiry notifications: ${err.message}`);
        throw err;
    }
}

/**
 * Sends notification when scheduled maintenance request is generated.
 * @param {Object} options - Notification options
 * @param {Object} options.request - Request document
 * @param {Object} options.schedule - Schedule document
 * @param {string} options.link - Link to request details
 * @returns {Promise<Object>} Send results
 */
async function sendMaintenanceRequestGenerated({ request, schedule, link }) {
    try {
        const recipientIds = [];
        
        // Add assigned person if available
        if (request.assignedTo && request.assignedToModel === 'User') {
            recipientIds.push(request.assignedTo.toString());
        }
        
        // Add property managers and landlords
        if (schedule?.property?._id) {
            const PropertyUser = require('../models/propertyUser');
            const users = await PropertyUser.find({
                property: schedule.property._id,
                roles: { $in: ['propertymanager', 'landlord'] },
                isActive: true,
            }).populate('user');
            
            for (const pu of users) {
                if (pu.user?._id) {
                    recipientIds.push(pu.user._id.toString());
                }
            }
        }
        
        // If request was created by a user, add them too
        if (request.createdBy) {
            recipientIds.push(request.createdBy.toString());
        }
        
        // Remove duplicates
        const uniqueRecipientIds = [...new Set(recipientIds)];
        
        // If vendor is assigned, handle separately (may not have user account)
        if (request.assignedTo && request.assignedToModel === 'Vendor') {
            try {
                const Vendor = require('../models/vendor');
                const vendor = await Vendor.findById(request.assignedTo);
                
                if (vendor?.email) {
                    const emailContent = emailService.generateRequestUpdateEmailContent({
                        requestTitle: request.title,
                        status: request.status,
                        requestLink: link
                    });
                    
                    await emailService.sendEmail({
                        to: vendor.email,
                        subject: emailContent.subject,
                        html: emailContent.html,
                        text: emailContent.text
                    });
                    
                    logger.info(`Email sent to vendor ${vendor.name} (${vendor.email}) for maintenance request ${request._id}`);
                }
                
                if (vendor?.phone) {
                    const smsMessage = smsTemplates.generateRequestUpdateSms({
                        requestTitle: request.title,
                        status: request.status,
                        requestLink: link
                    });
                    
                    await smsService.sendSms(vendor.phone, smsMessage);
                    logger.info(`SMS sent to vendor ${vendor.name} (${vendor.phone}) for maintenance request ${request._id}`);
                }
            } catch (error) {
                logger.error(`Failed to notify vendor for maintenance request: ${error.message}`);
            }
        }
        
        // No recipients to notify
        if (uniqueRecipientIds.length === 0) {
            logger.warn(`No recipients found for maintenance request notification`);
            return { success: false, message: 'No recipients found' };
        }
        
        // Generate notification content
        const emailContent = emailService.generateRequestUpdateEmailContent({
            requestTitle: request.title,
            status: request.status,
            requestLink: link
        });
        
        const smsMessage = smsTemplates.generateRequestUpdateSms({
            requestTitle: request.title,
            status: request.status,
            requestLink: link
        });
        
        // Send bulk notification
        return await sendBulkNotification({
            type: 'maintenance_request',
            message: `Maintenance request "${request.title}" has been generated from scheduled maintenance`,
            link,
            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            relatedResourceId: request._id,
            emailDetails: {
                subject: emailContent.subject,
                html: emailContent.html,
                text: emailContent.text
            },
            smsDetails: {
                message: smsMessage
            },
            recipientIds: uniqueRecipientIds
        });
    } catch (err) {
        logger.error(`Failed to send maintenance request generated notification: ${err.message}`);
        throw err;
    }
}

/**
 * Sends maintenance reminder for overdue requests.
 * @param {Object} options - Reminder options
 * @param {Object} options.request - Request document
 * @param {string} options.link - Link to request details
 * @returns {Promise<Object>} Send results
 */
async function sendMaintenanceReminder({ request, link }) {
    try {
        const recipientIds = [];
        
        // Add assigned person if available
        if (request.assignedTo && request.assignedToModel === 'User') {
            recipientIds.push(request.assignedTo.toString());
        }
        
        // Add reporter if available
        if (request.createdBy) {
            recipientIds.push(request.createdBy.toString());
        }
        
        // Add property managers and landlords
        if (request.property?._id) {
            const PropertyUser = require('../models/propertyUser');
            const users = await PropertyUser.find({
                property: request.property._id,
                roles: { $in: ['propertymanager', 'landlord'] },
                isActive: true,
            }).populate('user');
            
            for (const pu of users) {
                if (pu.user?._id) {
                    recipientIds.push(pu.user._id.toString());
                }
            }
        }
        
        // Remove duplicates
        const uniqueRecipientIds = [...new Set(recipientIds)];
        
        // If vendor is assigned, handle separately
        if (request.assignedTo && request.assignedToModel === 'Vendor') {
            try {
                const Vendor = require('../models/vendor');
                const vendor = await Vendor.findById(request.assignedTo);
                
                if (vendor?.email) {
                    const emailContent = emailService.generateRequestUpdateEmailContent({
                        requestTitle: request.title,
                        status: 'overdue',
                        requestLink: link
                    });
                    
                    await emailService.sendEmail({
                        to: vendor.email,
                        subject: `REMINDER: ${emailContent.subject}`,
                        html: emailContent.html,
                        text: emailContent.text
                    });
                    
                    logger.info(`Reminder email sent to vendor ${vendor.name} for maintenance request ${request._id}`);
                }
                
                if (vendor?.phone) {
                    const smsMessage = smsTemplates.generateRequestUpdateSms({
                        requestTitle: request.title,
                        status: 'overdue',
                        requestLink: link
                    });
                    
                    await smsService.sendSms(vendor.phone, smsMessage);
                    logger.info(`Reminder SMS sent to vendor ${vendor.name} for maintenance request ${request._id}`);
                }
            } catch (error) {
                logger.error(`Failed to send reminder to vendor: ${error.message}`);
            }
        }
        
        // No recipients to notify
        if (uniqueRecipientIds.length === 0) {
            logger.warn(`No recipients found for maintenance reminder notification`);
            return { success: false, message: 'No recipients found' };
        }
        
        // Generate email content
        const emailContent = emailService.generateRequestUpdateEmailContent({
            requestTitle: request.title,
            status: 'overdue',
            requestLink: link
        });
        
        // Generate SMS content
        const smsMessage = smsTemplates.generateRequestUpdateSms({
            requestTitle: request.title,
            status: 'overdue',
            requestLink: link
        });
        
        // Send bulk notification
        return await sendBulkNotification({
            type: 'maintenance_reminder',
            message: `REMINDER: Maintenance request "${request.title}" is overdue`,
            link,
            relatedResourceType: AUDIT_RESOURCE_TYPE_ENUM.Request,
            relatedResourceId: request._id,
            emailDetails: {
                subject: `REMINDER: ${emailContent.subject}`,
                html: emailContent.html,
                text: emailContent.text
            },
            smsDetails: {
                message: `REMINDER: ${smsMessage}`
            },
            recipientIds: uniqueRecipientIds
        });
    } catch (err) {
        logger.error(`Failed to send maintenance reminder: ${err.message}`);
        throw err;
    }
}

module.exports = {
    // Basic notification operations
    getNotifications,
    getNotificationById,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    createInAppNotification,
    
    // Generic notification sending
    sendNotification,
    sendBulkNotification,
    
    // User preference management
    getUserNotificationPreferences,
    updateNotificationPreferences,
    
    // Specialized notification types
    sendDailyDigest,
    sendRentReminder,
    sendLeaseExpiry,
    sendMaintenanceRequestGenerated,
    sendMaintenanceReminder
};