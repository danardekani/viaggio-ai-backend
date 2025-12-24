// ============================================================================
// VIAGGIO.AI BACKEND SERVER
// ============================================================================
// Main Express server that handles:
// - AI chat conversations via Claude API
// - Tour search via Viator API
// - Image identification via Vision AI
// - Affiliate link tracking
// - User feedback collection
// ============================================================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import tourRoutes from './routes/tours.js';
import { warmTourCache } from './services/affiliates/viator.js';

// Import routes
import trackingRoutes from './routes/tracking.js';
import feedbackRoutes from './routes/feedback.js';
import identifyRoutes from './routes/identify.js';
import agentRoutes from './routes/agent/chat-agent.js';

// Import middleware
import { corsConfig } from './middleware/cors.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './utils/errors.js';
import { logger } from './utils/logger.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Load environment variables from .env file
dotenv.config();

// Get current directory (needed for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy - required for Railway (and other cloud platforms)
app.set('trust proxy', 1);

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Parse JSON request bodies
app.use(express.json({ limit: '50mb'}));

// Agentic AI route (before CORS to use its own CORS handling)
app.use('/api/agent', agentRoutes);

// Enable CORS for frontend communication
app.use(cors(corsConfig));

// Apply rate limiting to prevent abuse
app.use('/api/', rateLimiter);

// Get tours from viator
app.use('/api/tours', tourRoutes);

// Where is this destination?
app.use('/api/identify', identifyRoutes);

// Log all incoming requests
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// ============================================================================
// ROUTES
// ============================================================================

// Health check endpoint - used to verify server is running
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// API Routes
app.use('/api/tracking', trackingRoutes);   // Affiliate tracking endpoint
app.use('/api/feedback', feedbackRoutes);   // User feedback endpoint
app.use('/api/identify', identifyRoutes);   // Where is this endpoint

// Catch-all route for undefined endpoints
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Global error handler (must be last middleware)
app.use(errorHandler);

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  logger.info(`🚀 Viaggio.ai Backend running on port ${PORT}`);
  logger.info(`📡 Environment: ${process.env.NODE_ENV}`);
  logger.info(`🌐 Frontend URL: ${process.env.FRONTEND_URL}`);

  // Pre-warm tour cache in background (non-blocking)
  // This makes popular destination searches instant from the start
  if (process.env.WARM_CACHE_ON_STARTUP !== 'false') {
    logger.info('🔥 Starting cache warm-up in background...');
    warmTourCache().catch(err => {
      logger.warn('Cache warm-up failed:', err.message);
    });
  }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
  });
});
