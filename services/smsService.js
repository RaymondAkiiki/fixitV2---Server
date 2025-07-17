const smsGatewayClient = require('../lib/smsGatewayClient');
const smsTemplates = require('../utils/smsTemplates');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * Send a general SMS via the gateway.
 * @param {string|string[]} to - Recipient(s)
 * @param {string} message - Message content
 * @param {string} [messageType='transactional']
 * @returns {Promise<object>}
 */
const sendSms = async (to, message, messageType = 'transactional') => {
    if (!to || typeof message !== 'string' || message.trim() === '') {
        logger.warn('SmsService: Missing recipient or empty message.');
        throw new AppError('Recipient and message content are required for sending SMS.', 400);
    }
    try {
        logger.info(`SmsService: Sending ${messageType} SMS to ${Array.isArray(to) ? to.join(', ') : to}.`);
        const response = await smsGatewayClient.sendSms(to, message);
        logger.info(`SmsService: SMS sent to ${Array.isArray(to) ? to.join(', ') : to}. Response: ${JSON.stringify(response)}`);
        return response;
    } catch (error) {
        logger.error(`SmsService: Failed to send SMS to ${Array.isArray(to) ? to.join(', ') : to}: ${error.message}`);
        throw new AppError(`Failed to send SMS: ${error.message}`, 500);
    }
};

/**
 * Send an invitation SMS.
 * @param {string} phoneNumber
 * @param {string} inviteLink
 * @param {string} role
 * @returns {Promise<object>}
 */
const sendInvitationSms = async (phoneNumber, inviteLink, role) => {
    const message = smsTemplates.generateInvitationSms({ inviteLink, role });
    return sendSms(phoneNumber, message, 'transactional');
};

/**
 * Send a maintenance request update SMS.
 * @param {string} phoneNumber
 * @param {string} requestTitle
 * @param {string} status
 * @param {string} requestLink
 * @returns {Promise<object>}
 */
const sendRequestUpdateSms = async (phoneNumber, requestTitle, status, requestLink) => {
    const message = smsTemplates.generateRequestUpdateSms({ requestTitle, status, requestLink });
    return sendSms(phoneNumber, message, 'transactional');
};

/**
 * Send a rent due/overdue reminder SMS.
 * @param {string} phoneNumber
 * @param {string} propertyName
 * @param {string} unitNumber
 * @param {number} amountDue
 * @param {Date|string} dueDate
 * @param {'due'|'overdue'} type
 * @returns {Promise<object>}
 */
const sendRentReminderSms = async (phoneNumber, propertyName, unitNumber, amountDue, dueDate, type) => {
    const message = smsTemplates.generateRentReminderSms({ propertyName, unitNumber, amountDue, dueDate, type });
    return sendSms(phoneNumber, message, 'transactional');
};

module.exports = {
    sendSms,
    sendInvitationSms,
    sendRequestUpdateSms,
    sendRentReminderSms
};