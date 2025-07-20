const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const invoiceController = require('../controllers/invoiceController');
const invoiceService = require('../services/invoiceService');
const { mockRequest, mockResponse } = require('./setup');

describe('Invoice Tests', () => {
  describe('Invoice Model', () => {
    it('should create a new invoice', async () => {
      const invoiceData = {
        invoiceNumber: 'INV-2025-001',
        tenant: mongoose.Types.ObjectId(),
        property: mongoose.Types.ObjectId(),
        unit: mongoose.Types.ObjectId(),
        amount: 1500,
        dueDate: new Date('2025-08-01'),
        items: [
          { description: 'Monthly Rent', amount: 1200 },
          { description: 'Parking Fee', amount: 150 },
          { description: 'Utility Charge', amount: 150 }
        ],
        status: 'pending',
        createdBy: mongoose.Types.ObjectId()
      };
      
      const invoice = new Invoice(invoiceData);
      const savedInvoice = await invoice.save();
      
      expect(savedInvoice._id).toBeDefined();
      expect(savedInvoice.invoiceNumber).toBe(invoiceData.invoiceNumber);
      expect(savedInvoice.amount).toBe(1500);
      expect(savedInvoice.items).toHaveLength(3);
    });
  });
  
  describe('Invoice Service', () => {
    it('should generate an invoice from rent data', async () => {
      const rentData = {
        tenant: mongoose.Types.ObjectId(),
        property: mongoose.Types.ObjectId(),
        unit: mongoose.Types.ObjectId(),
        amount: 1200,
        dueDate: new Date('2025-08-01'),
        additionalCharges: [
          { description: 'Parking Fee', amount: 150 }
        ]
      };
      
      const invoice = await invoiceService.generateInvoiceFromRent(rentData);
      
      expect(invoice._id).toBeDefined();
      expect(invoice.amount).toBe(1350); // 1200 + 150
      expect(invoice.items).toHaveLength(2);
      expect(invoice.status).toBe('pending');
    });
    
    it('should mark an invoice as paid', async () => {
      // Create a test invoice
      const invoice = await Invoice.create({
        invoiceNumber: 'INV-2025-002',
        tenant: mongoose.Types.ObjectId(),
        property: mongoose.Types.ObjectId(),
        unit: mongoose.Types.ObjectId(),
        amount: 1500,
        dueDate: new Date('2025-08-01'),
        items: [{ description: 'Monthly Rent', amount: 1500 }],
        status: 'pending',
        createdBy: mongoose.Types.ObjectId()
      });
      
      const paymentData = {
        amount: 1500,
        paymentMethod: 'credit_card',
        paymentDate: new Date(),
        transactionId: 'txn_12345'
      };
      
      const updatedInvoice = await invoiceService.markInvoiceAsPaid(
        invoice._id,
        paymentData
      );
      
      expect(updatedInvoice.status).toBe('paid');
      expect(updatedInvoice.payment).toBeDefined();
      expect(updatedInvoice.payment.transactionId).toBe('txn_12345');
    });
  });
  
  describe('Invoice Controller', () => {
    beforeEach(async () => {
      const tenant = mongoose.Types.ObjectId();
      await Invoice.insertMany([
        {
          invoiceNumber: 'INV-2025-001',
          tenant,
          property: mongoose.Types.ObjectId(),
          unit: mongoose.Types.ObjectId(),
          amount: 1500,
          dueDate: new Date('2025-08-01'),
          items: [{ description: 'Monthly Rent', amount: 1500 }],
          status: 'pending',
          createdBy: mongoose.Types.ObjectId()
        },
        {
          invoiceNumber: 'INV-2025-002',
          tenant,
          property: mongoose.Types.ObjectId(),
          unit: mongoose.Types.ObjectId(),
          amount: 1500,
          dueDate: new Date('2025-07-01'),
          items: [{ description: 'Monthly Rent', amount: 1500 }],
          status: 'paid',
          payment: {
            amount: 1500,
            paymentMethod: 'bank_transfer',
            paymentDate: new Date('2025-07-01'),
            transactionId: 'txn_12345'
          },
          createdBy: mongoose.Types.ObjectId()
        }
      ]);
    });
    
    it('should get all invoices', async () => {
      const req = mockRequest();
      const res = mockResponse();
      
      await invoiceController.getAllInvoices(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const invoices = res.json.mock.calls[0][0].data;
      expect(invoices).toHaveLength(2);
    });
    
    it('should get invoices by tenant', async () => {
      const tenant = await Invoice.findOne().then(invoice => invoice.tenant);
      const req = mockRequest({ query: { tenant: tenant.toString() } });
      const res = mockResponse();
      
      await invoiceController.getAllInvoices(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const invoices = res.json.mock.calls[0][0].data;
      expect(invoices).toHaveLength(2);
    });
    
    it('should get invoices by status', async () => {
      const req = mockRequest({ query: { status: 'pending' } });
      const res = mockResponse();
      
      await invoiceController.getAllInvoices(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const invoices = res.json.mock.calls[0][0].data;
      expect(invoices).toHaveLength(1);
      expect(invoices[0].status).toBe('pending');
    });
    
    it('should get invoice by ID', async () => {
      const invoice = await Invoice.findOne({ status: 'pending' });
      const req = mockRequest({ params: { id: invoice._id.toString() } });
      const res = mockResponse();
      
      await invoiceController.getInvoiceById(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const returnedInvoice = res.json.mock.calls[0][0].data;
      expect(returnedInvoice._id.toString()).toBe(invoice._id.toString());
    });
  });
});