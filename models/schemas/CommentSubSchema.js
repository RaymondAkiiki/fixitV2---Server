// server/models/schemas/CommentSubSchema.js
const mongoose = require('mongoose');

const commentSubSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true, maxlength: [1000, 'Comment message cannot exceed 1000 characters.'] },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

module.exports = commentSubSchema;