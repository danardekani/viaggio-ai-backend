// ============================================================================
// HOTELBEDS ACTIVITIES ROUTES
// ============================================================================

import express from 'express';
import {
  searchActivities,
  searchActivitiesByLocation,
  searchActivitiesByHotel,
  getActivityDetails,
  getActivityContent,
  getExcursionPickups,
  fetchCountries,
  fetchDestinations,
  findDestinationCode,
  searchDestinationsAutocomplete,
} from '../services/affiliates/hotelbeds-activities.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// GET /api/activities/destinations/autocomplete
// ============================================================================

/**
 * Autocomplete for activity destination search
 *
 * Query params:
 * - q: Search term (min 2 characters)
 * - limit: Number of results (default: 8, max: 20)
 */
router.get('/destinations/autocomplete', async (req, res, _next) => {
  try {
    const { q, limit = 8 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await searchDestinationsAutocomplete(q, Math.min(parseInt(limit) || 8, 20));

    res.json({
      suggestions,
      query: q,
    });
  } catch (error) {
    logger.error('Activity destination autocomplete error:', error);
    res.status(500).json({
      suggestions: [],
      error: 'Autocomplete search failed',
    });
  }
});

// ============================================================================
// POST /api/activities/search
// ============================================================================

/**
 * Search for activities in a destination
 *
 * Request body:
 * {
 *   destination: "Barcelona",           // Required - City name or destination code
 *   destinationCode: "BCN",             // Optional - If provided, skips lookup
 *   from: "2025-07-15",                 // Required - Start date (YYYY-MM-DD)
 *   to: "2025-07-22",                   // Required - End date (YYYY-MM-DD)
 *   adults: 2,                          // Optional - Number of adults (default: 2)
 *   children: 0,                        // Optional - Number of children (default: 0)
 *   childrenAges: [10, 8],              // Optional - Ages of children
 *   language: "en",                     // Optional - Language code (default: en)
 *   resultCount: 20                     // Optional - Number of results (default: 20, max: 50)
 * }
 */
router.post('/search', async (req, res, next) => {
  const destination = req.body.destination;

  try {
    let { destinationCode } = req.body;
    const {
      from,
      to,
      adults = 2,
      children = 0,
      childrenAges = [],
      language = 'en',
      resultCount = 20,
    } = req.body;

    // Validate required fields
    if (!destination && !destinationCode) {
      return res.status(400).json({
        error: 'Missing required field: destination or destinationCode',
      });
    }

    if (!from || !to) {
      return res.status(400).json({
        error: 'Missing required fields: from and to dates',
      });
    }

    // Fix string "null" or "undefined" from frontend
    if (destinationCode === 'null' || destinationCode === 'undefined' || destinationCode === '') {
      destinationCode = null;
    }

    // Find destination code if not provided
    if (!destinationCode) {
      const destInfo = findDestinationCode(destination);
      if (destInfo) {
        destinationCode = destInfo.code;
        logger.info(`Resolved destination "${destination}" to code "${destinationCode}"`);
      } else {
        logger.warn(`Could not find destination code for: ${destination}`);
        return res.status(400).json({
          error: 'Destination not found',
          message: `Could not find destination: ${destination}. Try a major city like Barcelona, Rome, or Paris.`,
          suggestion: 'Use the /destinations/autocomplete endpoint to find valid destinations.',
        });
      }
    }

    // Build paxes array
    const paxes = [];

    // Add adults (default age 30)
    for (let i = 0; i < adults; i++) {
      paxes.push({ age: 30 });
    }

    // Add children with ages
    for (let i = 0; i < children; i++) {
      const age = childrenAges[i] || 10; // Default child age 10
      paxes.push({ age });
    }

    logger.info(
      `Activity search: ${destination} (${destinationCode}), ${from} to ${to}, ${paxes.length} pax`
    );

    const activities = await searchActivities({
      destination: destinationCode,
      from,
      to,
      paxes,
      resultCount: Math.min(parseInt(resultCount) || 20, 50),
      language,
    });

    res.json({
      activities,
      count: activities.length,
      searchParams: {
        destination,
        destinationCode,
        from,
        to,
        adults,
        children,
        language,
        resultCount,
      },
    });
  } catch (error) {
    logger.error('Activity search error:', error);

    if (error.message.includes('401') || error.message.includes('403')) {
      return res.status(500).json({
        error: 'API authentication error',
        message: 'There was an issue with the activity search service. Please try again later.',
      });
    }

    next(error);
  }
});

// ============================================================================
// POST /api/activities/search/location
// ============================================================================

/**
 * Search for activities by geolocation
 *
 * Request body:
 * {
 *   latitude: 41.3851,                  // Required
 *   longitude: 2.1734,                  // Required
 *   radius: 30,                         // Optional - Radius in km (default: 30)
 *   from: "2025-07-15",                 // Required
 *   to: "2025-07-22",                   // Required
 *   adults: 2,                          // Optional
 *   children: 0,                        // Optional
 *   childrenAges: [],                   // Optional
 *   language: "en",                     // Optional
 *   resultCount: 20                     // Optional
 * }
 */
router.post('/search/location', async (req, res, next) => {
  try {
    const {
      latitude,
      longitude,
      radius = 30,
      from,
      to,
      adults = 2,
      children = 0,
      childrenAges = [],
      language = 'en',
      resultCount = 20,
    } = req.body;

    // Validate required fields
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: latitude and longitude',
      });
    }

    if (!from || !to) {
      return res.status(400).json({
        error: 'Missing required fields: from and to dates',
      });
    }

    // Build paxes array
    const paxes = [];
    for (let i = 0; i < adults; i++) {
      paxes.push({ age: 30 });
    }
    for (let i = 0; i < children; i++) {
      paxes.push({ age: childrenAges[i] || 10 });
    }

    logger.info(`Activity geo search: (${latitude}, ${longitude}), radius ${radius}km`);

    const activities = await searchActivitiesByLocation({
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      radius: parseInt(radius),
      from,
      to,
      paxes,
      resultCount: Math.min(parseInt(resultCount) || 20, 50),
      language,
    });

    res.json({
      activities,
      count: activities.length,
      searchParams: {
        latitude,
        longitude,
        radius,
        from,
        to,
        adults,
        children,
      },
    });
  } catch (error) {
    logger.error('Activity location search error:', error);
    next(error);
  }
});

