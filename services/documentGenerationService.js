// src/services/documentGenerationService.js

const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const pdfkit = require('pdfkit');
const cloudinaryClient = require('../lib/cloudinaryClient');
const auditService = require('./auditService');
const mongoose = require('mongoose');
const Media = require('../models/media');
const Lease = require('../models/lease');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { 
  DOCUMENT_TEMPLATES, 
  formatDate, 
  formatCurrency,
  getDocumentTemplate
} = require('../utils/DocumentTemplates');
const { MEDIA_RELATED_TO_ENUM, DOCUMENT_TYPE_ENUM, AUDIT_ACTION_ENUM, AUDIT_RESOURCE_TYPE_ENUM } = require('../utils/constants/enums');

// Define a temporary directory for PDF generation
const TEMP_DIR = path.join(os.tmpdir(), 'lease_logix_pdfs');

/**
 * Ensures the temporary directory exists
 * @returns {Promise<void>}
 */
const ensureTempDir = async () => {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    logger.info(`DocumentGenerationService: Temp directory created: ${TEMP_DIR}`);
  } catch (error) {
    logger.error(`DocumentGenerationService: Failed to create temp directory: ${error.message}`, error);
    throw new AppError(`Failed to prepare document generation environment: ${error.message}`, 500);
  }
};

/**
 * Generate and upload a document to cloud storage
 * @param {string} documentType - Type of document to generate
 * @param {Object} data - Data for the document
 * @param {Object} [options={}] - Additional options
 * @returns {Promise<Object>} Media document for the generated file
 */
const generateAndUploadDocument = async (documentType, data, options = {}) => {
  // Ensure valid document type
  if (!DOCUMENT_TYPE_ENUM.includes(documentType)) {
    throw new AppError(`Invalid document type: ${documentType}. Allowed types: ${DOCUMENT_TYPE_ENUM.join(', ')}`, 400);
  }

  // Get the document template
  const template = getDocumentTemplate(documentType);
  if (!template) {
    throw new AppError(`No template found for document type: ${documentType}`, 400);
  }

  // Validate required fields
  if (template.requiredFields) {
    const missingFields = template.requiredFields.filter(field => !data[field]);
    if (missingFields.length > 0) {
      throw new AppError(`Missing required fields for ${documentType}: ${missingFields.join(', ')}`, 400);
    }
  }

  await ensureTempDir();
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Prepare document filename
    const baseFileName = `${documentType.replace(/_/g, '-')}_${Date.now()}`;
    const pdfFilePath = path.join(TEMP_DIR, `${baseFileName}.pdf`);
    let pdfBuffer;

    // 1. Generate PDF
    pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new pdfkit({ 
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: `${documentType.replace(/_/g, ' ').toUpperCase()} - LeaseLogix`,
          Author: 'LeaseLogix System',
          Subject: `${documentType.replace(/_/g, ' ')} document`,
          Keywords: 'lease, property management, document',
          Creator: 'LeaseLogix by Threalty',
        }
      });

      let buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Add header with logo if available
      doc.fontSize(20).text(`LeaseLogix by Threalty - ${documentType.replace(/_/g, ' ').toUpperCase()}`, {
        align: 'center'
      });
      doc.moveDown(1.5);

      // Apply the template generator function
      template.generator(doc, data, options);

      doc.end();
    });

    // Write buffer to file for logging/debugging purposes
    await fs.writeFile(pdfFilePath, pdfBuffer);
    logger.info(`DocumentGenerationService: PDF generated at: ${pdfFilePath}`);

    // 2. Upload to Cloudinary
    const uploadResult = await cloudinaryClient.uploadFileBuffer(
      pdfBuffer,
      'application/pdf',
      `${baseFileName}.pdf`,
      `lease_logix/documents/${documentType.toLowerCase()}`,
      {
        tags: [documentType, options.relatedResourceType || 'document']
      }
    );

    // 3. Create Media record
    const mediaDoc = new Media({
      publicId: uploadResult.publicId,
      filename: `${baseFileName}.pdf`,
      originalname: `${documentType.replace(/_/g, ' ')}.pdf`,
      mimeType: 'application/pdf',
      size: pdfBuffer.length,
      url: uploadResult.url,
      thumbnailUrl: null,
      resourceType: 'raw', // PDF is considered 'raw' in Cloudinary
      uploadedBy: options.userId || null,
      relatedTo: options.relatedResourceType && MEDIA_RELATED_TO_ENUM.includes(options.relatedResourceType) 
        ? options.relatedResourceType 
        : 'Document',
      relatedId: options.relatedResourceId || null,
      description: `Auto-generated ${documentType.replace(/_/g, ' ')} document.`,
      tags: [documentType, 'auto-generated', options.relatedResourceType || 'document'],
      isPublic: false
    });

    await mediaDoc.save({ session });
    logger.info(`DocumentGenerationService: Media record created: ${mediaDoc._id}`);

    // 4. If related to a Lease, update the Lease document
    if (options.relatedResourceType === 'Lease' && options.relatedResourceId) {
      await Lease.findByIdAndUpdate(
        options.relatedResourceId,
        { $push: { documents: mediaDoc._id } },
        { session }
      );
      logger.info(`DocumentGenerationService: Linked document to Lease ${options.relatedResourceId}`);
    }

    // 5. Log the action
    await auditService.logActivity(
      AUDIT_ACTION_ENUM.DOCUMENT_GENERATED,
      AUDIT_RESOURCE_TYPE_ENUM[7], // 'Media'
      mediaDoc._id,
      {
        userId: options.userId,
        ipAddress: options.ipAddress,
        description: `Generated and uploaded ${documentType.replace(/_/g, ' ')} document (Media ID: ${mediaDoc._id}).`,
        metadata: { 
          documentType, 
          relatedResourceType: options.relatedResourceType,
          relatedResourceId: options.relatedResourceId
        }
      }
    );

    // Commit the transaction
    await session.commitTransaction();

    // Delete the temp file
    try {
      await fs.unlink(pdfFilePath);
    } catch (error) {
      logger.warn(`DocumentGenerationService: Could not delete temp file ${pdfFilePath}: ${error.message}`);
      // Non-critical error, continue execution
    }

    return mediaDoc;
  } catch (error) {
    // Abort the transaction on error
    await session.abortTransaction();
    
    logger.error(`DocumentGenerationService: Error generating document (${documentType}): ${error.message}`, error);
    
    // Log the error
    await auditService.logActivity(
      AUDIT_ACTION_ENUM.ERROR,
      AUDIT_RESOURCE_TYPE_ENUM[16], // 'System'
      null,
      {
        userId: options.userId,
        ipAddress: options.ipAddress,
        description: `Failed to generate ${documentType.replace(/_/g, ' ')} document: ${error.message}`,
        status: 'failure',
        errorMessage: error.message
      }
    );

    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(`Failed to generate document: ${error.message}`, 500);
  } finally {
    session.endSession();
  }
};

/**
 * Get all available document templates
 * @returns {Array<Object>} Array of document template metadata
 */
const getDocumentTemplates = () => {
  return Object.entries(DOCUMENT_TEMPLATES).map(([type, template]) => ({
    type,
    name: template.name,
    description: template.description,
    requiredFields: template.requiredFields || [],
    optionalFields: template.optionalFields || []
  }));
};

module.exports = {
  generateAndUploadDocument,
  getDocumentTemplates
};