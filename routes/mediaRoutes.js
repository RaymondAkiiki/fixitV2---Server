const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/mediaController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// For handling file uploads (e.g., multer)
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Adjust storage config as needed

// Upload media file
router.post(
  '/',
  protect,
  upload.single('file'), // 'file' is the field name in form-data
  mediaController.uploadMedia
);

// Get all media
router.get(
  '/',
  protect,
  mediaController.getAllMedia
);

// Get media by ID
router.get(
  '/:id',
  protect,
  mediaController.getMediaById
);

// Delete media (admin only)
router.delete(
  '/:id',
  protect,
  authorizeRoles('admin'),
  mediaController.deleteMedia
);

module.exports = router;