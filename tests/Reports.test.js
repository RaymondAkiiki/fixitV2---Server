const mongoose = require('mongoose');
const reportController = require('../controllers/reportController');
const reportService = require('../services/reportService');
const { mockRequest, mockResponse } = require('./setup');

// Mock models that reports depend on
jest.mock('../models/Property', () => ({
  find: jest.fn(),
  aggregate: jest.fn()
}));

jest.mock('../models/Lease', () => ({
  find: jest.fn(),
  aggregate: jest.fn()
}));

jest.mock('../models/Rent', () => ({
  find: jest.fn(),
  aggregate: jest.fn()
}));

jest.mock('../models/Request', () => ({
  find: jest.fn(),
  aggregate: jest.fn()
}));

describe('Reports Tests', () => {
  describe('Financial Reports', () => {
    it('should generate a rent collection report', async () => {
      // Mock the aggregate return value
      require('../models/Rent').aggregate.mockResolvedValueOnce([
        { month: '2025-07', totalCollected: 15000, totalDue: 16000 },
        { month: '2025-06', totalCollected: 14500, totalDue: 16000 },
        { month: '2025-05', totalCollected: 15800, totalDue: 16000 }
      ]);
      
      const req = mockRequest({
        query: {
          startDate: '2025-05-01',
          endDate: '2025-07-31'
        }
      });
      const res = mockResponse();
      
      await reportController.getRentCollectionReport(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const report = res.json.mock.calls[0][0].data;
      expect(report).toHaveLength(3);
      expect(report[0].month).toBe('2025-07');
      expect(report[0].totalCollected).toBe(15000);
    });
    
    it('should generate a property performance report', async () => {
      // Mock the aggregate return value
      require('../models/Property').aggregate.mockResolvedValueOnce([
        { _id: mongoose.Types.ObjectId(), name: 'Property A', income: 5000, expenses: 2000 },
        { _id: mongoose.Types.ObjectId(), name: 'Property B', income: 4000, expenses: 1500 }
      ]);
      
      const req = mockRequest({
        query: {
          year: '2025'
        }
      });
      const res = mockResponse();
      
      await reportController.getPropertyPerformanceReport(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const report = res.json.mock.calls[0][0].data;
      expect(report).toHaveLength(2);
      expect(report[0].netIncome).toBe(3000); // 5000 - 2000
    });
  });
  
  describe('Maintenance Reports', () => {
    it('should generate a maintenance request report', async () => {
      // Mock the aggregate return value
      require('../models/Request').aggregate.mockResolvedValueOnce([
        { status: 'open', count: 5 },
        { status: 'in_progress', count: 3 },
        { status: 'completed', count: 12 }
      ]);
      
      const req = mockRequest({
        query: {
          startDate: '2025-06-01',
          endDate: '2025-07-31'
        }
      });
      const res = mockResponse();
      
      await reportController.getMaintenanceRequestReport(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const report = res.json.mock.calls[0][0].data;
      expect(report).toHaveLength(3);
      expect(report.find(r => r.status === 'completed').count).toBe(12);
    });
  });
  
  describe('Occupancy Reports', () => {
    it('should generate an occupancy report', async () => {
      // Mock the aggregate return value
      require('../models/Property').aggregate.mockResolvedValueOnce([
        { status: 'occupied', count: 15, percentage: 75 },
        { status: 'vacant', count: 5, percentage: 25 }
      ]);
      
      const req = mockRequest();
      const res = mockResponse();
      
      await reportController.getOccupancyReport(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const report = res.json.mock.calls[0][0].data;
      expect(report).toHaveLength(2);
      expect(report[0].status).toBe('occupied');
      expect(report[0].percentage).toBe(75);
    });
  });
});