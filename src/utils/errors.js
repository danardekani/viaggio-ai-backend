// ============================================================================
// ERROR HANDLING UTILITIES
// ============================================================================
// Centralized error handling for consistent error responses
// ============================================================================

import { logger } from './logger.js';

// Custom error class for API errors
export class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'ApiError';
  }
}

// Global error handler middleware
export function errorHandler(err, req, res, _next) {
  // Log the error
  logger.error(err.message, {
    path: req.path,
    method: req.method,
    stack: err.stack,
  });

  // Handle known API errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details && { details: err.details }),
    });
  }

  // Handle unknown errors
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
