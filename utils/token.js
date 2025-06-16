const crypto = require('crypto');
exports.generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};