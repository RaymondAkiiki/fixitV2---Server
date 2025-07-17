/**
 * User Data Transfer Object (DTO)
 * Maps a User Mongoose document to a plain object for API responses.
 */
function userToDto(userDoc) {
  if (!userDoc) return null;
  // Use .toJSON() if a Mongoose doc, otherwise assume it's already a plain object
  const user = typeof userDoc.toJSON === 'function' ? userDoc.toJSON() : userDoc;
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.registrationStatus, // Map to "status" for API
    isActive: user.isActive,
    isEmailVerified: user.isEmailVerified,
    avatar: user.avatar,
    preferences: user.preferences,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
    // Add or remove fields as needed for your frontend
  };
}
module.exports = { userToDto };