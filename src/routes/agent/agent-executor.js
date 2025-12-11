// ============================================================================
// AGENT EXECUTOR - Executes Tools Called by the Agent
// ============================================================================
// This module handles the actual execution of tools when Claude requests them.
// It connects tool calls to real APIs and services.
// ============================================================================

import { searchTours, searchDestinationsAutocomplete } from '../../services/affiliates/viator.js';
import { searchHotels } from '../../services/affiliates/hotelbeds.js';
import { identifyLocation } from '../../services/vision.js';

// Simple logger (console-based)
const logger = {
  info: (...args) => console.log('[Agent Executor]', ...args),
  warn: (...args) => console.warn('[Agent Executor]', ...args),
  error: (...args) => console.error('[Agent Executor]', ...args)
};

// ==========================================================================
// TOOL EXECUTOR - Routes tool calls to appropriate handlers
// ==========================================================================

export async function executeTool(toolName, toolInput) {
  logger.info(`Executing tool: ${toolName}`, JSON.stringify(toolInput));

  try {
    switch (toolName) {
      case 'search_tours':
        return await executeSearchTours(toolInput);

      case 'search_flights':
        return await executeSearchFlights(toolInput);

      case 'search_hotels':
        return await executeSearchHotels(toolInput);

      case 'get_destination_info':
        return await executeGetDestinationInfo(toolInput);

      case 'identify_location':
        return await executeIdentifyLocation(toolInput);

      default:
        logger.error(`Unknown tool requested: ${toolName}`);
        return {
          error: true,
          message: `Unknown tool: ${toolName}`
        };
    }
  } catch (error) {
    logger.error(`Tool execution failed: ${toolName}`, error.message);
    return {
      error: true,
      message: `Tool execution failed: ${error.message}`
    };
  }
}

// ==========================================================================
// SEARCH TOURS - Connected to Viator API
// ==========================================================================

async function executeSearchTours(input) {
  const {
    destination,
    interests = [],
    sort_by = 'popular',  // NEW: Added sort_by parameter
    start_date,
    end_date,
    max_price,
    min_rating,
    result_count = 5
  } = input;

  logger.info(`Searching tours in ${destination}`, { interests, sort_by, start_date, end_date });

  try {
    // Step 1: Use Viator's autocomplete to find the best matching destination
    let searchDestination = destination;
    
    try {
      const autocompleteResults = await searchDestinationsAutocomplete(destination, 1);
      if (autocompleteResults && autocompleteResults.length > 0) {
        const bestMatch = autocompleteResults[0];
        searchDestination = bestMatch.name || bestMatch.destinationName || destination;
        logger.info(`Autocomplete matched "${destination}" -> "${searchDestination}" (ID: ${bestMatch.destinationId})`);
      }
    } catch (autoError) {
      logger.warn(`Autocomplete failed, using original destination: ${autoError.message}`);
    }

    // Step 2: Search for tours using the matched destination
    const tours = await searchTours({
      destination: searchDestination,
      searchTerms: interests.join(' '),
      sortBy: sort_by,  // NEW: Pass sort_by to Viator service
      startDate: start_date,
      endDate: end_date,
      maxPrice: max_price,
      minRating: min_rating,
      resultCount: Math.min(result_count, 10)
    });

    if (!tours || tours.length === 0) {
      return {
        success: true,
        tours: [],
        message: `No tours found in ${destination} matching your criteria.`,
        suggestion: 'Try broadening your search or checking different dates.'
      };
    }

    // Tours are already formatted by viator.js - just pass them through
    logger.info(`Found ${tours.length} tours in ${searchDestination} (sorted by: ${sort_by})`);

    return {
      success: true,
      destination: searchDestination,
      tourCount: tours.length,
      tours: tours,
      sortedBy: sort_by
    };

  } catch (error) {
    logger.error('Tour search failed:', error.message);
    return {
      error: true,
      message: `Unable to search tours: ${error.message}`,
      suggestion: 'Please try again or try a different destination.'
    };
  }
}

// ==========================================================================
// SEARCH FLIGHTS - Placeholder for future Amadeus/Duffel integration
// ==========================================================================

