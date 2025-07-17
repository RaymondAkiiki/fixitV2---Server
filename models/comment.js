// server/models/comment.js
const mongoose = require('mongoose');
const { AUDIT_RESOURCE_TYPE_ENUM } = require('../utils/constants/enums');

const commentSchema = new mongoose.Schema(
    {
        contextType: {
            type: String,
            // Filter out 'Comment' itself if a comment cannot be a context for another comment,
            // or if recursive comments are not intended at the top level.
            // Keeping it as is, excluding 'Comment' from enum.
            enum: AUDIT_RESOURCE_TYPE_ENUM.filter(type => type !== 'Comment'),
            required: [true, 'Context type is required for comment.'],
            lowercase: true,
            index: true
        },
        contextId: {
            type: mongoose.Schema.Types.ObjectId,
            required: [true, 'Context ID is required for comment.'],
            refPath: 'contextType',
            index: true
        },
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            required: [function() { return !this.isExternal; }, 'Sender is required for internal comments.']
        },
        message: {
            type: String,
            required: [true, 'Comment message is required.'],
            maxlength: [2000, 'Comment message cannot exceed 2000 characters.']
        },
        isExternal: {
            type: Boolean,
            default: false
        },
        externalUserName: {
            type: String,
            trim: true,
            default: null,
            required: [function() { return this.isExternal; }, 'External user name is required for external comments.']
        },
        externalUserEmail: {
            type: String,
            trim: true,
            lowercase: true,
            default: null,
            required: [function() { return this.isExternal; }, 'External user email is required for external comments.']
        },
        isInternalNote: {
            type: Boolean,
            default: false
        },
        media: [{ // Now referencing Media model directly for consistency
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Media'
        }]
    },
    { timestamps: true }
);

// Compound index for fast lookup of comments by context
commentSchema.index({ contextType: 1, contextId: 1, createdAt: 1 });
commentSchema.index({ sender: 1 });
commentSchema.index({ externalUserEmail: 1 });

module.exports = mongoose.models.Comment || mongoose.model('Comment', commentSchema);