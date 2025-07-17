// server/utils/emailTemplates.js

/**
 * Generates the HTML and plain text for an invitation email.
 * @param {object} options - Options for the email.
 * @param {string} options.inviteLink - The full URL for the invitation.
 * @param {string} options.role - The role the user is invited as.
 * @param {string} [options.invitedByUserName='A user'] - The name of the inviter.
 * @param {string} [options.propertyDisplayName='a property'] - The name of the property.
 * @param {string} [options.appName=process.env.APP_NAME || 'Fix it by Threalty'] - The application name.
 * @returns {{subject: string, text: string, html: string}} Email content.
 */
const generateInvitationEmail = ({
    inviteLink,
    role,
    invitedByUserName = 'A user',
    propertyDisplayName = 'a property',
    appName = process.env.APP_NAME || 'Fix it by Threalty', // Use env var as default
}) => {
    const subject = `You're invited to ${appName} as a ${role}!`;

    const text = `Hello,

${invitedByUserName} has invited you to join ${appName} as a ${role} for ${propertyDisplayName}.

Please click on the following link to accept the invitation and set up your account:
${inviteLink}

This link will expire soon.

If you did not expect this invitation, you can ignore this email.

Best regards,
The ${appName} Team`;

    const html = `
        <p>Hello,</p>
        <p>${invitedByUserName} has invited you to join <strong>${appName}</strong> as a <strong>${role}</strong> for <strong>${propertyDisplayName}</strong>.</p>
        <p>Please click on the following link to accept the invitation and set up your account:</p>
        <p><a href="${inviteLink}">${inviteLink}</a></p>
        <p>This link will expire soon.</p>
        <p>If you did not expect this invitation, you can ignore this email.</p>
        <p>Best regards,<br/>The ${appName} Team</p>
    `;

    return { subject, text, html };
};

/**
 * Generates the HTML and plain text for a maintenance request update email.
 * @param {object} options - Options for the email.
 * @param {string} options.requestTitle - The title of the maintenance request.
 * @param {string} options.status - The new status of the request.
 * @param {string} options.requestLink - Link to the request details on the frontend.
 * @param {string} [options.appName=process.env.APP_NAME || 'Fix it by Threalty'] - The application name.
 * @returns {{subject: string, text: string, html: string}} Email content.
 */
const generateRequestUpdateEmail = ({
    requestTitle,
    status,
    requestLink,
    appName = process.env.APP_NAME || 'Fix it by Threalty',
}) => {
    const subject = `Maintenance Request Update: "${requestTitle}" is now ${status}`;
    const text = `Hello,

The maintenance request "${requestTitle}" has been updated. Its new status is: ${status}.

You can view the details here:
${requestLink}

Best regards,
The ${appName} Team`;

    const html = `
        <p>Hello,</p>
        <p>The maintenance request "<strong>${requestTitle}</strong>" has been updated. Its new status is: <strong>${status}</strong>.</p>
        <p>You can view the details here: <a href="${requestLink}">${requestLink}</a></p>
        <p>Best regards,<br/>The ${appName} Team</p>
    `;
    return { subject, text, html };
};

/**
 * Generates the HTML and plain text for a lease expiry reminder email.
 * @param {object} options - Options for the email.
 * @param {string} options.tenantName - The tenant's name.
 * @param {string} options.propertyName - The name of the property.
 * @param {string} options.unitNumber - The unit number.
 * @param {Date} options.leaseEndDate - The lease end date.
 * @param {string} options.leaseLink - Link to the lease details on the frontend.
 * @param {string} [options.appName=process.env.APP_NAME || 'Fix it by Threalty'] - The application name.
 * @returns {{subject: string, text: string, html: string}} Email content.
 */
