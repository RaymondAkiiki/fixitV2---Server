// src/models/comment.js

const mongoose = require('mongoose');
const { AUDIT_RESOURCE_TYPE_ENUM } = require('../utils/constants/enums');

const commentSchema = new mongoose.Schema(
    {
        contextType: {
            type: String,
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
            trim: true,
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
            required: [function() { return this.isExternal; }, 'External user email is required for external comments.'],
            match: [
                /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
                'Please enter a valid email for external user.',
            ]
        },
        isInternalNote: {
            type: Boolean,
            default: false
        },
        isEdited: {
            type: Boolean,
            default: false
        },
        lastEditedAt: {
            type: Date,
            default: null
        },
        media: [{ 
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Media'
        }],
        mentions: [{
            user: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            },
            readAt: {
                type: Date,
                default: null
            }
        }]
    },
    { 
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

// Virtual for the formatted date (more readable in frontend)
commentSchema.virtual('formattedDate').get(function() {
    return this.createdAt ? this.createdAt.toLocaleString() : '';
});

// Pre-save middleware to update lastEditedAt and isEdited flags when message is modified
commentSchema.pre('save', function(next) {
    if (this.isModified('message') && !this.isNew) {
        this.isEdited = true;
        this.lastEditedAt = new Date();
    }
    next();
});

// Compound index for fast lookup of comments by context
commentSchema.index({ contextType: 1, contextId: 1, createdAt: 1 });
commentSchema.index({ sender: 1 });
commentSchema.index({ externalUserEmail: 1 });
commentSchema.index({ 'mentions.user': 1 });

module.exports = mongoose.models.Comment || mongoose.model('Comment', commentSchema);