// ============================================================================
// TOUR ROUTES
// ============================================================================
// API endpoints for searching and retrieving tour/activity data from Viator
// ============================================================================

import express from 'express';
import { searchTours, getTourDetails, searchDestination } from '../services/affiliates/viator.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// SEARCH TOURS
// ============================================================================

/**
 * POST /api/tours/search
 * Search for tours at a destination
 * 
 * Request body:
 * {
 *   destination: "Florence",
 *   startDate: "2025-09-15",  // optional
 *   endDate: "2025-09-22",    // optional
 *   adults: 2                  // optional, default 2
 * }
 */
router.post('/search', async (req, res, next) => {
  try {
    const { destination, startDate, endDate, adults = 2 } = req.body;

    // Validate required fields
    if (!destination) {
      return res.status(400).json({ 
        error: 'Missing required field: destination',
        example: { destination: 'Florence', startDate: '2025-09-15', endDate: '2025-09-22' }
      });
    }

    logger.info(`Tour search: ${destination}, ${startDate || 'flexible'} to ${endDate || 'flexible'}, ${adults} adults`);

    const tours = await searchTours({
      destination,
      startDate,
      endDate,
      adults
    });

    logger.info(`Found ${tours.length} tours for ${destination}`);

    res.json({ 
      tours,
      searchParams: { destination, startDate, endDate, adults },
      count: tours.length
    });

  } catch (error) {
    logger.error('Tour search error:', error);
    next(error);
  }
});

// ============================================================================
// GET TOUR DETAILS
// ============================================================================

/**
 * GET /api/tours/:productCode
 * Get details for a specific tour
 */
router.get('/:productCode', async (req, res, next) => {
  try {
    const { productCode } = req.params;

    if (!productCode) {
      return res.status(400).json({ error: 'Product code is required' });
    }

    logger.info(`Tour details: ${productCode}`);

    const tour = await getTourDetails(productCode);

    res.json({ tour });

  } catch (error) {
    logger.error('Tour details error:', error);
    next(error);
  }
});

// ============================================================================
// SEARCH DESTINATIONS
// ============================================================================

/**
 * GET /api/tours/destinations/search?q=Florence
 * Search for valid destination names
 */
router.get('/destinations/search', async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const destination = await searchDestination(q);

    if (!destination) {
      return res.json({ destination: null, found: false });
    }

    res.json({ destination, found: true });

  } catch (error) {
    logger.error('Destination search error:', error);
    next(error);
  }
});

export default router;
