// src/services/documentGenerationService.js

const path = require('path');
const fs = require('fs/promises'); // For async file operations
const pdfkit = require('pdfkit'); // Import the PDF generation library
const { uploadFileBuffer } = require('./cloudStorageService'); // Import our cloud storage service
const AuditLog = require('../models/auditLog');
const Media = require('../models/media'); // To save generated documents as Media records
const Lease = require('../models/lease'); // To update lease with document reference
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { MEDIA_RELATED_TO_ENUM, DOCUMENT_TYPE_ENUM } = require('../utils/constants/enums'); // Import enums

// Define a temporary directory for any potential intermediate files (e.g., images)
// For pure pdfkit buffer generation, this might not be strictly needed, but good practice
// if other generation methods involve temporary files.
const TEMP_DIR = path.join(__dirname, '../../temp_pdfs');

// Ensure the temporary directory exists
const ensureTempDir = async () => {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
        logger.info(`DocumentGenerationService: Ensured temporary PDF directory exists: ${TEMP_DIR}`);
    } catch (error) {
        logger.error(`DocumentGenerationService: Failed to create temporary PDF directory ${TEMP_DIR}: ${error.message}`, error);
        throw new AppError(`Failed to prepare document generation environment: ${error.message}`, 500);
    }
};

/**
 * Generates a PDF document (e.g., lease notice, rent report) and uploads it to cloud storage.
 * @param {string} documentType - The type of document to generate ('lease_notice', 'rent_report', 'renewal_letter', 'exit_letter', 'termination_notice', etc.).
 * @param {object} data - The data to populate the PDF (e.g., lease details, rent summary).
 * @param {object} [options={}] - Additional options:
 * @param {string} [options.userId] - The ID of the user triggering the generation.
 * @param {string} [options.ipAddress] - The IP address of the user.
 * @param {string} [options.relatedResourceId] - The ID of the resource this document relates to (e.g., Lease ID, Property ID).
 * @param {string} [options.relatedResourceType] - The type of resource this document relates to (e.g., 'Lease', 'Property').
 * @returns {Promise<object>} - Object containing details of the uploaded document (Media record).
 * @throws {AppError} - If PDF generation or upload fails.
 */
