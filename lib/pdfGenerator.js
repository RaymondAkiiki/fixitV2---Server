// src/lib/pdfGenerator.js

const PDFDocument = require('pdfkit');
const fs = require('fs'); // For saving to file system (optional, for debugging/local storage)
const logger = require('../utils/logger'); // Import the logger utility
const AppError = require('../utils/AppError'); // For consistent error handling

/**
 * Generates a PDF document for lease notices or reports.
 * This is a basic example; complex layouts will require more PDFKit features.
 *
 * @param {string} type - The type of document to generate ('lease_notice', 'rent_report', 'renewal_letter', 'exit_letter').
 * @param {object} data - The data to populate the PDF (e.g., lease details, rent summary).
 * @param {string} outputPath - The file path where the PDF will be saved temporarily.
 * @returns {Promise<string>} - A promise that resolves with the path to the generated PDF file.
 * @throws {AppError} If PDF generation fails.
 */
const generatePdf = async (type, data, outputPath) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument();
        const stream = fs.createWriteStream(outputPath);

        doc.pipe(stream);

        // Set basic font and size for consistency
        doc.font('Helvetica');

        // Header for all documents
        doc.fontSize(20).text(`LeaseLogix by Threalty - ${type.replace(/_/g, ' ').toUpperCase()}`, {
            align: 'center'
        });
        doc.moveDown(1.5); // Add more space after header

        if (type === 'lease_notice' || type === 'renewal_letter' || type === 'exit_letter') {
            const noticeType = type === 'lease_notice' ? 'General Lease Notice' : (type === 'renewal_letter' ? 'Lease Renewal Letter' : 'Lease Exit Letter');
            
            doc.fontSize(16).text(`${noticeType} for Unit ${data.unitName || 'N/A'}`, { align: 'center' });
            doc.moveDown();

            doc.fontSize(11)
                .text(`To: ${data.tenantName || 'Tenant'}`)
                .text(`Unit: ${data.unitName || 'N/A'}, ${data.propertyName || 'N/A Property'}`)
                .text(`Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`)
                .moveDown(0.5)
                .text(`Subject: ${data.subject || `${noticeType} Regarding Your Lease`}`)
                .moveDown();

            doc.fontSize(10)
                .text(data.content || 'Please review the attached terms for your lease. This is an important notice regarding your tenancy.')
                .moveDown();

            doc.text(`Lease Start Date: ${new Date(data.leaseStartDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric'})}`);
            doc.text(`Lease End Date: ${new Date(data.leaseEndDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric'})}`);
            doc.moveDown(1.5);

            doc.text('Sincerely,');
            doc.text(data.landlordOrPmName || 'The Management Team');
            doc.text(data.contactEmail || ''); // Optional contact email
            doc.text(data.contactPhone || ''); // Optional contact phone

        } else if (type === 'rent_report') {
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
            logger.warn(`PDFGenerator: Attempted to generate PDF for unrecognized type: ${type}`);
        }

        doc.end();

        stream.on('finish', () => {
            logger.info(`PDF generated successfully: ${outputPath}`);
            resolve(outputPath);
        });

        stream.on('error', (err) => {
            logger.error(`PDFGenerator: Stream error during PDF generation to ${outputPath}: ${err.message}`, err);
            reject(new AppError(`Failed to generate PDF: ${err.message}`, 500));
        });
    });
};

module.exports = {
    generatePdf
};
