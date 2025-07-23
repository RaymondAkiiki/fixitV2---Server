// backend/routes/dashboardRoutes.js

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { protect,  authorizeRoles } = require('../middleware/authMiddleware');

// Get dashboard data for different user roles
router.get('/admin/dashboard-data', 
  protect, 
  authorizeRoles('admin'), 
  dashboardController.getAdminDashboardData
);

router.get('/pm/dashboard-data', 
  protect, 
  authorizeRoles('admin', 'propertymanager'), 
  dashboardController.getPMDashboardData
);

router.get('/landlord/dashboard-data', 
  protect, 
  authorizeRoles('admin', 'landlord'), 
  dashboardController.getLandlordDashboardData
);

router.get('/tenant/dashboard-data', 
  protect, 
  authorizeRoles('tenant'), 
  dashboardController.getTenantDashboardData
);

// Get detailed data for a specific section
router.get('/dashboard/:section', 
  protect, 
  dashboardController.getDashboardSection
);

module.exports = router;