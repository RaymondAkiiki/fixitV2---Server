// backend/utils/cronJobs.js

// This file sets up scheduled tasks (cron jobs) using the 'node-cron' library.
// It will be responsible for automating tasks like generating maintenance requests
// from scheduled maintenance entries and sending reminders.

const cron = require('node-cron');
const ScheduledMaintenance = require('../models/scheduledMaintenance');
const Request = require('../models/request');
const User = require('../models/user'); // Assuming we need user info for notifications
const { sendRequestNotificationEmail } = require('./emailService'); // For sending email reminders

/**
 * Initializes and starts all cron jobs for the application.
 */
const startCronJobs = () => {
    // Cron job to generate Maintenance Requests from Scheduled Maintenance entries.
    // Runs once every day at 2:00 AM (0 2 * * *).
    // You can adjust the schedule as needed (e.g., hourly, weekly).
    cron.schedule('0 2 * * *', async () => {
        console.log('Running daily cron job: Generating scheduled maintenance requests...');
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize to start of day for comparison

        try {
            // Find scheduled maintenance entries that are due today or overdue
            const dueSchedules = await ScheduledMaintenance.find({
                nextDueDate: { $lte: today },
                status: 'Active' // Only consider active schedules
            });

            for (const schedule of dueSchedules) {
                // Check if a request for this exact due date has already been generated
                // This prevents duplicate requests if cron runs multiple times
                const existingRequest = await Request.findOne({
                    'scheduledMaintenanceRef': schedule._id,
                    'createdAt': { $gte: today } // Check if created today or after
                });

                if (existingRequest) {
                    console.log(`Skipping: Request already generated for schedule ${schedule._id} today.`);
                    continue;
                }

                // Create a new MaintenanceRequest based on the ScheduledMaintenance
                const newRequest = new Request({
                    title: `Scheduled Maintenance: ${schedule.title}`,
                    description: schedule.description,
                    category: 'Scheduled', // Or a more specific category if applicable
                    priority: 'Low', // Default priority for scheduled tasks
                    property: schedule.property,
                    unit: schedule.unit,
                    // For scheduled tasks, the "reporter" might be the PM/Landlord who set it up
                    // Or you can define a system user for automated tasks
                    reportedBy: schedule.assignedTo, // Assign reporter as the assignee for traceability
                    assignedTo: schedule.assignedTo,
                    status: 'New', // Initial status for a newly generated request
                    scheduledMaintenanceRef: schedule._id, // Link back to the schedule
                });

                await newRequest.save();
                console.log(`Generated new maintenance request for schedule ${schedule._id}: ${newRequest._id}`);

                // Update the ScheduledMaintenance entry's lastRunDate and calculate nextDueDate
                // Based on frequency, update nextDueDate
                let nextDate = new Date(schedule.nextDueDate || today);
                if (schedule.frequency === 'Daily') {
                    nextDate.setDate(nextDate.getDate() + 1);
                } else if (schedule.frequency === 'Weekly') {
                    nextDate.setDate(nextDate.getDate() + 7);
                } else if (schedule.frequency === 'Monthly') {
                    nextDate.setMonth(nextDate.getMonth() + 1);
                } else if (schedule.frequency === 'Quarterly') {
                    nextDate.setMonth(nextDate.getMonth() + 3);
                } else if (schedule.frequency === 'Bi-Annually') {
                    nextDate.setMonth(nextDate.getMonth() + 6);
                } else if (schedule.frequency === 'Annually') {
                    nextDate.setFullYear(nextDate.getFullYear() + 1);
                }
                // For 'Custom' frequency, you'd need more logic or user input for definition

                schedule.lastRunDate = new Date();
                schedule.nextDueDate = nextDate; // Set for the next cycle
                schedule.tasksGenerated.push(newRequest._id); // Add the generated request ID
                await schedule.save();

                // Send notification to the assigned person (PM/Vendor)
                const assignedUser = await User.findById(schedule.assignedTo);
                if (assignedUser && assignedUser.email) {
                    const requestLink = `${process.env.VITE_API_URL}/requests/${newRequest._id}`; // Frontend URL for the request
                    await sendRequestNotificationEmail(assignedUser.email, newRequest.title, newRequest.status, requestLink);
                    console.log(`Notification sent for new scheduled request ${newRequest._id} to ${assignedUser.email}`);
                }
            }
        } catch (error) {
            console.error('Error in scheduled maintenance cron job:', error);
        }
    }, {
        scheduled: true,
        timezone: "Africa/Nairobi" // Set your application's timezone, e.g., "America/New_York" or "UTC"
    });

    // Cron job to send reminders for unacted-on tasks.
    // Runs once every day at 9:00 AM (0 9 * * *).
    cron.schedule('0 9 * * *', async () => {
        console.log('Running daily cron job: Sending reminders for overdue requests...');
        const reminderThreshold = new Date();
        // Tasks not acted on for more than X days (e.g., 3 days)
        reminderThreshold.setDate(reminderThreshold.getDate() - 3);

        try {
            const overdueRequests = await MaintenanceRequest.find({
                status: { $in: ['New', 'Assigned'] }, // Requests that are new or assigned but not yet 'In Progress'
                createdAt: { $lte: reminderThreshold }, // Created X days ago or earlier
            }).populate('property reportedBy assignedTo', 'name email role'); // Populate to get email and names

            for (const request of overdueRequests) {
                console.log(`Sending reminder for request ${request._id}: "${request.title}"`);

                // Determine who to notify: typically the assignedTo (PM/Vendor)
                const recipient = request.assignedTo;
                if (recipient && recipient.email) {
                    const requestLink = `${process.env.VITE_API_URL}/requests/${request._id}`;
                    const subject = `Reminder: Action Required for Maintenance Request "${request.title}"`;
                    const text = `Hello ${recipient.name || recipient.email},

This is a reminder that maintenance request "${request.title}" (reported by ${request.reportedBy ? request.reportedBy.email : 'an unknown user'}) is still awaiting action.

Current Status: ${request.status}

Please review and update the status as soon as possible.
View details: ${requestLink}

Best regards,
The Fix It by Threalty Team`;

                    const html = `
                        <p>Hello ${recipient.name || recipient.email},</p>
                        <p>This is a reminder that maintenance request "<strong>${request.title}</strong>" (reported by ${request.reportedBy ? request.reportedBy.email : 'an unknown user'}) is still awaiting action.</p>
                        <p>Current Status: <strong>${request.status}</strong></p>
                        <p>Please review and update the status as soon as possible.</p>
                        <p>View details: <a href="${requestLink}">${requestLink}</a></p>
                        <p>Best regards,<br/>The Fix It by Threalty Team</p>
                    `;

                    await sendRequestNotificationEmail(recipient.email, request.title, request.status, requestLink);
                    console.log(`Reminder sent for request ${request._id} to ${recipient.email}`);

                    // Optionally, you could also notify the landlord or PM associated with the property
                    // if the assignedTo is a vendor and the task is still overdue.
                }
            }
        } catch (error) {
            console.error('Error in overdue requests reminder cron job:', error);
        }
    }, {
        scheduled: true,
        timezone: "Africa/Nairobi" // Set your application's timezone
    });

    console.log('All cron jobs scheduled.');
};

module.exports = startCronJobs;

