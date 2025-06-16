const cron = require('node-cron');
const Request = require('../models/request');
const User = require('../models/user');
const Property = require('../models/property');
const asyncHandler = require('express-async-handler');

/**
 * @desc Schedule a task to send reminders for overdue maintenance requests
 */
exports.scheduleOverdueRequestReminders = () => {
  // Schedule the task to run every day at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    try {
      // Find overdue maintenance requests (e.g., requests that are still "new" or "in progress" after a certain period)
      const overdueRequests = await Request.find({
        status: { $in: ['new', 'in progress'] },
        createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Older than 7 days
      }).populate('property', 'name').populate('assignedTo', 'name email');

      // Send reminders to landlords or property managers for each overdue request
      for (const request of overdueRequests) {
        // Find the landlord or property manager associated with the property
        const property = await Property.findById(request.property);
        const landlord = await User.findById(property.landlord); // Assuming property has a landlord field

        if (landlord) {
          // Send reminder email (replace with your email sending logic)
          sendReminderEmail(
            landlord.email,
            `Overdue Maintenance Request: ${request.description}`,
            `The following maintenance request is overdue for property ${request.property.name}: ${request.description}. Please take action.`
          );
          console.log(`Reminder sent to ${landlord.email} for overdue request: ${request.description}`);
        } else {
          console.warn(`No landlord found for property ${request.property.name}`);
        }
      }

      console.log('Overdue request reminders sent successfully.');
    } catch (error) {
      console.error('Error scheduling overdue request reminders:', error.message);
    }
  });
};

/**
 * @desc Example function to send reminder email (replace with your actual email sending logic)
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body
 */
function sendReminderEmail(to, subject, body) {
  // Replace this with your actual email sending logic (e.g., using Nodemailer)
  console.log(`Sending email to: ${to}\nSubject: ${subject}\nBody: ${body}`);
  // Example using Nodemailer:
  // const nodemailer = require('nodemailer');
  // const transporter = nodemailer.createTransport({ /* your transporter config */ });
  // transporter.sendMail({ to, subject, html: body }, (err, info) => { /* error handling */ });
}