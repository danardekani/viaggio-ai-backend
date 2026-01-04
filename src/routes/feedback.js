// ============================================================================
// FEEDBACK ROUTES
// ============================================================================
// Handles user feedback collection and retrieval
// ============================================================================

import express from 'express';
import { saveFeedback, getFeedbackStats } from '../services/analytics.js';
import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// POST /api/feedback
// ============================================================================
// Submit user feedback
//
// Request body:
// {
//   "rating": 5,                         // 1-5 stars
//   "comment": "Great experience!",      // Optional comment
//   "sessionId": "uuid",                 // User session ID
//   "page": "itinerary",                 // Where feedback was given
//   "metadata": {...}                    // Additional data
// }
//
// Response:
// {
//   "id": "uuid",
//   "success": true
// }
// ============================================================================

router.post('/', async (req, res, next) => {
  try {
    const { rating, comment, sessionId, page, metadata } = req.body;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      throw new ApiError(400, 'Rating must be between 1 and 5');
    }

    // Save feedback
    const feedback = await saveFeedback({
      rating: parseInt(rating),
      comment: comment || '',
      sessionId: sessionId || 'anonymous',
      page: page || 'unknown',
      metadata: metadata || {},
    });

    logger.info('User feedback received', {
      feedbackId: feedback.id,
      rating: feedback.rating,
      page: feedback.page,
    });

    res.json({
      id: feedback.id,
      success: true,
      message: 'Thank you for your feedback!',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/feedback/stats
// ============================================================================
// Get feedback statistics (protected - add auth in production!)
// ============================================================================

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await getFeedbackStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
