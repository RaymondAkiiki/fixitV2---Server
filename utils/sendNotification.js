// fixtit-backend/utils/sendNotification.js

const Notification = require("../models/notification");

/**
 * Sends an in-app notification to a user.
 * @param {string} recipientId - User ID to notify
 * @param {string} message - Notification message
 * @param {string} [link] - Optional link for the notification
 * @returns {Promise<void>}
 */
const sendNotification = async (recipientId, message, link = "") => {
  try {
    await Notification.create({
      recipient: recipientId,
      message,
      link,
    });
  } catch (error) {
    console.error("Notification Error:", error.message);
  }
};

module.exports = sendNotification;

/**
 * CHANGES/NOTES:
 * - Added a JSDoc comment for clarity.
 * - No changes to business logic (simple, robust).
 */