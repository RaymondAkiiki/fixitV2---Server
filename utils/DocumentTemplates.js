// src/utils/DocumentTemplates.js

/**
 * Document templates for various document types
 * This file centralizes all document templates used in the system
 */

/**
 * Format date in a readable format
 * @param {Date|string} date - Date to format
 * @param {Object} [options] - Formatting options
 * @returns {string} Formatted date string
 */
const formatDate = (date, options = { year: 'numeric', month: 'long', day: 'numeric' }) => {
  if (!date) return 'N/A';
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toLocaleDateString('en-US', options);
};

/**
 * Formats currency with proper separators and decimal places
 * @param {number} amount - Amount to format
 * @param {string} [currency='UGX'] - Currency code
 * @returns {string} Formatted currency string
 */
const formatCurrency = (amount, currency = 'UGX') => {
  if (amount === undefined || amount === null) return `0 ${currency}`;
  return `${amount.toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })} ${currency}`;
};

/**
 * Templates for document generation
 */
const DOCUMENT_TEMPLATES = {
  lease_notice: {
    name: 'Lease Notice',
    description: 'General notification regarding a lease agreement.',
    requiredFields: ['tenantName', 'unitName', 'propertyName', 'leaseStartDate', 'leaseEndDate'],
    optionalFields: ['content', 'subject', 'landlordOrPmName', 'contactEmail', 'contactPhone', 'customText'],
    generator: (doc, data, options = {}) => {
      const title = 'General Lease Notice';
      
      doc.fontSize(16).text(`${title} for Unit ${data.unitName || 'N/A'}`, { align: 'center' });
      doc.moveDown();

      doc.fontSize(11)
        .text(`To: ${data.tenantName || 'Tenant'}`)
        .text(`Unit: ${data.unitName || 'N/A'}, ${data.propertyName || 'N/A Property'}`)
        .text(`Date: ${formatDate(new Date())}`)
        .moveDown(0.5)
        .text(`Subject: ${data.subject || `${title} Regarding Your Lease`}`)
        .moveDown();

      doc.fontSize(10)
        .text(data.content || 'Please review the attached terms for your lease. This is an important notice regarding your tenancy.')
        .moveDown();

      doc.text(`Lease Start Date: ${formatDate(data.leaseStartDate)}`);
      doc.text(`Lease End Date: ${formatDate(data.leaseEndDate)}`);
      doc.moveDown(1.5);

      doc.text('Sincerely,');
      doc.text(data.landlordOrPmName || 'The Management Team');
      doc.text(data.contactEmail || '');
      doc.text(data.contactPhone || '');

      if (options.customText) {
        doc.moveDown();
        doc.fontSize(12).text(options.customText);
      }
    }
  },
  
  renewal_letter: {
    name: 'Lease Renewal Letter',
    description: 'Formal offer to renew a lease agreement.',
    requiredFields: ['tenantName', 'unitName', 'propertyName', 'leaseStartDate', 'leaseEndDate'],
    optionalFields: ['newRentAmount', 'newLeaseStartDate', 'newLeaseEndDate', 'content', 'subject', 'renewalInstructions', 'landlordOrPmName', 'contactEmail', 'contactPhone', 'customText'],
    generator: (doc, data, options = {}) => {
      const title = 'Lease Renewal Offer';
      
      doc.fontSize(16).text(`${title} for Unit ${data.unitName || 'N/A'}`, { align: 'center' });
      doc.moveDown();

      doc.fontSize(11)
        .text(`To: ${data.tenantName || 'Tenant'}`)
        .text(`Unit: ${data.unitName || 'N/A'}, ${data.propertyName || 'N/A Property'}`)
        .text(`Date: ${formatDate(new Date())}`)
        .moveDown(0.5)
        .text(`Subject: ${data.subject || `${title}`}`)
        .moveDown();

      doc.fontSize(10)
        .text(
          data.content || 
          `We are pleased to offer you the opportunity to renew your lease agreement for Unit ${data.unitName} at ${data.propertyName}. ` +
          `Your current lease is set to expire on ${formatDate(data.leaseEndDate)}.`
        )
        .moveDown();

      if (data.newRentAmount) {
        doc.text(`Current Monthly Rent: ${formatCurrency(data.monthlyRent, data.currency)}`);
        doc.text(`New Monthly Rent: ${formatCurrency(data.newRentAmount, data.currency)}`);
      }

      if (data.newLeaseStartDate && data.newLeaseEndDate) {
        doc.moveDown();
        doc.text(`New Lease Period: ${formatDate(data.newLeaseStartDate)} to ${formatDate(data.newLeaseEndDate)}`);
      }

      doc.moveDown();
      doc.text(
        data.renewalInstructions || 
        "To renew your lease, please contact the property management office within 14 days of receiving this letter. " +
        "If we do not hear from you, we will assume you do not wish to renew your lease."
      );
      
      doc.moveDown(1.5);
      doc.text('Sincerely,');
      doc.text(data.landlordOrPmName || 'The Management Team');
      doc.text(data.contactEmail || '');
      doc.text(data.contactPhone || '');

      if (options.customText) {
        doc.moveDown();
        doc.fontSize(12).text(options.customText);
      }
    }
  },
  
  exit_letter: {
    name: 'Lease Exit Instructions',
    description: 'Instructions for tenants on lease termination procedures.',
    requiredFields: ['tenantName', 'unitName', 'propertyName', 'leaseEndDate'],
    optionalFields: ['content', 'subject', 'moveOutInstructions', 'depositInfo', 'landlordOrPmName', 'contactEmail', 'contactPhone', 'customText'],
    generator: (doc, data, options = {}) => {
      const title = 'Lease Exit Instructions';
      
      doc.fontSize(16).text(`${title} for Unit ${data.unitName || 'N/A'}`, { align: 'center' });
      doc.moveDown();

      doc.fontSize(11)
        .text(`To: ${data.tenantName || 'Tenant'}`)
        .text(`Unit: ${data.unitName || 'N/A'}, ${data.propertyName || 'N/A Property'}`)
        .text(`Date: ${formatDate(new Date())}`)
        .moveDown(0.5)
        .text(`Subject: ${data.subject || `${title}`}`)
        .moveDown();

      doc.fontSize(10)
        .text(
          data.content || 
          `We are writing to confirm the end of your lease agreement for Unit ${data.unitName} at ${data.propertyName}. ` +
          `Your lease will expire on ${formatDate(data.leaseEndDate)}.`
        )
        .moveDown();

      if (data.moveOutInstructions) {
        doc.text(data.moveOutInstructions);
      } else {
        doc.text("Move-Out Instructions:");
        doc.text("1. Schedule a move-out inspection with the property management office.");
        doc.text("2. Remove all personal belongings from the unit.");
        doc.text("3. Clean the unit thoroughly.");
        doc.text("4. Return all keys and access cards to the property management office.");
      }
      
      doc.moveDown();
      if (data.depositInfo) {
        doc.text(data.depositInfo);
      } else {
        doc.text("Security Deposit: Your security deposit will be returned within 30 days of your move-out date, less any charges for damages, unpaid rent, or other charges as specified in your lease agreement.");
      }

      doc.moveDown(1.5);
      doc.text('Sincerely,');
      doc.text(data.landlordOrPmName || 'The Management Team');
      doc.text(data.contactEmail || '');
      doc.text(data.contactPhone || '');

      if (options.customText) {
        doc.moveDown();
        doc.fontSize(12).text(options.customText);
      }
    }
  },
  
  termination_notice: {
    name: 'Lease Termination Notice',
    description: 'Formal notice of lease termination.',
    requiredFields: ['tenantName', 'unitName', 'propertyName', 'leaseEndDate'],
    optionalFields: ['terminationDate', 'terminationReason', 'content', 'subject', 'moveOutInstructions', 'legalDisclosure', 'landlordOrPmName', 'contactEmail', 'contactPhone', 'customText'],
    generator: (doc, data, options = {}) => {
      const title = 'Lease Termination Notice';
      
      doc.fontSize(16).text(`${title} for Unit ${data.unitName || 'N/A'}`, { align: 'center' });
      doc.moveDown();

      doc.fontSize(11)
        .text(`To: ${data.tenantName || 'Tenant'}`)
        .text(`Unit: ${data.unitName || 'N/A'}, ${data.propertyName || 'N/A Property'}`)
        .text(`Date: ${formatDate(new Date())}`)
        .moveDown(0.5)
        .text(`Subject: ${data.subject || `${title}`}`)
        .moveDown();

      doc.fontSize(10)
        .text(
          data.content || 
          `This letter serves as formal notice that your lease agreement for Unit ${data.unitName} at ${data.propertyName} ` +
          `is being terminated.`
        )
        .moveDown();

      if (data.terminationReason) {
        doc.text(`Reason for Termination: ${data.terminationReason}`);
        doc.moveDown();
      }

      doc.text(`Termination Date: ${formatDate(data.terminationDate || data.leaseEndDate)}`);
      doc.moveDown();

      if (data.moveOutInstructions) {
        doc.text(data.moveOutInstructions);
      }

      doc.moveDown();
      if (data.legalDisclosure) {
        doc.text(data.legalDisclosure);
      } else {
        doc.text("Legal Disclosure: This termination is in accordance with the terms of your lease agreement and applicable laws. If you have questions about your rights, please consult with legal counsel.");
      }

      doc.moveDown(1.5);
      doc.text('Sincerely,');
      doc.text(data.landlordOrPmName || 'The Management Team');
      doc.text(data.contactEmail || '');
      doc.text(data.contactPhone || '');

      if (options.customText) {
        doc.moveDown();
        doc.fontSize(12).text(options.customText);
      }
    }
  },
  
  rent_report: {
    name: 'Rent Report',
    description: 'Summary of rent payments for a property or properties.',
    requiredFields: ['startDate', 'endDate', 'rentEntries'],
    optionalFields: ['propertyName', 'totalDue', 'totalCollected', 'currency', 'statusSummary', 'generatedBy'],
    generator: (doc, data, options = {}) => {
      doc.fontSize(16).text(`Rent Report for ${data.propertyName || 'All Properties'}`, { align: 'center' });
      doc.moveDown();

      doc.fontSize(11)
        .text(`Period: ${formatDate(data.startDate, { month: 'short', day: 'numeric', year: 'numeric' })} - ${formatDate(data.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}`)
        .text(`Generated On: ${formatDate(new Date(), { month: 'short', day: 'numeric', year: 'numeric' })}`)
        .text(`Generated By: ${data.generatedBy || options.userName || 'System'}`)
        .moveDown(0.5)
        .text(`Total Rent Due: ${formatCurrency(data.totalDue, data.currency)}`)
        .text(`Total Rent Collected: ${formatCurrency(data.totalCollected, data.currency)}`)
        .text(`Outstanding Balance: ${formatCurrency(data.totalDue - data.totalCollected, data.currency)}`)
        .moveDown(1);

      // Draw a horizontal line
      doc.strokeColor('#cccccc').lineWidth(1);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      // Summary by status if available
      if (data.statusSummary) {
        doc.fontSize(12).text('Summary by Status:', { underline: true });
        doc.moveDown(0.5);
        
        Object.entries(data.statusSummary).forEach(([status, amount]) => {
          doc.fontSize(10).text(`${status}: ${formatCurrency(amount, data.currency)}`);
        });
        
        doc.moveDown(1);
        doc.strokeColor('#cccccc').lineWidth(1);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);
      }

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
      doc.strokeColor('#000000').lineWidth(0.5);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      // Rent entries with alternating row colors
      let isAlternate = false;
      (data.rentEntries || []).forEach(entry => {
        if (isAlternate) {
          doc.rect(50, doc.y, 500, 20).fill('#f5f5f5');
        }
        isAlternate = !isAlternate;
        
        const yPos = doc.y;
        doc.fillColor('#000000').fontSize(9)
           .text(entry.unitName || 'N/A', 50, yPos, { width: 50, align: 'left' })
           .text(entry.tenantName || 'N/A', 100, yPos, { width: 100, align: 'left' })
           .text(formatDate(entry.dueDate, { month: 'short', day: 'numeric' }), 200, yPos, { width: 70, align: 'left' })
           .text(formatCurrency(entry.amountDue, '').trim(), 270, yPos, { width: 80, align: 'right' })
           .text(formatCurrency(entry.amountPaid, '').trim(), 350, yPos, { width: 80, align: 'right' })
           .text(entry.status, 430, yPos, { width: 70, align: 'left' });
        
        doc.moveDown(1.2);
      });

      // Add footer with page number
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        
        // Footer text
        doc.fontSize(8)
          .text(
            `Generated on ${formatDate(new Date(), { month: 'short', day: 'numeric', year: 'numeric' })} by LeaseLogix | Page ${i + 1} of ${pageCount}`,
            50,
            doc.page.height - 50,
            { align: 'center', width: doc.page.width - 100 }
          );
      }
    }
  },
  
  maintenance_report: {
    name: 'Maintenance Report',
    description: 'Summary of maintenance requests for a property.',
    requiredFields: ['startDate', 'endDate', 'requests'],
    optionalFields: ['reportTitle', 'propertyName', 'summary', 'detailedRequests', 'generatedBy'],
    generator: (doc, data, options = {}) => {
      doc.fontSize(16).text(`${data.reportTitle || 'Maintenance Report'}`, { align: 'center' });
      doc.moveDown();

      // Header section
      doc.fontSize(11)
        .text(`Property: ${data.propertyName || 'N/A'}`)
        .text(`Period: ${formatDate(data.startDate)} - ${formatDate(data.endDate)}`)
        .text(`Generated On: ${formatDate(new Date())}`)
        .text(`Generated By: ${data.generatedBy || options.userName || 'System'}`)
        .moveDown(1);

      // Summary section if available
      if (data.summary) {
        doc.fontSize(12).text('Summary:', { underline: true });
        doc.moveDown(0.5);
        
        doc.fontSize(10)
          .text(`Total Requests: ${data.summary.totalRequests || 0}`)
          .text(`Completed: ${data.summary.completed || 0}`)
          .text(`In Progress: ${data.summary.inProgress || 0}`)
          .text(`New/Unassigned: ${data.summary.new || 0}`)
          .text(`Average Resolution Time: ${data.summary.avgResolutionTime || 'N/A'}`);
        
        doc.moveDown(1);
      }

      // Draw a horizontal line
      doc.strokeColor('#cccccc').lineWidth(1);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      // Detailed entries section
      doc.fontSize(12).text('Maintenance Requests:', { underline: true });
      doc.moveDown(0.5);

      // Table Headers
      doc.fontSize(10)
         .text('ID', 50, doc.y, { width: 40, align: 'left' })
         .text('Title', 90, doc.y, { width: 120, align: 'left' })
         .text('Category', 210, doc.y, { width: 80, align: 'left' })
         .text('Status', 290, doc.y, { width: 60, align: 'left' })
         .text('Reported', 350, doc.y, { width: 70, align: 'left' })
         .text('Completed', 420, doc.y, { width: 80, align: 'left' });
      doc.moveDown(0.5);

      // Draw a line under headers
      doc.strokeColor('#000000').lineWidth(0.5);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      // Request entries with alternating row colors
      let isAlternate = false;
      (data.requests || []).forEach(request => {
        if (isAlternate) {
          doc.rect(50, doc.y, 500, 20).fill('#f5f5f5');
        }
        isAlternate = !isAlternate;
        
        const yPos = doc.y;
        const requestId = request._id ? request._id.toString().slice(-6) : 'N/A';
        
        doc.fillColor('#000000').fontSize(9)
           .text(requestId, 50, yPos, { width: 40, align: 'left' })
           .text(request.title || 'N/A', 90, yPos, { width: 120, align: 'left' })
           .text(request.category || 'N/A', 210, yPos, { width: 80, align: 'left' })
           .text(request.status || 'N/A', 290, yPos, { width: 60, align: 'left' })
           .text(formatDate(request.createdAt, { month: 'short', day: 'numeric' }), 350, yPos, { width: 70, align: 'left' })
           .text(request.resolvedAt ? formatDate(request.resolvedAt, { month: 'short', day: 'numeric' }) : 'N/A', 420, yPos, { width: 80, align: 'left' });
        
        doc.moveDown(1.2);
      });

      // Add details of specific requests if provided
      if (data.detailedRequests && data.detailedRequests.length > 0) {
        doc.addPage();
        doc.fontSize(14).text('Detailed Request Information', { align: 'center' });
        doc.moveDown();

        data.detailedRequests.forEach((request, index) => {
          const requestId = request._id ? request._id.toString().slice(-6) : 'N/A';
          
          doc.fontSize(12).text(`Request #${requestId}: ${request.title || 'N/A'}`, { underline: true });
          doc.moveDown(0.5);
          
          doc.fontSize(10)
            .text(`Category: ${request.category || 'N/A'}`)
            .text(`Status: ${request.status || 'N/A'}`)
            .text(`Priority: ${request.priority || 'N/A'}`)
            .text(`Reported By: ${request.reportedByName || 'N/A'}`)
            .text(`Reported On: ${formatDate(request.createdAt)}`)
            .text(`Assigned To: ${request.assignedToName || 'N/A'}`)
            .text(`Completed On: ${request.resolvedAt ? formatDate(request.resolvedAt) : 'N/A'}`);
          
          doc.moveDown(0.5);
          doc.text('Description:');
          doc.font('Helvetica-Oblique')
            .text(request.description || 'No description provided.', {
              width: 450,
              align: 'left'
            });
          doc.font('Helvetica');
          
          if (request.comments && request.comments.length > 0) {
            doc.moveDown(0.5);
            doc.text('Comments:');
            request.comments.forEach(comment => {
              doc.font('Helvetica-Bold')
                .text(`${comment.senderName || 'User'} (${formatDate(comment.timestamp, { month: 'short', day: 'numeric' })}):`);
              doc.font('Helvetica')
                .text(comment.message || '', {
                  width: 450,
                  align: 'left'
                });
              doc.moveDown(0.5);
            });
          }

          // Add a separator between requests
          if (index < data.detailedRequests.length - 1) {
            doc.strokeColor('#cccccc').lineWidth(1);
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown(1);
          }
        });
      }

      // Add footer with page number
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        
        // Footer text
        doc.fontSize(8)
          .text(
            `Generated on ${formatDate(new Date(), { month: 'short', day: 'numeric', year: 'numeric' })} by LeaseLogix | Page ${i + 1} of ${pageCount}`,
            50,
            doc.page.height - 50,
            { align: 'center', width: doc.page.width - 100 }
          );
      }
    }
  }
};

// Export templates and utility functions
module.exports = {
  DOCUMENT_TEMPLATES,
  formatDate,
  formatCurrency,
  getDocumentTemplate: (type) => DOCUMENT_TEMPLATES[type] || null
};