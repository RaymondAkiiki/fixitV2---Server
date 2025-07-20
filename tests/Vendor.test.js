const mongoose = require('mongoose');
const Vendor = require('../models/Vendor');
const vendorController = require('../controllers/vendorController');
const { mockRequest, mockResponse } = require('./setup');

describe('Vendor Tests', () => {
  describe('Vendor Model', () => {
    it('should create a new vendor', async () => {
      const vendorData = {
        name: 'Test Vendor',
        contactPerson: 'John Doe',
        email: 'vendor@example.com',
        phone: '1234567890',
        address: {
          street: '123 Vendor St',
          city: 'Vendor City',
          state: 'VS',
          zipCode: '12345'
        },
        services: ['Plumbing', 'Electrical'],
        taxId: '12-3456789'
      };
      
      const vendor = new Vendor(vendorData);
      const savedVendor = await vendor.save();
      
      expect(savedVendor._id).toBeDefined();
      expect(savedVendor.name).toBe(vendorData.name);
      expect(savedVendor.email).toBe(vendorData.email);
      expect(savedVendor.services).toHaveLength(2);
    });
    
    it('should fail if required fields are missing', async () => {
      const vendor = new Vendor({
        contactPerson: 'John Doe',
        phone: '1234567890'
      });
      
      let error;
      try {
        await vendor.save();
      } catch (e) {
        error = e;
      }
      
      expect(error).toBeDefined();
      expect(error.errors.name).toBeDefined();
      expect(error.errors.email).toBeDefined();
    });
  });
  
  describe('Vendor Controller', () => {
    beforeEach(async () => {
      await Vendor.create([
        {
          name: 'Plumbing Co',
          contactPerson: 'Mike Smith',
          email: 'mike@plumbingco.com',
          phone: '1234567890',
          services: ['Plumbing']
        },
        {
          name: 'Electric Experts',
          contactPerson: 'Sarah Johnson',
          email: 'sarah@electric.com',
          phone: '0987654321',
          services: ['Electrical']
        }
      ]);
    });
    
    it('should get all vendors', async () => {
      const req = mockRequest();
      const res = mockResponse();
      
      await vendorController.getAllVendors(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const vendors = res.json.mock.calls[0][0].data;
      expect(vendors).toHaveLength(2);
    });
    
    it('should get vendor by ID', async () => {
      const vendor = await Vendor.findOne({ name: 'Plumbing Co' });
      const req = mockRequest({ params: { id: vendor._id.toString() } });
      const res = mockResponse();
      
      await vendorController.getVendorById(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const returnedVendor = res.json.mock.calls[0][0].data;
      expect(returnedVendor.name).toBe('Plumbing Co');
    });
    
    it('should filter vendors by service', async () => {
      const req = mockRequest({ query: { service: 'Electrical' } });
      const res = mockResponse();
      
      await vendorController.getAllVendors(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const vendors = res.json.mock.calls[0][0].data;
      expect(vendors).toHaveLength(1);
      expect(vendors[0].name).toBe('Electric Experts');
    });
    
    it('should update a vendor', async () => {
      const vendor = await Vendor.findOne({ name: 'Plumbing Co' });
      const req = mockRequest({ 
        params: { id: vendor._id.toString() },
        body: { phone: '5555555555' }
      });
      const res = mockResponse();
      
      await vendorController.updateVendor(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      
      const updatedVendor = await Vendor.findById(vendor._id);
      expect(updatedVendor.phone).toBe('5555555555');
    });
  });
});