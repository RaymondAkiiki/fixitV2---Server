const AfricasTalking = require('africastalking');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const AT_USERNAME = process.env.AT_USERNAME;
const AT_API_KEY = process.env.AT_API_KEY;
const SMS_SENDER_ID = process.env.SMS_GATEWAY_SENDER_ID || 'FixItByThrealty';

// Check if SMS credentials are configured
const isSmsConfigured = () => {
    return AT_USERNAME && AT_API_KEY;
};

// Initialize Africa's Talking only if credentials are available
let africastalking = null;
let sms = null;

if (isSmsConfigured()) {
    africastalking = AfricasTalking({
        username: AT_USERNAME,
        apiKey: AT_API_KEY
    });
    sms = africastalking.SMS;
} else {
    logger.warn("Africa's Talking credentials are not configured. SMS functionality will be disabled.");
}

const validPhone = /^\+\d{7,15}$/;

const sendSms = async (to, message) => {
    if (!sms) {
        logger.warn('SMS functionality is disabled - credentials not configured');
        return { message: 'SMS functionality is disabled', status: 'disabled' };
    }
    
    try {
        const recipients = Array.isArray(to) ? to : [to];
        if (!recipients.length) {
            logger.warn('No recipients provided for SMS.');
            return { message: 'No recipients for SMS', status: 'skipped' };
        }
        for (const num of recipients) {
            if (!validPhone.test(num)) {
                logger.warn(`Invalid phone number format: ${num}`);
                throw new AppError('Invalid phone number format.', 400);
            }
        }
        if (!message || typeof message !== 'string' || message.trim() === '') {
            throw new AppError('SMS message content is empty.', 400);
        }
        const options = {
            to: recipients,
            message: message,
            from: SMS_SENDER_ID
        };
        logger.info(`Sending SMS to ${recipients.join(', ')}`);
        const response = await sms.send(options);
        logger.info(`SMS sent to ${recipients.join(', ')}`, response);
        return response;
    } catch (error) {
        logger.error(`Error sending SMS: ${error.message}`, { stack: error.stack });
        throw new AppError(`Failed to send SMS via Africa's Talking: ${error.message}`, 500);
    }
};

module.exports = {
    sendSms,
    isSmsConfigured
};