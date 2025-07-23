// tests/integration/bug-fixes.test.js

// Mock environment variables for testing
process.env.MONGO_URI = 'mongodb://localhost:27017/test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

describe('Bug Fixes Integration Tests', () => {
    describe('Module Imports', () => {
        test('Auth middleware should import correctly', () => {
            const authMiddleware = require('../../middleware/authMiddleware');
            expect(authMiddleware).toHaveProperty('protect');
            expect(authMiddleware).toHaveProperty('authorizeRoles');
            expect(authMiddleware).toHaveProperty('authorizePropertyAccess');
            expect(typeof authMiddleware.protect).toBe('function');
        });

        test('Error middleware should import correctly', () => {
            const errorMiddleware = require('../../middleware/errorMiddleware');
            expect(errorMiddleware).toHaveProperty('errorHandler');
            expect(errorMiddleware).toHaveProperty('notFound');
            expect(typeof errorMiddleware.errorHandler).toBe('function');
            expect(typeof errorMiddleware.notFound).toBe('function');
        });

        test('RentController should import correctly (case sensitivity fix)', () => {
            expect(() => {
                const rentController = require('../../controllers/rentController');
                expect(rentController).toBeDefined();
            }).not.toThrow();
        });

        test('AsyncHandler should import correctly from utils', () => {
            expect(() => {
                const asyncHandler = require('../../utils/asyncHandler');
                expect(typeof asyncHandler).toBe('function');
            }).not.toThrow();
        });
    });

    describe('External Service Integration', () => {
        test('Google Auth should handle missing credentials gracefully', () => {
            const googleAuthClient = require('../../lib/googleAuthClient');
            expect(googleAuthClient).toHaveProperty('isGoogleAuthConfigured');
            expect(typeof googleAuthClient.isGoogleAuthConfigured).toBe('function');
            
            // Should not throw an error when credentials are missing
            expect(() => googleAuthClient.isGoogleAuthConfigured()).not.toThrow();
        });

        test('SMS Gateway should handle missing credentials gracefully', () => {
            const smsGatewayClient = require('../../lib/smsGatewayClient');
            expect(smsGatewayClient).toHaveProperty('isSmsConfigured');
            expect(typeof smsGatewayClient.isSmsConfigured).toBe('function');
            
            // Should not throw an error when credentials are missing
            expect(() => smsGatewayClient.isSmsConfigured()).not.toThrow();
        });

        test('Cloudinary should handle missing credentials gracefully', () => {
            const cloudStorageService = require('../../services/cloudStorageService');
            expect(cloudStorageService).toHaveProperty('isCloudinaryConfigured');
            expect(typeof cloudStorageService.isCloudinaryConfigured).toBe('function');
            
            // Should not throw an error when credentials are missing
            expect(() => cloudStorageService.isCloudinaryConfigured()).not.toThrow();
        });
    });

    describe('Route Imports', () => {
        test('All route files should import correctly', () => {
            const routePaths = [
                'authRoutes',
                'commentRoutes',
                'documentGenerationRoutes',
                'inviteRoutes',
                'messageRoutes',
                'notificationRoutes',
                'onboardingRoutes',
                'propertyRoutes',
                'rentRoutes', // This was failing due to case sensitivity
                'requestRoutes',
                'userRoutes'
            ];

            for (const routePath of routePaths) {
                expect(() => {
                    require(`../../routes/${routePath}`);
                }).not.toThrow();
            }
        });
    });

    describe('Configuration Validation', () => {
        test('Config modules should load without throwing', () => {
            expect(() => {
                require('../../config/db');
                require('../../config/cloudinary');
                require('../../config/jwt');
            }).not.toThrow();
        });

        test('Utility modules should load without throwing', () => {
            expect(() => {
                require('../../utils/AppError');
                require('../../utils/asyncHandler');
                require('../../utils/logger');
            }).not.toThrow();
        });
    });
});