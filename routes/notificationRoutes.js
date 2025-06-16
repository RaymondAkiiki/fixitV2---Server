const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const notificationController = require("../controllers/notificationController");

// Get all notifications for the logged-in user
router.get("/", protect, notificationController.getAllNotifications);

// Mark a notification as read by ID
router.patch("/:id/read", protect, notificationController.markAsRead);

module.exports = router;
