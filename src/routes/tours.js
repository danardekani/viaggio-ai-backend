// ============================================================================
// TOUR ROUTES - Multi-Platform Marketplace
// ============================================================================
// Aggregates tours from multiple providers: Viator, HotelBeds Activities
// ============================================================================

import express from 'express';
import { searchTours, getTourDetails, findDestination, debugSearchDestinations, searchDestinationsAutocomplete } from '../services/affiliates/viator.js';
import { searchToursAggregated, getTourDetailsAggregated, getProviders } from '../services/affiliates/tour-aggregator.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// GET /api/tours/destinations/autocomplete - Autocomplete for destination input
// ============================================================================

router.get('/destinations/autocomplete', async (req, res, next) => {
  try {
    const { q, limit = 8 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await searchDestinationsAutocomplete(q, parseInt(limit));

    res.json({ 
      suggestions,
      query: q
    });

  } catch (error) {
    logger.error('Autocomplete error:', error);
    res.json({ suggestions: [], error: 'Search failed' });
  }
});

// ============================================================================
// POST /api/tours/search
// ============================================================================

/**
 * Search for tours across multiple platforms
 *
 * Request body:
 * {
 *   destination: "Boston",           // Required
 *   searchTerms: "food brewery",     // Optional - filter by keywords
 *   resultCount: 5,                  // Optional - number of results (default 10)
 *   sortBy: "reviews",               // Optional - 'popular', 'rating', 'reviews', 'price_low', 'price_high', 'newest', 'duration_short', 'duration_long'
 *   startDate: "2025-07-15",         // Optional - YYYY-MM-DD format
 *   endDate: "2025-07-22",           // Optional - YYYY-MM-DD format
 *   flags: ["FREE_CANCELLATION"],    // Optional - array of: FREE_CANCELLATION, SKIP_THE_LINE, PRIVATE_TOUR, LIKELY_TO_SELL_OUT, SPECIAL_OFFER
 *   minPrice: 50,                    // Optional - minimum price in USD
 *   maxPrice: 200,                   // Optional - maximum price in USD
 *   minDuration: 60,                 // Optional - minimum duration in minutes
 *   maxDuration: 240,                // Optional - maximum duration in minutes
 *   minRating: 4,                    // Optional - minimum rating (1-5)
 *   providers: ["viator", "hotelbeds"] // Optional - providers to search (default: all)
 * }
 *
 * Response:
 * {
 *   tours: [...],                    // Array of tour objects with provider field
 *   totalCount: 3038,                // Total available across all providers
 *   hasMore: true,                   // Whether more results exist
 *   count: 500,                      // Number of tours returned
 *   providers: {...},                // Stats per provider
 *   searchParams: {...},             // Echo of search parameters
 *   aggregated: true                 // Indicates multi-platform search
 * }
 */
router.post('/search', async (req, res, next) => {
  try {
    const {
      destination,
      destinationId,
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
      minRating,
      providers // Optional: ['viator', 'hotelbeds'] - defaults to all
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

    // Validate providers if provided
    const validProviders = ['viator', 'hotelbeds'];
    const selectedProviders = Array.isArray(providers)
      ? providers.filter(p => validProviders.includes(p))
      : validProviders; // Default to all providers

    logger.info(`Tour search: dest="${destination}", terms="${searchTerms}", count=${resultCount}, sort=${sortBy}, providers=${selectedProviders.join(',')}`);

    // Use single-provider search for backward compatibility when only Viator requested
    if (selectedProviders.length === 1 && selectedProviders[0] === 'viator') {
      const result = await searchTours({
        destination,
        destinationId,
        searchTerms,
        resultCount: Math.min(parseInt(resultCount) || 10, 500),
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

      // Handle both old format (array) and new format (object with metadata)
      let tours, totalCount, hasMore;

      if (Array.isArray(result)) {
        tours = result;
        totalCount = result.length;
        hasMore = false;
      } else {
        tours = result.tours || [];
        totalCount = result.totalCount || tours.length;
        hasMore = result.hasMore || false;
      }

      logger.info(`Returning ${tours.length} tours (${totalCount} total available, hasMore: ${hasMore})`);

      return res.json({
        tours,
        totalCount,
        hasMore,
        count: tours.length,
        providers: { viator: { count: tours.length, totalCount, hasMore } },
        searchParams: {
          destination,
          destinationId,
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
          minRating,
          providers: selectedProviders
        }
      });
    }

    // Use aggregated search for multiple providers
    const result = await searchToursAggregated({
      destination,
      destinationId,
      searchTerms,
      resultCount: Math.min(parseInt(resultCount) || 10, 500),
      sortBy,
      startDate,
      endDate,
      providers: selectedProviders,
      flags: sanitizedFlags,
      minPrice: minPrice !== undefined ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice !== undefined ? parseFloat(maxPrice) : undefined,
      minDuration: minDuration !== undefined ? parseInt(minDuration) : undefined,
      maxDuration: maxDuration !== undefined ? parseInt(maxDuration) : undefined,
      minRating: minRating !== undefined ? parseFloat(minRating) : undefined
    });

    logger.info(`Returning ${result.count} tours from ${Object.keys(result.providers).length} providers`);

    res.json(result);

  } catch (error) {
    logger.error('Tour search error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/tours/providers - List available tour providers
// ============================================================================

router.get('/providers', (req, res) => {
  const providers = getProviders();
  res.json({ providers });
});

// ============================================================================
// GET /api/tours/:productCode - Get tour details from any provider
// ============================================================================

router.get('/:productCode', async (req, res, next) => {
  try {
    const { productCode } = req.params;

    if (!productCode) {
      return res.status(400).json({ error: 'Product code is required' });
    }

    // Use aggregated details (handles both Viator and HotelBeds)
    const tour = await getTourDetailsAggregated(productCode);
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
