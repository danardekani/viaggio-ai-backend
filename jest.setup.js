// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.PORT = '3002';
process.env.VIATOR_API_KEY = 'test-viator-key';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.REDIS_URL = ''; // Disable Redis in tests by default

// Global test utilities
global.testTimeout = 5000;
