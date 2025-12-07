// ============================================================================
// AGENT EXECUTOR - Executes Tools Called by the Agent
// ============================================================================
// This module handles the actual execution of tools when Claude requests them.
// It connects tool calls to real APIs and services.
// ============================================================================

import { searchTours } from '../../services/affiliates/viator.js';
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
    start_date,
    end_date,
    max_price,
    min_rating,
    result_count = 5
  } = input;

  logger.info(`Searching tours in ${destination}`, { interests, start_date, end_date });

  try {
    const tours = await searchTours({
      destination,
      searchTerms: interests.join(' '),
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
    // viator.js returns: id, name, image, duration, rating, reviewCount, price, bookingLink, etc.
    logger.info(`Found ${tours.length} tours in ${destination}`);

    return {
      success: true,
      destination,
      tourCount: tours.length,
      tours: tours  // Pass through as-is
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
// SEARCH HOTELS - Placeholder for future Booking.com integration
// ==========================================================================

async function executeSearchHotels(input) {
  const { destination, check_in, check_out, guests = 2, rooms = 1, max_price_per_night } = input;

  logger.info(`Hotel search requested: ${destination}`, { check_in, check_out, guests });

  // Return a helpful placeholder response
  return {
    success: false,
    available: false,
    message: 'Hotel search is coming soon to Viaggio!',
    searchedFor: {
      destination,
      check_in,
      check_out,
      guests,
      rooms,
      max_price_per_night
    },
    suggestion: `For now, I recommend checking Booking.com or Hotels.com for accommodations in ${destination}. I can still help you find amazing tours and experiences for your trip!`,
    workaround: {
      booking: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(destination)}`,
      hotels: `https://www.hotels.com/search.do?q-destination=${encodeURIComponent(destination)}`
    }
  };
}

// ==========================================================================
// GET DESTINATION INFO - Returns structured prompt for Claude to fill
// ==========================================================================

async function executeGetDestinationInfo(input) {
  const { destination, topics = [] } = input;

  logger.info(`Destination info requested: ${destination}`, { topics });

  // This tool returns a prompt for Claude to answer with its knowledge
  // Rather than calling an external API, we let Claude use its training data
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

// ==========================================================================
// EXPORTS
// ==========================================================================

export default { executeTool };
