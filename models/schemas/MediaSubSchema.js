// server/models/schemas/MediaSubSchema.js
const mongoose = require('mongoose');

const mediaSubSchema = new mongoose.Schema({
  url: { type: String, required: true },
  description: { type: String, default: null, maxlength: 500 },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

module.exports = mediaSubSchema;