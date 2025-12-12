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
    sort_by = 'popular',
    start_date,
    end_date,
    max_price,
    min_rating,
    result_count = 5
  } = input;

  logger.info(`Searching tours in ${destination}`, { interests, sort_by, start_date, end_date });

  try {
    // Step 1: Use Viator's autocomplete to find the best matching destination
    // Get multiple results so we can pick the most specific match
    let searchDestination = destination;
    let destinationId = null;
    
    try {
      const autocompleteResults = await searchDestinationsAutocomplete(destination, 5);
      if (autocompleteResults && autocompleteResults.length > 0) {
        // Find the best match - prefer exact/closest matches and cities over countries
        const bestMatch = findBestDestinationMatch(destination, autocompleteResults);
        searchDestination = bestMatch.name || bestMatch.destinationName || destination;
        destinationId = bestMatch.destinationId;
        logger.info(`Autocomplete matched "${destination}" -> "${searchDestination}" (ID: ${destinationId}, type: ${bestMatch.type})`);
      }
    } catch (autoError) {
      logger.warn(`Autocomplete failed, using original destination: ${autoError.message}`);
    }

    // Step 2: Search for tours using the matched destination
    const tours = await searchTours({
      destination: searchDestination,
      destinationId: destinationId,  // Pass the ID if we have it
      searchTerms: interests.join(' '),
      sortBy: sort_by,
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

    // Check if results are mostly transfers (not actual tours)
    const transferKeywords = ['transfer', 'chauffeur', 'airport', 'taxi', 'transportation', 'pickup', 'drop-off'];
    const actualTours = tours.filter(t => {
      const name = (t.name || '').toLowerCase();
      return !transferKeywords.some(kw => name.includes(kw));
    });
    
    const onlyTransfers = actualTours.length === 0 && tours.length > 0;
    const mostlyTransfers = actualTours.length < tours.length / 2 && actualTours.length < 3;

    logger.info(`Found ${tours.length} tours in ${searchDestination} (${actualTours.length} actual tours, sorted by: ${sort_by})`);

    return {
      success: true,
      destination: searchDestination,
      tourCount: tours.length,
      actualTourCount: actualTours.length,
      tours: tours,
      sortedBy: sort_by,
      onlyTransfers: onlyTransfers,
      mostlyTransfers: mostlyTransfers,
      suggestion: onlyTransfers 
        ? `${destination} mainly has private transfers. Consider searching for a nearby larger city for more tour options.`
        : mostlyTransfers
        ? `Limited tours available in ${destination}. You might find more options in a nearby larger city.`
        : null
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
// HELPER: Find best destination match from autocomplete results
// ==========================================================================

function findBestDestinationMatch(query, results) {
  if (!results || results.length === 0) return null;
  if (results.length === 1) return results[0];
  
  const queryLower = query.toLowerCase().trim();
  
  // Extract the primary destination name (before any comma)
  // e.g., "Santorini, Greece" -> "santorini"
  const primaryQuery = queryLower.split(',')[0].trim();
  
  // Score each result
  const scored = results.map(r => {
    const name = (r.name || r.destinationName || '').toLowerCase();
    const displayName = (r.displayName || '').toLowerCase();
    let score = 0;
    
    // Exact match on primary name - highest priority
    if (name === primaryQuery) {
      score = 100;
    }
    // Name starts with primary query
    else if (name.startsWith(primaryQuery)) {
      score = 80;
    }
    // Primary query starts with name (e.g., query "new york city" matches "new york")
    else if (primaryQuery.startsWith(name)) {
      score = 70;
    }
    // Name contains primary query
    else if (name.includes(primaryQuery)) {
      score = 50;
    }
    // Display name contains the full query (e.g., "Santorini, Greece")
    else if (displayName.includes(queryLower)) {
      score = 40;
    }
    
    // Boost cities over regions/countries - we want specific results
    if (r.type === 'CITY') score += 15;
    else if (r.type === 'REGION') score += 5;
    else if (r.type === 'COUNTRY') score -= 10;  // Penalize countries
    
    return { ...r, score };
  });
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  logger.info(`Destination matching for "${query}": ${scored.slice(0, 3).map(s => `${s.name}(${s.score})`).join(', ')}`);
  
  return scored[0];
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