const generateAndUploadDocument = async (documentType, data, options = {}) => {
    await ensureTempDir(); // Ensure temp directory exists

    const baseFileName = `${documentType.replace(/_/g, '-')}_${Date.now()}`;
    let pdfBuffer;

    try {
        // 1. Generate PDF and get its buffer
        pdfBuffer = await new Promise((resolve, reject) => {
            const doc = new pdfkit(); // Create a new PDFDocument instance
            let buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            // --- PDF Content Generation Logic ---
            doc.font('Helvetica');
            doc.fontSize(20).text(`LeaseLogix by Threalty - ${documentType.replace(/_/g, ' ').toUpperCase()}`, {
                align: 'center'
            });
            doc.moveDown(1.5);

            if (documentType === DOCUMENT_TYPE_ENUM.find(dt => dt === 'lease_notice') ||
                documentType === DOCUMENT_TYPE_ENUM.find(dt => dt === 'renewal_letter') ||
                documentType === DOCUMENT_TYPE_ENUM.find(dt => dt === 'exit_letter') ||
                documentType === DOCUMENT_TYPE_ENUM.find(dt => dt === 'termination_notice')) {
                const noticeTitle = {
                    'lease_notice': 'General Lease Notice',
                    'renewal_letter': 'Lease Renewal Letter',
                    'exit_letter': 'Lease Exit Letter',
                    'termination_notice': 'Lease Termination Notice'
                }[documentType];

                doc.fontSize(16).text(`${noticeTitle} for Unit ${data.unitName || 'N/A'}`, { align: 'center' });
                doc.moveDown();

                doc.fontSize(11)
                    .text(`To: ${data.tenantName || 'Tenant'}`)
                    .text(`Unit: ${data.unitName || 'N/A'}, ${data.propertyName || 'N/A Property'}`)
                    .text(`Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`)
                    .moveDown(0.5)
                    .text(`Subject: ${data.subject || `${noticeTitle} Regarding Your Lease`}`)
                    .moveDown();

                doc.fontSize(10)
                    .text(data.content || 'Please review the attached terms for your lease. This is an important notice regarding your tenancy.')
                    .moveDown();

                doc.text(`Lease Start Date: ${new Date(data.leaseStartDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric'})}`);
                doc.text(`Lease End Date: ${new Date(data.leaseEndDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric'})}`);
                doc.moveDown(1.5);

                doc.text('Sincerely,');
                doc.text(data.landlordOrPmName || 'The Management Team');
                doc.text(data.contactEmail || '');
                doc.text(data.contactPhone || '');

                if (options.customText) { // Allow custom text injection
                    doc.moveDown();
                    doc.fontSize(12).text(options.customText);
                }

            } else if (documentType === DOCUMENT_TYPE_ENUM.find(dt => dt === 'rent_report')) {
                doc.fontSize(16).text(`Rent Report for ${data.propertyName || 'All Properties'}`, { align: 'center' });
                doc.moveDown();

                doc.fontSize(11)
                    .text(`Period: ${new Date(data.startDate).toLocaleDateString('en-US')} - ${new Date(data.endDate).toLocaleDateString('en-US')}`)
                    .text(`Generated On: ${new Date().toLocaleDateString('en-US')}`)
                    .moveDown(0.5)
                    .text(`Total Rent Due: ${data.totalDue} ${data.currency}`)
                    .text(`Total Rent Collected: ${data.totalCollected} ${data.currency}`)
                    .text(`Outstanding Balance: ${data.totalDue - data.totalCollected} ${data.currency}`)
                    .moveDown(1);

                doc.fontSize(12).text('Detailed Entries:', { underline: true });
                doc.moveDown(0.5);

                // Table Headers
                doc.fontSize(10)
                   .text('Unit', 50, doc.y, { width: 50, align: 'left' })
                   .text('Tenant', 100, doc.y, { width: 100, align: 'left' })
                   .text('Due Date', 200, doc.y, { width: 70, align: 'left' })
                   .text('Amount Due', 270, doc.y, { width: 80, align: 'right' })
                   .text('Amount Paid', 350, doc.y, { width: 80, align: 'right' })
                   .text('Status', 430, doc.y, { width: 70, align: 'left' });
                doc.moveDown(0.5);

                // Draw a line under headers
                doc.lineWidth(0.5).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
                doc.moveDown(0.5);

                // Rent entries
                data.rentEntries.forEach(entry => {
                    const yPos = doc.y;
                    doc.fontSize(9)
                       .text(entry.unitName || 'N/A', 50, yPos, { width: 50, align: 'left' })
                       .text(entry.tenantName || 'N/A', 100, yPos, { width: 100, align: 'left' })
                       .text(new Date(entry.dueDate).toLocaleDateString('en-US'), 200, yPos, { width: 70, align: 'left' })
                       .text(entry.amountDue.toFixed(2), 270, yPos, { width: 80, align: 'right' })
                       .text(entry.amountPaid.toFixed(2), 350, yPos, { width: 80, align: 'right' })
                       .text(entry.status, 430, yPos, { width: 70, align: 'left' });
                    doc.moveDown(1); // Move down for next row
                });
            } else {
                doc.fontSize(12).text('Document content not specified or type not recognized.');
                logger.warn(`DocumentGenerationService: Attempted to generate PDF for unrecognized type: ${documentType}`);
            }

            doc.end();
        });

        logger.info(`DocumentGenerationService: PDF generated into buffer for type: ${documentType}`);

        // 2. Upload PDF buffer to Cloudinary
        const uploadResult = await uploadFileBuffer(
            pdfBuffer,
            'application/pdf',
            `${baseFileName}.pdf`,
            `lease_logix/documents/${documentType.toLowerCase()}`, // Specific folder for documents
            {} // No extra options for now
        );

        // 3. Create a Media record for the generated document
        const mediaDoc = await Media.create({
            filename: `${baseFileName}.pdf`,
            originalname: `${baseFileName}.pdf`, // Original name is the generated name
            mimeType: 'application/pdf',
            size: pdfBuffer.length,
            url: uploadResult.url,
            thumbnailUrl: null, // PDFs typically don't have thumbnails unless generated separately
            uploadedBy: options.userId || null, // Link to user who initiated, or null for system
            relatedTo: options.relatedResourceType && MEDIA_RELATED_TO_ENUM.includes(options.relatedResourceType) ? options.relatedResourceType : 'Document', // Default to 'Document' if not specific
            relatedId: options.relatedResourceId || null,
            description: `Auto-generated ${documentType.replace(/_/g, ' ')} document.`,
            isPublic: false // Documents are usually private
        });

        // 4. If related to a Lease, update the Lease document with this new document
        if (options.relatedResourceType === 'Lease' && options.relatedResourceId) {
            await Lease.findByIdAndUpdate(options.relatedResourceId, {
                $push: { documents: mediaDoc._id }
            });
            logger.info(`DocumentGenerationService: Linked generated document ${mediaDoc._id} to Lease ${options.relatedResourceId}.`);
        }

        // 5. Audit Log
        await AuditLog.create({
            user: options.userId || null,
            action: 'DOCUMENT_GENERATED',
            resourceType: mediaDoc.relatedTo, // Use the actual related resource type
            resourceId: mediaDoc.relatedId,
            newValue: { documentType, mediaId: mediaDoc._id, url: mediaDoc.url },
            ipAddress: options.ipAddress || 'System',
            status: 'success',
            description: `Generated and uploaded ${documentType.replace(/_/g, ' ')} document (Media ID: ${mediaDoc._id}).`
        });

        logger.info(`DocumentGenerationService: Document generated, uploaded, and Media record created: ${mediaDoc._id}`);
        return mediaDoc; // Return the Media document
    } catch (error) {
        logger.error(`DocumentGenerationService: Error generating and uploading document (${documentType}): ${error.message}`, error);
        await AuditLog.create({
            user: options.userId || null,
            action: 'ERROR',
            resourceType: options.relatedResourceType || 'Document',
            resourceId: options.relatedResourceId || null,
            status: 'failure',
            errorMessage: error.message,
            ipAddress: options.ipAddress || 'System',
            description: `Failed to generate and upload ${documentType.replace(/_/g, ' ')} document. Error: ${error.message}`
        });
        if (error instanceof AppError) {
            throw error;
        }
        throw new AppError(`Failed to generate and upload document: ${error.message}`, 500);
    } finally {
        // No temporary file to clean up here as pdfkit generates directly to a buffer.
        // The TEMP_DIR is only for potential future use cases involving temporary files.
    }
};

module.exports = {
    generateAndUploadDocument,
};
