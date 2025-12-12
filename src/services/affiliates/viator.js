// ============================================================================
// VIATOR AFFILIATE API SERVICE
// ============================================================================

import { logger } from '../../utils/logger.js';

const VIATOR_API_BASE = 'https://api.sandbox.viator.com/partner';
const API_KEY = process.env.VIATOR_API_KEY;
const AFFILIATE_ID = process.env.VIATOR_AFFILIATE_ID;

// ============================================================================
// TAG MAPPING - Maps search terms to Viator tag IDs
// See: https://partnerresources.viator.com/travel-commerce/tags/
// ============================================================================

const TAG_MAPPING = {
  // Food & Drink
  'food': 21911,
  'food tour': 12053,
  'food tours': 12053,
  'culinary': 12053,
  'dining': 11890,
  'restaurant': 11890,
  'eating': 12053,
  'tasting': 12053,
  'wine': 11933,
  'beer': 11934,
  'brewery': 11934,
  'cooking': 11879,
  'cooking class': 11879,
  
  // Tours & Sightseeing
  'walking': 11938,
  'walking tour': 11938,
  'bus tour': 11930,
  'hop on hop off': 11931,
  'city tour': 11929,
  'sightseeing': 21913,
  'guided tour': 11929,
  
  // History & Culture
  'history': 21914,
  'historical': 21914,
  'museum': 11877,
  'art': 11876,
  'culture': 21914,
  'heritage': 21914,
  
  // Outdoor & Adventure
  'adventure': 21909,
  'outdoor': 21909,
  'hiking': 11897,
  'biking': 11898,
  'bike': 11898,
  'kayak': 11899,
  'water': 21442,
  'boat': 21701,
  'sailing': 21701,
  'cruise': 21701,
  
  // Entertainment
  'nightlife': 11963,
  'show': 11941,
  'concert': 11941,
  'theater': 11941,
  'entertainment': 11941,
  
  // Family
  'family': 21917,
  'kids': 21917,
  'children': 21917,
  
  // Quality tags
  'top': 367652,
  'best': 21972,
  'popular': 22083,
  'unique': 21074
};

// Cache for destinations
let destinationsCache = null;
let destinationsCacheTime = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Clear cache function (for debugging)
export function clearDestinationCache() {
  destinationsCache = null;
  destinationsCacheTime = null;
  logger.info('Destination cache cleared');
}

// ============================================================================
// GET TAGS FROM SEARCH TERMS
// ============================================================================

function getTagsFromSearchTerms(searchTerms) {
  if (!searchTerms) return [];
  
  const terms = searchTerms.toLowerCase().trim();
  const tags = [];
  
  // Check for exact matches first (longer phrases)
  for (const [term, tagId] of Object.entries(TAG_MAPPING)) {
    if (terms.includes(term)) {
      if (!tags.includes(tagId)) {
        tags.push(tagId);
      }
    }
  }
  
  // Also check individual words
  const words = terms.split(/\s+/);
  for (const word of words) {
    if (TAG_MAPPING[word] && !tags.includes(TAG_MAPPING[word])) {
      tags.push(TAG_MAPPING[word]);
    }
  }
  
  logger.info(`Mapped search terms "${searchTerms}" to tags: [${tags.join(', ')}]`);
  return tags;
}

// ============================================================================
// FETCH DESTINATIONS
// ============================================================================

async function fetchDestinations() {
  if (destinationsCache && destinationsCacheTime && 
      (Date.now() - destinationsCacheTime) < CACHE_DURATION) {
    logger.info(`Using cached destinations (${destinationsCache.length} destinations, cached ${Math.round((Date.now() - destinationsCacheTime) / 60000)} min ago)`);
    return destinationsCache;
  }

  logger.info('Fetching fresh destinations from Viator...');

  const response = await fetch(`${VIATOR_API_BASE}/destinations`, {
    method: 'GET',
    headers: {
      'exp-api-key': API_KEY,
      'Accept': 'application/json;version=2.0',
      'Accept-Language': 'en-US'
    }
  });

  if (!response.ok) {
    throw new Error(`Viator API error: ${response.status}`);
  }

  const data = await response.json();
  destinationsCache = data.destinations || [];
  destinationsCacheTime = Date.now();

  logger.info(`Cached ${destinationsCache.length} destinations`);
  return destinationsCache;
}