const generateLeaseExpiryReminderEmail = ({
    tenantName,
    propertyName,
    unitNumber,
    leaseEndDate,
    leaseLink,
    appName = process.env.APP_NAME || 'Fix it by Threalty',
}) => {
    const formattedEndDate = leaseEndDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const subject = `Important: Lease Expiry Reminder for ${propertyName} - Unit ${unitNumber}`;

    const text = `Dear ${tenantName},

This is a reminder that your lease for ${propertyName}, Unit ${unitNumber}, is approaching its expiration date on ${formattedEndDate}.

Please review your lease details and contact your landlord or property manager to discuss renewal options or move-out procedures.

View your lease details here:
${leaseLink}

Best regards,
The ${appName} Team`;

    const html = `
        <p>Dear ${tenantName},</p>
        <p>This is a reminder that your lease for <strong>${propertyName}</strong>, Unit <strong>${unitNumber}</strong>, is approaching its expiration date on <strong>${formattedEndDate}</strong>.</p>
        <p>Please review your lease details and contact your landlord or property manager to discuss renewal options or move-out procedures.</p>
        <p>View your lease details here: <a href="${leaseLink}">${leaseLink}</a></p>
        <p>Best regards,<br/>The ${appName} Team</p>
    `;
    return { subject, text, html };
};

/**
 * Generates the HTML and plain text for a rent due/overdue reminder email.
 * @param {object} options - Options for the email.
 * @param {string} options.tenantName - The tenant's name.
 * @param {string} options.propertyName - The name of the property.
 * @param {string} options.unitNumber - The unit number.
 * @param {string} options.billingPeriod - The billing period (e.g., "July 2025").
 * @param {number} options.amountDue - The amount due.
 * @param {Date} options.dueDate - The rent due date.
 * @param {string} options.rentLink - Link to the rent details on the frontend.
 * @param {'due'|'overdue'} options.type - 'due' or 'overdue'.
 * @param {string} [options.appName=process.env.APP_NAME || 'Fix it by Threalty'] - The application name.
 * @returns {{subject: string, text: string, html: string}} Email content.
 */
const generateRentReminderEmail = ({
    tenantName,
    propertyName,
    unitNumber,
    billingPeriod,
    amountDue,
    dueDate,
    rentLink,
    type,
    appName = process.env.APP_NAME || 'Fix it by Threalty',
}) => {
    const formattedDueDate = dueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const subject = type === 'due'
        ? `Rent Due Reminder: ${propertyName} - Unit ${unitNumber} for ${billingPeriod}`
        : `Urgent: Overdue Rent for ${propertyName} - Unit ${unitNumber} for ${billingPeriod}`;

    const text = `Dear ${tenantName},

This is a reminder that your rent for ${propertyName}, Unit ${unitNumber}, for the billing period of ${billingPeriod} is ${type}.

Amount Due: ${amountDue} UGX
Due Date: ${formattedDueDate}

Please ensure payment is made promptly to avoid any late fees.

View your rent details here:
${rentLink}

Best regards,
The ${appName} Team`;

    const html = `
        <p>Dear ${tenantName},</p>
        <p>This is a reminder that your rent for <strong>${propertyName}</strong>, Unit <strong>${unitNumber}</strong>, for the billing period of <strong>${billingPeriod}</strong> is <strong>${type}</strong>.</p>
        <p>Amount Due: <strong>${amountDue} UGX</strong></p>
        <p>Due Date: <strong>${formattedDueDate}</strong></p>
        <p>Please ensure payment is made promptly to avoid any late fees.</p>
        <p>View your rent details here: <a href="${rentLink}">${rentLink}</a></p>
        <p>Best regards,<br/>The ${appName} Team</p>
    `;
    return { subject, text, html };
};

/**
 * Generates the HTML and plain text for a new user approval request email to landlords.
 * @param {object} options - Options for the email.
 * @param {string} options.landlordFirstName - The first name of the landlord recipient.
 * @param {string} options.newUserRole - The role of the new user awaiting approval.
 * @param {string} options.newUserEmail - The email of the new user awaiting approval.
 * @param {string} options.approvalLink - The link to the admin dashboard for approval.
 * @param {string} [options.appName=process.env.APP_NAME || 'Fix it by Threalty'] - The application name.
 * @returns {{subject: string, text: string, html: string}} Email content.
 */