// ============================================================================
// POST /api/activities/search/hotel
// ============================================================================

/**
 * Search for activities near a hotel
 *
 * Request body:
 * {
 *   hotelCode: "8011",                  // Required - HotelBeds hotel code
 *   from: "2025-07-15",                 // Required
 *   to: "2025-07-22",                   // Required
 *   adults: 2,                          // Optional
 *   children: 0,                        // Optional
 *   childrenAges: [],                   // Optional
 *   language: "en",                     // Optional
 *   resultCount: 20                     // Optional
 * }
 */
router.post('/search/hotel', async (req, res, next) => {
  try {
    const {
      hotelCode,
      from,
      to,
      adults = 2,
      children = 0,
      childrenAges = [],
      language = 'en',
      resultCount = 20,
    } = req.body;

    // Validate required fields
    if (!hotelCode) {
      return res.status(400).json({
        error: 'Missing required field: hotelCode',
      });
    }

    if (!from || !to) {
      return res.status(400).json({
        error: 'Missing required fields: from and to dates',
      });
    }

    // Build paxes array
    const paxes = [];
    for (let i = 0; i < adults; i++) {
      paxes.push({ age: 30 });
    }
    for (let i = 0; i < children; i++) {
      paxes.push({ age: childrenAges[i] || 10 });
    }

    logger.info(`Activity hotel search: hotel ${hotelCode}`);

    const activities = await searchActivitiesByHotel({
      hotelCode,
      from,
      to,
      paxes,
      resultCount: Math.min(parseInt(resultCount) || 20, 50),
      language,
    });

    res.json({
      activities,
      count: activities.length,
      searchParams: {
        hotelCode,
        from,
        to,
        adults,
        children,
      },
    });
  } catch (error) {
    logger.error('Activity hotel search error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/activities/:activityCode
// ============================================================================

/**
 * Get detailed information about a specific activity
 *
 * URL Parameters:
 * - activityCode: The HotelBeds activity code
 *
 * Query Parameters:
 * - from: Start date (YYYY-MM-DD) - Required
 * - to: End date (YYYY-MM-DD) - Required
 * - adults: Number of adults (default: 2)
 * - children: Number of children (default: 0)
 * - childrenAges: Comma-separated ages (e.g., "10,8")
 * - language: Language code (default: en)
 * - full: Whether to fetch full details (default: false)
 */
router.get('/:activityCode', async (req, res, next) => {
  try {
    const { activityCode } = req.params;
    const {
      from,
      to,
      adults = 2,
      children = 0,
      childrenAges = '',
      language = 'en',
      full = 'false',
    } = req.query;

    if (!activityCode) {
      return res.status(400).json({ error: 'Activity code is required' });
    }

    if (!from || !to) {
      return res.status(400).json({
        error: 'From and to dates are required as query parameters',
        example: `/api/activities/${activityCode}?from=2025-07-15&to=2025-07-22`,
      });
    }

    // Build paxes array
    const paxes = [];
    for (let i = 0; i < parseInt(adults); i++) {
      paxes.push({ age: 30 });
    }

    const childAges = childrenAges ? childrenAges.split(',').map(a => parseInt(a.trim())) : [];
    for (let i = 0; i < parseInt(children); i++) {
      paxes.push({ age: childAges[i] || 10 });
    }

    logger.info(`Fetching activity details: ${activityCode}`);

    const activity = await getActivityDetails(
      activityCode,
      from,
      to,
      paxes,
      language,
      full === 'true'
    );

    res.json({ activity });
  } catch (error) {
    logger.error('Activity details error:', error);

    if (error.message.includes('not found') || error.message.includes('not available')) {
      return res.status(404).json({
        error: 'Activity not found',
        message:
          'The requested activity could not be found or is not available for the specified dates.',
      });
    }

    next(error);
  }
});

// ============================================================================
// GET /api/activities/:activityCode/content
// ============================================================================

/**
 * Get activity content (images, descriptions) without availability check
 * Useful for displaying cached content
 *
 * Query Parameters:
 * - modality: Optional modality code
 * - language: Language code (default: en)
 */
router.get('/:activityCode/content', async (req, res, next) => {
  try {
    const { activityCode } = req.params;
    const { modality, language = 'en' } = req.query;

    if (!activityCode) {
      return res.status(400).json({ error: 'Activity code is required' });
    }

    logger.info(`Fetching activity content: ${activityCode}`);

    const content = await getActivityContent(activityCode, modality, language);

    if (!content) {
      return res.status(404).json({
        error: 'Content not found',
        message: 'Could not find content for this activity.',
      });
    }

    res.json({ content });
  } catch (error) {
    logger.error('Activity content error:', error);
    next(error);
  }
});

// ============================================================================
// POST /api/activities/pickups
// ============================================================================

/**
 * Get pickup points for an excursion
 *
 * Request body:
 * {
 *   pickupRetrievalKey: "abc123...",   // Required - Key from activity details
 *   from: "2025-07-15",                // Required
 *   to: "2025-07-22"                   // Required
 * }
 */
router.post('/pickups', async (req, res, next) => {
  try {
    const { pickupRetrievalKey, from, to } = req.body;

    if (!pickupRetrievalKey) {
      return res.status(400).json({
        error: 'Missing required field: pickupRetrievalKey',
      });
    }

    if (!from || !to) {
      return res.status(400).json({
        error: 'Missing required fields: from and to dates',
      });
    }

    logger.info(`Fetching pickups for key: ${pickupRetrievalKey.substring(0, 10)}...`);

    const pickups = await getExcursionPickups(pickupRetrievalKey, from, to);

    res.json({
      pickups,
      count: pickups.length,
    });
  } catch (error) {
    logger.error('Pickups error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/activities/destinations/countries
// ============================================================================

/**
 * Get list of countries with activities
 *
 * Query Parameters:
 * - language: Language code (default: en)
 */
router.get('/destinations/countries', async (req, res, next) => {
  try {
    const { language = 'en' } = req.query;

    const countries = await fetchCountries(language);

    res.json({
      countries,
      count: countries.length,
    });
  } catch (error) {
    logger.error('Countries fetch error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/activities/destinations/:countryCode
// ============================================================================

/**
 * Get destinations in a country for activities
 *
 * URL Parameters:
 * - countryCode: Two-letter country code (e.g., 'ES', 'IT')
 *
 * Query Parameters:
 * - language: Language code (default: en)
 */
router.get('/destinations/:countryCode', async (req, res, next) => {
  try {
    const { countryCode } = req.params;
    const { language = 'en' } = req.query;

    if (!countryCode) {
      return res.status(400).json({ error: 'Country code is required' });
    }

    const destinations = await fetchDestinations(countryCode.toUpperCase(), language);

    res.json({
      destinations,
      count: destinations.length,
      countryCode: countryCode.toUpperCase(),
    });
  } catch (error) {
    logger.error('Destinations fetch error:', error);
    next(error);
  }
});

export default router;
