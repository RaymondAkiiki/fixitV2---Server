const mongoose = require('mongoose');
const Rent = require('../models/Rent');
const rentController = require('../controllers/rentController');
const rentService = require('../services/rentService');
const { mockRequest, mockResponse } = require('./setup');

// Mock the Invoice model
jest.mock('../models/Invoice', () => ({
  create: jest.fn().mockImplementation(data => Promise.resolve({ _id: mongoose.Types.ObjectId(), ...data }))
}));

describe('Rent Tests', () => {
  describe('Rent Model', () => {
    it('should create a new rent record', async () => {
      const rentData = {
        lease: mongoose.Types.ObjectId(),
        tenant: mongoose.Types.ObjectId(),
        property: mongoose.Types.ObjectId(),
        unit: mongoose.Types.ObjectId(),
        amount: 1200,
        dueDate: new Date('2025-08-01'),
        status: 'pending',
        additionalCharges: [
          { description: 'Parking Fee', amount: 150 }
        ]
      };
      
      const rent = new Rent(rentData);
      const savedRent = await rent.save();
      
      expect(savedRent._id).toBeDefined();
      expect(savedRent.amount).toBe(1200);
      expect(savedRent.status).toBe('pending');
      expect(savedRent.additionalCharges).toHaveLength(1);
    });
  });
  
  describe('Rent Service', () => {
    it('should generate rent for a lease', async () => {
      const leaseData = {
        _id: mongoose.Types.ObjectId(),
        tenant: mongoose.Types.ObjectId(),
        property: mongoose.Types.ObjectId(),
        unit: mongoose.Types.ObjectId(),
        rentAmount: 1200,
        startDate: new Date('2025-07-01'),
        endDate: new Date('2026-06-30'),
        paymentDueDay: 1,
        additionalCharges: [
          { description: 'Parking Fee', amount: 150, recurring: true }
        ]
      };
      
      const rent = await rentService.generateRentFromLease(leaseData, new Date('2025-08-01'));
      
      expect(rent._id).toBeDefined();
      expect(rent.lease.toString()).toBe(leaseData._id.toString());
      expect(rent.amount).toBe(1200);
      expect(rent.dueDate.getMonth()).toBe(7); // August (0-indexed)
      expect(rent.additionalCharges).toHaveLength(1);
      expect(rent.additionalCharges[0].amount).toBe(150);
    });
    
    it('should mark rent as paid', async () => {
      // Create a test rent record
      const rent = await Rent.create({
        lease: mongoose.Types.ObjectId(),
        tenant: mongoose.Types.ObjectId(),
        property: mongoose.Types.ObjectId(),
        unit: mongoose.Types.ObjectId(),
        amount: 1200,
        dueDate: new Date('2025-08-01'),
        status: 'pending',
        additionalCharges: [
          { description: 'Parking Fee', amount: 150 }
        ]
      });
      
      const paymentData = {
        amount: 1350, // rent + parking
        paymentMethod: 'credit_card',
        paymentDate: new Date(),
        transactionId: 'txn_12345'
      };
      
      const updatedRent = await rentService.markRentAsPaid(
        rent._id,
        paymentData
      );
      
      expect(updatedRent.status).toBe('paid');
      expect(updatedRent.payment).toBeDefined();
      expect(updatedRent.payment.transactionId).toBe('txn_12345');
    });
    
    it('should generate invoice from rent', async () => {
      const rent = await Rent.create({
        lease: mongoose.Types.ObjectId(),
        tenant: mongoose.Types.ObjectId(),
        property: mongoose.Types.ObjectId(),
        unit: mongoose.Types.ObjectId(),
        amount: 1200,
        dueDate: new Date('2025-08-01'),
        status: 'pending',
        additionalCharges: [
          { description: 'Parking Fee', amount: 150 }
        ]
      });
      
      const invoice = await rentService.generateInvoiceForRent(rent._id);
      
      expect(invoice).toBeDefined();
      expect(invoice.amount).toBe(1350); // 1200 + 150
      
      // Check that Invoice.create was called
      const Invoice = require('../models/Invoice');
      expect(Invoice.create).toHaveBeenCalled();
    });
  });
  
  describe('Rent Controller', () => {
    const tenantId = mongoose.Types.ObjectId();
    const propertyId = mongoose.Types.ObjectId();
    
    beforeEach(async () => {
      await Rent.insertMany([
        {
          lease: mongoose.Types.ObjectId(),
          tenant: tenantId,
          property: propertyId,
          unit: mongoose.Types.ObjectId(),
          amount: 1200,
          dueDate: new Date('2025-08-01'),
          status: 'pending',
          additionalCharges: [
            { description: 'Parking Fee', amount: 150 }
          ]
        },
        {
          lease: mongoose.Types.ObjectId(),
          tenant: tenantId,
          property: propertyId,
          unit: mongoose.Types.ObjectId(),
          amount: 1200,
          dueDate: new Date('2025-07-01'),
          status: 'paid',
          additionalCharges: [
            { description: 'Parking Fee', amount: 150 }
          ],
          payment: {
            amount: 1350,
            paymentMethod: 'bank_transfer',
            paymentDate: new Date('2025-07-01'),
            transactionId: 'txn_12345'
          }
        },
        {
          lease: mongoose.Types.ObjectId(),
          tenant: mongoose.Types.ObjectId(),
          property: mongoose.Types.ObjectId(),
          unit: mongoose.Types.ObjectId(),
          amount: 950,
          dueDate: new Date('2025-08-01'),
          status: 'pending',
          additionalCharges: []
        }
      ]);
    });
    
    it('should get all rent records', async () => {
      const req = mockRequest();
      const res = mockResponse();
      
      await rentController.getAllRent(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const rents = res.json.mock.calls[0][0].data;
      