// src/lib/smsGatewayClient.js

const AfricasTalking = require('africastalking');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// Environment variables with defaults
const {
    AT_USERNAME,
    AT_API_KEY,
    SMS_GATEWAY_SENDER_ID = 'LeaseLogix',
    NODE_ENV = 'development',
    SMS_TEST_MODE = NODE_ENV === 'development', // Enable test mode in development
    SMS_MAX_RETRIES = 2
} = process.env;

// Validate phone number format
const VALID_PHONE_REGEX = /^\+\d{7,15}$/;

// Mock SMS functionality for testing/development
const mockSms = {
    send: async (options) => {
        logger.info(`[MOCK SMS] Would send to: ${options.to.join(', ')}`);
        logger.info(`[MOCK SMS] Message: ${options.message}`);
        logger.info(`[MOCK SMS] From: ${options.from}`);
        
        return {
            SMSMessageData: {
                Message: 'Sent to 1 recipients',
                Recipients: options.to.map(recipient => ({
                    number: recipient,
                    status: 'Success',
                    messageId: `mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    cost: '0'
                }))
            }
        };
    }
};

// Check if SMS credentials are configured
const isSmsConfigured = () => {
    return !!(AT_USERNAME && AT_API_KEY);
};

// Initialize Africa's Talking SDK
let client = null;
let smsService = null;

// Initialize the SMS client
const initializeClient = () => {
    if (client) return; // Already initialized
    
    if (SMS_TEST_MODE === 'true' || SMS_TEST_MODE === true) {
        logger.info('SMS Gateway: Using mock SMS service for development/testing');
        smsService = mockSms;
        return;
    }
    
    if (!isSmsConfigured()) {
        logger.warn("Africa's Talking credentials are not configured. SMS functionality will be limited.");
        smsService = mockSms;
        return;
    }
    
    try {
        client = AfricasTalking({
            username: AT_USERNAME,
            apiKey: AT_API_KEY
        });
        
        smsService = client.SMS;
        logger.info('SMS Gateway: Africa\'s Talking client initialized successfully');
    } catch (error) {
        logger.error(`SMS Gateway: Failed to initialize Africa's Talking client: ${error.message}`, error);
        // Fall back to mock SMS if initialization fails
        smsService = mockSms;
    }
};

/**
 * Validates phone numbers against the expected format
 * @param {string|string[]} phoneNumbers - Phone number(s) to validate
 * @returns {boolean} True if all valid, throws error otherwise
 * @throws {AppError} If any phone number is invalid
 */
const validatePhoneNumbers = (phoneNumbers) => {
    const numbers = Array.isArray(phoneNumbers) ? phoneNumbers : [phoneNumbers];
    
    if (!numbers.length) {
        throw new AppError('No phone numbers provided for SMS.', 400);
    }
    
    const invalidNumbers = numbers.filter(num => !VALID_PHONE_REGEX.test(num));
    
    if (invalidNumbers.length > 0) {
        throw new AppError(`Invalid phone number format: ${invalidNumbers.join(', ')}. Must be in E.164 format (e.g., +256701234567).`, 400);
    }
    
    return true;
};

/**
 * Sends an SMS with retry logic
 * @param {string|string[]} to - Recipient phone number(s)
 * @param {string} message - SMS content
 * @param {Object} [options={}] - Additional options
 * @param {string} [options.from] - Sender ID (defaults to env var)
 * @param {number} [options.retryAttempt=0] - Current retry attempt (internal use)
 * @returns {Promise<Object>} SMS send response
 * @throws {AppError} If SMS fails to send after all retries
 */
const sendSms = async (to, message, options = {}) => {
    // Initialize client if not already done
    if (!smsService) {
        initializeClient();
    }
    
    const { from = SMS_GATEWAY_SENDER_ID, retryAttempt = 0 } = options;
    
    try {
        // Validate recipients
        const recipients = Array.isArray(to) ? to : [to];
        validatePhoneNumbers(recipients);
        
        // Validate message
        if (!message || typeof message !== 'string' || message.trim() === '') {
            throw new AppError('SMS message content cannot be empty.', 400);
        }
        
        // Truncate message if too long (typically 160 chars for standard SMS)
        const MAX_SMS_LENGTH = 160;
        const truncatedMessage = message.length > MAX_SMS_LENGTH ? 
            `${message.substring(0, MAX_SMS_LENGTH - 3)}...` : message;
        
        // Prepare send options
        const sendOptions = {
            to: recipients,
            message: truncatedMessage,
            from
        };
        
        // Log the send attempt
        logger.info(`SMS Gateway: Sending SMS to ${recipients.join(', ')}`);
        
        // Send the SMS
        const response = await smsService.send(sendOptions);
        
        // Log success
        logger.info(`SMS Gateway: SMS sent successfully to ${recipients.join(', ')}`);
        
        return response;
    } catch (error) {
        // Log the error
        logger.error(`SMS Gateway: Error sending SMS (attempt ${retryAttempt + 1}): ${error.message}`, { 
            stack: error.stack,
            recipients: Array.isArray(to) ? to : [to]
        });
        
        // Implement retry logic
        const maxRetries = parseInt(SMS_MAX_RETRIES, 10) || 2;
        
        if (retryAttempt < maxRetries) {
            // Exponential backoff delay
            const delay = 1000 * Math.pow(2, retryAttempt);
            
            logger.info(`SMS Gateway: Retrying SMS send in ${delay}ms (attempt ${retryAttempt + 1}/${maxRetries})`);
            
            // Wait and retry
            await new Promise(resolve => setTimeout(resolve, delay));
            return sendSms(to, message, { ...options, retryAttempt: retryAttempt + 1 });
        }
        
        // All retries failed
        throw new AppError(`Failed to send SMS after ${maxRetries + 1} attempts: ${error.message}`, 500);
    }
};

// Initialize on module load if not in test environment
if (process.env.NODE_ENV !== 'test') {
    initializeClient();
}

module.exports = {
    sendSms,
    isSmsConfigured,
    validatePhoneNumbers,
    initializeClient // Exported for testing purposes
};