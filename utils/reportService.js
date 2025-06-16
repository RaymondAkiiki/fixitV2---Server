const Media = require('../models/media');
const Property = require('../models/property');
const Request = require('../models/request');
const User = require('../models/user');
const asyncHandler = require('express-async-handler');

/**
 * @desc   Generate maintenance report for a property
 * @param  {string} propertyId - ID of the property
 * @param  {Date} startDate - Start date for the report
 * @param  {Date} endDate - End date for the report
 * @returns {Promise<object>} - Report data
 */
exports.generatePropertyReport = async (propertyId, startDate, endDate) => {
  try {
    // Validate inputs
    if (!propertyId || !startDate || !endDate) {
      throw new Error('Missing required parameters');
    }

    // Fetch property details
    const property = await Property.findById(propertyId);
    if (!property) {
      throw new Error('Property not found');
    }

    // Query requests for the property within the date range
    const requests = await Request.find({
      property: propertyId,
      createdAt: {
        $gte: startDate,
        $lte: endDate,
      },
    }).populate('assignedTo', 'name email'); // Populate assigned vendor details

    // Calculate report metrics
    const totalRequests = requests.length;
    const resolvedRequests = requests.filter(req => req.status === 'resolved').length;
    const averageResolutionTime = calculateAverageResolutionTime(requests); // Implement this function
    const mostFrequentIssue = findMostFrequentIssue(requests); // Implement this function

    // Structure the report data
    const reportData = {
      property: {
        _id: property._id,
        name: property.name,
        address: property.address,
      },
      period: {
        startDate,
        endDate,
      },
      metrics: {
        totalRequests,
        resolvedRequests,
        averageResolutionTime,
        mostFrequentIssue,
      },
      requests: requests.map(req => ({
        _id: req._id,
        description: req.description,
        status: req.status,
        createdAt: req.createdAt,
        resolvedAt: req.resolvedAt,
        assignedTo: req.assignedTo,
      })),
    };

    return reportData;
  } catch (error) {
    console.error('Error generating property report:', error.message);
    throw error; // Re-throw the error for handling in the controller
  }
};

/**
 * Helper function to calculate average resolution time (in days)
 * @param {Array<object>} requests - Array of request objects
 * @returns {number} - Average resolution time in days
 */
function calculateAverageResolutionTime(requests) {
  if (requests.length === 0) return 0;

  const resolvedRequests = requests.filter(req => req.status === 'resolved');
  if (resolvedRequests.length === 0) return 0;

  const totalResolutionTime = resolvedRequests.reduce((sum, req) => {
    const createdAt = new Date(req.createdAt).getTime();
    const resolvedAt = new Date(req.resolvedAt).getTime();
    return sum + (resolvedAt - createdAt);
  }, 0);

  const averageResolutionTimeMs = totalResolutionTime / resolvedRequests.length;
  return averageResolutionTimeMs / (1000 * 60 * 60 * 24); // Convert milliseconds to days
}

/**
 * Helper function to find the most frequent issue category
 * @param {Array<object>} requests - Array of request objects
 * @returns {string} - Most frequent issue category
 */
function findMostFrequentIssue(requests) {
  if (requests.length === 0) return 'N/A';

  const categoryCounts = {};
  requests.forEach(req => {
    const category = req.category || 'Uncategorized'; // Assuming 'category' field exists in Request model
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  });

  let mostFrequentCategory = '';
  let maxCount = 0;

  for (const category in categoryCounts) {
    if (categoryCounts[category] > maxCount) {
      mostFrequentCategory = category;
      maxCount = categoryCounts[category];
    }
  }

  return mostFrequentCategory;
}