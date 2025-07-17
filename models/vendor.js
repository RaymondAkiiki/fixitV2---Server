const mongoose = require('mongoose');
const { SERVICE_ENUM, STATUS_ENUM } = require('../utils/constants/enums');
const addressSchema = require('./schemas/AddressSchema');

const vendorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Vendor name is required.'],
    trim: true,
    maxlength: [100, 'Vendor name cannot exceed 100 characters.'],
  },
  phone: {
    type: String,
    required: [true, 'Vendor phone number is required.'],
    trim: true,
    validate: {
      validator: v => /^\+?[0-9\s-]{7,20}$/.test(v),
      message: props => `${props.value} is not a valid phone number format!`
    }
  },
  email: {
    type: String,
    required: [true, 'Vendor email is required.'],
    trim: true,
    unique: true,
    lowercase: true,
    match: [
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
      'Please enter a valid email.',
    ]
  },
  address: addressSchema,
  description: {
    type: String,
    maxlength: [1000, 'Description cannot exceed 1000 characters.'],
    default: null
  },
  services: {
    type: [String],
    required: [true, 'At least one service is required for the vendor.'],
    enum: {
      values: SERVICE_ENUM.map(s => s.toLowerCase()),
      message: '"{VALUE}" is not a supported service type.'
    }
  },
  contactPerson: { type: String, trim: true, default: null },
  fixedCalloutFee: { type: Number, min: [0, 'Fixed callout fee cannot be negative.'], default: 0 },
  paymentTerms: { type: String, trim: true, default: null },
  status: { type: String, enum: STATUS_ENUM, default: 'active', lowercase: true },
  averageRating: { type: Number, min: 1, max: 5, default: null },
  totalJobsCompleted: { type: Number, default: 0 },
  companyName: { type: String, trim: true, default: null },
  licenseNumber: { type: String, trim: true, default: null },
  insuranceDetails: { type: String, trim: true, default: null },
  notes: { type: String, trim: true, default: null },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'AddedBy user is required.']
  },
  associatedProperties: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property'
  }],
  documents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Media'
  }]
}, { timestamps: true });

vendorSchema.index({ services: 1 });
vendorSchema.index({ status: 1 });
vendorSchema.index({ companyName: 1 });

module.exports = mongoose.models.Vendor || mongoose.model('Vendor', vendorSchema);