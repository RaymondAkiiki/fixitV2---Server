// src/models/unit.js

const mongoose = require('mongoose');
const { UNIT_STATUS_ENUM, UTILITY_RESPONSIBILITY_ENUM } = require('../utils/constants/enums');

const unitSchema = new mongoose.Schema({
  unitName: {
    type: String,
    required: [true, 'Unit name is required.'],
    trim: true,
    maxlength: [50, 'Unit name cannot exceed 50 characters.']
  },
  floor: {
    type: String,
    trim: true,
    default: null,
    maxlength: [20, 'Floor number/name cannot exceed 20 characters.']
  },
  details: {
    type: String,
    maxlength: [1000, 'Details cannot exceed 1000 characters.'],
    default: null
  },
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Unit must belong to a property.'],
    index: true
  },
  tenants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: []
  }],
  numBedrooms: { 
    type: Number, 
    min: [0, 'Number of bedrooms cannot be negative.'], 
    default: null 
  },
  numBathrooms: { 
    type: Number, 
    min: [0, 'Number of bathrooms cannot be negative.'], 
    default: null 
  },
  squareFootage: { 
    type: Number, 
    min: [0, 'Square footage cannot be negative.'], 
    default: null 
  },
  rentAmount: { 
    type: Number, 
    min: [0, 'Rent amount cannot be negative.'], 
    default: null 
  },
  depositAmount: { 
    type: Number, 
    min: [0, 'Deposit amount cannot be negative.'], 
    default: null 
  },
  status: {
    type: String,
    enum: UNIT_STATUS_ENUM,
    default: 'vacant',
    lowercase: true,
    index: true
  },
  utilityResponsibility: {
    type: String,
    enum: UTILITY_RESPONSIBILITY_ENUM,
    default: 'tenant_pays_all',
    lowercase: true
  },
  notes: {
    type: String,
    maxlength: [2000, 'Notes cannot exceed 2000 characters.'],
    default: null
  },
  lastInspected: { 
    type: Date, 
    default: null 
  },
  nextInspectionDate: {
    type: Date,
    default: null
  },
  unitImages: [{ 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Media'
  }],
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  amenities: {
    type: [String],
    default: []
  },
  features: [{
    name: String,
    description: String
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for occupancy status
unitSchema.virtual('isOccupied').get(function() {
  return this.tenants && this.tenants.length > 0;
});

// Virtual for calculating days since last inspection
unitSchema.virtual('daysSinceLastInspection').get(function() {
  if (!this.lastInspected) return null;
  const now = new Date();
  const diff = now - this.lastInspected;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
});

// Indexes
unitSchema.index({ property: 1, unitName: 1 }, { unique: true });
unitSchema.index({ status: 1, property: 1 });
unitSchema.index({ numBedrooms: 1, property: 1 });
unitSchema.index({ 'tenants': 1 });

module.exports = mongoose.models.Unit || mongoose.model('Unit', unitSchema);