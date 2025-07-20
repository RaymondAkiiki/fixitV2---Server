// src/services/smsService.js

const smsGatewayClient = require('../lib/smsGatewayClient');
const smsTemplates = require('../utils/smsTemplates');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * Send a general SMS via the gateway.
 * @param {string|string[]} to - Recipient phone number(s)
 * @param {string} message - Message content
 * @param {Object} [options={}] - Additional options
 * @param {string} [options.from] - Sender ID
 * @param {string} [options.messageType='transactional'] - Message classification
 * @returns {Promise<Object>} Send response
 * @throws {AppError} If send fails
 */
const sendSms = async (to, message, options = {}) => {
    const { messageType = 'transactional', ...clientOptions } = options;
    
    if (!to || !to.length) {
        logger.warn('SmsService: Missing recipient(s).');
        throw new AppError('Recipient phone number(s) required for sending SMS.', 400);
    }
    
    if (!message || typeof message !== 'string' || message.trim() === '') {
        logger.warn('SmsService: Empty message.');
        throw new AppError('Message content is required for sending SMS.', 400);
    }
    
    try {
        logger.info(`SmsService: Sending ${messageType} SMS to ${Array.isArray(to) ? to.join(', ') : to}.`);
        
        const response = await smsGatewayClient.sendSms(to, message, clientOptions);
        
        logger.info(`SmsService: SMS sent successfully.`);
        return response;
    } catch (error) {
        logger.error(`SmsService: Failed to send SMS: ${error.message}`, {
            recipients: Array.isArray(to) ? to : [to],
            errorDetails: error
        });
        throw new AppError(`Failed to send SMS: ${error.message}`, error.statusCode || 500);
    }
};

/**
 * Send an invitation SMS.
 * @param {Object} options - Invitation options
 * @param {string|string[]} options.to - Recipient phone number(s)
 * @param {string} options.inviteLink - Full invitation URL
 * @param {string} options.role - Role being invited to
 * @param {string} [options.invitedByName] - Name of inviter
 * @param {string} [options.propertyName] - Name of property
 * @returns {Promise<Object>} Send response
 */
const sendInvitationSms = async ({ to, inviteLink, role, invitedByName, propertyName }) => {
    if (!to || !inviteLink || !role) {
        throw new AppError('Recipient, invite link, and role are required for invitation SMS.', 400);
    }
    
    const message = smsTemplates.generateInvitationSms({ 
        inviteLink, 
        role, 
        invitedByName, 
        propertyName 
    });
    
    return sendSms(to, message, { messageType: 'invitation' });
};

/**
 * Send a maintenance request update SMS.
 * @param {Object} options - Update options
 * @param {string|string[]} options.to - Recipient phone number(s)
 * @param {string} options.requestTitle - Request title
 * @param {string} options.status - Request status
 * @param {string} options.requestLink - Link to request details
 * @returns {Promise<Object>} Send response
 */
const sendRequestUpdateSms = async ({ to, requestTitle, status, requestLink }) => {
    if (!to || !requestTitle || !status) {
        throw new AppError('Recipient, request title, and status are required for request update SMS.', 400);
    }
    
    const message = smsTemplates.generateRequestUpdateSms({ 
        requestTitle, 
        status, 
        requestLink 
    });
    
    return sendSms(to, message, { messageType: 'update' });
};

/**
 * Send a lease expiry reminder SMS.
 * @param {Object} options - Reminder options
 * @param {string|string[]} options.to - Recipient phone number(s)
 * @param {string} options.propertyName - Property name
 * @param {string} options.unitNumber - Unit number/name
 * @param {Date|string} options.expiryDate - Lease expiry date
 * @param {string} [options.leaseLink] - Link to lease details
 * @returns {Promise<Object>} Send response
 */
const sendLeaseExpirySms = async ({ to, propertyName, unitNumber, expiryDate, leaseLink }) => {
    if (!to || !propertyName || !expiryDate) {
        throw new AppError('Recipient, property name, and expiry date are required for lease expiry SMS.', 400);
    }
    
    const message = smsTemplates.generateLeaseExpirySms({
        propertyName,
        unitNumber,
        expiryDate,
        leaseLink
    });
    
    return sendSms(to, message, { messageType: 'reminder' });
};

/**
 * Send a rent due/overdue reminder SMS.
 * @param {Object} options - Reminder options
 * @param {string|string[]} options.to - Recipient phone number(s)
 * @param {string} options.propertyName - Property name
 * @param {string} options.unitNumber - Unit number/name
 * @param {number} options.amountDue - Amount due
 * @param {Date|string} options.dueDate - Due date
 * @param {'due'|'overdue'} options.type - Type of reminder
 * @param {string} [options.rentLink] - Link to payment details
 * @returns {Promise<Object>} Send response
 */
const sendRentReminderSms = async ({ to, propertyName, unitNumber, amountDue, dueDate, type = 'due', rentLink }) => {
    if (!to || !propertyName || !amountDue) {
        throw new AppError('Recipient, property name, and amount due are required for rent reminder SMS.', 400);
    }
    
    const message = smsTemplates.generateRentReminderSms({ 
        propertyName, 
        unitNumber, 
        amountDue, 
        dueDate, 
        type,
        rentLink
    });
    
    return sendSms(to, message, { messageType: 'reminder' });
};

/**
 * Send a maintenance appointment SMS.
 * @param {Object} options - Appointment options
 * @param {string|string[]} options.to - Recipient phone number(s)
 * @param {string} options.propertyName - Property name
 * @param {string} options.unitNumber - Unit number/name
 * @param {Date|string} options.appointmentDate - Appointment date and time
 * @param {string} [options.category] - Maintenance category
 * @param {string} [options.vendorName] - Vendor name
 * @param {string} [options.detailsLink] - Link to appointment details
 * @returns {Promise<Object>} Send response
 */
const sendMaintenanceAppointmentSms = async ({ to, propertyName, unitNumber, appointmentDate, category, vendorName, detailsLink }) => {
    if (!to || !propertyName || !appointmentDate) {
        throw new AppError('Recipient, property name, and appointment date are required for maintenance appointment SMS.', 400);
    }
    
    const message = smsTemplates.generateMaintenanceAppointmentSms({
        propertyName,
        unitNumber,
        appointmentDate,
        category,
        vendorName,
        detailsLink
    });
    
    return sendSms(to, message, { messageType: 'appointment' });
};

module.exports = {
    sendSms,
    sendInvitationSms,
    sendRequestUpdateSms,
    sendLeaseExpirySms,
    sendRentReminderSms,
    sendMaintenanceAppointmentSms
};