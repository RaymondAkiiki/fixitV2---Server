/**
 * SMS Templates for LeaseLogix and other apps.
 */

/**
 * Generates the text for an invitation SMS.
 * @param {object} options
 * @param {string} options.inviteLink
 * @param {string} options.role
 * @param {string} [options.appName='LeaseLogix']
 * @returns {string}
 */
const generateInvitationSms = ({ inviteLink = '', role = '', appName = 'LeaseLogix' } = {}) => {
    return `You're invited to ${appName} as a ${role}! Accept here: ${inviteLink}`;
};

/**
 * Generates the text for a maintenance request update SMS.
 * @param {object} options
 * @param {string} options.requestTitle
 * @param {string} options.status
 * @param {string} options.requestLink
 * @returns {string}
 */
const generateRequestUpdateSms = ({ requestTitle = '', status = '', requestLink = '' } = {}) => {
    return `Update: "${requestTitle}" is now ${status}. View: ${requestLink}`;
};

/**
 * Generates the text for a rent due/overdue reminder SMS.
 * @param {object} options
 * @param {string} options.propertyName
 * @param {string} options.unitNumber
 * @param {number} options.amountDue
 * @param {Date|string} options.dueDate
 * @param {string} options.type - 'due' or 'overdue'
 * @returns {string}
 */
const generateRentReminderSms = ({ propertyName = '', unitNumber = '', amountDue = 0, dueDate, type = 'due' } = {}) => {
    let formattedDueDate = '';
    if (dueDate instanceof Date) {
        formattedDueDate = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else if (typeof dueDate === 'string') {
        formattedDueDate = dueDate;
    }
    const statusText = type === 'due' ? 'due' : 'OVERDUE';
    return `Rent for ${propertyName} Unit ${unitNumber} is ${statusText}. Amount: ${amountDue} UGX. Due: ${formattedDueDate}.`;
};

module.exports = {
    generateInvitationSms,
    generateRequestUpdateSms,
    generateRentReminderSms
};