// ============================================================================
// REGIONAL FALLBACKS - Map smaller areas to larger Viator destinations
// ============================================================================

const REGIONAL_FALLBACKS = {
  'napa': 'Napa & Sonoma',
  'napa valley': 'Napa & Sonoma',
  'sonoma': 'Napa & Sonoma',
  'wine country': 'Napa & Sonoma',
  'portland, me': 'Portland',
  'portland, maine': 'Portland',
  'portland maine': 'Portland'
};

// State abbreviations
const STATE_ABBREVS = {
  'me': 'Maine',
  'or': 'Oregon',
  'wa': 'Washington',
  'ca': 'California',
  'ny': 'New York',
  'ma': 'Massachusetts',
  'fl': 'Florida',
  'tx': 'Texas'
};

// ============================================================================
// FIND DESTINATION
// ============================================================================

export async function findDestination(query, stateContext = null) {
  try {
    const destinations = await fetchDestinations();
    const normalizedQuery = query.toLowerCase().trim();
    
    logger.info(`Looking up destination: "${query}" -> cleaned: "${query}" -> normalized: "${normalizedQuery}"${stateContext ? ` (state context: parentId=${stateContext.parentId})` : ''}`);

    // Try to find the destination with state context if available
    let match = findDestinationMatch(destinations, normalizedQuery, stateContext);
    
    // If no match, try regional fallback
    if (!match && REGIONAL_FALLBACKS[normalizedQuery]) {
      const fallbackName = REGIONAL_FALLBACKS[normalizedQuery];
      logger.info(`No match for "${normalizedQuery}", trying regional fallback: "${fallbackName}"`);
      match = findDestinationMatch(destinations, fallbackName.toLowerCase(), null);
    }
    
    // Also try the original query with state in the fallbacks
    if (!match) {
      const originalNormalized = query.toLowerCase().trim();
      if (REGIONAL_FALLBACKS[originalNormalized]) {
        const fallbackName = REGIONAL_FALLBACKS[originalNormalized];
        logger.info(`Trying original query fallback: "${originalNormalized}" -> "${fallbackName}"`);
        match = findDestinationMatch(destinations, fallbackName.toLowerCase(), null);
      }
    }
    
    // If still no match and we have state context, try the state/region itself
    if (!match && stateContext) {
      const stateName = stateContext.stateName || STATE_ABBREVS[stateContext.stateAbbrev];
      if (stateName) {
        logger.info(`Trying state fallback: "${stateName}"`);
        match = findDestinationMatch(destinations, stateName.toLowerCase(), null);
      }
    }

    if (match) {
      const id = match.destinationId || match.id;
      const name = match.destinationName || match.name;
      logger.info(`Found destination: "${name}" (ID: ${id}) for query "${query}"`);
      return {
        id: id.toString(),
        name: name
      };
    }

    logger.warn(`No destination found for: "${query}"`);
    return null;
  } catch (error) {
    logger.error('Destination lookup error:', error.message);
    return null;
  }
}

// Helper function to find destination match
function findDestinationMatch(destinations, query, stateContext = null) {
  // Try exact match first
  let matches = destinations.filter(dest => {
    const name = (dest.destinationName || dest.name || '').toLowerCase();
    return name === query;
  });

  // Try includes match (destination name contains the query)
  if (matches.length === 0) {
    matches = destinations.filter(dest => {
      const name = (dest.destinationName || dest.name || '').toLowerCase();
      return name.includes(query);
    });
  }
  
  // Try query contains destination name
  if (matches.length === 0) {
    matches = destinations.filter(dest => {
      const name = (dest.destinationName || dest.name || '').toLowerCase();
      return query.includes(name) && name.length > 3;
    });
  }
  
  if (matches.length === 0) {
    return null;
  }
  
  if (matches.length === 1) {
    return matches[0];
  }
  
  // Multiple matches - try to disambiguate
  logger.info(`Found ${matches.length} matches for "${query}": ${matches.map(m => `${m.name} (parent: ${m.parentDestinationId})`).join(', ')}`);
  
  // If we have state context, prefer match with correct parent
  if (stateContext && stateContext.parentId) {
    const stateMatch = matches.find(m => m.parentDestinationId === stateContext.parentId);
    if (stateMatch) {
      logger.info(`Disambiguated to "${stateMatch.name}" based on state context (parent: ${stateContext.parentId})`);
      return stateMatch;
    }
  }
  
  // Default to first match
  return matches[0];
}

