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
// TRANSFER/TRANSPORT DETECTION
// ============================================================================

const TRANSFER_KEYWORDS = [
  'private transfer',
  'airport transfer',
  'chauffeur',
  'car transfer',
  'shuttle transfer',
  'taxi',
  'transportation to',
  'transportation from',
  'transfer from',
  'transfer to',
  'pickup from',
  'drop-off'
];

/**
 * Check if a tour is actually a private transfer/transport service
 */
function isTransferProduct(product) {
  const title = (product.title || product.name || '').toLowerCase();
  return TRANSFER_KEYWORDS.some(keyword => title.includes(keyword));
}

/**
 * Filter and sort products to prioritize actual tours over transfers
 * @param {Array} products - Array of tour products
 * @param {boolean} excludeTransfers - If true, completely exclude transfers
 * @returns {Array} Filtered/sorted products
 */
function filterTransfers(products, excludeTransfers = false) {
  if (!products || products.length === 0) return products;
  
  const tours = products.filter(p => !isTransferProduct(p));
  const transfers = products.filter(p => isTransferProduct(p));
  
  if (excludeTransfers) {
    logger.info(`Filtered out ${transfers.length} transfer products, keeping ${tours.length} tours`);
    return tours;
  }
  
  // Put tours first, transfers at the end
  if (transfers.length > 0) {
    logger.info(`Deprioritized ${transfers.length} transfer products, ${tours.length} tours shown first`);
  }
  return [...tours, ...transfers];
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
    
    // Parse query for city, country pattern (e.g., "London, England" or "Paris, France")
    let cityName = normalizedQuery;
    let countryHint = null;
    
    // Check for comma-separated format: "City, Country" or "City, State"
    const commaMatch = normalizedQuery.match(/^([^,]+),\s*(.+)$/);
    if (commaMatch) {
      cityName = commaMatch[1].trim();
      countryHint = commaMatch[2].trim();
      logger.info(`Parsed query: city="${cityName}", country/region hint="${countryHint}"`);
    }
    
    logger.info(`Looking up destination: "${query}" -> city: "${cityName}"${countryHint ? `, hint: "${countryHint}"` : ''}${stateContext ? ` (state context: parentId=${stateContext.parentId})` : ''}`);

    // Try to find the destination with country hint if available
    let match = findDestinationMatch(destinations, cityName, stateContext, countryHint);
    
    // If no match with city name alone, try full query
    if (!match && cityName !== normalizedQuery) {
      match = findDestinationMatch(destinations, normalizedQuery, stateContext, null);
    }
    
    // If no match, try regional fallback
    if (!match && REGIONAL_FALLBACKS[normalizedQuery]) {
      const fallbackName = REGIONAL_FALLBACKS[normalizedQuery];
      logger.info(`No match for "${normalizedQuery}", trying regional fallback: "${fallbackName}"`);
      match = findDestinationMatch(destinations, fallbackName.toLowerCase(), null, null);
    }
    
    // Also try the original query with state in the fallbacks
    if (!match) {
      const originalNormalized = query.toLowerCase().trim();
      if (REGIONAL_FALLBACKS[originalNormalized]) {
        const fallbackName = REGIONAL_FALLBACKS[originalNormalized];
        logger.info(`Trying original query fallback: "${originalNormalized}" -> "${fallbackName}"`);
        match = findDestinationMatch(destinations, fallbackName.toLowerCase(), null, null);
      }
    }
    
    // If still no match and we have state context, try the state/region itself
    if (!match && stateContext) {
      const stateName = stateContext.stateName || STATE_ABBREVS[stateContext.stateAbbrev];
      if (stateName) {
        logger.info(`Trying state fallback: "${stateName}"`);
        match = findDestinationMatch(destinations, stateName.toLowerCase(), null, null);
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

// Country/region name mappings for disambiguation
const COUNTRY_ALIASES = {
  'england': ['united kingdom', 'uk', 'great britain', 'britain'],
  'uk': ['united kingdom', 'england', 'great britain', 'britain'],
  'united kingdom': ['uk', 'england', 'great britain', 'britain'],
  'great britain': ['united kingdom', 'uk', 'england', 'britain'],
  'britain': ['united kingdom', 'uk', 'england', 'great britain'],
  'usa': ['united states', 'us', 'america'],
  'us': ['united states', 'usa', 'america'],
  'united states': ['usa', 'us', 'america'],
  'america': ['united states', 'usa', 'us'],
  'uae': ['united arab emirates'],
  'united arab emirates': ['uae']
};

// US State name mappings (full name -> abbreviation and vice versa)
const US_STATE_MAPPINGS = {
  'alabama': 'al', 'alaska': 'ak', 'arizona': 'az', 'arkansas': 'ar',
  'california': 'ca', 'colorado': 'co', 'connecticut': 'ct', 'delaware': 'de',
  'florida': 'fl', 'georgia': 'ga', 'hawaii': 'hi', 'idaho': 'id',
  'illinois': 'il', 'indiana': 'in', 'iowa': 'ia', 'kansas': 'ks',
  'kentucky': 'ky', 'louisiana': 'la', 'maine': 'me', 'maryland': 'md',
  'massachusetts': 'ma', 'michigan': 'mi', 'minnesota': 'mn', 'mississippi': 'ms',
  'missouri': 'mo', 'montana': 'mt', 'nebraska': 'ne', 'nevada': 'nv',
  'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny',
  'north carolina': 'nc', 'north dakota': 'nd', 'ohio': 'oh', 'oklahoma': 'ok',
  'oregon': 'or', 'pennsylvania': 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
  'south dakota': 'sd', 'tennessee': 'tn', 'texas': 'tx', 'utah': 'ut',
  'vermont': 'vt', 'virginia': 'va', 'washington': 'wa', 'west virginia': 'wv',
  'wisconsin': 'wi', 'wyoming': 'wy', 'district of columbia': 'dc'
};

// Nearby destination fallbacks for cities that don't exist in Viator
const NEARBY_DESTINATION_FALLBACKS = {
  'ocean city': ['Atlantic City', 'Philadelphia'],
  'wildwood': ['Atlantic City', 'Philadelphia'],
  'cape may': ['Atlantic City', 'Philadelphia'],
  'seaside heights': ['Atlantic City', 'Philadelphia'],
  'point pleasant': ['Atlantic City', 'Philadelphia'],
  'long beach island': ['Atlantic City', 'Philadelphia'],
  'asbury park': ['Atlantic City', 'Philadelphia'],
  'hoboken': ['New York City', 'Jersey City'],
  'jersey city': ['New York City'],
  'newark': ['New York City'],
};

// Create reverse mapping (abbreviation -> full name)
const US_STATE_ABBREV_TO_NAME = Object.fromEntries(
  Object.entries(US_STATE_MAPPINGS).map(([name, abbr]) => [abbr, name])
);

/**
 * Get all variations of a US state name for matching
 */
function getStateVariations(stateHint) {
  const hint = stateHint.toLowerCase().trim();
  const variations = [hint];
  
  if (US_STATE_MAPPINGS[hint]) {
    variations.push(US_STATE_MAPPINGS[hint]);
  }
  
  if (US_STATE_ABBREV_TO_NAME[hint]) {
    variations.push(US_STATE_ABBREV_TO_NAME[hint]);
  }
  
  return variations;
}

// Helper function to find destination match
function findDestinationMatch(destinations, query, stateContext = null, countryHint = null) {
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
  
  // If we have a hint, verify even single matches
  if (matches.length === 1 && countryHint) {
    const match = matches[0];
    const destMap = new Map(destinations.map(d => [d.destinationId, d]));
    
    // Get hint variations
    const hintVariations = [countryHint];
    if (COUNTRY_ALIASES[countryHint]) {
      hintVariations.push(...COUNTRY_ALIASES[countryHint]);
    }
    const stateVariations = getStateVariations(countryHint);
    hintVariations.push(...stateVariations);
    
    // Check if this single match actually matches the hint
    let matchesHint = false;
    
    // Check destination name itself
    const destName = (match.destinationName || match.name || '').toLowerCase();
    if (hintVariations.some(hint => destName.includes(hint))) {
      matchesHint = true;
    }
    
    // Check ancestry
    if (!matchesHint) {
      let currentDest = match;
      let depth = 0;
      while (currentDest && depth < 5) {
        const parentName = (currentDest.destinationName || currentDest.name || '').toLowerCase();
        if (hintVariations.some(hint => parentName.includes(hint))) {
          matchesHint = true;
          break;
        }
        if (currentDest.parentDestinationId) {
          currentDest = destMap.get(currentDest.parentDestinationId);
        } else {
          break;
        }
        depth++;
      }
    }
    
    if (matchesHint) {
      logger.info(`Single match "${match.name}" verified against hint "${countryHint}"`);
      return match;
    } else {
      logger.warn(`Single match "${match.name}" (ID: ${match.destinationId}) does NOT match hint "${countryHint}" - may be wrong location!`);
      
      const hintParts = countryHint.split(',').map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
      
      const expandedHints = [...hintVariations];
      for (const part of hintParts) {
        if (!expandedHints.includes(part)) {
          expandedHints.push(part);
        }
        const partVariations = getStateVariations(part);
        for (const v of partVariations) {
          if (!expandedHints.includes(v)) {
            expandedHints.push(v);
          }
        }
      }
      
      logger.info(`Searching for fallback with hints: ${expandedHints.slice(0, 10).join(', ')}...`);
      
      // Check for known nearby destination fallbacks
      const nearbyFallbacks = NEARBY_DESTINATION_FALLBACKS[query.toLowerCase()];
      if (nearbyFallbacks) {
        for (const fallbackName of nearbyFallbacks) {
          const fallbackMatch = destinations.find(d => {
            const name = (d.destinationName || d.name || '').toLowerCase();
            return name === fallbackName.toLowerCase() || name.includes(fallbackName.toLowerCase());
          });
          if (fallbackMatch) {
            logger.info(`Using nearby fallback "${fallbackMatch.name}" (ID: ${fallbackMatch.destinationId}) for "${query}"`);
            return fallbackMatch;
          }
        }
      }
      
      // Try to find the hinted region as a destination
      for (const hintVar of expandedHints) {
        if (hintVar.length < 3 || hintVar === 'us' || hintVar === 'usa') continue;
        
        const regionMatch = destinations.find(d => {
          const name = (d.destinationName || d.name || '').toLowerCase();
          return name === hintVar || name.includes(hintVar);
        });
        if (regionMatch && regionMatch.destinationId !== match.destinationId) {
          logger.info(`Using region "${regionMatch.name}" (ID: ${regionMatch.destinationId}) instead of mismatched "${match.name}"`);
          return regionMatch;
        }
      }
      
      logger.warn(`Returning "${match.name}" despite hint mismatch - no "${countryHint}" destination found`);
      return match;
    }
  }
  
  if (matches.length === 1) {
    return matches[0];
  }
  
  // Multiple matches - try to disambiguate
  logger.info(`Found ${matches.length} matches for "${query}": ${matches.map(m => `${m.name} (parent: ${m.parentDestinationId})`).join(', ')}`);
  
  if (countryHint) {
    const hintVariations = [countryHint];
    
    if (COUNTRY_ALIASES[countryHint]) {
      hintVariations.push(...COUNTRY_ALIASES[countryHint]);
    }
    
    const stateVariations = getStateVariations(countryHint);
    hintVariations.push(...stateVariations);
    
    logger.info(`Disambiguation hints for "${countryHint}": ${hintVariations.join(', ')}`);
    
    // Check if any match has the hint in its own name
    for (const match of matches) {
      const destName = (match.destinationName || match.name || '').toLowerCase();
      if (hintVariations.some(hint => destName.includes(hint))) {
        logger.info(`Disambiguated to "${match.name}" based on destination name containing hint "${countryHint}"`);
        return match;
      }
    }
    
    const destMap = new Map(destinations.map(d => [d.destinationId, d]));
    
    for (const match of matches) {
      let currentDest = match;
      let depth = 0;
      const maxDepth = 5;
      
      while (currentDest && depth < maxDepth) {
        const parentName = (currentDest.destinationName || currentDest.name || '').toLowerCase();
        
        if (hintVariations.some(hint => parentName.includes(hint))) {
          logger.info(`Disambiguated to "${match.name}" based on hint "${countryHint}" (matched parent: ${parentName})`);
          return match;
        }
        
        if (currentDest.parentDestinationId) {
          currentDest = destMap.get(currentDest.parentDestinationId);
        } else {
          break;
        }
        depth++;
      }
    }
    
    // Check direct parent
    for (const match of matches) {
      const parentId = match.parentDestinationId;
      if (parentId) {
        const parent = destMap.get(parentId);
        if (parent) {
          const parentName = (parent.destinationName || parent.name || '').toLowerCase();
          if (hintVariations.some(hint => parentName.includes(hint))) {
            logger.info(`Disambiguated to "${match.name}" based on direct parent match "${parentName}"`);
            return match;
          }
        }
      }
    }
    
    logger.info(`Hint "${countryHint}" did not help disambiguate`);
  }
  
  // If we have state context, prefer match with correct parent
  if (stateContext && stateContext.parentId) {
    const stateMatch = matches.find(m => m.parentDestinationId === stateContext.parentId);
    if (stateMatch) {
      logger.info(`Disambiguated to "${stateMatch.name}" based on state context (parent: ${stateContext.parentId})`);
      return stateMatch;
    }
  }
  
  // Prefer CITY type, then lower IDs
  matches.sort((a, b) => {
    const aIsCity = a.type === 'CITY' ? 1 : 0;
    const bIsCity = b.type === 'CITY' ? 1 : 0;
    if (aIsCity !== bIsCity) return bIsCity - aIsCity;
    
    return (a.destinationId || 999999) - (b.destinationId || 999999);
  });
  
  logger.info(`Returning first match after sorting: "${matches[0].name}" (ID: ${matches[0].destinationId})`);
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
 * @param {number} params.resultCount - Number of results (default 10, max ~500)
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
  destinationId = null,
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
    const filterOptions = { startDate, endDate, flags, minPrice, maxPrice, minDuration, maxDuration, minRating };
    
    // Use searchByDestinationId for all searches - it handles pagination with limits
    return await searchByDestinationId(destination, resultCount, searchTerms, sortBy, filterOptions, destinationId);

  } catch (error) {
    logger.error('Tour search error:', error);
    throw error;
  }
}

// ============================================================================
// SEARCH BY DESTINATION ID - WITH PAGINATION LIMITS
// ============================================================================
// FIXED: Now limits to 500 results max (10 pages) instead of fetching ALL tours
// ============================================================================

async function searchByDestinationId(destination, resultCount, filterTerms = '', sortBy = 'popular', filterOptions = {}, providedDestinationId = null) {
  let destInfo;
  
  // Use provided destination ID if available
  if (providedDestinationId) {
    destInfo = { id: parseInt(providedDestinationId), name: destination };
    logger.info(`Using provided destination ID ${providedDestinationId} for search`);
  } else {
    destInfo = await findDestination(destination);
    if (!destInfo) {
      logger.warn(`Destination not found: ${destination}`);
      return { tours: [], totalCount: 0, hasMore: false, fetchedCount: 0 };
    }
  }

  const tags = getTagsFromSearchTerms(filterTerms);
  const needsClientSort = sortBy === 'reviews';
  const viatorSort = getViatorSort(sortBy);
  
  // =========================================================================
  // PAGINATION LIMITS - THE FIX!
  // =========================================================================
  const PAGE_SIZE = 50;      // Viator API max per request
  const MAX_RESULTS = 500;   // Cap at 500 results (was 5000!)
  const MAX_PAGES = 10;      // Maximum 10 pages (was unlimited!)
  // =========================================================================
  
  logger.info(`Searching tours: destination=${destInfo.id} (${destInfo.name}), filter="${filterTerms}", tags=[${tags.join(',')}], sort=${sortBy}, max=${MAX_RESULTS}`);

  let allProducts = [];
  let currentStart = 1;
  let totalCount = 0;
  let hasMore = true;
  let pagesFetched = 0;

  // Fetch pages until we hit our limits
  while (hasMore && allProducts.length < MAX_RESULTS && pagesFetched < MAX_PAGES) {
    const searchBody = {
      filtering: {
        destination: destInfo.id
      },
      sorting: viatorSort,
      pagination: {
        start: currentStart,
        count: PAGE_SIZE
      },
      currency: 'USD'
    };

    if (tags.length > 0) {
      searchBody.filtering.tags = tags;
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
      logger.error(`Viator search error (page ${pagesFetched + 1}): ${response.status} - ${errorText}`);
      break;
    }

    const data = await response.json();
    const pageProducts = data.products || [];
    totalCount = data.totalCount || 0;

    allProducts = [...allProducts, ...pageProducts];
    pagesFetched++;
    
    logger.info(`Page ${pagesFetched}: fetched ${pageProducts.length} tours (total so far: ${allProducts.length}/${totalCount})`);

    // Check if there are more results AND we haven't hit our limits
    hasMore = pageProducts.length === PAGE_SIZE && allProducts.length < totalCount && allProducts.length < MAX_RESULTS && pagesFetched < MAX_PAGES;
    currentStart += PAGE_SIZE;
  }

  // Calculate if there are more results available beyond what we fetched
  const moreAvailable = totalCount > allProducts.length;
  
  logger.info(`Fetched ${allProducts.length} tours for ${destination} in ${pagesFetched} pages (${totalCount} total available, hasMore: ${moreAvailable})`);

  // If tag filtering returned 0 results, try again without tags (but still with limits)
  if (allProducts.length === 0 && tags.length > 0) {
    logger.info(`No results with tags, retrying without tag filter`);
    
    const retryBody = {
      filtering: {
        destination: destInfo.id
      },
      sorting: viatorSort,
      pagination: {
        start: 1,
        count: PAGE_SIZE
      },
      currency: 'USD'
    };

    applyFilters(retryBody.filtering, filterOptions);

    // Fetch with limits
    let retryStart = 1;
    let retryHasMore = true;
    let retryPages = 0;
    
    while (retryHasMore && allProducts.length < MAX_RESULTS && retryPages < MAX_PAGES) {
      retryBody.pagination.start = retryStart;
      
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
        const retryProducts = retryData.products || [];
        totalCount = retryData.totalCount || 0;
        
        allProducts = [...allProducts, ...retryProducts];
        retryPages++;
        retryHasMore = retryProducts.length === PAGE_SIZE && allProducts.length < totalCount && allProducts.length < MAX_RESULTS && retryPages < MAX_PAGES;
        retryStart += PAGE_SIZE;
      } else {
        break;
      }
    }
    
    logger.info(`Retry without tags found ${allProducts.length} total tours in ${retryPages} pages`);
  }

  let products = allProducts;

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
      logger.info(`No tours matched filter "${filterTerms}", returning all tours instead`);
    }
  }

  // Apply client-side sorting by review count if requested
  if (sortBy === 'reviews' && products.length > 0) {
    products.sort((a, b) => {
      const reviewsA = a.reviews?.totalReviews || a.reviewCount || 0;
      const reviewsB = b.reviews?.totalReviews || b.reviewCount || 0;
      return reviewsB - reviewsA;
    });
    logger.info(`Sorted ${products.length} tours by review count (top: ${products[0]?.reviews?.totalReviews || products[0]?.reviewCount || 0} reviews)`);
  }

  // Filter out/deprioritize transfers - actual tours should come first
  products = filterTransfers(products, false);
  
  // If ALL results are transfers, log a warning
  const actualTours = products.filter(p => !isTransferProduct(p));
  if (actualTours.length === 0 && products.length > 0) {
    logger.warn(`Only transfers found for ${destination}, no actual tours available`);
  }

  // Format and return with metadata
  const formattedTours = products.map(p => formatTourResult(p));
  
  // Return object with metadata about total available
  return {
    tours: formattedTours,
    totalCount: totalCount,           // Total available from Viator
    hasMore: totalCount > formattedTours.length,  // Are there more results?
    fetchedCount: formattedTours.length  // How many we actually fetched
  };
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

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
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

