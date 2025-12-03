// ============================================================================
// TOUR ROUTES
// ============================================================================

import express from 'express';
import { searchTours, getTourDetails, findDestination, debugSearchDestinations } from '../services/affiliates/viator.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// POST /api/tours/search
// ============================================================================

/**
 * Search for tours
 * 
 * Request body:
 * {
 *   destination: "Boston",           // Required
 *   searchTerms: "food brewery",     // Optional - filter by keywords
 *   resultCount: 5,                  // Optional - number of results (default 10, max 20)
 *   sortBy: "reviews",               // Optional - 'popular', 'rating', 'reviews', 'price_low', 'price_high', 'newest', 'duration_short', 'duration_long'
 *   startDate: "2025-07-15",         // Optional - YYYY-MM-DD format
 *   endDate: "2025-07-22",           // Optional - YYYY-MM-DD format
 *   flags: ["FREE_CANCELLATION"],    // Optional - array of: FREE_CANCELLATION, SKIP_THE_LINE, PRIVATE_TOUR, LIKELY_TO_SELL_OUT, SPECIAL_OFFER
 *   minPrice: 50,                    // Optional - minimum price in USD
 *   maxPrice: 200,                   // Optional - maximum price in USD
 *   minDuration: 60,                 // Optional - minimum duration in minutes
 *   maxDuration: 240,                // Optional - maximum duration in minutes
 *   minRating: 4                     // Optional - minimum rating (1-5)
 * }
 */
router.post('/search', async (req, res, next) => {
  try {
    const { 
      destination, 
      searchTerms = '', 
      resultCount = 10,
      sortBy = 'popular',
      startDate, 
      endDate,
      flags = [],
      minPrice,
      maxPrice,
      minDuration,
      maxDuration,
      minRating
    } = req.body;

    if (!destination) {
      return res.status(400).json({ 
        error: 'Missing required field: destination'
      });
    }

    // Validate flags if provided
    const validFlags = ['FREE_CANCELLATION', 'SKIP_THE_LINE', 'PRIVATE_TOUR', 'LIKELY_TO_SELL_OUT', 'SPECIAL_OFFER', 'NEW_ON_VIATOR'];
    const sanitizedFlags = Array.isArray(flags) 
      ? flags.filter(f => validFlags.includes(f))
      : [];

    logger.info(`Tour search: dest="${destination}", terms="${searchTerms}", count=${resultCount}, sort=${sortBy}`);

    const tours = await searchTours({
      destination,
      searchTerms,
      resultCount: Math.min(parseInt(resultCount) || 10, 20),
      sortBy,
      startDate,
      endDate,
      flags: sanitizedFlags,
      minPrice: minPrice !== undefined ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice !== undefined ? parseFloat(maxPrice) : undefined,
      minDuration: minDuration !== undefined ? parseInt(minDuration) : undefined,
      maxDuration: maxDuration !== undefined ? parseInt(maxDuration) : undefined,
      minRating: minRating !== undefined ? parseFloat(minRating) : undefined
    });

    logger.info(`Returning ${tours.length} tours`);

    res.json({ 
      tours,
      searchParams: { 
        destination, 
        searchTerms, 
        resultCount, 
        sortBy,
        startDate,
        endDate,
        flags: sanitizedFlags,
        minPrice,
        maxPrice,
        minDuration,
        maxDuration,
        minRating
      },
      count: tours.length
    });

  } catch (error) {
    logger.error('Tour search error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/tours/:productCode
// ============================================================================

router.get('/:productCode', async (req, res, next) => {
  try {
    const { productCode } = req.params;

    if (!productCode) {
      return res.status(400).json({ error: 'Product code is required' });
    }

    const tour = await getTourDetails(productCode);
    res.json({ tour });

  } catch (error) {
    logger.error('Tour details error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/tours/destinations/search
// ============================================================================

router.get('/destinations/search', async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const destination = await findDestination(q);

    res.json({ 
      destination, 
      found: !!destination 
    });

  } catch (error) {
    logger.error('Destination search error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/tours/debug/destinations - Debug endpoint to search all destinations
// ============================================================================

router.get('/debug/destinations', async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const results = await debugSearchDestinations(q);

    res.json(results);

  } catch (error) {
    logger.error('Debug destination search error:', error);
    next(error);
  }
});

export default router;
