// ============================================================================
// RATE LIMITER MIDDLEWARE
// ============================================================================
// Prevents API abuse by limiting requests per IP address
// Default: 100 requests per 15 minutes
// ============================================================================

import rateLimit from 'express-rate-limit';

export const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Stricter rate limit for chat endpoint (Claude API is expensive)
export const chatRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit chat to 30 requests per 15 minutes
  message: 'Too many chat requests, please slow down.',
});
