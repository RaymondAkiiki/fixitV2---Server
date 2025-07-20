const mongoose = require('mongoose');
const Unit = require('../models/Unit');
const unitController = require('../controllers/unitController');
const { mockRequest, mockResponse } = require('./setup');

describe('Unit Tests', () => {
  describe('Unit Model', () => {
    it('should create a new unit', async () => {
      const unitData = {
        unitNumber: 'A101',
        property: mongoose.Types.ObjectId(),
        type: 'apartment',
        bedrooms: 2,
        bathrooms: 1,
        sqft: 850,
        rentAmount: 1200,
        status: 'vacant',
        amenities: ['balcony', 'dishwasher', 'central_air']
      };
      
      const unit = new Unit(unitData);
      const savedUnit = await unit.save();
      
      expect(savedUnit._id).toBeDefined();
      expect(savedUnit.unitNumber).toBe(unitData.unitNumber);
      expect(savedUnit.bedrooms).toBe(2);
      expect(savedUnit.rentAmount).toBe(1200);
      expect(savedUnit.amenities).toHaveLength(3);
    });
    
    it('should validate required fields', async () => {
      const unit = new Unit({
        bedrooms: 2,
        bathrooms: 1
      });
      
      let error;
      try {
        await unit.save();
      } catch (e) {
        error = e;
      }
      
      expect(error).toBeDefined();
      expect(error.errors.unitNumber).toBeDefined();
      expect(error.errors.property).toBeDefined();
    });
  });
  
  describe('Unit Controller', () => {
    const propertyId = mongoose.Types.ObjectId();
    
    beforeEach(async () => {
      await Unit.insertMany([
        {
          unitNumber: 'A101',
          property: propertyId,
          type: 'apartment',
          bedrooms: 2,
          bathrooms: 1,
          sqft: 850,
          rentAmount: 1200,
          status: 'vacant',
          amenities: ['balcony', 'dishwasher']
        },
        {
          unitNumber: 'A102',
          property: propertyId,
          type: 'apartment',
          bedrooms: 1,
          bathrooms: 1,
          sqft: 650,
          rentAmount: 950,
          status: 'occupied',
          amenities: ['dishwasher']
        },
        {
          unitNumber: 'B101',
          property: mongoose.Types.ObjectId(),
          type: 'studio',
          bedrooms: 0,
          bathrooms: 1,
          sqft: 500,
          rentAmount: 800,
          status: 'vacant',
          amenities: []
        }
      ]);
    });
    
    it('should get all units', async () => {
      const req = mockRequest();
      const res = mockResponse();
      
      await unitController.getAllUnits(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const units = res.json.mock.calls[0][0].data;
      expect(units).toHaveLength(3);
    });
    
    it('should get units by property', async () => {
      const req = mockRequest({ query: { property: propertyId.toString() } });
      const res = mockResponse();
      
      await unitController.getAllUnits(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const units = res.json.mock.calls[0][0].data;
      expect(units).toHaveLength(2);
      expect(units[0].property.toString()).toBe(propertyId.toString());
    });
    
    it('should get vacant units', async () => {
      const req = mockRequest({ query: { status: 'vacant' } });
      const res = mockResponse();
      
      await unitController.getAllUnits(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const units = res.json.mock.calls[0][0].data;
      expect(units).toHaveLength(2);
      expect(units[0].status).toBe('vacant');
    });
    
    it('should get unit by ID', async () => {
      const unit = await Unit.findOne({ unitNumber: 'A101' });
      const req = mockRequest({ params: { id: unit._id.toString() } });
      const res = mockResponse();
      
      await unitController.getUnitById(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const returnedUnit = res.json.mock.calls[0][0].data;
      expect(returnedUnit._id.toString()).toBe(unit._id.toString());
      expect(returnedUnit.unitNumber).toBe('A101');
    });
    
    it('should create a new unit', async () => {
      const unitData = {
        unitNumber: 'C101',
        property: mongoose.Types.ObjectId().toString(),
        type: 'townhouse',
        bedrooms: 3,
        bathrooms: 2.5,
        sqft: 1500,
        rentAmount: 1800,
        status: 'vacant',
        amenities: ['garage', 'fireplace', 'backyard']
      };
      
      const req = mockRequest({ body: unitData });
      const res = mockResponse();
      
      await unitController.createUnit(req, res);
      
      expect(res.status).toHaveBeenCalledWith(201);
      
      const unit = await Unit.findOne({ unitNumber: 'C101' });
      expect(unit).toBeDefined();
      expect(unit.type).toBe('townhouse');
      expect(unit.bedrooms).toBe(3);
    });
    
    it('should update a unit', async () => {
      const unit = await Unit.findOne({ unitNumber: 'A101' });
      const req = mockRequest({
        params: { id: unit._id.toString() },
        body: { rentAmount: 1300, amenities: ['balcony', 'dishwasher', 'washer_dryer'] }
      });
      const res = mockResponse();
      
      await unitController.updateUnit(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      
      const updatedUnit = await Unit.findById(unit._id);
      expect(updatedUnit.rentAmount).toBe(1300);
      expect(updatedUnit.amenities).toHaveLength(3);
      expect(updatedUnit.amenities).toContain('washer_dryer');
    });
  });
});