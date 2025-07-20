const smsService = require('../services/smsService');
const SMS = require('../models/SMS');
const { mockRequest, mockResponse } = require('./setup');

// Mock the Twilio client
jest.mock('twilio', () => () => ({
  messages: {
    create: jest.fn().mockResolvedValue({
      sid: 'mock-sid',
      status: 'sent',
      dateCreated: new Date()
    })
  }
}));

describe('SMS Tests', () => {
  describe('SMS Service', () => {
    it('should send an SMS', async () => {
      const smsData = {
        to: '+15551234567',
        body: 'This is a test SMS',
        from: '+15557654321'
      };
      
      const result = await smsService.sendSms(smsData);
      
      expect(result).toBeDefined();
      expect(result.sid).toBe('mock-sid');
      expect(result.status).toBe('sent');
    });
    
    it('should save SMS to database', async () => {
      const smsData = {
        to: '+15551234567',
        body: 'This is a test SMS',
        from: '+15557654321',
        saveToDb: true
      };
      
      await smsService.sendSms(smsData);
      
      const sms = await SMS.findOne({ to: '+15551234567' });
      expect(sms).toBeDefined();
      expect(sms.body).toBe('This is a test SMS');
    });
    
    it('should handle template-based SMS', async () => {
      const templateData = {
        template: 'maintenance_reminder',
        to: '+15551234567',
        data: {
          propertyName: 'Sunset Apartments',
          date: '2025-07-25',
          time: '10:00 AM'
        }
      };
      
      const result = await smsService.sendTemplatedSms(templateData);
      
      expect(result).toBeDefined();
      expect(result.sid).toBe('mock-sid');
    });
  });
  
  describe('SMS Templates', () => {
    it('should render an SMS template with variables', async () => {
      const template = 'maintenance_reminder';
      const data = {
        propertyName: 'Sunset Apartments',
        date: '2025-07-25',
        time: '10:00 AM'
      };
      
      const renderedTemplate = await smsService.renderSmsTemplate(template, data);
      
      expect(renderedTemplate).toBeDefined();
      expect(renderedTemplate).toContain('Sunset Apartments');
      expect(renderedTemplate).toContain('2025-07-25');
      expect(renderedTemplate).toContain('10:00 AM');
    });
  });
});