async function executeSearchFlights(input) {
  const { origin, destination, departure_date, return_date, passengers = 1 } = input;

  logger.info(`Flight search requested: ${origin} → ${destination}`, { departure_date, return_date });

  // Return a helpful placeholder response
  return {
    success: false,
    available: false,
    message: 'Flight search is coming soon to Viaggio!',
    searchedFor: {
      origin,
      destination,
      departure_date,
      return_date,
      passengers
    },
    suggestion: `For now, I recommend checking Google Flights or Skyscanner for flights from ${origin} to ${destination}. Once you have flight preferences, I can help you find hotels and tours that match your schedule!`,
    workaround: {
      googleFlights: `https://www.google.com/travel/flights?q=flights%20from%20${encodeURIComponent(origin)}%20to%20${encodeURIComponent(destination)}`,
      skyscanner: `https://www.skyscanner.com/transport/flights/${encodeURIComponent(origin)}/${encodeURIComponent(destination)}/`
    }
  };
}

// ==========================================================================
// SEARCH HOTELS - Connected to HotelBeds API
// ==========================================================================

async function executeSearchHotels(input) {
  const { 
    destination, 
    check_in, 
    check_out, 
    guests = 2, 
    rooms = 1, 
    max_price_per_night 
  } = input;

  logger.info(`Hotel search: ${destination}`, { check_in, check_out, guests, rooms });

  try {
    // Call the HotelBeds API
    const hotels = await searchHotels({
      destination,
      checkIn: check_in,
      checkOut: check_out,
      adults: guests,
      children: 0,
      rooms,
      currency: 'USD',
      resultCount: 10
    });

    // Filter by price if specified
    let filteredHotels = hotels;
    if (max_price_per_night) {
      filteredHotels = hotels.filter(h => {
        const pricePerNight = parseFloat(h.pricePerNight);
        return pricePerNight <= max_price_per_night;
      });
    }

    if (!filteredHotels || filteredHotels.length === 0) {
      return {
        success: true,
        hotels: [],
        message: `No hotels found in ${destination} for those dates matching your criteria.`,
        suggestion: 'Try different dates or adjusting your budget.',
        searchedFor: {
          destination,
          check_in,
          check_out,
          guests,
          rooms
        }
      };
    }

    logger.info(`Found ${filteredHotels.length} hotels in ${destination}`);

    return {
      success: true,
      destination,
      hotelCount: filteredHotels.length,
      hotels: filteredHotels,
      searchedFor: {
        destination,
        check_in,
        check_out,
        guests,
        rooms
      }
    };

  } catch (error) {
    logger.error('Hotel search failed:', error.message);
    
    // If it's a destination not found error, be helpful
    if (error.message.includes('Destination not found')) {
      return {
        error: true,
        message: `I couldn't find "${destination}" in our hotel database. Could you try a different city name? For example, try "New York" instead of "NYC".`,
        suggestion: 'Try using the full city name, like "New York", "London", or "Paris".',
        searchedFor: {
          destination,
          check_in,
          check_out
        }
      };
    }

    return {
      error: true,
      message: `Unable to search hotels: ${error.message}`,
      suggestion: 'Please try again or try a different destination.',
      searchedFor: {
        destination,
        check_in,
        check_out
      }
    };
  }
}

// ==========================================================================
// GET DESTINATION INFO - Returns structured prompt for Claude to fill
// ==========================================================================

async function executeGetDestinationInfo(input) {
  const { destination, topics = [] } = input;

  logger.info(`Destination info requested: ${destination}`, { topics });

  // This tool returns a prompt for Claude to answer with its knowledge
  return {
    success: true,
    type: 'knowledge_request',
    destination,
    topics: topics.length > 0 ? topics : ['overview', 'best_time_to_visit', 'neighborhoods', 'local_tips'],
    instruction: `Please provide helpful travel information about ${destination} covering: ${topics.length > 0 ? topics.join(', ') : 'overview, best time to visit, recommended neighborhoods, and local tips'}. Be specific and practical.`
  };
}

// ==========================================================================
// IDENTIFY LOCATION - Connected to Vision service
// ==========================================================================

async function executeIdentifyLocation(input) {
  const { image_base64, media_type = 'image/jpeg' } = input;

  if (!image_base64) {
    return {
      error: true,
      message: 'No image provided'
    };
  }

  logger.info('Identifying location from image...');

  try {
    // Remove data URL prefix if present
    let imageData = image_base64;
    if (imageData.includes('base64,')) {
      imageData = imageData.split('base64,')[1];
    }

    const result = await identifyLocation(imageData, media_type);

    return {
      success: result.success,
      destination: result.destination,
      landmark: result.landmark,
      confidence: result.confidence,
      coordinates: result.coordinates,
      reasoning: result.reasoning,
      travelTips: result.travelTips,
      source: result.source
    };

  } catch (error) {
    logger.error('Location identification failed:', error.message);
    return {
      error: true,
      message: `Unable to identify location: ${error.message}`
    };
  }
}
