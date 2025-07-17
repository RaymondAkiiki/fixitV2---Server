// server/models/schemas/AddressSchema.js
const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  street: { type: String, trim: true, default: null },
  city: { type: String, required: [true, 'City is required for address.'], trim: true },
  state: { type: String, trim: true, default: null },
  zipCode: { type: String, trim: true, default: null },
  country: { type: String, required: [true, 'Country is required for address.'], trim: true },
}, { _id: false });

module.exports = addressSchema;