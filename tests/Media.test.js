const mongoose = require('mongoose');
const Media = require('../models/Media');
const mediaController = require('../controllers/mediaController');
const { mockRequest, mockResponse } = require('./setup');
const cloudinaryService = require('../services/cloudinaryService');

// Mock the cloudinary service
jest.mock('../services/cloudinaryService', () => ({
  uploadFileBuffer: jest.fn().mockResolvedValue({
    url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    publicId: 'sample'
  }),
  deleteFile: jest.fn().mockResolvedValue({ result: 'ok' })
}));

describe('Media Tests', () => {
  describe('Media Model', () => {
    it('should create a new media record', async () => {
      const mediaData = {
        name: 'test-image.jpg',
        url: 'https://example.com/test-image.jpg',
        mimeType: 'image/jpeg',
        size: 12345,
        entityType: 'Property',
        entityId: mongoose.Types.ObjectId(),
        uploadedBy: mongoose.Types.ObjectId()
      };
      
      const media = new Media(mediaData);
      const savedMedia = await media.save();
      
      expect(savedMedia._id).toBeDefined();
      expect(savedMedia.name).toBe(mediaData.name);
      expect(savedMedia.url).toBe(mediaData.url);
    });
  });
  
  describe('Media Controller', () => {
    beforeEach(async () => {
      // Create test media records
      await Media.insertMany([
        {
          name: 'property-image.jpg',
          url: 'https://example.com/property-image.jpg',
          mimeType: 'image/jpeg',
          size: 12345,
          entityType: 'Property',
          entityId: mongoose.Types.ObjectId(),
          uploadedBy: mongoose.Types.ObjectId()
        },
        {
          name: 'lease-document.pdf',
          url: 'https://example.com/lease-document.pdf',
          mimeType: 'application/pdf',
          size: 67890,
          entityType: 'Lease',
          entityId: mongoose.Types.ObjectId(),
          uploadedBy: mongoose.Types.ObjectId()
        }
      ]);
    });
    
    it('should upload a file', async () => {
      const file = {
        originalname: 'test.jpg',
        buffer: Buffer.from('test file content'),
        mimetype: 'image/jpeg',
        size: 12345
      };
      
      const entityId = mongoose.Types.ObjectId();
      
      const req = mockRequest({
        body: { entityType: 'Property', entityId: entityId.toString() },
        files: [file],
        user: { _id: mongoose.Types.ObjectId() }
      });
      
      const res = mockResponse();
      
      await mediaController.uploadMedia(req, res);
      
      expect(cloudinaryService.uploadFileBuffer).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      
      const media = await Media.findOne({ name: 'test.jpg' });
      expect(media).toBeDefined();
      expect(media.entityType).toBe('Property');
      expect(media.entityId.toString()).toBe(entityId.toString());
    });
    
    it('should get media by entity', async () => {
      const propertyMedia = await Media.findOne({ entityType: 'Property' });
      const req = mockRequest({ 
        query: { 
          entityType: 'Property', 
          entityId: propertyMedia.entityId.toString()
        }
      });
      const res = mockResponse();
      
      await mediaController.getMediaByEntity(req, res);
      
      expect(res.status).toHaveBeenCalledWith(200);
      const media = res.json.mock.calls[0][0].data;
      expect(media).toHaveLength(1);
      expect(media[0].entityType).toBe('Property');
    });
    
    it('should delete media', async () => {
      const media = await Media.findOne({ name: 'property-image.jpg' });
      const req = mockRequest({ params: { id: media._id.toString() } });
      const res = mockResponse();
      
      await mediaController.deleteMedia(req, res);
      
      expect(cloudinaryService.deleteFile).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      
      const deletedMedia = await Media.findById(media._id);
      expect(deletedMedia).toBeNull();
    });
  });
});