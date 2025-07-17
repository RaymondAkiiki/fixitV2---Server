// server/models/schemas/DocumentSchema.js
const mongoose = require('mongoose');

// DocumentSchema will now primarily serve as metadata for external documents or
// embedded document details if not handled by the central Media model.
// For files uploaded to Cloudinary (or similar), prefer referencing the Media model.
const documentSchema = new mongoose.Schema({
  url: { type: String, required: true },
  name: { type: String, required: true },
  mimeType: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

module.exports = documentSchema;