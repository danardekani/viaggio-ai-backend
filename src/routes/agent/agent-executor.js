// ============================================================================
// AGENT EXECUTOR - Executes Tools Called by the Agent
// ============================================================================
// This module handles the actual execution of tools when Claude requests them.
// It connects tool calls to real APIs and services.
// ============================================================================

import { searchTours, searchDestinationsAutocomplete } from '../../services/affiliates/viator.js';
import { 
  searchActivities, 
  searchActivitiesByHotel,
  getActivityDetails,
  findDestinationCode 
} from '../../services/affiliates/hotelbeds-activities.js';
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

      case 'search_hotelbeds_activities':
        return await executeSearchHotelbedsActivities(toolInput);

      case 'get_hotelbeds_activity_details':
        return await executeGetHotelbedsActivityDetails(toolInput);

      case 'search_activities_near_hotel':
        return await executeSearchActivitiesNearHotel(toolInput);

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
      resultCount: effectiveResultCount + 1
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

    // Check if there are more results available
    const hasMore = tours.length > effectiveResultCount;
    const returnedTours = tours.slice(0, effectiveResultCount);

    // Check if results are mostly transfers (indicates limited tour inventory)
    const transferCount = returnedTours.filter(t => 
      t.name?.toLowerCase().includes('transfer') || 
      t.name?.toLowerCase().includes('airport')
    ).length;
    const mostlyTransfers = transferCount > returnedTours.length / 2;

    // Format for response
    return {
      success: true,
      destination: searchDestination,
      destinationId: destinationId,
      searchTerms: interests.join(' ') || null,
      tours: returnedTours.map((tour, index) => ({
        position: index + 1,
        productCode: tour.productCode,
        name: tour.name,
        price: tour.price,
        currency: tour.currency || 'USD',
        duration: tour.duration,
        rating: tour.rating,
        reviewCount: tour.reviewCount,
        image: tour.image,
        description: tour.description,
        bookingLink: tour.bookingLink,
        flags: tour.flags || []
      })),
      hasMore,
      totalReturned: returnedTours.length,
      note: mostlyTransfers 
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
  const primaryQuery = queryLower.split(',')[0].trim();
  
  const scored = results.map(r => {
    const name = (r.name || r.destinationName || '').toLowerCase();
    const displayName = (r.displayName || '').toLowerCase();
    let score = 0;
    
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
    
    if (r.type === 'CITY') score += 15;
    else if (r.type === 'REGION') score += 5;
    else if (r.type === 'COUNTRY') score -= 10;
    
    return { ...r, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  
  logger.info(`Destination matching for "${query}": ${scored.slice(0, 3).map(s => `${s.name}(${s.score})`).join(', ')}`);
  
  return scored[0];
}

// ==========================================================================
// SEARCH HOTELBEDS ACTIVITIES (NEW)
// ==========================================================================

async function executeSearchHotelbedsActivities(input) {
  const {
    destination,
    destination_code,
    from,
    to,
    adults = 2,
    children = 0,
    children_ages = [],
    result_count = 5
  } = input;

  const CHAT_ACTIVITY_LIMIT = 10;
  const effectiveResultCount = Math.min(result_count || 5, CHAT_ACTIVITY_LIMIT);

  logger.info(`Searching HotelBeds activities in ${destination}`, { from, to, adults, children });

  try {
    // Resolve destination code
    let destCode = destination_code;
    let destName = destination;

    if (!destCode) {
      const destInfo = findDestinationCode(destination);
      if (destInfo) {
        destCode = destInfo.code;
        destName = destInfo.name;
        logger.info(`Resolved "${destination}" -> ${destName} (${destCode})`);
      }
    }

    if (!destCode) {
      return {
        success: false,
        activities: [],
        message: `I couldn't find "${destination}" in the HotelBeds system. Try a major European city like Barcelona, Rome, Paris, or London.`,
        suggestion: 'Would you like me to search for tours on Viator instead?'
      };
    }

    // Build paxes array (HotelBeds requires age for each person)
    const paxes = [];
    for (let i = 0; i < adults; i++) {
      paxes.push({ age: 30 });
    }
    for (let i = 0; i < children; i++) {
      paxes.push({ age: children_ages[i] || 10 });
    }

    // Search activities
    const activities = await searchActivities({
      destination: destCode,
      from,
      to,
      paxes,
      resultCount: effectiveResultCount + 1,
      language: 'en'
    });

    if (!activities || activities.length === 0) {
      return {
        success: true,
        activities: [],
        hasMore: false,
        message: `No activities found in ${destName} for ${from} to ${to}.`,
        suggestion: 'Try different dates or search on Viator for more options.'
      };
    }

    // Check if there are more results
    const hasMore = activities.length > effectiveResultCount;
    const returnedActivities = activities.slice(0, effectiveResultCount);

    // Separate tickets from excursions for better presentation
    const tickets = returnedActivities.filter(a => a.type === 'TICKET');
    const excursions = returnedActivities.filter(a => a.type === 'EXCURSION');

    return {
      success: true,
      provider: 'hotelbeds',
      destination: destName,
      destinationCode: destCode,
      dateRange: { from, to },
      totalResults: returnedActivities.length,
      hasMore,
      ticketCount: tickets.length,
      excursionCount: excursions.length,
      activities: returnedActivities.map((activity, index) => ({
        position: index + 1,
        code: activity.code,
        name: activity.name,
        type: activity.type,
        typeLabel: activity.type === 'TICKET' ? '🎫 Ticket' : '🚌 Excursion',
        price: activity.price,
        currency: activity.currency,
        priceType: activity.priceType,
        duration: activity.duration,
        description: activity.shortDescription,
        image: activity.image,
        features: activity.features,
        rateKey: activity.rateKey
      }))
    };

  } catch (error) {
    logger.error('HotelBeds activity search failed:', error.message);
    return {
      success: false,
      error: true,
      message: `Unable to search activities: ${error.message}`,
      suggestion: 'Would you like me to search for tours on Viator instead?'
    };
  }
}

// ==========================================================================
// GET HOTELBEDS ACTIVITY DETAILS (NEW)
// ==========================================================================

async function executeGetHotelbedsActivityDetails(input) {
  const {
    activity_code,
    from,
    to,
    adults = 2,
    full_details = false
  } = input;

  logger.info(`Getting HotelBeds activity details: ${activity_code}`);

  try {
    const paxes = [];
    for (let i = 0; i < adults; i++) {
      paxes.push({ age: 30 });
    }

    const activity = await getActivityDetails(
      activity_code,
      from,
      to,
      paxes,
      'en',
      full_details
    );

    if (!activity) {
      return {
        success: false,
        message: `Activity ${activity_code} not found or not available for these dates.`
      };
    }

    return {
      success: true,
      provider: 'hotelbeds',
      activity: {
        code: activity.code,
        name: activity.name,
        type: activity.type,
        typeLabel: activity.type === 'TICKET' ? 'Ticket/Entry' : 'Excursion with Transport',
        description: activity.description,
        price: activity.price,
        currency: activity.currency,
        priceType: activity.priceType,
        duration: activity.duration,
        location: activity.location,
        meetingPoint: activity.meetingPoint,
        highlights: activity.highlights?.slice(0, 5),
        includedServices: activity.includedServices?.slice(0, 8),
        excludedServices: activity.excludedServices?.slice(0, 5),
        importantInfo: activity.importantInfo?.slice(0, 5),
        images: activity.images?.slice(0, 3),
        modalities: activity.modalities?.map(m => ({
          code: m.code,
          name: m.name,
          duration: m.duration,
          prices: m.rates?.slice(0, 3).map(r => ({
            amount: r.amount,
            currency: r.currency,
            rateKey: r.rateKey
          }))
        })),
        features: activity.features
      }
    };

  } catch (error) {
    logger.error('HotelBeds activity details failed:', error.message);
    return {
      success: false,
      error: true,
      message: `Unable to get activity details: ${error.message}`
    };
  }
}

// ==========================================================================
// SEARCH ACTIVITIES NEAR HOTEL (NEW)
// ==========================================================================

async function executeSearchActivitiesNearHotel(input) {
  const {
    hotel_code,
    from,
    to,
    adults = 2,
    result_count = 5
  } = input;

  logger.info(`Searching activities near hotel: ${hotel_code}`);

  try {
    const paxes = [];
    for (let i = 0; i < adults; i++) {
      paxes.push({ age: 30 });
    }

    const activities = await searchActivitiesByHotel({
      hotelCode: hotel_code,
      from,
      to,
      paxes,
      resultCount: Math.min(result_count, 10),
      language: 'en'
    });

    if (!activities || activities.length === 0) {
      return {
        success: true,
        activities: [],
        message: `No activities found near hotel ${hotel_code} for these dates.`,
        suggestion: 'Try searching by destination instead.'
      };
    }

    return {
      success: true,
      provider: 'hotelbeds',
      hotelCode: hotel_code,
      dateRange: { from, to },
      totalResults: activities.length,
      activities: activities.map((activity, index) => ({
        position: index + 1,
        code: activity.code,
        name: activity.name,
        type: activity.type,
        typeLabel: activity.type === 'TICKET' ? '🎫 Ticket' : '🚌 Excursion',
        price: activity.price,
        currency: activity.currency,
        duration: activity.duration,
        description: activity.shortDescription,
        image: activity.image
      }))
    };

  } catch (error) {
    logger.error('Hotel activity search failed:', error.message);
    return {
      success: false,
      error: true,
      message: `Unable to search activities near hotel: ${error.message}`
    };
  }
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