/**
 * Search for destinations using Viator's freetext search API
 * This provides real-time autocomplete suggestions as users type
 */
export async function searchDestinationsAutocomplete(searchTerm, limit = 8) {
  if (!searchTerm || searchTerm.length < 2) {
    return [];
  }

  logger.info(`Autocomplete search for: "${searchTerm}"`);

  try {
    const allDestinations = await fetchDestinations();
    const destMap = new Map(allDestinations.map(d => [d.destinationId, d]));
    
    let apiResults = [];
    
    try {
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

      if (response.ok) {
        const data = await response.json();
        const destinations = data.destinations?.results || [];
        
        apiResults = destinations.map(d => {
          const destId = d.id || d.destinationId;
          const cachedDest = destMap.get(destId);
          const destType = cachedDest?.type || 'DESTINATION';
          const name = d.name || d.destinationName;
          const displayName = buildDisplayName(name, destId, destType, destMap);
          
          return {
            destinationId: destId?.toString(),
            name: name,
            type: destType,
            parentName: d.parentDestinationName || null,
            displayName: displayName,
            source: 'api'
          };
        });
      }
    } catch (apiError) {
      logger.warn(`Freetext API failed, will use cache only: ${apiError.message}`);
    }
    
    // Also search local cache for additional matches
    const searchLower = searchTerm.toLowerCase();
    
    const cacheResults = allDestinations
      .filter(d => {
        if (!d.name) return false;
        const nameLower = d.name.toLowerCase();
        return nameLower.startsWith(searchLower) || nameLower === searchLower;
      })
      .map(d => {
        const nameLower = d.name.toLowerCase();
        let score = 0;
        
        if (nameLower === searchLower) score = 100;
        else if (nameLower.startsWith(searchLower)) score = 80;
        
        if (d.type === 'CITY') score += 15;
        else if (d.type === 'REGION') score += 5;
        
        return { ...d, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 2)
      .map(d => {
        const displayName = buildDisplayName(d.name, d.destinationId, d.type || 'CITY', destMap);
        
        return {
          destinationId: d.destinationId?.toString(),
          name: d.name,
          type: d.type || 'CITY',
          parentName: null,
          displayName: displayName,
          source: 'cache'
        };
      });
    
    // Merge and deduplicate results
    const seenIds = new Set();
    const mergedResults = [];
    
    for (const result of apiResults) {
      if (!seenIds.has(result.destinationId)) {
        seenIds.add(result.destinationId);
        mergedResults.push(result);
      }
    }
    
    for (const result of cacheResults) {
      if (!seenIds.has(result.destinationId) && mergedResults.length < limit) {
        seenIds.add(result.destinationId);
        mergedResults.push(result);
      }
    }
    
    const finalResults = mergedResults.slice(0, limit).map(({ source, ...rest }) => rest);

    logger.info(`Autocomplete found ${finalResults.length} destinations for "${searchTerm}" (API: ${apiResults.length}, Cache: ${cacheResults.length})`);
    return finalResults;

  } catch (error) {
    logger.error('Autocomplete search error:', error);
    return fallbackDestinationSearch(searchTerm, limit);
  }
}

/**
 * Build a user-friendly display name for a destination
 */
function buildDisplayName(name, destId, destType, destMap) {
  const ancestry = getDestinationAncestry(destId, destMap);
  
  const country = ancestry.find(d => d.type === 'COUNTRY');
  const countryName = country?.name || null;
  
  if (destType === 'COUNTRY') {
    return name;
  }
  
  if (destType === 'REGION' || destType === 'STATE') {
    return countryName ? `${name}, ${countryName}` : name;
  }
  
  if (destType === 'CITY') {
    return countryName ? `${name}, ${countryName}` : name;
  }
  
  const parentCity = ancestry.find(d => d.type === 'CITY');
  
  if (parentCity && countryName) {
    return `${name}, ${parentCity.name}, ${countryName}`;
  } else if (countryName) {
    return `${name}, ${countryName}`;
  }
  
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
 * Get the ancestry chain for a destination
 */
function getDestinationAncestry(destId, destMap, maxDepth = 5) {
  const ancestry = [];
  let currentId = destId;
  let depth = 0;
  
  while (currentId && depth < maxDepth) {
    const dest = destMap.get(currentId);
    if (!dest) break;
    
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
