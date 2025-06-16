// backend/routes/commentRoutes.js

const express = require('express');
const { body, query } = require('express-validator'); // Import validation functions
const router = express.Router();
const commentController = require('../controllers/commentController'); // Corrected import path
const { protect } = require('../middleware/authMiddleware'); // Corrected import path

// Validation for adding a comment
// ContextType enum values are now lowercase to match model/controller
const addCommentValidation = [
    body('contextType').isIn(['request', 'scheduledmaintenance', 'property', 'unit'])
        .withMessage('Invalid context type.'),
    body('contextId').isMongoId().withMessage('Invalid context ID.'),
    body('message').notEmpty().withMessage('Message is required.')
        .isLength({ max: 1000 }).withMessage('Message cannot exceed 1000 characters.'),
];

// Validation for listing comments
// ContextType enum values are now lowercase to match model/controller
const listCommentsValidation = [
    query('contextType').isIn(['request', 'scheduledmaintenance', 'property', 'unit'])
        .withMessage('Invalid context type.'),
    query('contextId').isMongoId().withMessage('Invalid context ID.'),
];

// --- ROUTES ---

// POST /api/comments - Add a new comment to a specified resource
router.post('/', protect, addCommentValidation, commentController.addComment);

// GET /api/comments - List comments for a specified resource
router.get('/', protect, listCommentsValidation, commentController.listComments);

module.exports = router;
