// ============================================================================
// AGENT EXECUTOR - Executes Tools Called by the Agent
// ============================================================================
// This module handles the actual execution of tools when Claude requests them.
// It connects tool calls to real APIs and services.
// ============================================================================

import { searchTours, searchDestinationsAutocomplete } from '../../services/affiliates/viator.js';
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
    special_offer = false,
    result_count = 5
  } = input;

  // PERFORMANCE: Enforce 5 tour limit for chat bot responses
  const CHAT_TOUR_LIMIT = 5;
  const effectiveResultCount = Math.min(result_count || CHAT_TOUR_LIMIT, CHAT_TOUR_LIMIT);

  logger.info(`Searching tours in ${destination}`, { interests, sort_by, start_date, end_date, special_offer, effectiveResultCount });

  try {
    // Step 1: Use Viator's autocomplete to find the best matching destination
    let searchDestination = destination;
    let destinationId = null;

    try {
      const autocompleteResults = await searchDestinationsAutocomplete(destination, 5);
      if (autocompleteResults && autocompleteResults.length > 0) {
        const bestMatch = findBestDestinationMatch(destination, autocompleteResults);
        searchDestination = bestMatch.name || bestMatch.destinationName || destination;
        destinationId = bestMatch.destinationId;
        logger.info(`Autocomplete matched "${destination}" -> "${searchDestination}" (ID: ${destinationId}, type: ${bestMatch.type})`);
      }
    } catch (autoError) {
      logger.warn(`Autocomplete failed, using original destination: ${autoError.message}`);
    }

    // Build flags array
    const flags = [];
    if (special_offer) {
      flags.push('SPECIAL_OFFER');
      logger.info(`Including SPECIAL_OFFER flag for deals search`);
    }

    // Step 2: Search for tours - request a few extra to check if there are more
    const tours = await searchTours({
      destination: searchDestination,
      destinationId: destinationId,
      searchTerms: interests.join(' '),
      sortBy: sort_by,
      startDate: start_date,
      endDate: end_date,
      maxPrice: max_price,
      minRating: min_rating,
      flags: flags.length > 0 ? flags : undefined,
      resultCount: effectiveResultCount + 1  // Request 1 extra to check hasMore
    });

    if (!tours || tours.length === 0) {
      return {
        success: true,
        tours: [],
        hasMore: false,
        message: `No tours found in ${destination} matching your criteria.`,
        suggestion: 'Try broadening your search or checking different dates.'
      };
    }

    // Check if there are more results beyond what we're returning
    const hasMore = tours.length > effectiveResultCount;
    const toursToReturn = tours.slice(0, effectiveResultCount);

    // Check if results are mostly transfers (not actual tours)
    const transferKeywords = ['transfer', 'chauffeur', 'airport', 'taxi', 'transportation', 'pickup', 'drop-off'];
    const actualTours = toursToReturn.filter(t => {
      const name = (t.name || '').toLowerCase();
      return !transferKeywords.some(kw => name.includes(kw));
    });

    const onlyTransfers = actualTours.length === 0 && toursToReturn.length > 0;
    const mostlyTransfers = actualTours.length < toursToReturn.length / 2 && actualTours.length < 3;

    logger.info(`Found ${tours.length} tours in ${searchDestination}, returning ${toursToReturn.length} (hasMore: ${hasMore})`);

    // Format for response
    return {
      success: true,
      destination: searchDestination,
      destinationId: destinationId,  // For "See more" navigation
      tourCount: toursToReturn.length,
      actualTourCount: actualTours.length,
      tours: toursToReturn,
      hasMore: hasMore,  // Frontend uses this for "See more" button
      sortedBy: sort_by,
      searchTerms: interests.join(' '),  // For "See more" navigation
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
    } else if (name.startsWith(primaryQuery)) {
      score = 80;
    } else if (primaryQuery.startsWith(name)) {
      score = 70;
    } else if (name.includes(primaryQuery)) {
      score = 50;
    } else if (displayName.includes(queryLower)) {
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
// SEARCH FLIGHTS - MVP DISABLED
// ==========================================================================

async function executeSearchFlights(input) {
  const { origin, destination } = input;

  logger.info(`Flight search requested but MVP disabled: ${origin} → ${destination}`);

  return {
    success: false,
    available: false,
    message: 'I specialize in tours and experiences! Flight booking is coming soon. For now, I can help you find amazing tours and activities at your destination.',
    suggestion: `Would you like me to search for tours in ${destination} instead?`
  };
}

// ==========================================================================
// SEARCH HOTELS - MVP DISABLED
// ==========================================================================

async function executeSearchHotels(input) {
  const { destination } = input;

  logger.info(`Hotel search requested but MVP disabled: ${destination}`);

  return {
    success: false,
    available: false,
    message: 'I specialize in tours and experiences! Hotel booking is coming soon. For now, I can help you find amazing tours and activities at your destination.',
    suggestion: `Would you like me to search for tours in ${destination} instead?`
  };
}

// ==========================================================================
// GET DESTINATION INFO - Returns structured prompt for Claude to fill
// ==========================================================================

async function executeGetDestinationInfo(input) {
  const { destination, topics = [] } = input;

  logger.info(`Destination info requested: ${destination}`, { topics });

  return {
    success: true,
    type: 'knowledge_request',
    destination,
    topics: topics.length > 0 ? topics : ['overview', 'best_time_to_visit', 'neighborhoods', 'local_tips'],
    instruction: `Please provide helpful travel information about ${destination} covering: ${topics.length > 0 ? topics.join(', ') : 'overview, best time to visit, recommended neighborhoods, and local tips'}. Keep it concise and helpful.`
  };
}

// ==========================================================================
// IDENTIFY LOCATION - Uses Vision AI
// ==========================================================================

async function executeIdentifyLocation(input) {
  const { image_url, image_data } = input;

  logger.info('Location identification requested');

  if (!image_url && !image_data) {
    return {
      success: false,
      message: 'No image provided. Please provide an image URL or base64 data.'
    };
  }

  try {
    const result = await identifyLocation(image_url || image_data);

    return {
      success: true,
      location: result.location,
      confidence: result.confidence,
      description: result.description,
      suggestion: result.location
        ? `Would you like me to find tours in ${result.location}?`
        : 'I couldn\'t identify this location. Could you tell me more about where this is?'
    };
  } catch (error) {
    logger.error('Location identification failed:', error.message);
    return {
      success: false,
      error: true,
      message: `Unable to identify location: ${error.message}`
    };
  }
}
