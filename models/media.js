const mongoose = require('mongoose');
const { MEDIA_RELATED_TO_ENUM } = require('../utils/constants/enums');

const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const mediaSchema = new mongoose.Schema({
    publicId: {
        type: String,
        required: [true, 'Cloudinary publicId required.'],
        unique: true,
        index: true,
    },
    filename: { // For display, from original upload
        type: String,
        required: [true, 'Filename is required.']
    },
    originalname: {
        type: String,
        required: [true, 'Original filename is required.'],
        maxlength: [255, 'Original filename cannot exceed 255 characters.']
    },
    mimeType: {
        type: String,
        required: [true, 'MIME type is required.'],
        trim: true
    },
    size: {
        type: Number,
        required: [true, 'File size is required.'],
        min: [0, 'File size cannot be negative.'],
        validate: {
            validator: function(v) {
                return v <= MAX_FILE_SIZE_BYTES;
            },
            message: props => `File size (${(props.value / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed size of ${MAX_FILE_SIZE_MB} MB.`
        }
    },
    url: {
        type: String,
        required: [true, 'Media URL is required.'],
        unique: true
    },
    thumbnailUrl: { type: String, default: null },
    resourceType: { type: String, default: 'image' }, // Cloudinary resource_type
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Uploader is required for media.']
    },
    relatedTo: {
        type: String,
        enum: MEDIA_RELATED_TO_ENUM,
        required: [true, 'Related resource type is required.'],
    },
    relatedId: {
        type: mongoose.Schema.Types.ObjectId,
        required: [true, 'Related resource ID is required.'],
        refPath: 'relatedTo'
    },
    description: {
        type: String,
        maxlength: [1000, 'Description cannot exceed 1000 characters.'],
        default: null,
    },
    tags: {
        type: [String],
        default: []
    },
    isPublic: { type: Boolean, default: false }
}, { timestamps: true });

mediaSchema.index({ relatedTo: 1, relatedId: 1 });
mediaSchema.index({ uploadedBy: 1 });
mediaSchema.index({ mimeType: 1 });
mediaSchema.index({ tags: 1 });

module.exports = mongoose.models.Media || mongoose.model('Media', mediaSchema);