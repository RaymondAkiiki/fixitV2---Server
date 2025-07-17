// server/models/schemas/FeedbackSubSchema.js
const mongoose = require('mongoose');

const feedbackSubSchema = new mongoose.Schema({
  rating: { type: Number, min: 1, max: 5, default: null },
  comment: { type: String, maxlength: [1000, 'Feedback comment cannot exceed 1000 characters.'], default: null },
  submittedAt: { type: Date, default: null },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { _id: false });

module.exports = feedbackSubSchema;