const generateUserApprovalRequestEmail = ({
    landlordFirstName,
    newUserRole,
    newUserEmail,
    approvalLink,
    appName = process.env.APP_NAME || 'Fix it by Threalty',
}) => {
    const subject = `New User Approval Request on ${appName}`;
    const text = `Dear ${landlordFirstName},
A new ${newUserRole} (${newUserEmail}) has registered and is awaiting your approval on ${appName}.
Please log in to your dashboard to review and approve/reject: ${approvalLink}
Best regards, The ${appName} Team`;

    const html = `<p>Dear ${landlordFirstName},</p>
        <p>A new <strong>${newUserRole}</strong> (<strong>${newUserEmail}</strong>) has registered and is awaiting your approval on ${appName}.</p>
        <p>Please log in to your dashboard to review and approve/reject: <a href="${approvalLink}">${approvalLink}</a></p>
        <p>Best regards,<br/>The ${appName} Team</p>`;

    return { subject, text, html };
};

/**
 * Generates the HTML and plain text for an email verification email.
 * @param {object} options - Options for the email.
 * @param {string} options.verificationUrl - The full URL for email verification.
 * @param {string} [options.appName=process.env.APP_NAME || 'Fix it by Threalty'] - The application name.
 * @returns {{subject: string, text: string, html: string}} Email content.
 */
const generateEmailVerificationEmail = ({
    verificationUrl,
    appName = process.env.APP_NAME || 'Fix it by Threalty',
}) => {
    const subject = `Verify Your Email for ${appName}`;
    const text = `Hello,

Thank you for registering with ${appName}! Please verify your email address by clicking the link below:

${verificationUrl}

This link is valid for 24 hours.

If you did not register for this service, please disregard this email.

Best regards,
The ${appName} Team`;

    const html = `
        <p>Hello,</p>
        <p>Thank you for registering with <strong>${appName}</strong>! Please verify your email address by clicking the link below:</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
        <p>This link is valid for 24 hours.</p>
        <p>If you did not register for this service, please disregard this email.</p>
        <p>Best regards,<br/>The ${appName} Team</p>
    `;
    return { subject, text, html };
};

/**
 * Generates the HTML and plain text for a password reset email.
 * @param {object} options - Options for the email.
 * @param {string} options.resetUrl - The full URL for password reset.
 * @param {string} [options.appName=process.env.APP_NAME || 'Fix it by Threalty'] - The application name.
 * @returns {{subject: string, text: string, html: string}} Email content.
 */
const generatePasswordResetEmail = ({
    resetUrl,
    appName = process.env.APP_NAME || 'Fix it by Threalty',
}) => {
    const subject = `Password Reset Request for ${appName}`;
    const text = `Hello,

You are receiving this email because you (or someone else) has requested the reset of the password for your account on ${appName}.

Please click on the following link, or paste this into your browser to complete the process:

${resetUrl}

This link will expire in 1 hour.

If you did not request this, please ignore this email and your password will remain unchanged.

Best regards,
The ${appName} Team`;

    const html = `
        <p>Hello,</p>
        <p>You are receiving this email because you (or someone else) has requested the reset of the password for your account on <strong>${appName}</strong>.</p>
        <p>Please click on the following link, or paste this into your browser to complete the process:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>This link will expire in 1 hour.</p>
        <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
        <p>Best regards,<br/>The ${appName} Team</p>
    `;
    return { subject, text, html };
};

module.exports = {
    generateInvitationEmail,
    generateRequestUpdateEmail,
    generateLeaseExpiryReminderEmail,
    generateRentReminderEmail,
    generateUserApprovalRequestEmail,
    generateEmailVerificationEmail,
    generatePasswordResetEmail,
};