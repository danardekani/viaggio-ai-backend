// ============================================================================
// TOUR AGGREGATOR SERVICE
// ============================================================================
// Aggregates tour/activity results from multiple providers:
// - Viator (primary)
// - HotelBeds Activities
// ============================================================================

import { searchTours as searchViatorTours, getTourDetails as getViatorTourDetails } from './viator.js';
import { searchActivities as searchHotelBedsActivities, getActivityDetails as getHotelBedsActivityDetails } from './hotelbeds-activities.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Provider configuration
const PROVIDERS = {
  viator: {
    name: 'Viator',
    enabled: true,
    priority: 1  // Lower = higher priority in results
  },
  hotelbeds: {
    name: 'HotelBeds',
    enabled: true,
    priority: 2
  }
};

// ============================================================================
// AGGREGATED TOUR SEARCH
// ============================================================================

/**
 * Search for tours across all enabled providers
 *
 * @param {Object} options Search options
 * @param {string} options.destination Destination name
 * @param {string} options.searchTerms Optional search terms
 * @param {number} options.resultCount Max results per provider
 * @param {string} options.sortBy Sort order
 * @param {string} options.startDate Start date (YYYY-MM-DD)
 * @param {string} options.endDate End date (YYYY-MM-DD)
 * @param {string[]} options.providers Array of providers to search (default: all enabled)
 * @param {number} options.minPrice Minimum price filter
 * @param {number} options.maxPrice Maximum price filter
 * @param {number} options.minRating Minimum rating filter
 * @returns {Promise<Object>} Aggregated search results
 */
export async function searchToursAggregated({
  destination,
  destinationId,
  searchTerms = '',
  resultCount = 50,
  sortBy = 'popular',
  startDate,
  endDate,
  providers = ['viator', 'hotelbeds'],
  flags = [],
  minPrice,
  maxPrice,
  minDuration,
  maxDuration,
  minRating
}) {
  const startTime = Date.now();
  const enabledProviders = providers.filter(p => PROVIDERS[p]?.enabled);

  logger.info(`[Aggregator] Searching ${enabledProviders.join(', ')} for: ${destination}`);

  // Build search promises for each provider
  const searchPromises = [];

  if (enabledProviders.includes('viator')) {
    searchPromises.push(
      searchViatorTours({
        destination,
        destinationId,
        searchTerms,
        resultCount,
        sortBy,
        startDate,
        endDate,
        flags,
        minPrice,
        maxPrice,
        minDuration,
        maxDuration,
        minRating
      }).then(result => ({
        provider: 'viator',
        ...result
      })).catch(error => {
        logger.error('[Aggregator] Viator search failed:', error.message);
        return { provider: 'viator', tours: [], totalCount: 0, error: error.message };
      })
    );
  }

  if (enabledProviders.includes('hotelbeds')) {
    searchPromises.push(
      searchHotelBedsActivities({
        destination,
        startDate,
        endDate,
        resultCount,
        sortBy,
        minPrice,
        maxPrice
      }).then(result => ({
        provider: 'hotelbeds',
        tours: result.activities || [],
        totalCount: result.totalCount || 0,
        hasMore: result.hasMore || false
      })).catch(error => {
        logger.error('[Aggregator] HotelBeds search failed:', error.message);
        return { provider: 'hotelbeds', tours: [], totalCount: 0, error: error.message };
      })
    );
  }

  // Execute searches in parallel
  const results = await Promise.all(searchPromises);

  // Aggregate results
  const allTours = [];
  const providerStats = {};
  let totalCount = 0;
  let hasMore = false;

  for (const result of results) {
    const tours = result.tours || [];
    allTours.push(...tours);
    totalCount += result.totalCount || tours.length;
    hasMore = hasMore || result.hasMore || false;

    providerStats[result.provider] = {
      count: tours.length,
      totalCount: result.totalCount || tours.length,
      hasMore: result.hasMore || false,
      error: result.error || null
    };
  }

  // Sort aggregated results
  const sortedTours = sortAggregatedTours(allTours, sortBy);

  // Apply result limit
  const limitedTours = sortedTours.slice(0, resultCount);

  const elapsed = Date.now() - startTime;
  logger.info(`[Aggregator] Found ${limitedTours.length} tours from ${enabledProviders.length} providers in ${elapsed}ms`);

  return {
    tours: limitedTours,
    totalCount,
    hasMore: hasMore || sortedTours.length > resultCount,
    count: limitedTours.length,
    providers: providerStats,
    searchParams: {
      destination,
      searchTerms,
      resultCount,
      sortBy,
      startDate,
      endDate,
      providers: enabledProviders
    },
    aggregated: true,
    elapsed
  };
}

// ============================================================================
// SORTING
// ============================================================================

/**
 * Sort aggregated tours based on sort preference
 */
function sortAggregatedTours(tours, sortBy) {
  const sorted = [...tours];

  switch (sortBy) {
    case 'price_low':
      sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
      break;

    case 'price_high':
      sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
      break;

    case 'rating':
      sorted.sort((a, b) => {
        const ratingDiff = (b.rating || 0) - (a.rating || 0);
        if (ratingDiff !== 0) return ratingDiff;
        // Secondary sort by review count
        return (b.reviewCount || 0) - (a.reviewCount || 0);
      });
      break;

    case 'reviews':
      sorted.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
      break;

    case 'duration_short':
      sorted.sort((a, b) => (a.durationMinutes || Infinity) - (b.durationMinutes || Infinity));
      break;

    case 'duration_long':
      sorted.sort((a, b) => (b.durationMinutes || 0) - (a.durationMinutes || 0));
      break;

    case 'popular':
    default:
      // For popular, interleave results from providers by priority
      // Viator first (priority 1), then HotelBeds (priority 2)
      sorted.sort((a, b) => {
        const providerA = PROVIDERS[a.provider]?.priority || 99;
        const providerB = PROVIDERS[b.provider]?.priority || 99;
        if (providerA !== providerB) return providerA - providerB;
        // Within same provider, maintain original order (popularity from API)
        return 0;
      });
      break;
  }

  return sorted;
}

// ============================================================================
// GET TOUR DETAILS
// ============================================================================

/**
 * Get tour details from the appropriate provider
 *
 * @param {string} tourId Tour ID (prefixed with provider: hb_ for hotelbeds)
 * @param {string} startDate Optional start date
 * @param {string} endDate Optional end date
 * @returns {Promise<Object>} Tour details
 */
export async function getTourDetailsAggregated(tourId, startDate, endDate) {
  // Determine provider from ID prefix
  if (tourId.startsWith('hb_')) {
    // HotelBeds activity
    const activityCode = tourId.replace('hb_', '');
    return getHotelBedsActivityDetails(activityCode, startDate, endDate);
  }

  // Default to Viator
  return getViatorTourDetails(tourId);
}

// ============================================================================
// PROVIDER MANAGEMENT
// ============================================================================

/**
 * Get list of available providers
 */
export function getProviders() {
  return Object.entries(PROVIDERS).map(([id, config]) => ({
    id,
    name: config.name,
    enabled: config.enabled
  }));
}

/**
 * Enable or disable a provider
 */
export function setProviderEnabled(providerId, enabled) {
  if (PROVIDERS[providerId]) {
    PROVIDERS[providerId].enabled = enabled;
    logger.info(`[Aggregator] Provider ${providerId} ${enabled ? 'enabled' : 'disabled'}`);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  searchToursAggregated,
  getTourDetailsAggregated,
  getProviders,
  setProviderEnabled
};
