const express = require("express");
const router = express.Router();
const { getTenantById, createTenant, updateTenant } = require("../controllers/tenantController");
const { protect } = require("../middleware/authMiddleware");

// Routes
router.get("/:id", protect, getTenantById);
router.post("/", protect, createTenant);
router.put("/:id", protect, updateTenant);

module.exports = router;
