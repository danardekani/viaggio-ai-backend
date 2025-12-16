// ============================================================================
// HOTEL ROUTES - PRODUCTION READY
// ============================================================================

import express from 'express';
import { 
  searchHotels, 
  getHotelDetails, 
  getDestinations,
  searchDestinationsAutocomplete 
} from '../services/affiliates/hotelbeds.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// GET /api/hotels/destinations/autocomplete
// ============================================================================

/**
 * Autocomplete for destination search
 * 
 * Query params:
 * - q: Search term (min 2 characters)
 * - limit: Number of results (default: 8, max: 20)
 */
router.get('/destinations/autocomplete', async (req, res, next) => {
  try {
    const { q, limit = 8 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await searchDestinationsAutocomplete(
      q, 
      Math.min(parseInt(limit) || 8, 20)
    );

    res.json({ 
      suggestions,
      query: q
    });

  } catch (error) {
    logger.error('Hotel destination autocomplete error:', error);
    res.status(500).json({ 
      suggestions: [], 
      error: 'Autocomplete search failed' 
    });
  }
});

// ============================================================================
// POST /api/hotels/search
// ============================================================================

/**
 * Search for hotels in a destination
 * 
 * Request body:
 * {
 *   destination: "New York",         // Required - City name
 *   destinationCode: "NYC",          // Optional - If provided, skips destination lookup
 *   checkIn: "2025-07-15",          // Required - YYYY-MM-DD
 *   checkOut: "2025-07-22",         // Required - YYYY-MM-DD
 *   adults: 2,                      // Optional - Number of adults (default: 2)
 *   children: 0,                    // Optional - Number of children (default: 0)
 *   rooms: 1,                       // Optional - Number of rooms (default: 1)
 *   currency: "USD",                // Optional - Currency code (default: USD)
 *   resultCount: 20                 // Optional - Number of results (default: 20, max: 50)
 * }
 */
router.post('/search', async (req, res, next) => {
  try {
    let { 
      destination, 
      destinationCode,  // Accept destination code from autocomplete
      checkIn,
      checkOut,
      adults = 2,
      children = 0,
      rooms = 1,
      currency = 'USD',
      resultCount = 20
    } = req.body;

    // Fix: Handle string "null" or "undefined" from frontend
    if (destinationCode === 'null' || destinationCode === 'undefined' || destinationCode === '') {
      destinationCode = null;
    }

    // Validate required fields
    if (!destination && !destinationCode) {
      return res.status(400).json({ 
        error: 'Missing required field: destination or destinationCode'
      });
    }

    // Generate default dates if not provided (2 weeks from now, 3 nights)
    let finalCheckIn = checkIn;
    let finalCheckOut = checkOut;
    
    if (!checkIn || !checkOut) {
      const today = new Date();
      const defaultCheckIn = new Date(today);
      defaultCheckIn.setDate(today.getDate() + 14); // 2 weeks from now
      
      const defaultCheckOut = new Date(defaultCheckIn);
      defaultCheckOut.setDate(defaultCheckIn.getDate() + 3); // 3 nights
      
      finalCheckIn = finalCheckIn || defaultCheckIn.toISOString().split('T')[0];
      finalCheckOut = finalCheckOut || defaultCheckOut.toISOString().split('T')[0];
      
      logger.info(`Using default dates: ${finalCheckIn} to ${finalCheckOut}`);
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(finalCheckIn) || !dateRegex.test(finalCheckOut)) {
      return res.status(400).json({ 
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }

    // Validate dates are in the future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkInDate = new Date(finalCheckIn);
    const checkOutDate = new Date(finalCheckOut);

    if (checkInDate < today) {
      return res.status(400).json({ 
        error: 'Check-in date must be today or in the future'
      });
    }

    if (checkOutDate <= checkInDate) {
      return res.status(400).json({ 
        error: 'Check-out date must be after check-in date'
      });
    }

    logger.info(`Hotel search: dest="${destination}", code="${destinationCode}", ${finalCheckIn} to ${finalCheckOut}, ${adults} adults, ${rooms} rooms`);

    const hotels = await searchHotels({
      destination,
      destinationCode,  // Pass the destination code
      checkIn: finalCheckIn,
      checkOut: finalCheckOut,
      adults: parseInt(adults),
      children: parseInt(children),
      rooms: parseInt(rooms),
      currency,
      resultCount: Math.min(parseInt(resultCount) || 20, 50)
    });

    logger.info(`Returning ${hotels.length} hotels`);

    res.json({ 
      hotels,
      searchParams: { 
        destination, 
        destinationCode,
        checkIn: finalCheckIn,
        checkOut: finalCheckOut,
        adults: parseInt(adults),
        children: parseInt(children),
        rooms: parseInt(rooms),
        currency,
        resultCount
      },
      count: hotels.length
    });

  } catch (error) {
    logger.error('Hotel search error:', error);
    
    // Send user-friendly error messages
    if (error.message.includes('Destination not found')) {
      return res.status(404).json({ 
        error: 'Destination not available',
        message: `Hotels in "${destination}" are not available in the current system. The HotelBeds sandbox environment has limited destinations (primarily European cities like Barcelona, Madrid, Lisbon, Porto). Try searching for a European destination like "Barcelona" or "Lisbon".`
      });
    }

    if (error.message.includes('401') || error.message.includes('403')) {
      return res.status(500).json({ 
        error: 'API authentication error',
        message: 'There was an issue with the hotel search service. Please try again later.'
      });
    }
    
    next(error);
  }
});

// ============================================================================
// GET /api/hotels/:hotelCode
// ============================================================================

/**
 * Get detailed information about a specific hotel
 * 
 * URL Parameters:
 * - hotelCode: The HotelBeds hotel code
 * 
 * Query Parameters:
 * - checkIn: Check-in date (YYYY-MM-DD) - Required
 * - checkOut: Check-out date (YYYY-MM-DD) - Required
 * - adults: Number of adults (default: 2)
 */
router.get('/:hotelCode', async (req, res, next) => {
  try {
    const { hotelCode } = req.params;
    const { checkIn, checkOut, adults = 2 } = req.query;

    if (!hotelCode) {
      return res.status(400).json({ error: 'Hotel code is required' });
    }

    if (!checkIn || !checkOut) {
      return res.status(400).json({ 
        error: 'Check-in and check-out dates are required as query parameters',
        example: `/api/hotels/${hotelCode}?checkIn=2025-12-20&checkOut=2025-12-27`
      });
    }

    logger.info(`Fetching hotel details: ${hotelCode}, ${checkIn} to ${checkOut}`);

    const hotel = await getHotelDetails(hotelCode, checkIn, checkOut, parseInt(adults));
    
    res.json({ hotel });

  } catch (error) {
    logger.error('Hotel details error:', error);
    
    if (error.message.includes('Hotel not found')) {
      return res.status(404).json({ 
        error: 'Hotel not found',
        message: 'The requested hotel could not be found or is not available for the specified dates.'
      });
    }
    
    next(error);
  }
});

// ============================================================================
// GET /api/hotels/destinations/list
// ============================================================================

/**
 * Get list of all available destinations
 * Useful for populating dropdown menus or showing popular destinations
 */
router.get('/destinations/list', async (req, res, next) => {
  try {
    const destinations = await getDestinations();
    
    res.json({ 
      destinations,
      count: destinations.length
    });

  } catch (error) {
    logger.error('Get destinations error:', error);
    next(error);
  }
});

export default router;
