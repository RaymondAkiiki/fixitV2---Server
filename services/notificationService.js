const emailService = require('./emailService');
const smsService = require('./smsService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const Notification = require('../models/notification'); // Import your Notification model
const { NOTIFICATION_TYPE_ENUM, AUDIT_RESOURCE_TYPE_ENUM } = require('../utils/constants/enums');


/**
 * Sends a daily digest via email and SMS.
 * @param {Object} params
 * @param {Object} params.user - Mongoose user document
 * @param {string} params.subject
 * @param {string} params.html
 * @param {string} params.text
 * @param {string} params.smsText
 */
async function sendDailyDigest({ user, subject, html, text, smsText }) {
    try {
        if (user.email) {
            await emailService.sendEmail({
                to: user.email,
                subject,
                text,
                html,
            });
        }
        if (user.phoneNumber) {
            await smsService.sendSms(user.phoneNumber, smsText);
        }
    } catch (err) {
        logger.error(`Failed to send daily digest to ${user.email || user.phoneNumber}: ${err.message}`);
        throw err;
    }
}

/**
 * Sends a rent reminder to the tenant (email + SMS).
 * @param {Object} params
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
        if (tenant.email) {
            await emailService.sendRentReminderEmail({
                to: tenant.email,
                tenantName: `${tenant.firstName} ${tenant.lastName}`,
                propertyName: property.name,
                unitNumber: unit.unitName,
                billingPeriod,
                amountDue,
                dueDate,
                rentLink,
                type,
            });
        }
        if (tenant.phoneNumber) {
            await smsService.sendRentReminderSms(
                tenant.phoneNumber,
                property.name,
                unit.unitName,
                amountDue,
                dueDate,
                type
            );
        }
    } catch (err) {
        logger.error(`Failed to send rent reminder to ${tenant.email || tenant.phoneNumber}: ${err.message}`);
        throw err;
    }
}

/**
 * Sends lease expiry notifications to tenant, landlord, and PMs.
 * @param {Object} params
 * @param {Object} params.lease - Lease mongoose document (populated)
 * @param {string} params.leaseLink
 */
async function sendLeaseExpiry({ lease, leaseLink }) {
    try {
        const { tenant, landlord, property, unit } = lease;
        const propertyName = property?.name || '';
        const unitName = unit?.unitName || '';

        // Tenant
        if (tenant?.email) {
            await emailService.sendLeaseExpiryReminderEmail({
                to: tenant.email,
                tenantName: `${tenant.firstName} ${tenant.lastName}`,
                propertyName,
                unitNumber: unitName,
                leaseEndDate: lease.leaseEndDate,
                leaseLink,
            });
        }
        if (tenant?.phoneNumber) {
            await smsService.sendRequestUpdateSms(
                tenant.phoneNumber,
                `Lease Expiry`,
                `expired`,
                leaseLink
            );
        }

        // Landlord
        if (landlord?.email) {
            await emailService.sendLeaseExpiryReminderEmail({
                to: landlord.email,
                tenantName: `${landlord.firstName} ${landlord.lastName}`,
                propertyName,
                unitNumber: unitName,
                leaseEndDate: lease.leaseEndDate,
                leaseLink,
            });
        }
        if (landlord?.phoneNumber) {
            await smsService.sendRequestUpdateSms(
                landlord.phoneNumber,
                `Lease Expiry`,
                `expired`,
                leaseLink
            );
        }

        // Property Managers (via PropertyUser)
        if (property?._id) {
            const PropertyUser = require('../models/propertyUser');
            const pms = await PropertyUser.find({
                property: property._id,
                roles: 'propertymanager',
                isActive: true,
            }).populate('user');
            for (const pmEntry of pms) {
                const pm = pmEntry.user;
                if (pm?.email) {
                    await emailService.sendLeaseExpiryReminderEmail({
                        to: pm.email,
                        tenantName: `${pm.firstName} ${pm.lastName}`,
                        propertyName,
                        unitNumber: unitName,
                        leaseEndDate: lease.leaseEndDate,
                        leaseLink,
                    });
                }
                if (pm?.phoneNumber) {
                    await smsService.sendRequestUpdateSms(
                        pm.phoneNumber,
                        `Lease Expiry`,
                        `expired`,
                        leaseLink
                    );
                }
            }
        }
    } catch (err) {
        logger.error(`Failed to send lease expiry notifications: ${err.message}`);
        throw err;
    }
}

/**
 * Sends notification when scheduled maintenance request is generated.
 * @param {Object} params
 * @param {Object} params.request
 * @param {Object} params.schedule
 * @param {string} params.link
 */
async function sendMaintenanceRequestGenerated({ request, schedule, link }) {
    // Assigned user/vendor or fallback to PMs/LLs
    try {
        let sent = false;
        if (request.assignedTo && request.assignedToModel === 'User') {
            const User = require('../models/user');
            const user = await User.findById(request.assignedTo);
            if (user?.email) {
                await emailService.sendRequestNotificationEmail({
                    to: user.email,
                    requestTitle: request.title,
                    status: request.status,
                    requestLink: link,
                });
                sent = true;
            }
            if (user?.phoneNumber) {
                await smsService.sendRequestUpdateSms(
                    user.phoneNumber,
                    request.title,
                    request.status,
                    link
                );
                sent = true;
            }
        } else if (request.assignedTo && request.assignedToModel === 'Vendor') {
            const Vendor = require('../models/vendor');
            const vendor = await Vendor.findById(request.assignedTo);
            if (vendor?.email) {
                await emailService.sendRequestNotificationEmail({
                    to: vendor.email,
                    requestTitle: request.title,
                    status: request.status,
                    requestLink: link,
                });
                sent = true;
            }
            // Vendors may not have SMS, but add if they do
            if (vendor?.phoneNumber) {
                await smsService.sendRequestUpdateSms(
                    vendor.phoneNumber,
                    request.title,
                    request.status,
                    link
                );
                sent = true;
            }
        }

        // Fallback: notify PMs/LLs
        if (!sent && schedule?.property) {
            const PropertyUser = require('../models/propertyUser');
            const users = await PropertyUser.find({
                property: schedule.property._id,
                roles: { $in: ['propertymanager', 'landlord'] },
                isActive: true,
            }).populate('user');
            for (const pu of users) {
                const user = pu.user;
                if (user?.email) {
                    await emailService.sendRequestNotificationEmail({
                        to: user.email,
                        requestTitle: request.title,
                        status: request.status,
                        requestLink: link,
                    });
                }
                if (user?.phoneNumber) {
                    await smsService.sendRequestUpdateSms(
                        user.phoneNumber,
                        request.title,
                        request.status,
                        link
                    );
                }
            }
        }
    } catch (err) {
        logger.error(`Failed to send maintenance request generated notification: ${err.message}`);
        throw err;
    }
}

/**
 * Sends maintenance reminder for overdue requests.
 * @param {Object} params
 * @param {Object} params.request
 * @param {string} params.link
 */
async function sendMaintenanceReminder({ request, link }) {
    try {
        let sent = false;
        if (request.assignedTo && request.assignedToModel === 'User') {
            const User = require('../models/user');
            const user = await User.findById(request.assignedTo);
            if (user?.email) {
                await emailService.sendRequestNotificationEmail({
                    to: user.email,
                    requestTitle: request.title,
                    status: request.status,
                    requestLink: link,
                });
                sent = true;
            }
            if (user?.phoneNumber) {
                await smsService.sendRequestUpdateSms(
                    user.phoneNumber,
                    request.title,
                    request.status,
                    link
                );
                sent = true;
            }
        } else if (request.assignedTo && request.assignedToModel === 'Vendor') {
            const Vendor = require('../models/vendor');
            const vendor = await Vendor.findById(request.assignedTo);
            if (vendor?.email) {
                await emailService.sendRequestNotificationEmail({
                    to: vendor.email,
                    requestTitle: request.title,
                    status: request.status,
                    requestLink: link,
                });
                sent = true;
            }
            // Vendors may not have SMS, but add if they do
            if (vendor?.phoneNumber) {
                await smsService.sendRequestUpdateSms(
                    vendor.phoneNumber,
                    request.title,
                    request.status,
                    link
                );
                sent = true;
            }
        }

        // Fallback: notify reporter and PMs/LLs
        if (!sent) {
            if (request.createdBy) {
                const User = require('../models/user');
                const creator = await User.findById(request.createdBy);
                if (creator?.email) {
                    await emailService.sendRequestNotificationEmail({
                        to: creator.email,
                        requestTitle: request.title,
                        status: request.status,
                        requestLink: link,
                    });
                }
                if (creator?.phoneNumber) {
                    await smsService.sendRequestUpdateSms(
                        creator.phoneNumber,
                        request.title,
                        request.status,
                        link
                    );
                }
            }
            if (request.property) {
                const PropertyUser = require('../models/propertyUser');
                const users = await PropertyUser.find({
                    property: request.property._id,
                    roles: { $in: ['propertymanager', 'landlord'] },
                    isActive: true,
                }).populate('user');
                for (const pu of users) {
                    const user = pu.user;
                    if (user?.email) {
                        await emailService.sendRequestNotificationEmail({
                            to: user.email,
                            requestTitle: request.title,
                            status: request.status,
                            requestLink: link,
                        });
                    }
                    if (user?.phoneNumber) {
                        await smsService.sendRequestUpdateSms(
                            user.phoneNumber,
                            request.title,
                            request.status,
                            link
                        );
                    }
                }
            }
        }
    } catch (err) {
        logger.error(`Failed to send maintenance reminder: ${err.message}`);
        throw err;
    }
}

/**
 * Creates an in-app notification.
 * @param {string} recipientId - The ID of the user who will receive the notification.
 * @param {string} type - The type of notification (e.g., 'new_comment', 'rent_due'). Must be in NOTIFICATION_TYPE_ENUM.
 * @param {string} message - The notification message.
 * @param {object} relatedResource - Object with `kind` and `item` (ID) of the related resource.
 * @param {string} [link=null] - Optional link for the notification.
 * @param {object} [contextData={}] - Optional additional context data for the notification.
 * @param {string} [senderId=null] - Optional ID of the user who initiated the notification.
 * @returns {Promise<Notification>} The created notification document.
 * @throws {AppError} If validation fails or there's a database error.
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
        // Basic validation (more comprehensive validation can be added in the Notification model)
        if (!recipientId || !type || !message || !relatedResource || !relatedResource.kind || !relatedResource.item) {
            throw new AppError('Missing required fields for in-app notification.', 400);
        }

        // Ensure the type is a valid enum value
        if (!Object.values(NOTIFICATION_TYPE_ENUM).includes(type)) {
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

// ------------------------------------------------------------------
// NEW FUNCTION: Get Notifications
// This function is missing and causing the TypeError.
// ------------------------------------------------------------------
/**
 * Fetches notifications for a given user, with optional filters and pagination.
 * @param {string} userId - The ID of the user whose notifications to fetch.
 * @param {object} filters - Optional filters (e.g., read status, type).
 * @param {number} page - Page number for pagination.
 * @param {number} limit - Number of items per page.
 * @returns {Promise<object>} Object containing notifications array, total count, page, and limit.
 * @throws {AppError} If userId is missing or database error occurs.
 */
async function getNotifications(userId, filters = {}, page = 1, limit = 10) {
    if (!userId) {
        throw new AppError('User ID is required to fetch notifications.', 400);
    }

    let query = { recipient: userId };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Apply filters
    if (filters.readStatus) {
        query.read = filters.readStatus === 'read';
    }
    if (filters.type) {
        if (!Object.values(NOTIFICATION_TYPE_ENUM).includes(filters.type)) {
            throw new AppError(`Invalid notification type filter: ${filters.type}`, 400);
        }
        query.type = filters.type;
    }
    if (filters.startDate || filters.endDate) {
        query.sentAt = query.sentAt || {};
        if (filters.startDate) query.sentAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.sentAt.$lte = new Date(filters.endDate);
    }

    try {
        const notifications = await Notification.find(query)
            .sort({ sentAt: -1 }) // Most recent first
            .limit(parseInt(limit))
            .skip(skip);

        const total = await Notification.countDocuments(query);

        logger.info(`Fetched ${notifications.length} notifications for user ${userId}.`);
        return {
            notifications,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
        };
    } catch (error) {
        logger.error(`Failed to fetch notifications for user ${userId}: ${error.message}`, error);
        throw new AppError('Failed to retrieve notifications.', 500);
    }
}

/**
 * Central notification sending function.
 * @param {object} params
 * @param {string} params.recipientId
 * @param {string} params.type
 * @param {string} params.message
 * @param {string} [params.link]
 * @param {string} params.relatedResourceType
 * @param {string} params.relatedResourceId
 * @param {object} [params.emailDetails] - { subject, html, text }
 * @param {string} [params.senderId]
 */
async function sendNotification({
    recipientId,
    type,
    message,
    link,
    relatedResourceType,
    relatedResourceId,
    emailDetails,
    senderId = null
}) {
    try {
        // In-app notification
        await createInAppNotification(
            recipientId,
            type,
            message,
            { kind: relatedResourceType, item: relatedResourceId },
            link,
            {}, // contextData
            senderId
        );

        // Email notification
        const User = require('../models/user'); // Avoid circular dependency
        const recipient = await User.findById(recipientId).select('email preferences');

        if (recipient && recipient.email && emailDetails) {
            const canSendEmail = !recipient.preferences || recipient.preferences.emailNotifications?.[type] !== false; // default to true
            if (canSendEmail) {
                await emailService.sendEmail({
                    to: recipient.email,
                    subject: emailDetails.subject,
                    html: emailDetails.html,
                    text: emailDetails.text || emailDetails.html.replace(/<[^>]*>?/gm, ''), // basic text version
                });
            }
        }
    } catch (error) {
        logger.error(`Failed to send notification for recipient ${recipientId}: ${error.message}`, error);
        // Do not rethrow to avoid halting a process that sends multiple notifications
    }
}


module.exports = {
    sendDailyDigest,
    sendRentReminder,
    sendLeaseExpiry,
    sendMaintenanceRequestGenerated,
    sendMaintenanceReminder,
    createInAppNotification,
    getNotifications,
    sendNotification,
};