// ============================================================================
// MAP SORT OPTIONS
// ============================================================================

function getViatorSort(sortBy) {
  const sortMap = {
    'popular': { sort: 'DEFAULT' },
    'rating': { sort: 'TRAVELER_RATING', order: 'DESCENDING' },
    'reviews': { sort: 'DEFAULT' }, // Will sort by reviewCount client-side
    'price_low': { sort: 'PRICE', order: 'ASCENDING' },
    'price_high': { sort: 'PRICE', order: 'DESCENDING' },
    'newest': { sort: 'DATE_ADDED', order: 'DESCENDING' },
    'duration_short': { sort: 'ITINERARY_DURATION', order: 'ASCENDING' },
    'duration_long': { sort: 'ITINERARY_DURATION', order: 'DESCENDING' }
  };
  return sortMap[sortBy] || { sort: 'DEFAULT' };
}

// ============================================================================
// APPLY FILTERS HELPER
// ============================================================================

function applyFilters(filtering, options) {
  const { startDate, endDate, flags, minPrice, maxPrice, minDuration, maxDuration, minRating } = options;
  
  if (startDate) filtering.startDate = startDate;
  if (endDate) filtering.endDate = endDate;
  
  if (flags && flags.length > 0) {
    filtering.flags = flags;
    logger.info(`Applied flags filter: [${flags.join(', ')}]`);
  }
  
  if (minPrice !== undefined && minPrice !== null) {
    filtering.lowestPrice = minPrice;
  }
  if (maxPrice !== undefined && maxPrice !== null) {
    filtering.highestPrice = maxPrice;
  }
  
  if (minDuration !== undefined || maxDuration !== undefined) {
    filtering.durationInMinutes = {};
    if (minDuration !== undefined && minDuration !== null) {
      filtering.durationInMinutes.from = minDuration;
    }
    if (maxDuration !== undefined && maxDuration !== null) {
      filtering.durationInMinutes.to = maxDuration;
    }
    logger.info(`Applied duration filter: ${minDuration || 0}-${maxDuration || '∞'} minutes`);
  }
  
  if (minRating !== undefined && minRating !== null && minRating > 0) {
    filtering.rating = { from: minRating };
    logger.info(`Applied rating filter: ${minRating}+ stars`);
  }
}

// ============================================================================
// SEARCH TOURS - Main function
// ============================================================================

/**
 * Search for tours with optional filtering
 * @param {Object} params
 * @param {string} params.destination - City name
 * @param {string} params.destinationId - Optional destination ID (skips name lookup if provided)
 * @param {string} params.searchTerms - Keywords to filter by
 * @param {number} params.resultCount - Number of results (default 10, max 20)
 * @param {string} params.sortBy - Sort option
 * @param {string} params.startDate - Optional start date (YYYY-MM-DD)
 * @param {string} params.endDate - Optional end date (YYYY-MM-DD)
 * @param {Array} params.flags - Optional flags
 * @param {number} params.minPrice - Optional minimum price
 * @param {number} params.maxPrice - Optional maximum price
 * @param {number} params.minDuration - Optional minimum duration in minutes
 * @param {number} params.maxDuration - Optional maximum duration in minutes
 * @param {number} params.minRating - Optional minimum rating (1-5)
 */
