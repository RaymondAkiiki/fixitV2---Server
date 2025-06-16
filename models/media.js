const mongoose = require('mongoose');

const MAX_SIZE_MB = 20;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

const mediaSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true,
  },
  originalname: {
    type: String,
    required: true,
  },
  mimeType: {
    type: String,
    required: true,
  },
  size: { 
    type: Number, 
    required: true,
    validate: {
      validator: function(v) {
        return v <= MAX_SIZE_BYTES;
      },
      message: props => `File size (${props.value}) exceeds maximum allowed size of ${MAX_SIZE_MB} MB`
    }
  },
  uploadDate: {
    type: Date,
    default: Date.now,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Assuming you have a User model
    required: true,
  },
  relatedTo: {
    type: String,
    enum: ['Property', 'Request', 'User', 'Unit' , 'Vendor' , 'ScheduledMaintenance'], // Example: Media related to a property, request, or user
    required: true,
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true, // ID of the related entity (e.g., property ID, request ID)
  },
  filePath: {
    type: String, // Path to the stored file (e.g., in uploads directory)
    required: true,
  },
  description: {
    type: String, // Optional description of the media
    default: null,
  },
   url: { type: String, required: true }, // URL from cloud storage
});

module.exports = mongoose.models.Media || mongoose.model('Media', mediaSchema);