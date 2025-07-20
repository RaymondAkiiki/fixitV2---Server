const mongoose = require('mongoose');
const Property = require('../models/Property');
const propertyController = require('../controllers/propertyController');
const { mockRequest, mockResponse } = require('./setup');

describe('Property Tests', () => {
  describe('Property Model', () => {
    it('should create a new property', async () => {
      const propertyData = {
        name: 'Sunset Apartments',
        address: {
          street: '123 Sunset Blvd',
          city: 'Los Angeles',
          state: 'CA',
          zipCode: '90210',
          country: 'USA'
        },
        type: 'apartment_building',
        totalUnits: 20,
        yearBuilt: 2010,
        amenities: ['pool', 'gym', 'parking'],
        owner: mongoose.Types.ObjectId(),
        manager: mongoose.Types.ObjectId()
      };
      
      const property = new Property(propertyData);
      const savedProperty = await property.save();
      
      expect(savedProperty._id).toBeDefined();
      expect(savedProperty.name).toBe(propertyData.name);
      expect(savedProperty.address.city).toBe('Los Angeles');
      expect(savedProperty.totalUnits).toBe(20);
      expect(savedProperty.amenities).toHaveLength(3);
    });
    
    it('should validate required fields', async () => {
      const property = new Property({
        type: 'apartment_building',
        totalUnits: 20
      });
      
      let error;
      try {
        await property.save();
      } catch (e) {
        error = e;
      }
      
      expect(error).toBeDefined();
      expect(error.errors.name).toBeDefined();
      expect(error.errors['address.street']).toBeDefined();
    });
  });
  
  describe('Property Controller', () => {
    const ownerId = mongoose.Types.ObjectId();
    
    beforeEach(async () => {
      await Property.insertMany([
        {
          name: 'Sunset Apartments',
          address: {
            street: '123 Sunset Blvd',
            city: 'Los Angeles',
            state: 'CA',
            zipCode: '90210',
            country: 'USA'
          },
          type: 'apartment_building',
          totalUnits: 20,
          yearBuilt: 2010,
          amenities: ['pool', 'gym', 'parking'],
          owner: ownerId,
          manager: mongoose.Types.ObjectId()
        },
        {
          name: 'Downtown Lofts',
          address: {
            street: '456 Main St',
            city: 'San Francisco',
            state: 'CA',
            zipCode: '94105',
            country: 'USA'
          },
          type: 'loft',
          totalUnits: 10,
          yearBuilt: 2015,
          amenities: ['rooftop', 'security'],
          owner: ownerId,
          manager: mongoose.Types.ObjectId()
        },
        {
          name: 'Lakeside Homes',
          address: {
            street: '789 Lake Rd',
            city: 'Chicago',
            state: 'IL',
            zipCode: '60601',
            country: 'USA'
          },
          type: 'single_family',
          totalUnits: 5,
          yearBuilt: 2008,
          amenities: ['lake_view', 'garage'],
          owner: mongoose.Types.ObjectId(),
          manager: mongoose.Types.ObjectId()
        }
      ]);
    });
    
    it('should get all properties', async () => {
      const req = mockRequest();
      const res = mockResponse();
      
      await propertyController.getAllProperties(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const properties = res.json.mock.calls[0][0].data;
      expect(properties).toHaveLength(3);
    });
    
    it('should get properties by owner', async () => {
      const req = mockRequest({ query: { owner: ownerId.toString() } });
      const res = mockResponse();
      
      await propertyController.getAllProperties(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const properties = res.json.mock.calls[0][0].data;
      expect(properties).toHaveLength(2);
      expect(properties[0].owner.toString()).toBe(ownerId.toString());
    });
    
    it('should get properties by type', async () => {
      const req = mockRequest({ query: { type: 'single_family' } });
      const res = mockResponse();
      
      await propertyController.getAllProperties(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const properties = res.json.mock.calls[0][0].data;
      expect(properties).toHaveLength(1);
      expect(properties[0].name).toBe('Lakeside Homes');
    });
    
    it('should get property by ID', async () => {
      const property = await Property.findOne({ name: 'Sunset Apartments' });
      const req = mockRequest({ params: { id: property._id.toString() } });
      const res = mockResponse();
      
      await propertyController.getPropertyById(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const returnedProperty = res.json.mock.calls[0][0].data;
      expect(returnedProperty._id.toString()).toBe(property._id.toString());
      expect(returnedProperty.name).toBe('Sunset Apartments');
    });
    
    it('should create a new property', async () => {
      const propertyData = {
        name: 'Mountain View Condos',
        address: {
          street: '321 Mountain Rd',
          city: 'Denver',
          state: 'CO',
          zipCode: '80202',
          country: 'USA'
        },
        type: 'condo',
        totalUnits: 12,
        yearBuilt: 2018,
        amenities: ['mountain_view', 'skiing_nearby'],
        owner: mongoose.Types.ObjectId().toString(),
        manager: mongoose.Types.ObjectId().toString()
      };
      
      const req = mockRequest({ body: propertyData });
      const res = mockResponse();
      
      await propertyController.createProperty(req, res);
      
      expect(res.status).toHaveBeenCalledWith(201);
      
      const property = await Property.findOne({ name: 'Mountain View Condos' });
      expect(property).toBeDefined();
      expect(property.type).toBe('condo');
      expect(property.totalUnits).toBe(12);
    });
    
    it('should update a property', async () => {
      const property = await Property.findOne({ name: 'Sunset Apartments' });
      const req = mockRequest({
        params: { id: property._id.toString() },
        body: { totalUnits: 25, amenities: ['pool', 'gym', 'parking', 'pet_friendly'] }
      });
      const res = mockResponse();
      
      await propertyController.updateProperty(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      
      const updatedProperty = await Property.findById(property._id);
      expect(updatedProperty.totalUnits).toBe(25);
      expect(updatedProperty.amenities).toHaveLength(4);
      expect(updatedProperty.amenities).toContain('pet_friendly');
    });
  });
});