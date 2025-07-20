const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');
const notificationController = require('../controllers/notificationController');
const { mockRequest, mockResponse } = require('./setup');

// Mock the Websocket service
jest.mock('../services/websocketService', () => ({
  emitToUser: jest.fn(),
  emitToRole: jest.fn()
}));

describe('Notification Tests', () => {
  describe('Notification Model', () => {
    it('should create a new notification', async () => {
      const userId = mongoose.Types.ObjectId();
      const notificationData = {
        user: userId,
        title: 'New Request',
        message: 'A new maintenance request has been submitted',
        type: 'request',
        entityId: mongoose.Types.ObjectId(),
        isRead: false
      };
      
      const notification = new Notification(notificationData);
      const savedNotification = await notification.save();
      
      expect(savedNotification._id).toBeDefined();
      expect(savedNotification.title).toBe(notificationData.title);
      expect(savedNotification.isRead).toBe(false);
    });
  });
  
  describe('Notification Service', () => {
    it('should create and send a notification', async () => {
      const userId = mongoose.Types.ObjectId();
      const notificationData = {
        user: userId,
        title: 'Rent Due',
        message: 'Your rent payment is due tomorrow',
        type: 'rent',
        entityId: mongoose.Types.ObjectId()
      };
      
      const notification = await notificationService.createNotification(notificationData);
      
      expect(notification._id).toBeDefined();
      expect(notification.title).toBe(notificationData.title);
      
      // Check that the websocket emission was called
      const websocketService = require('../services/websocketService');
      expect(websocketService.emitToUser).toHaveBeenCalledWith(
        userId.toString(),
        'notification',
        expect.objectContaining({
          title: 'Rent Due',
          type: 'rent'
        })
      );
    });
    
    it('should send notifications to users with a specific role', async () => {
      const notificationData = {
        role: 'admin',
        title: 'System Alert',
        message: 'System maintenance scheduled',
        type: 'system'
      };
      
      const notifications = await notificationService.notifyByRole(notificationData);
      
      expect(notifications).toBeDefined();
      expect(Array.isArray(notifications)).toBe(true);
      
      // Check that the websocket emission was called
      const websocketService = require('../services/websocketService');
      expect(websocketService.emitToRole).toHaveBeenCalledWith(
        'admin',
        'notification',
        expect.objectContaining({
          title: 'System Alert',
          type: 'system'
        })
      );
    });
  });
  
  describe('Notification Controller', () => {
    beforeEach(async () => {
      const userId = mongoose.Types.ObjectId('60d0fe4f5311236168a109ca');
      await Notification.insertMany([
        {
          user: userId,
          title: 'New Request',
          message: 'A new maintenance request has been submitted',
          type: 'request',
          entityId: mongoose.Types.ObjectId(),
          isRead: false,
          createdAt: new Date('2025-07-19')
        },
        {
          user: userId,
          title: 'Payment Received',
          message: 'Rent payment was received',
          type: 'rent',
          entityId: mongoose.Types.ObjectId(),
          isRead: true,
          createdAt: new Date('2025-07-18')
        }
      ]);
    });
    
    it('should get user notifications', async () => {
      const req = mockRequest();
      const res = mockResponse();
      
      await notificationController.getUserNotifications(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const notifications = res.json.mock.calls[0][0].data;
      expect(notifications).toHaveLength(2);
    });
    
    it('should mark notification as read', async () => {
      const notification = await Notification.findOne({ isRead: false });
      const req = mockRequest({ params: { id: notification._id.toString() } });
      const res = mockResponse();
      
      await notificationController.markAsRead(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      
      const updatedNotification = await Notification.findById(notification._id);
      expect(updatedNotification.isRead).toBe(true);
    });
    
    it('should get unread notification count', async () => {
      const req = mockRequest();
      const res = mockResponse();
      
      await notificationController.getUnreadCount(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const count = res.json.mock.calls[0][0].data;
      expect(count).toBe(1);
    });
  });
});