export async function searchTours({ 
  destination, 
  destinationId = null,  // NEW: Accept destination ID directly
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
}) {
  if (!API_KEY) {
    throw new Error('VIATOR_API_KEY not configured');
  }

  // Build filters summary for logging
  const filterSummary = [];
  if (startDate || endDate) filterSummary.push(`dates: ${startDate || 'any'} to ${endDate || 'any'}`);
  if (flags.length > 0) filterSummary.push(`flags: ${flags.join(',')}`);
  if (minPrice || maxPrice) filterSummary.push(`price: ${minPrice || 0}-${maxPrice || '∞'}`);
  if (minDuration || maxDuration) filterSummary.push(`duration: ${minDuration || 0}-${maxDuration || '∞'}min`);
  if (minRating) filterSummary.push(`rating: ${minRating}+`);

  logger.info(`Searching tours: ${destination}${destinationId ? ` (ID: ${destinationId})` : ''}, terms: "${searchTerms}", count: ${resultCount}, sort: ${sortBy}${filterSummary.length ? ', ' + filterSummary.join(', ') : ''}`);

  try {
    const tags = getTagsFromSearchTerms(searchTerms);
    const needsClientSort = sortBy === 'reviews';
    const fetchCount = needsClientSort ? 50 : Math.min(resultCount * 2, 30);
    const viatorSort = getViatorSort(sortBy);
    const filterOptions = { startDate, endDate, flags, minPrice, maxPrice, minDuration, maxDuration, minRating };
    
    // If we have tags or search terms, use tag-based search
    if (tags.length > 0 || searchTerms) {
      logger.info(`Using tag-based search for "${searchTerms}" with tags [${tags.join(', ')}]`);
      return await searchByDestinationId(destination, resultCount, searchTerms, sortBy, filterOptions, destinationId);
    }

    // Get destination info - use provided ID or look up by name
    let destInfo;
    if (destinationId) {
      // Use the provided destination ID directly - skip fuzzy name matching
      destInfo = { id: parseInt(destinationId), name: destination };
      logger.info(`Using provided destination ID ${destinationId} for "${destination}"`);
    } else {
      // Fall back to name-based lookup
      destInfo = await findDestination(destination);
      if (!destInfo) {
        logger.warn(`Destination not found: ${destination}, trying tag-based search`);
        return await searchByDestinationId(destination, resultCount, '', sortBy, filterOptions, null);
      }
    }

    logger.info(`Using destination ID ${destInfo.id} (${destInfo.name}) for search, sort: ${sortBy}`);

    const searchBody = {
      filtering: {
        destination: destInfo.id
      },
      sorting: viatorSort,
      pagination: {
        start: 1,
        count: fetchCount
      },
      currency: 'USD'
    };

    applyFilters(searchBody.filtering, filterOptions);

    const response = await fetch(`${VIATOR_API_BASE}/products/search`, {
      method: 'POST',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(searchBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Viator search error: ${response.status} - ${errorText}`);
      throw new Error(`Viator API error: ${response.status}`);
    }

    const data = await response.json();
    let products = data.products || [];

    logger.info(`Found ${products.length} tours for ${destination}`);
    
    // Apply client-side sorting by review count if requested
    if (needsClientSort && products.length > 0) {
      products.sort((a, b) => {
        const reviewsA = a.reviews?.totalReviews || 0;
        const reviewsB = b.reviews?.totalReviews || 0;
        return reviewsB - reviewsA;
      });
      logger.info(`Sorted ${products.length} tours by review count`);
    }

    return products.slice(0, resultCount).map(p => formatTourResult(p));

  } catch (error) {
    logger.error('Tour search error:', error);
    throw error;
  }
}

// ============================================================================
// SEARCH BY DESTINATION ID (Fallback with optional filtering)
// ============================================================================

async function searchByDestinationId(destination, resultCount, filterTerms = '', sortBy = 'popular', filterOptions = {}, providedDestinationId = null) {
  let destInfo;
  
  // Use provided destination ID if available
  if (providedDestinationId) {
    destInfo = { id: parseInt(providedDestinationId), name: destination };
    logger.info(`Using provided destination ID ${providedDestinationId} for fallback search`);
  } else {
    destInfo = await findDestination(destination);
    if (!destInfo) {
      logger.warn(`Destination not found for fallback: ${destination}`);
      return [];
    }
  }

  const tags = getTagsFromSearchTerms(filterTerms);
  const needsClientSort = sortBy === 'reviews';
  const fetchCount = needsClientSort ? 50 : Math.min(resultCount * 2, 30);
  const viatorSort = getViatorSort(sortBy);
  
  logger.info(`Fallback search: destination=${destInfo.id} (${destInfo.name}), filter="${filterTerms}", tags=[${tags.join(',')}], sort=${sortBy}`);

  const searchBody = {
    filtering: {
      destination: destInfo.id
    },
    sorting: viatorSort,
    pagination: {
      start: 1,
      count: fetchCount
    },
    currency: 'USD'
  };

  if (tags.length > 0) {
    searchBody.filtering.tags = tags;
    logger.info(`Using API tag filter: [${tags.join(', ')}]`);
  }

  applyFilters(searchBody.filtering, filterOptions);

  const response = await fetch(`${VIATOR_API_BASE}/products/search`, {
    method: 'POST',
    headers: {
      'exp-api-key': API_KEY,
      'Accept': 'application/json;version=2.0',
      'Accept-Language': 'en-US',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(searchBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`Viator fallback search error: ${response.status} - ${errorText}`);
    return [];
  }

  const data = await response.json();
  let products = data.products || [];

  logger.info(`Fallback found ${products.length} tours for ${destination}${tags.length ? ' with tag filter' : ''}`);

  // If tag filtering returned 0 results, try again without tags
  if (products.length === 0 && tags.length > 0) {
    logger.info(`No results with tags, retrying without tag filter`);
    
    const retryBody = {
      filtering: {
        destination: destInfo.id
      },
      sorting: viatorSort,
      pagination: {
        start: 1,
        count: 50
      },
      currency: 'USD'
    };

    const retryResponse = await fetch(`${VIATOR_API_BASE}/products/search`, {
      method: 'POST',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(retryBody)
    });

    if (retryResponse.ok) {
      const retryData = await retryResponse.json();
      products = retryData.products || [];
      logger.info(`Retry without tags found ${products.length} tours`);
    }
  }

  // Apply client-side filtering if we have search terms but no tag results
  if (filterTerms && products.length > 0 && tags.length === 0) {
    const filterWords = filterTerms.toLowerCase().split(' ').filter(w => w.length > 2);
    
    const filteredProducts = products.filter(product => {
      const title = (product.title || '').toLowerCase();
      const description = (product.description || '').toLowerCase();
      const searchText = `${title} ${description}`;
      return filterWords.some(word => searchText.includes(word));
    });

    logger.info(`Client-side filtered ${products.length} tours down to ${filteredProducts.length} matching "${filterTerms}"`);

    if (filteredProducts.length > 0) {
      products = filteredProducts;
    } else {
      logger.info(`No tours matched filter "${filterTerms}", returning top-rated tours instead`);
    }
  }

  // Apply client-side sorting by review count if requested
  if (needsClientSort && products.length > 0) {
    products.sort((a, b) => {
      const reviewsA = a.reviews?.totalReviews || a.reviewCount || 0;
      const reviewsB = b.reviews?.totalReviews || b.reviewCount || 0;
      return reviewsB - reviewsA;
    });
    logger.info(`Sorted ${products.length} tours by review count (top: ${products[0]?.reviews?.totalReviews || products[0]?.reviewCount || 0} reviews)`);
  }

  return products.slice(0, resultCount).map(p => formatTourResult(p));
}

// ============================================================================
// GET TOUR DETAILS
// ============================================================================

export async function getTourDetails(productCode) {
  const response = await fetch(`${VIATOR_API_BASE}/products/${productCode}`, {
    method: 'GET',
    headers: {
      'exp-api-key': API_KEY,
      'Accept': 'application/json;version=2.0',
      'Accept-Language': 'en-US'
    }
  });

  if (!response.ok) {
    throw new Error(`Viator API error: ${response.status}`);
  }

  const product = await response.json();
  return formatTourResult(product);
}

// ============================================================================
// FORMAT RESULT
// ============================================================================

function formatTourResult(product) {
  const price = product.pricing?.summary?.fromPrice || 0;

  let duration = 'Varies';
  if (product.duration?.fixedDurationInMinutes) {
    const hours = Math.floor(product.duration.fixedDurationInMinutes / 60);
    const mins = product.duration.fixedDurationInMinutes % 60;
    if (hours === 0) duration = `${mins} minutes`;
    else if (mins === 0) duration = `${hours} hours`;
    else duration = `${hours}h ${mins}m`;
  }

  const rating = product.reviews?.combinedAverageRating?.toFixed(1) || 'New';
  const reviewCount = product.reviews?.totalReviews || 0;

  let image = null;
  if (product.images?.[0]?.variants) {
    const variant = product.images[0].variants.find(v => v.width >= 400 && v.width <= 720) ||
                    product.images[0].variants[product.images[0].variants.length - 1];
    image = variant?.url;
  }

  const productCode = product.productCode;
  const bookingLink = product.productUrl || buildAffiliateLink(productCode);

  return {
    id: productCode,
    name: product.title,
    description: product.description || '',
    duration,
    rating,
    reviewCount,
    price,
    currency: 'USD',
    image,
    flags: product.flags || [],
    bookingLink,
    link: bookingLink,
    productCode
  };
}

function buildAffiliateLink(productCode) {
  const params = new URLSearchParams({
    pid: AFFILIATE_ID || 'P00278785',
    mcid: '42383',
    medium: 'api',
    api_version: '2.0'
  });
  return `https://www.viator.com/tours/${productCode}?${params.toString()}`;
}

// ============================================================================
// DEBUG: Search all destinations
// ============================================================================

export async function debugSearchDestinations(query) {
  const destinations = await fetchDestinations();
  const normalizedQuery = query.toLowerCase().trim();
  
  const matches = destinations.filter(dest => {
    const name = (dest.name || '').toLowerCase();
    return name.includes(normalizedQuery);
  });
  
  return {
    query,
    totalDestinations: destinations.length,
    matchCount: matches.length,
    matches: matches.slice(0, 30).map(d => ({
      id: d.destinationId,
      name: d.name,
      type: d.type,
      parentId: d.parentDestinationId
    }))
  };
}

// ============================================================================
// FREETEXT SEARCH (AUTOCOMPLETE)
// ============================================================================

export async function searchDestinationsAutocomplete(searchTerm, limit = 8) {
  if (!searchTerm || searchTerm.length < 2) {
    return [];
  }

  logger.info(`Autocomplete search for: "${searchTerm}"`);

  try {
    const allDestinations = await fetchDestinations();
    const destMap = new Map(allDestinations.map(d => [d.destinationId, d]));
    
    const response = await fetch(`${VIATOR_API_BASE}/search/freetext`, {
      method: 'POST',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        searchTerm: searchTerm,
        searchTypes: [
          {
            searchType: 'DESTINATIONS',
            pagination: {
              start: 1,
              count: limit
            }
          }
        ],
        currency: 'USD'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Viator freetext API error: ${response.status} - ${errorText}`);
      return fallbackDestinationSearch(searchTerm, limit);
    }

    const data = await response.json();
    const destinations = data.destinations?.results || [];
    
    const results = destinations.map(d => {
      const destId = d.id || d.destinationId;
      const cachedDest = destMap.get(destId);
      const destType = cachedDest?.type || 'DESTINATION';
      const name = d.name || d.destinationName;
      
      // Build a user-friendly display name based on type
      const displayName = buildDisplayName(name, destId, destType, destMap);
      
      return {
        destinationId: destId?.toString(),
        name: name,
        type: destType,
        parentName: d.parentDestinationName || null,
        displayName: displayName
      };
    });

    logger.info(`Autocomplete found ${results.length} destinations for "${searchTerm}"`);
    return results;

  } catch (error) {
    logger.error('Autocomplete search error:', error);
    return fallbackDestinationSearch(searchTerm, limit);
  }
}

/**
 * Build a user-friendly display name for a destination
 * - Country: "France"
 * - Region: "Tuscany, Italy"
 * - City: "Paris, France" (not "Paris, Ile-de-France")
 * - Town/District: "Oia, Santorini, Greece"
 */
function buildDisplayName(name, destId, destType, destMap) {
  // Get the full ancestry chain for this destination
  const ancestry = getDestinationAncestry(destId, destMap);
  
  // Find the country (type === 'COUNTRY') in the ancestry
  const country = ancestry.find(d => d.type === 'COUNTRY');
  const countryName = country?.name || null;
  
  // Handle different destination types
  if (destType === 'COUNTRY') {
    // Countries just show their name
    return name;
  }
  
  if (destType === 'REGION' || destType === 'STATE') {
    // Regions show: "Region, Country"
    return countryName ? `${name}, ${countryName}` : name;
  }
  
  if (destType === 'CITY') {
    // Cities show: "City, Country"
    return countryName ? `${name}, ${countryName}` : name;
  }
  
  // For towns, districts, or other sub-city types, show: "Town, City, Country"
  // Find the parent city in ancestry
  const parentCity = ancestry.find(d => d.type === 'CITY');
  
  if (parentCity && countryName) {
    return `${name}, ${parentCity.name}, ${countryName}`;
  } else if (countryName) {
    return `${name}, ${countryName}`;
  }
  
  // Fallback: just use the immediate parent if we have one
  const cachedDest = destMap.get(destId);
  if (cachedDest?.parentDestinationId) {
    const parent = destMap.get(cachedDest.parentDestinationId);
    if (parent) {
      return `${name}, ${parent.name}`;
    }
  }
  
  return name;
}

/**
 * Get the ancestry chain for a destination (parent, grandparent, etc.)
 */
function getDestinationAncestry(destId, destMap, maxDepth = 5) {
  const ancestry = [];
  let currentId = destId;
  let depth = 0;
  
  while (currentId && depth < maxDepth) {
    const dest = destMap.get(currentId);
    if (!dest) break;
    
    // Don't include the destination itself, only its ancestors
    if (dest.parentDestinationId) {
      const parent = destMap.get(dest.parentDestinationId);
      if (parent) {
        ancestry.push({
          id: parent.destinationId,
          name: parent.name,
          type: parent.type
        });
        currentId = parent.destinationId;
      } else {
        break;
      }
    } else {
      break;
    }
    
    depth++;
  }
  
  return ancestry;
}

/**
 * Fallback to searching cached destinations when API fails
 */
async function fallbackDestinationSearch(searchTerm, limit = 8) {
  try {
    const destinations = await fetchDestinations();
    const searchLower = searchTerm.toLowerCase();
    const destMap = new Map(destinations.map(d => [d.destinationId, d]));
    
    const scored = destinations
      .filter(d => d.name && d.name.toLowerCase().includes(searchLower))
      .map(d => {
        const nameLower = d.name.toLowerCase();
        let score = 0;
        
        if (nameLower === searchLower) score = 100;
        else if (nameLower.startsWith(searchLower)) score = 80;
        else score = 50;
        
        if (d.type === 'CITY') score += 10;
        
        return { ...d, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    return scored.map(d => {
      const displayName = buildDisplayName(d.name, d.destinationId, d.type || 'CITY', destMap);
      
      return {
        destinationId: d.destinationId?.toString(),
        name: d.name,
        type: d.type || 'CITY',
        parentName: null,
        displayName: displayName
      };
    });

  } catch (error) {
    logger.error('Fallback destination search error:', error);
    return [];
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { fetchDestinations };

export default {
  searchTours,
  getTourDetails,
  findDestination,
  fetchDestinations,
  debugSearchDestinations,
  searchDestinationsAutocomplete
};
