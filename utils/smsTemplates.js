// src/utils/smsTemplates.js

/**
 * SMS Templates for LeaseLogix
 * Contains template generators for different types of SMS notifications
 */

const {
    APP_NAME = 'LeaseLogix'
} = process.env;

/**
 * Format currency value
 * @param {number} amount - Amount to format
 * @param {string} [currency='UGX'] - Currency code
 * @returns {string} Formatted currency string
 */
const formatCurrency = (amount, currency = 'UGX') => {
    if (amount === undefined || amount === null) return `0 ${currency}`;
    return `${amount.toLocaleString()} ${currency}`;
};

/**
 * Format date in a readable format for SMS
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
const formatDate = (date) => {
    if (!date) return '';
    
    const dateObj = date instanceof Date ? date : new Date(date);
    
    if (isNaN(dateObj.getTime())) {
        return date.toString(); // Return as is if invalid date
    }
    
    return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * Generates the text for an invitation SMS.
 * @param {object} options
 * @param {string} options.inviteLink - Full URL for invitation
 * @param {string} options.role - Role being invited to
 * @param {string} [options.invitedByName] - Name of person sending invitation
 * @param {string} [options.propertyName] - Name of property (if applicable)
 * @param {string} [options.appName=APP_NAME] - Application name
 * @returns {string} SMS message text
 */
const generateInvitationSms = ({ 
    inviteLink = '', 
    role = '', 
    invitedByName = '',
    propertyName = '',
    appName = APP_NAME
} = {}) => {
    let message = `${appName}: You've been invited`;
    
    if (invitedByName) {
        message += ` by ${invitedByName}`;
    }
    
    message += ` as a ${role}`;
    
    if (propertyName) {
        message += ` for ${propertyName}`;
    }
    
    message += `. Accept here: ${inviteLink}`;
    
    return message;
};

/**
 * Generates the text for a maintenance request update SMS.
 * @param {object} options
 * @param {string} options.requestTitle - Title of maintenance request
 * @param {string} options.status - New status
 * @param {string} options.requestLink - Link to request details
 * @param {string} [options.appName=APP_NAME] - Application name
 * @returns {string} SMS message text
 */
const generateRequestUpdateSms = ({ 
    requestTitle = '', 
    status = '', 
    requestLink = '',
    appName = APP_NAME
} = {}) => {
    // Truncate long titles to keep SMS concise
    const MAX_TITLE_LENGTH = 30;
    const truncatedTitle = requestTitle.length > MAX_TITLE_LENGTH ? 
        requestTitle.substring(0, MAX_TITLE_LENGTH) + '...' : 
        requestTitle;
    
    return `${appName}: Your request "${truncatedTitle}" is now ${status}. View details: ${requestLink}`;
};

/**
 * Generates the text for a lease expiry reminder SMS.
 * @param {object} options
 * @param {string} options.propertyName - Property name
 * @param {string} options.unitNumber - Unit number/name
 * @param {Date|string} options.expiryDate - Lease expiry date
 * @param {string} [options.leaseLink] - Link to lease details
 * @param {string} [options.appName=APP_NAME] - Application name
 * @returns {string} SMS message text
 */
const generateLeaseExpirySms = ({
    propertyName = '',
    unitNumber = '',
    expiryDate,
    leaseLink = '',
    appName = APP_NAME
} = {}) => {
    const formattedDate = formatDate(expiryDate);
    
    let message = `${appName}: Your lease for ${propertyName}`;
    
    if (unitNumber) {
        message += ` Unit ${unitNumber}`;
    }
    
    message += ` expires on ${formattedDate}.`;
    
    if (leaseLink) {
        message += ` Details: ${leaseLink}`;
    }
    
    return message;
};

/**
 * Generates the text for a rent due/overdue reminder SMS.
 * @param {object} options
 * @param {string} options.propertyName - Property name
 * @param {string} options.unitNumber - Unit number/name
 * @param {number} options.amountDue - Amount due
 * @param {Date|string} options.dueDate - Due date
 * @param {'due'|'overdue'} options.type - Type of reminder
 * @param {string} [options.rentLink] - Link to payment details
 * @param {string} [options.appName=APP_NAME] - Application name
 * @returns {string} SMS message text
 */
const generateRentReminderSms = ({ 
    propertyName = '', 
    unitNumber = '', 
    amountDue = 0, 
    dueDate,
    type = 'due',
    rentLink = '',
    appName = APP_NAME
} = {}) => {
    const formattedDueDate = formatDate(dueDate);
    const formattedAmount = formatCurrency(amountDue);
    const statusText = type.toLowerCase() === 'due' ? 'due' : 'OVERDUE';
    
    let message = `${appName}: Rent for ${propertyName}`;
    
    if (unitNumber) {
        message += ` Unit ${unitNumber}`;
    }
    
    message += ` is ${statusText}. Amount: ${formattedAmount}.`;
    
    if (formattedDueDate) {
        message += ` Due: ${formattedDueDate}.`;
    }
    
    if (rentLink) {
        message += ` Pay online: ${rentLink}`;
    }
    
    return message;
};

/**
 * Generates the text for a maintenance appointment SMS.
 * @param {object} options
 * @param {string} options.propertyName - Property name
 * @param {string} options.unitNumber - Unit number/name
 * @param {Date|string} options.appointmentDate - Appointment date and time
 * @param {string} [options.category] - Maintenance category
 * @param {string} [options.vendorName] - Vendor name
 * @param {string} [options.detailsLink] - Link to appointment details
 * @param {string} [options.appName=APP_NAME] - Application name
 * @returns {string} SMS message text
 */
const generateMaintenanceAppointmentSms = ({
    propertyName = '',
    unitNumber = '',
    appointmentDate,
    category = '',
    vendorName = '',
    detailsLink = '',
    appName = APP_NAME
} = {}) => {
    // Format the date with time for appointments
    const dateObj = appointmentDate instanceof Date ? 
        appointmentDate : 
        new Date(appointmentDate);
    
    const formattedDate = isNaN(dateObj.getTime()) ? 
        appointmentDate.toString() : 
        dateObj.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            hour: 'numeric', 
            minute: 'numeric' 
        });
    
    let message = `${appName}: Maintenance appointment`;
    
    if (category) {
        message += ` for ${category}`;
    }
    
    message += ` at ${propertyName}`;
    
    if (unitNumber) {
        message += ` Unit ${unitNumber}`;
    }
    
    message += ` scheduled for ${formattedDate}`;
    
    if (vendorName) {
        message += ` with ${vendorName}`;
    }
    
    if (detailsLink) {
        message += `. Details: ${detailsLink}`;
    }
    
    return message;
};

module.exports = {
    generateInvitationSms,
    generateRequestUpdateSms,
    generateRentReminderSms,
    generateLeaseExpirySms,
    generateMaintenanceAppointmentSms,
    formatCurrency,
    formatDate
};