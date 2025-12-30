// ============================================================================
// TOUR ROUTES
// ============================================================================

import express from 'express';
import {
  searchTours,
  getTourDetails,
  findDestination,
  debugSearchDestinations,
  searchDestinationsAutocomplete,
  searchAttractions,
  getAttractionDetails,
  searchToursByAttraction,
  combinedAutocomplete
} from '../services/affiliates/viator.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// DEBUG: See raw Viator freetext response
router.get('/autocomplete/debug', async (req, res) => {
  const { q } = req.query;
  
  try {
    const response = await fetch('https://api.sandbox.viator.com/partner/search/freetext', {
      method: 'POST',
      headers: {
        'exp-api-key': process.env.VIATOR_API_KEY,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        searchTerm: q,
        searchTypes: [
          { searchType: 'ATTRACTIONS', pagination: { start: 1, count: 3 } }
        ],
        currency: 'USD'
      })
    });
    
    const data = await response.json();
    
    // Return raw response so we can see the field names
    res.json({
      rawAttractions: data.attractions?.results?.slice(0, 2),
      fieldNames: data.attractions?.results?.[0] ? Object.keys(data.attractions.results[0]) : []
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

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
 * Search for tours
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
 *   minRating: 4                     // Optional - minimum rating (1-5)
 * }
 *
 * Response:
 * {
 *   tours: [...],                    // Array of tour objects
 *   totalCount: 3038,                // Total available from Viator API
 *   hasMore: true,                   // Whether more results exist beyond fetched
 *   count: 500,                      // Number of tours returned
 *   searchParams: {...}              // Echo of search parameters
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

    const result = await searchTours({
      destination,
      destinationId,
      searchTerms,
      resultCount: Math.min(parseInt(resultCount) || 10, 500), // Allow up to 500
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
      // Old format - backward compatibility
      tours = result;
      totalCount = result.length;
      hasMore = false;
    } else {
      // New format with metadata
      tours = result.tours || [];
      totalCount = result.totalCount || tours.length;
      hasMore = result.hasMore || false;
    }

    logger.info(`Returning ${tours.length} tours (${totalCount} total available, hasMore: ${hasMore})`);

    res.json({
      tours,
      totalCount,        // Total available from Viator
      hasMore,           // Are there more results beyond what we fetched?
      count: tours.length,
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
        minRating
      }
    });

  } catch (error) {
    logger.error('Tour search error:', error);
    next(error);
  }
});

// ============================================================================
// ATTRACTIONS/LANDMARKS ROUTES
// ============================================================================

// GET /api/tours/attractions - Get attractions/landmarks for a destination
router.get('/attractions', async (req, res, next) => {
  try {
    const { destinationId, sort = 'DEFAULT', start = 1, count = 30 } = req.query;

    if (!destinationId) {
      return res.status(400).json({
        error: 'destinationId is required',
        example: '/api/tours/attractions?destinationId=684'
      });
    }

    const result = await searchAttractions(parseInt(destinationId), {
      sort,
      start: parseInt(start),
      count: Math.min(parseInt(count), 30)
    });

    res.json(result);
  } catch (error) {
    logger.error('Attractions search error:', error);
    next(error);
  }
});

// GET /api/tours/attractions/:seoId/tours - Get tours for a specific attraction
// Note: Use the seoId from the attractions search response, NOT the attractionId
router.get('/attractions/:seoId/tours', async (req, res, next) => {
  try {
    const { seoId } = req.params;
    const {
      start = 1,
      count = 50,
      sortBy = 'popular',
      flags,
      minPrice,
      maxPrice,
      minRating,
      destinationId
    } = req.query;

    if (!seoId || isNaN(parseInt(seoId))) {
      return res.status(400).json({ error: 'Valid seoId is required' });
    }

    const result = await searchToursByAttraction(parseInt(seoId), parseInt(destinationId), {
      start: parseInt(start),
      count: Math.min(parseInt(count), 50),
      sortBy,
      flags: flags ? flags.split(',') : [],
      minPrice: minPrice ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      minRating: minRating ? parseFloat(minRating) : undefined
    });

    res.json(result);
  } catch (error) {
    logger.error('Tours by attraction error:', error);
    next(error);
  }
});

// GET /api/tours/attractions/:attractionId - Get details for a specific attraction
router.get('/attractions/:attractionId', async (req, res, next) => {
  try {
    const { attractionId } = req.params;

    if (!attractionId || isNaN(parseInt(attractionId))) {
      return res.status(400).json({ error: 'Valid attractionId is required' });
    }

    const details = await getAttractionDetails(parseInt(attractionId));
    res.json(details);
  } catch (error) {
    logger.error('Attraction details error:', error);
    next(error);
  }
});

// GET /api/tours/autocomplete/combined - Combined autocomplete for destinations AND attractions
router.get('/autocomplete/combined', async (req, res, next) => {
  try {
    const { q, limit = 8 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ destinations: [], attractions: [] });
    }

    const result = await combinedAutocomplete(q, parseInt(limit));
    res.json(result);
  } catch (error) {
    logger.error('Combined autocomplete error:', error);
    res.json({ destinations: [], attractions: [] });
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
