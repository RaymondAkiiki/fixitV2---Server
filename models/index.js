// server/models/index.js

// Export all individual models
module.exports = {
  Vendor: require('./vendor'),
  User: require('./user'),
  Unit: require('./unit'),
  ScheduledMaintenance: require('./scheduledMaintenance'),
  Request: require('./request'),
  PropertyUser: require('./propertyUser'),
  Property: require('./property'),
  Rent: require('./rent'),
  RentSchedule: require('./rentSchedule'),
  Lease: require('./lease'),
  Message: require('./message'),
  Notification: require('./notification'),
  Media: require('./media'),
  Invite: require('./invite'),
  Comment: require('./comment'),
  AuditLog: require('./auditLog'),
  Onboarding: require('./onboarding'),
};