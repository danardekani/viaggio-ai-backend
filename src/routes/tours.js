// ============================================================================
// TOUR ROUTES
// ============================================================================

import express from 'express';
import { searchTours, getTourDetails, findDestination } from '../services/affiliates/viator.js';
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
 *   resultCount: 5,                  // Optional - number of results (default 10)
 *   startDate: "2025-07-15",         // Optional
 *   endDate: "2025-07-22"            // Optional
 * }
 */
router.post('/search', async (req, res, next) => {
  try {
    const { 
      destination, 
      searchTerms = '', 
      resultCount = 10,
      startDate, 
      endDate 
    } = req.body;

    if (!destination) {
      return res.status(400).json({ 
        error: 'Missing required field: destination'
      });
    }

    logger.info(`Tour search: dest="${destination}", terms="${searchTerms}", count=${resultCount}`);

    const tours = await searchTours({
      destination,
      searchTerms,
      resultCount: Math.min(parseInt(resultCount) || 10, 20),
      startDate,
      endDate
    });

    logger.info(`Returning ${tours.length} tours`);

    res.json({ 
      tours,
      searchParams: { destination, searchTerms, resultCount },
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

export default router;
