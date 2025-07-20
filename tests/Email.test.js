const emailService = require('../services/emailService');
const Email = require('../models/Email');
const { mockRequest, mockResponse } = require('./setup');

// Mock the actual email sending function
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockImplementation((mailOptions, callback) => {
      if (callback) {
        callback(null, { messageId: 'mock-message-id' });
      }
      return Promise.resolve({ messageId: 'mock-message-id' });
    })
  })
}));

describe('Email Tests', () => {
  describe('Email Service', () => {
    it('should send an email', async () => {
      const emailData = {
        to: 'recipient@example.com',
        subject: 'Test Email',
        body: '<p>This is a test email</p>',
        from: 'sender@example.com'
      };
      
      const result = await emailService.sendEmail(emailData);
      
      expect(result).toBeDefined();
      expect(result.messageId).toBe('mock-message-id');
    });
    
    it('should save email to database', async () => {
      const emailData = {
        to: 'recipient@example.com',
        subject: 'Test Email',
        body: '<p>This is a test email</p>',
        from: 'sender@example.com',
        saveToDb: true
      };
      
      await emailService.sendEmail(emailData);
      
      const email = await Email.findOne({ to: 'recipient@example.com' });
      expect(email).toBeDefined();
      expect(email.subject).toBe('Test Email');
    });
    
    it('should handle template-based emails', async () => {
      const templateData = {
        template: 'welcome',
        to: 'newuser@example.com',
        data: {
          name: 'New User',
          loginUrl: 'https://example.com/login'
        }
      };
      
      const result = await emailService.sendTemplatedEmail(templateData);
      
      expect(result).toBeDefined();
      expect(result.messageId).toBe('mock-message-id');
    });
  });
  
  describe('Email Templates', () => {
    it('should render an email template with variables', async () => {
      const template = 'welcome';
      const data = {
        name: 'Test User',
        loginUrl: 'https://example.com/login'
      };
      
      const renderedTemplate = await emailService.renderEmailTemplate(template, data);
      
      expect(renderedTemplate).toBeDefined();
      expect(renderedTemplate).toContain('Test User');
      expect(renderedTemplate).toContain('https://example.com/login');
    });
  });
});