// ============================================================================
// TRACKING ROUTES
// ============================================================================
// Handles affiliate link click tracking
// ============================================================================

import express from 'express';
import { trackClick, getClickStats } from '../services/analytics.js';
import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// POST /api/tracking/click
// ============================================================================
// Track an affiliate link click
//
// Request body:
// {
//   "type": "flight",                    // flight, hotel, or tour
//   "provider": "booking.com",           // affiliate provider
//   "itemId": "f1",                      // ID of the item
//   "sessionId": "uuid",                 // User session ID
//   "metadata": {...}                    // Additional data
// }
//
// Response:
// {
//   "id": "uuid",                        // Unique click ID
//   "tracked": true
// }
// ============================================================================

router.post('/click', async (req, res, next) => {
  try {
    const { type, provider, itemId, sessionId, metadata } = req.body;

    // Validate required fields
    if (!type || !provider || !itemId) {
      throw new ApiError(400, 'Missing required fields: type, provider, itemId');
    }

    // Validate type
    const validTypes = ['flight', 'hotel', 'tour'];
    if (!validTypes.includes(type)) {
      throw new ApiError(400, 'Invalid type. Must be: flight, hotel, or tour');
    }

    // Track the click
    const click = await trackClick({
      type,
      provider,
      itemId,
      sessionId: sessionId || 'anonymous',
      userAgent: req.headers['user-agent'],
      referrer: req.headers.referer || req.headers.referrer,
      metadata,
    });

    logger.info('Affiliate click tracked', {
      clickId: click.id,
      type: click.type,
      provider: click.provider,
    });

    res.json({
      id: click.id,
      tracked: true,
      timestamp: click.timestamp,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/tracking/stats
// ============================================================================
// Get affiliate click statistics (protected - add auth in production!)
// ============================================================================

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await getClickStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /api/tracking/conversion
// ============================================================================
// Track a completed booking/conversion (for future use)
// ============================================================================

router.post('/conversion', async (req, res, next) => {
  try {
    const { clickId, amount, currency, bookingId } = req.body;

    // For MVP, just log it
    // In production, you'd save this to database and calculate revenue
    logger.info('Conversion tracked', {
      clickId,
      amount,
      currency,
      bookingId,
    });

    res.json({
      success: true,
      message: 'Conversion tracked',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
