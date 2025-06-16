// backend/models/Comment.js

const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema(
    {
        contextType: { // Type of resource the comment is attached to
            type: String, 
            enum: ['request', 'scheduledmaintenance', 'property', 'unit'], // Consistent lowercase, matched ScheduledMaintenance
            required: [true, 'Context type is required for comment.'],
            lowercase: true
        },
        contextId: { // ID of the resource (e.g., MaintenanceRequest ID, ScheduledMaintenance ID)
            type: mongoose.Schema.Types.ObjectId, 
            required: [true, 'Context ID is required for comment.'] 
        },
        sender: { // The user who posted the comment
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'User', 
            required: [true, 'Sender is required for comment.'] 
        },
        message: { 
            type: String, 
            required: [true, 'Comment message is required.'], 
            maxlength: [1000, 'Comment message cannot exceed 1000 characters.'] 
        }, 
    },
    { timestamps: true }
);

// Compound index for fast lookup of comments by context
commentSchema.index({ contextType: 1, contextId: 1 });
commentSchema.index({ sender: 1 }); // Index for finding comments by a specific user

module.exports = mongoose.models.Comment || mongoose.model('Comment', commentSchema);
