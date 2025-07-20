const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const config = require('../config');

// Mock current user for tests
const mockUser = {
  _id: '60d0fe4f5311236168a109ca',
  name: 'Test User',
  email: 'testuser@example.com',
  role: 'admin'
};

// Setup MongoDB Memory Server
let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// Clear all collections after each test
afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// Generate auth token for testing
const generateAuthToken = (user = mockUser) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
};

// Create mock request and response objects
const mockRequest = (overrides = {}) => {
  const req = {
    body: {},
    params: {},
    query: {},
    user: { ...mockUser },
    files: [],
    ...overrides
  };
  return req;
};

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

module.exports = {
  mockUser,
  generateAuthToken,
  mockRequest,
  mockResponse
};