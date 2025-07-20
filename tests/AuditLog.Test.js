const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const auditLogController = require('../controllers/auditLogController');
const { mockRequest, mockResponse } = require('./setup');

describe('Audit Log Tests', () => {
  describe('createAuditLog', () => {
    it('should create a new audit log entry', async () => {
      const logEntry = {
        user: mongoose.Types.ObjectId(),
        action: 'create',
        entityType: 'Property',
        entityId: mongoose.Types.ObjectId(),
        details: { name: 'Test Property', address: '123 Test St' }
      };
      
      const newLog = await AuditLog.create(logEntry);
      expect(newLog).toBeDefined();
      expect(newLog.action).toBe('create');
      expect(newLog.entityType).toBe('Property');
    });
  });
  
  describe('getAuditLogs Controller', () => {
    beforeEach(async () => {
      // Create some test audit logs
      await AuditLog.insertMany([
        {
          user: mongoose.Types.ObjectId(),
          action: 'create',
          entityType: 'Property',
          entityId: mongoose.Types.ObjectId(),
          details: { name: 'Property 1' },
          timestamp: new Date('2025-07-19')
        },
        {
          user: mongoose.Types.ObjectId(),
          action: 'update',
          entityType: 'Lease',
          entityId: mongoose.Types.ObjectId(),
          details: { status: 'active' },
          timestamp: new Date('2025-07-20')
        }
      ]);
    });
    
    it('should get all audit logs', async () => {
      const req = mockRequest();
      const res = mockResponse();
      
      await auditLogController.getAuditLogs(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
      const data = res.json.mock.calls[0][0].data;
      expect(data.length).toBe(2);
    });
    
    it('should filter audit logs by entity type', async () => {
      const req = mockRequest({ query: { entityType: 'Property' } });
      const res = mockResponse();
      
      await auditLogController.getAuditLogs(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const data = res.json.mock.calls[0][0].data;
      expect(data.length).toBe(1);
      expect(data[0].entityType).toBe('Property');
    });
    
    it('should filter audit logs by date range', async () => {
      const req = mockRequest({ 
        query: { 
          startDate: '2025-07-20', 
          endDate: '2025-07-21' 
        } 
      });
      const res = mockResponse();
      
      await auditLogController.getAuditLogs(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const data = res.json.mock.calls[0][0].data;
      expect(data.length).toBe(1);
      expect(data[0].entityType).toBe('Lease');
    });
  });
});