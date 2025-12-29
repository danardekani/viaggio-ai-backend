// ============================================================================
// VIATOR AFFILIATE API SERVICE
// ============================================================================

import { logger } from '../../utils/logger.js';

const VIATOR_API_BASE = 'https://api.sandbox.viator.com/partner';
const API_KEY = process.env.VIATOR_API_KEY;
const AFFILIATE_ID = process.env.VIATOR_AFFILIATE_ID;
const FETCH_TIMEOUT_MS = 30000; // 30 second timeout for API calls (sandbox API can be slow)

/**
 * Fetch with timeout to prevent hanging requests
 * @param {string} url - URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

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
let destinationsMapCache = null; // PERFORMANCE: Pre-built Map for O(1) lookups
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// PERFORMANCE: Cache for tour search results by destination
// Key: "destId:tags:sort" -> { tours: [], timestamp: Date.now() }
const tourSearchCache = new Map();
const TOUR_CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache for tour results
const MAX_TOUR_CACHE_ENTRIES = 50; // Limit cache size to prevent memory issues

// PERFORMANCE: Cache for attractions by destination
const attractionsCache = new Map();
const ATTRACTIONS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Clear cache function (for debugging)
export function clearDestinationCache() {
  destinationsCache = null;
  destinationsCacheTime = null;
  destinationsMapCache = null;
  logger.info('Destination cache cleared');
}

// Clear tour search cache
export function clearTourSearchCache() {
  tourSearchCache.clear();
  logger.info('Tour search cache cleared');
}

// Get cached tour search results
function getCachedTourSearch(cacheKey) {
  const cached = tourSearchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < TOUR_CACHE_DURATION) {
    logger.info(`Tour cache HIT for ${cacheKey} (${cached.tours.length} tours, age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
    return cached.tours;
  }
  if (cached) {
    tourSearchCache.delete(cacheKey); // Clean up expired entry
  }
  return null;
}

// Store tour search results in cache
function cacheTourSearch(cacheKey, tours) {
  // Evict oldest entries if cache is full
  if (tourSearchCache.size >= MAX_TOUR_CACHE_ENTRIES) {
    const oldestKey = tourSearchCache.keys().next().value;
    tourSearchCache.delete(oldestKey);
    logger.info(`Evicted oldest tour cache entry: ${oldestKey}`);
  }
  tourSearchCache.set(cacheKey, { tours, timestamp: Date.now() });
  logger.info(`Tour cache STORE for ${cacheKey} (${tours.length} tours)`);
}

// Get cached attractions for a destination
function getCachedAttractions(destinationId) {
  const cached = attractionsCache.get(destinationId);
  if (cached && Date.now() - cached.timestamp < ATTRACTIONS_CACHE_TTL) {
    return cached.data;
  }
  return null;
}

// Store attractions in cache
function setCachedAttractions(destinationId, data) {
  attractionsCache.set(destinationId, { data, timestamp: Date.now() });
}

// Get cached destination Map (creates it once, reuses afterwards)
function getDestinationMap(destinations) {
  if (!destinationsMapCache && destinations) {
    destinationsMapCache = new Map(destinations.map(d => [d.destinationId, d]));
    logger.info(`Built destination map with ${destinationsMapCache.size} entries`);
  }
  return destinationsMapCache;
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
 * PERFORMANCE OPTIMIZED: Single pass partition instead of double filter + spread
 * @param {Array} products - Array of tour products
 * @param {boolean} excludeTransfers - If true, completely exclude transfers
 * @returns {Array} Filtered/sorted products
 */
function filterTransfers(products, excludeTransfers = false) {
  if (!products || products.length === 0) return products;

  // Single pass: partition into tours and transfers
  const tours = [];
  const transfers = [];

  for (const p of products) {
    if (isTransferProduct(p)) {
      transfers.push(p);
    } else {
      tours.push(p);
    }
  }

  if (excludeTransfers) {
    logger.info(`Filtered out ${transfers.length} transfer products, keeping ${tours.length} tours`);
    return tours;
  }

  // Put tours first, transfers at the end
  if (transfers.length > 0) {
    logger.info(`Deprioritized ${transfers.length} transfer products, ${tours.length} tours shown first`);
    // Use push for better performance than spread
    for (const t of transfers) {
      tours.push(t);
    }
  }
  return tours;
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

  const response = await fetchWithTimeout(`${VIATOR_API_BASE}/destinations`, {
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
// Maps city names to nearby alternatives that DO exist in Viator
const NEARBY_DESTINATION_FALLBACKS = {
  // New Jersey Shore towns -> Atlantic City (the main NJ beach destination in Viator)
  'ocean city': ['Atlantic City', 'Philadelphia'],
  'wildwood': ['Atlantic City', 'Philadelphia'],
  'cape may': ['Atlantic City', 'Philadelphia'],
  'seaside heights': ['Atlantic City', 'Philadelphia'],
  'point pleasant': ['Atlantic City', 'Philadelphia'],
  'long beach island': ['Atlantic City', 'Philadelphia'],
  'asbury park': ['Atlantic City', 'Philadelphia'],
  // Other common fallbacks
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
  
  // If it's a full state name, add the abbreviation
  if (US_STATE_MAPPINGS[hint]) {
    variations.push(US_STATE_MAPPINGS[hint]);
  }
  
  // If it's an abbreviation, add the full name
  if (US_STATE_ABBREV_TO_NAME[hint]) {
    variations.push(US_STATE_ABBREV_TO_NAME[hint]);
  }
  
  return variations;
}

// Helper function to find destination match
// PERFORMANCE OPTIMIZED: Single-pass filtering with scoring instead of 3x array scans
function findDestinationMatch(destinations, query, stateContext = null, countryHint = null) {
  // Single pass through destinations with scoring
  const scoredMatches = [];

  for (const dest of destinations) {
    const name = (dest.destinationName || dest.name || '').toLowerCase();
    let score = 0;

    // Exact match - highest priority
    if (name === query) {
      score = 100;
    }
    // Destination name contains query
    else if (name.includes(query)) {
      score = 50;
    }
    // Query contains destination name (only for names > 3 chars)
    else if (name.length > 3 && query.includes(name)) {
      score = 25;
    }

    if (score > 0) {
      scoredMatches.push({ dest, score });
    }
  }

  if (scoredMatches.length === 0) {
    return null;
  }

  // Sort by score descending and extract destinations
  scoredMatches.sort((a, b) => b.score - a.score);
  const matches = scoredMatches.map(m => m.dest);
  
  // If we have a hint, verify even single matches
  if (matches.length === 1 && countryHint) {
    const match = matches[0];
    const destMap = getDestinationMap(destinations);
    
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
      // Single match doesn't match the hint - this is likely wrong!
      // Try to find the state/region as a destination instead
      logger.warn(`Single match "${match.name}" (ID: ${match.destinationId}) does NOT match hint "${countryHint}" - may be wrong location!`);
      
      // Split the hint by comma to get individual parts (e.g., "new jersey, united states" -> ["new jersey", "united states"])
      const hintParts = countryHint.split(',').map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
      
      // Build expanded hint variations including split parts
      const expandedHints = [...hintVariations];
      for (const part of hintParts) {
        if (!expandedHints.includes(part)) {
          expandedHints.push(part);
        }
        // Add state variations for each part
        const partVariations = getStateVariations(part);
        for (const v of partVariations) {
          if (!expandedHints.includes(v)) {
            expandedHints.push(v);
          }
        }
      }
      
      logger.info(`Searching for fallback with hints: ${expandedHints.slice(0, 10).join(', ')}...`);
      
      // FIRST: Check for known nearby destination fallbacks (e.g., Ocean City NJ -> Atlantic City)
      // This gives more relevant results than falling back to entire state
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
      
      // SECOND: Try to find the hinted region as a destination (e.g., "New Jersey" as a destination)
      // This is a broader fallback if no nearby city is available
      for (const hintVar of expandedHints) {
        // Skip very short or generic terms
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
      
      // No better match found, return the original with a warning logged
      logger.warn(`Returning "${match.name}" despite hint mismatch - no "${countryHint}" destination found`);
      return match;
    }
  }
  
  if (matches.length === 1) {
    return matches[0];
  }
  
  // Multiple matches - try to disambiguate
  logger.info(`Found ${matches.length} matches for "${query}": ${matches.map(m => `${m.name} (parent: ${m.parentDestinationId})`).join(', ')}`);
  
  // If we have a country/state hint, try to find a match whose ancestry includes it
  if (countryHint) {
    // Get all possible names to match against (country aliases + US state variations)
    const hintVariations = [countryHint];
    
    // Add country aliases
    if (COUNTRY_ALIASES[countryHint]) {
      hintVariations.push(...COUNTRY_ALIASES[countryHint]);
    }
    
    // Add US state variations (e.g., "new jersey" -> also check "nj")
    const stateVariations = getStateVariations(countryHint);
    hintVariations.push(...stateVariations);
    
    logger.info(`Disambiguation hints for "${countryHint}": ${hintVariations.join(', ')}`);
    
    // FIRST: Check if any match has the hint in its own name (e.g., "Ocean City, NJ")
    for (const match of matches) {
      const destName = (match.destinationName || match.name || '').toLowerCase();
      if (hintVariations.some(hint => destName.includes(hint))) {
        logger.info(`Disambiguated to "${match.name}" based on destination name containing hint "${countryHint}"`);
        return match;
      }
    }
    
    // Use cached destination map for ancestry lookup
    const destMap = getDestinationMap(destinations);
    
    for (const match of matches) {
      // Check the ancestry of this destination for the hint
      let currentDest = match;
      let depth = 0;
      const maxDepth = 5; // Prevent infinite loops
      
      while (currentDest && depth < maxDepth) {
        const parentName = (currentDest.destinationName || currentDest.name || '').toLowerCase();
        
        // Check if any parent matches the hint variations
        if (hintVariations.some(hint => parentName.includes(hint))) {
          logger.info(`Disambiguated to "${match.name}" based on hint "${countryHint}" (matched parent: ${parentName})`);
          return match;
        }
        
        // Move up the ancestry chain
        if (currentDest.parentDestinationId) {
          currentDest = destMap.get(currentDest.parentDestinationId);
        } else {
          break;
        }
        depth++;
      }
    }
    
    // Also check if any match has the hint in its parent name directly
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
  
  // Prefer destinations with higher lookup frequency (major cities tend to have lower IDs in Viator)
  // Also prefer CITY type over REGION or other types
  matches.sort((a, b) => {
    // Prefer CITY type
    const aIsCity = a.type === 'CITY' ? 1 : 0;
    const bIsCity = b.type === 'CITY' ? 1 : 0;
    if (aIsCity !== bIsCity) return bIsCity - aIsCity;
    
    // Prefer lower IDs (generally more popular destinations)
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
 * @param {number} params.resultCount - Number of results (default 10, no max - fetches all)
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

  logger.info(`Searching ALL tours: ${destination}${destinationId ? ` (ID: ${destinationId})` : ''}, terms: "${searchTerms}", sort: ${sortBy}${filterSummary.length ? ', ' + filterSummary.join(', ') : ''}`);

  try {
    const filterOptions = { startDate, endDate, flags, minPrice, maxPrice, minDuration, maxDuration, minRating };
    
    // Use searchByDestinationId for all searches - it handles pagination to get ALL results
    return await searchByDestinationId(destination, resultCount, searchTerms, sortBy, filterOptions, destinationId);

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
    logger.info(`Using provided destination ID ${providedDestinationId} for search`);
  } else {
    destInfo = await findDestination(destination);
    if (!destInfo) {
      logger.warn(`Destination not found: ${destination}`);
      return [];
    }
  }

  const tags = getTagsFromSearchTerms(filterTerms);
  const viatorSort = getViatorSort(sortBy);
  const PAGE_SIZE = 50; // Viator API max per request (they limit to 50 even if you ask for more)
  const MAX_RESULTS = 1000; // Cap results to keep initial load reasonable (~20 API calls max)

  // PERFORMANCE: Check cache first (only for searches without date filters)
  const hasDateFilters = filterOptions.startDate || filterOptions.endDate;
  const cacheKey = `${destInfo.id}:${tags.sort().join(',')}:${sortBy}`;

  if (!hasDateFilters) {
    const cachedResults = getCachedTourSearch(cacheKey);
    if (cachedResults) {
      // Apply any additional client-side filtering and return cached results
      let products = cachedResults;
      if (filterTerms && tags.length === 0) {
        const filterWords = filterTerms.toLowerCase().split(' ').filter(w => w.length > 2);
        products = products.filter(p => {
          const searchText = `${p.name || ''} ${p.description || ''}`.toLowerCase();
          return filterWords.some(word => searchText.includes(word));
        });
      }
      logger.info(`Returning ${products.length} cached tours for ${destination}`);
      return products;
    }
  }

  logger.info(`Searching tours: destination=${destInfo.id} (${destInfo.name}), filter="${filterTerms}", tags=[${tags.join(',')}], sort=${sortBy}`);

  const PARALLEL_BATCH_SIZE = 10; // Fetch 10 pages at once (500 tours per batch)

  // Helper to build search request body
  const buildSearchBody = (startIndex) => {
    const body = {
      filtering: { destination: destInfo.id },
      sorting: viatorSort,
      pagination: { start: startIndex, count: PAGE_SIZE },
      currency: 'USD'
    };
    if (tags.length > 0) body.filtering.tags = tags;
    applyFilters(body.filtering, filterOptions);
    return body;
  };

  // Helper to fetch a single page
  const fetchPage = async (startIndex) => {
    const response = await fetchWithTimeout(`${VIATOR_API_BASE}/products/search`, {
      method: 'POST',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildSearchBody(startIndex))
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Viator search error (start=${startIndex}): ${response.status} - ${errorText}`);
      return { products: [], totalCount: 0 };
    }

    const data = await response.json();
    return { products: data.products || [], totalCount: data.totalCount || 0 };
  };

  // STEP 1: Fetch first page to get totalCount
  const startTime = Date.now();
  const firstPage = await fetchPage(1);
  let allProducts = firstPage.products;
  const totalCount = firstPage.totalCount;

  logger.info(`Page 1: fetched ${allProducts.length} tours (total available: ${totalCount})`);

  // STEP 2: Calculate how many more pages we need
  const targetCount = Math.min(MAX_RESULTS, totalCount);
  const totalPages = Math.ceil(targetCount / PAGE_SIZE);

  if (totalPages > 1) {
    // STEP 3: Fetch remaining pages in parallel batches
    const remainingPageStarts = [];
    for (let page = 2; page <= totalPages; page++) {
      remainingPageStarts.push((page - 1) * PAGE_SIZE + 1);
    }

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < remainingPageStarts.length; i += PARALLEL_BATCH_SIZE) {
      const batch = remainingPageStarts.slice(i, i + PARALLEL_BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(start => fetchPage(start)));

      for (const result of batchResults) {
        allProducts.push(...result.products);
      }

      const batchNum = Math.floor(i / PARALLEL_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(remainingPageStarts.length / PARALLEL_BATCH_SIZE);
      logger.info(`Batch ${batchNum}/${totalBatches}: fetched ${batch.length * PAGE_SIZE} tours (total so far: ${allProducts.length})`);
    }
  }

  const elapsed = Date.now() - startTime;
  logger.info(`Fetched ${allProducts.length} tours for ${destination} in ${elapsed}ms (API total: ${totalCount}, parallel batches used)`);

  // If tag filtering returned 0 results, retry without tags using parallel fetch
  if (allProducts.length === 0 && tags.length > 0) {
    logger.info(`No results with tags, retrying without tag filter`);

    // Build retry search body (no tags)
    const buildRetryBody = (startIndex) => {
      const body = {
        filtering: { destination: destInfo.id },
        sorting: viatorSort,
        pagination: { start: startIndex, count: PAGE_SIZE },
        currency: 'USD'
      };
      applyFilters(body.filtering, filterOptions);
      return body;
    };

    // Fetch retry page helper
    const fetchRetryPage = async (startIndex) => {
      const response = await fetchWithTimeout(`${VIATOR_API_BASE}/products/search`, {
        method: 'POST',
        headers: {
          'exp-api-key': API_KEY,
          'Accept': 'application/json;version=2.0',
          'Accept-Language': 'en-US',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildRetryBody(startIndex))
      });

      if (!response.ok) return { products: [], totalCount: 0 };
      const data = await response.json();
      return { products: data.products || [], totalCount: data.totalCount || 0 };
    };

    // Fetch first page to get count
    const retryFirst = await fetchRetryPage(1);
    allProducts = retryFirst.products;
    const retryTotal = retryFirst.totalCount;
    const retryPages = Math.ceil(Math.min(MAX_RESULTS, retryTotal) / PAGE_SIZE);

    if (retryPages > 1) {
      const retryStarts = [];
      for (let p = 2; p <= retryPages; p++) {
        retryStarts.push((p - 1) * PAGE_SIZE + 1);
      }

      for (let i = 0; i < retryStarts.length; i += PARALLEL_BATCH_SIZE) {
        const batch = retryStarts.slice(i, i + PARALLEL_BATCH_SIZE);
        const results = await Promise.all(batch.map(s => fetchRetryPage(s)));
        for (const r of results) allProducts.push(...r.products);
      }
    }

    logger.info(`Retry without tags found ${allProducts.length} tours (parallel fetch)`);
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

  // Format all results
  const formattedResults = products.map(p => formatTourResult(p));

  // PERFORMANCE: Cache the results for subsequent requests (only if no date filters)
  if (!hasDateFilters) {
    cacheTourSearch(cacheKey, formattedResults);
  }

  logger.info(`Returning ${formattedResults.length} tours for ${destination}`);
  return formattedResults;
}
/**
 * Resolve location references (LOC-xxx) to actual location names
 * Uses Viator's /locations/bulk endpoint
 * @param {Array} locationRefs - Array of location reference strings (e.g., "LOC-5620ab70-c813-4904-ad13-bcf527540d3e")
 * @returns {Object} Map of reference -> location data (including name)
 */
async function resolveLocationReferences(locationRefs) {
  if (!locationRefs || locationRefs.length === 0) {
    return {};
  }

  // Filter out invalid refs and deduplicate
  const validRefs = [...new Set(
    locationRefs.filter(ref => ref && typeof ref === 'string' && ref.startsWith('LOC-'))
  )];

  if (validRefs.length === 0) {
    return {};
  }

  logger.info(`Resolving ${validRefs.length} location references`);

  try {
    const response = await fetchWithTimeout(`${VIATOR_API_BASE}/locations/bulk`, {
      method: 'POST',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        locations: validRefs
      })
    });

    if (!response.ok) {
      logger.warn(`Failed to resolve locations: ${response.status}`);
      return {};
    }

    const data = await response.json();
    const locations = data.locations || [];

    // Build a map of reference -> location data
    const locationMap = {};
    for (const loc of locations) {
      if (loc.reference) {
        locationMap[loc.reference] = {
          name: loc.name || null,
          address: loc.address || null,
          center: loc.center || null,
          provider: loc.provider || null,
          providerReference: loc.providerReference || null
        };
      }
    }

    logger.info(`Resolved ${Object.keys(locationMap).length} of ${validRefs.length} locations`);
    return locationMap;

  } catch (error) {
    logger.error('Error resolving location references:', error);
    return {};
  }
}

/**
 * Extract all location references from an itinerary object
 * Handles all 5 itinerary types: STANDARD, ACTIVITY, MULTI_DAY_TOUR, HOP_ON_HOP_OFF, UNSTRUCTURED
 */
function extractLocationRefs(itinerary) {
  const refs = [];

  if (!itinerary) return refs;

  // STANDARD itinerary - itineraryItems[]
  if (itinerary.itineraryItems) {
    for (const item of itinerary.itineraryItems) {
      const ref = item.pointOfInterestLocation?.location?.ref;
      if (ref) refs.push(ref);
    }
  }

  // ACTIVITY itinerary - activityInfo.location
  if (itinerary.activityInfo?.location?.ref) {
    refs.push(itinerary.activityInfo.location.ref);
  }

  // MULTI_DAY_TOUR - days[].items[]
  if (itinerary.days) {
    for (const day of itinerary.days) {
      if (day.items) {
        for (const item of day.items) {
          const ref = item.pointOfInterestLocation?.location?.ref;
          if (ref) refs.push(ref);
        }
      }
    }
  }

  // HOP_ON_HOP_OFF - routes[].stops[] and routes[].pointsOfInterest[]
  if (itinerary.routes) {
    for (const route of itinerary.routes) {
      // Stops
      if (route.stops) {
        for (const stop of route.stops) {
          const ref = stop.stopLocation?.ref;
          if (ref) refs.push(ref);
        }
      }
      // Points of interest
      if (route.pointsOfInterest) {
        for (const poi of route.pointsOfInterest) {
          const ref = poi.location?.ref;
          if (ref) refs.push(ref);
        }
      }
    }
  }

  // UNSTRUCTURED - pointOfInterestLocations[]
  if (itinerary.pointOfInterestLocations) {
    for (const poi of itinerary.pointOfInterestLocations) {
      const ref = poi.location?.ref;
      if (ref) refs.push(ref);
    }
  }

  return refs;
}

/**
 * Enhance itinerary with resolved location names
 * Modifies the itinerary object in place to add resolved names
 */
function enhanceItineraryWithNames(itinerary, locationMap) {
  if (!itinerary || Object.keys(locationMap).length === 0) return itinerary;

  // Helper to get resolved name for a reference
  const getResolvedName = (ref) => locationMap[ref]?.name || null;

  // STANDARD itinerary - itineraryItems[]
  if (itinerary.itineraryItems) {
    itinerary.itineraryItems = itinerary.itineraryItems.map(item => {
      const ref = item.pointOfInterestLocation?.location?.ref;
      if (ref && locationMap[ref]) {
        // Add resolved location data to the item
        item.resolvedLocation = locationMap[ref];
        // Also add name directly for easier access
        if (!item.pointOfInterestLocation.name && locationMap[ref].name) {
          item.pointOfInterestLocation.name = locationMap[ref].name;
        }
      }
      return item;
    });
  }

  // MULTI_DAY_TOUR - days[].items[]
  if (itinerary.days) {
    itinerary.days = itinerary.days.map(day => {
      if (day.items) {
        day.items = day.items.map(item => {
          const ref = item.pointOfInterestLocation?.location?.ref;
          if (ref && locationMap[ref]) {
            item.resolvedLocation = locationMap[ref];
            if (!item.pointOfInterestLocation.name && locationMap[ref].name) {
              item.pointOfInterestLocation.name = locationMap[ref].name;
            }
          }
          return item;
        });
      }
      return day;
    });
  }

  // HOP_ON_HOP_OFF - routes[].stops[] and routes[].pointsOfInterest[]
  if (itinerary.routes) {
    itinerary.routes = itinerary.routes.map(route => {
      // Enhance stops
      if (route.stops) {
        route.stops = route.stops.map(stop => {
          const ref = stop.stopLocation?.ref;
          if (ref && locationMap[ref]) {
            stop.resolvedLocation = locationMap[ref];
            if (!stop.name && locationMap[ref].name) {
              stop.name = locationMap[ref].name;
            }
          }
          return stop;
        });
      }
      // Enhance POIs
      if (route.pointsOfInterest) {
        route.pointsOfInterest = route.pointsOfInterest.map(poi => {
          const ref = poi.location?.ref;
          if (ref && locationMap[ref]) {
            poi.resolvedLocation = locationMap[ref];
            if (!poi.name && locationMap[ref].name) {
              poi.name = locationMap[ref].name;
            }
          }
          return poi;
        });
      }
      return route;
    });
  }

  // UNSTRUCTURED - pointOfInterestLocations[]
  if (itinerary.pointOfInterestLocations) {
    itinerary.pointOfInterestLocations = itinerary.pointOfInterestLocations.map(poi => {
      const ref = poi.location?.ref;
      if (ref && locationMap[ref]) {
        poi.resolvedLocation = locationMap[ref];
        if (!poi.name && locationMap[ref].name) {
          poi.name = locationMap[ref].name;
        }
      }
      return poi;
    });
  }

  return itinerary;
}

// ============================================================================
// GET TOUR DETAILS
// ============================================================================

export async function getTourDetails(productCode) {
  logger.info(`Fetching tour details for: ${productCode}`);

  const response = await fetchWithTimeout(`${VIATOR_API_BASE}/products/${productCode}`, {
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
  
  // Debug logging to see what Viator returns
  logger.info(`Tour ${productCode} raw data:`, {
    hasImages: !!product.images,
    imageCount: product.images?.length || 0,
    hasFlags: !!product.flags,
    flagCount: product.flags?.length || 0,
    hasCancellationPolicy: !!product.cancellationPolicy,
    cancellationType: product.cancellationPolicy?.type,
    hasItinerary: !!product.itinerary,
    skipTheLine: product.itinerary?.skipTheLine,
    privateTour: product.itinerary?.privateTour,
    hasPricing: !!product.pricing,
    pricingSummary: product.pricing?.summary,
    hasPricingInfo: !!product.pricingInfo
  });

  // =========================================================================
  // RESOLVE LOCATION REFERENCES
  // Viator returns LOC-xxx references that must be resolved via /locations/bulk
  // =========================================================================
  if (product.itinerary) {
    try {
      // Extract all location references from the itinerary
      const locationRefs = extractLocationRefs(product.itinerary);
      
      if (locationRefs.length > 0) {
        logger.info(`Found ${locationRefs.length} location references to resolve`);
        
        // Resolve references to actual names via Viator API
        const locationMap = await resolveLocationReferences(locationRefs);
        
        // Enhance the itinerary with resolved names
        if (Object.keys(locationMap).length > 0) {
          enhanceItineraryWithNames(product.itinerary, locationMap);
          logger.info(`Enhanced itinerary with ${Object.keys(locationMap).length} resolved locations`);
        }
      }
    } catch (error) {
      logger.warn(`Failed to resolve location references: ${error.message}`);
      // Continue without resolved names - formatTourResult will use fallbacks
    }
  }
  
  return formatTourResult(product);
}

// ============================================================================
// FORMAT RESULT
// ============================================================================

function formatTourResult(product) {
  // Price extraction with multiple fallbacks
  let price = product.pricing?.summary?.fromPrice || 0;
  
  // Fallback to pricingInfo if pricing.summary is missing
  if (!price && product.pricingInfo) {
    // Try to get from ageBands (adult price)
    const adultBand = product.pricingInfo.ageBands?.find(b => 
      b.ageBand === 'ADULT' || b.ageBand === 'TRAVELER'
    );
    if (adultBand) {
      price = adultBand.prices?.[0]?.price || adultBand.retailPrice || 0;
    }
  }
  
  // Check for original price before discount (for special offers)
  const originalPrice = product.pricing?.summary?.fromPriceBeforeDiscount || null;
  const hasDiscount = originalPrice && originalPrice > price;

  // Determine pricing type - crucial for correct price display
  // Viator uses: TRAVELLER (per person), UNIT (per group/vehicle), etc.
  // If pricingUnit is UNIT or if it's a private tour, it's likely per-group pricing
  const pricingUnit = product.pricing?.summary?.pricingUnit || 
                      product.pricingInfo?.type || 
                      'TRAVELLER'; // Default to per-person
  
  // Also check if tour name suggests it's a private/group tour
  const title = (product.title || '').toLowerCase();
  const isPrivateTour = title.includes('private') || 
                        title.includes('per group') ||
                        title.includes('per vehicle') ||
                        title.includes('charter');
  
  // Determine if price is per person or per group
  const isPerPerson = pricingUnit === 'TRAVELLER' || 
                      pricingUnit === 'PER_PERSON' ||
                      pricingUnit === 'PERSON';
  const isPerGroup = pricingUnit === 'UNIT' || 
                     pricingUnit === 'PER_GROUP' ||
                     pricingUnit === 'GROUP' ||
                     pricingUnit === 'VEHICLE' ||
                     isPrivateTour;
  
  // Final pricing type: 'person' or 'group'
  const pricingType = isPerGroup ? 'group' : 'person';
  
  // Get max group size if available (for per-group pricing)
  const maxGroupSize = product.pricing?.summary?.paxRange?.max || 
                       product.pricingInfo?.groupPricing?.maxGroupSize ||
                       null;

  // Duration - handle various formats
  let duration = 'Varies';
  let durationMinutes = null;
  if (product.duration?.fixedDurationInMinutes) {
    durationMinutes = product.duration.fixedDurationInMinutes;
    const hours = Math.floor(durationMinutes / 60);
    const mins = durationMinutes % 60;
    if (hours === 0) duration = `${mins} minutes`;
    else if (mins === 0) duration = `${hours} hour${hours > 1 ? 's' : ''}`;
    else duration = `${hours}h ${mins}m`;
  } else if (product.duration?.variableDurationFromMinutes) {
    const fromMins = product.duration.variableDurationFromMinutes;
    const toMins = product.duration.variableDurationToMinutes;
    const fromHours = Math.floor(fromMins / 60);
    const toHours = Math.floor(toMins / 60);
    duration = `${fromHours}-${toHours} hours`;
    durationMinutes = fromMins;
  }

  const rating = product.reviews?.combinedAverageRating?.toFixed(1) || 'New';
  const reviewCount = product.reviews?.totalReviews || 0;

  // Get multiple images for gallery
  let images = [];
  
  // Try images array first (from search results)
  if (product.images && product.images.length > 0) {
    images = product.images.slice(0, 8).map(img => {
      // Handle different image formats
      if (typeof img === 'string') return img;
      
      // Find best variant (prefer medium size)
      const variant = img.variants?.find(v => v.width >= 400 && v.width <= 720) ||
                      img.variants?.find(v => v.width >= 200) ||
                      img.variants?.[img.variants.length - 1];
      return variant?.url || img.url;
    }).filter(Boolean);
  }
  
  // Fallback: try photoUrl or coverPhoto (some API responses use these)
  if (images.length === 0 && product.photoUrl) {
    images = [product.photoUrl];
  }
  if (images.length === 0 && product.coverPhoto?.url) {
    images = [product.coverPhoto.url];
  }
  
  // Log for debugging
  logger.debug(`Images extracted for ${product.productCode}: ${images.length} images`);
  
  const image = images[0] || null;

  const productCode = product.productCode;
  const bookingLink = product.productUrl || buildAffiliateLink(productCode);

  // Helper to safely extract string from potentially nested objects
  const extractString = (value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      // Handle {type, description} or {description} objects
      return value.description || value.otherDescription || value.typeDescription || value.name || value.type || JSON.stringify(value);
    }
    return String(value);
  };

  // Extract highlights/inclusions - handle nested objects
  const inclusions = product.inclusions?.map(i => {
    const desc = i.otherDescription || i.typeDescription || i.description || i;
    return extractString(desc);
  }).filter(Boolean) || [];
  
  const exclusions = product.exclusions?.map(e => {
    const desc = e.otherDescription || e.typeDescription || e.description || e;
    return extractString(desc);
  }).filter(Boolean) || [];
  
  // Extract itinerary/highlights
  // POI name can be in multiple places depending on the Viator response structure
  const itinerary = product.itinerary?.itineraryItems?.map(item => {
    const poiLocation = item.pointOfInterestLocation?.location;

    let poiName = null;
    
    // FIRST: Check for resolved location name (from /locations/bulk API call)
    if (item.resolvedLocation?.name) {
      poiName = item.resolvedLocation.name;
    }
    // SECOND: Check pointOfInterestLocation.name (also set by enhancement)
    else if (item.pointOfInterestLocation?.name) {
      poiName = typeof item.pointOfInterestLocation.name === 'string'
        ? item.pointOfInterestLocation.name
        : item.pointOfInterestLocation.name?.en || Object.values(item.pointOfInterestLocation.name)[0];
    }
    // THIRD: Check the nested location.name
    else if (poiLocation?.name) {
      poiName = typeof poiLocation.name === 'string'
        ? poiLocation.name
        : poiLocation.name?.en || poiLocation.name?.content || Object.values(poiLocation.name)[0];
    }

    // Check for attraction name directly on the location
    if (!poiName && poiLocation?.attractionName) {
      poiName = poiLocation.attractionName;
    }

    // Check for POI object directly on the item
    if (!poiName && item.poi?.name) {
      poiName = extractString(item.poi.name);
    }

    // Check for name directly on the item
    if (!poiName && item.name) {
      poiName = extractString(item.name);
    }

    // The description typically contains what you do there (e.g., "Pass By", "Stop At")
    const stopType = extractString(item.description) || '';

    // If we still don't have a POI name, try extracting from description
    if (!poiName) {
      const genericDescriptions = ['pass by', 'stop at', 'admission ticket', 'photo stop'];
      const descLower = stopType.toLowerCase();
      if (genericDescriptions.some(gd => descLower === gd || descLower.startsWith(gd + ':'))) {
        if (stopType.includes(':')) {
          poiName = stopType.split(':').slice(1).join(':').trim();
        }
      }
      if (!poiName && stopType.length > 20) {
        poiName = stopType;
      }
    }

    // NEVER use LOC-xxx ref as a name - skip those items or use description
    if (!poiName || poiName.startsWith('LOC-') || poiName.toLowerCase() === 'pass by' || poiName.toLowerCase() === 'stop at') {
      return null;
    }

    return {
      name: extractString(poiName),
      description: stopType || 'Visit',
      duration: item.duration?.fixedDurationInMinutes
    };
  }).filter(Boolean) || [];

  // Additional info - ensure all items are strings
  const additionalInfo = (product.additionalInfo || []).map(info => extractString(info)).filter(Boolean);
  
  // Extract highlights from viatorUniqueContent (Viator's curated highlights)
  const highlights = product.viatorUniqueContent?.highlights || [];
  
  // Also get insider tips if available
  const insiderTips = product.viatorUniqueContent?.insiderTips || null;
  
  const cancellationPolicy = product.cancellationPolicy?.type || null;
  
  // ========================================================================
  // DERIVE FLAGS from API response fields
  // The product details endpoint doesn't return flags directly, so we derive them
  // ========================================================================
  let derivedFlags = [];
  
  // FREE_CANCELLATION: cancellationPolicy.type is NOT 'ALL_SALES_FINAL'
  if (cancellationPolicy && cancellationPolicy !== 'ALL_SALES_FINAL') {
    derivedFlags.push('FREE_CANCELLATION');
  }
  
  // SKIP_THE_LINE: itinerary.skipTheLine is true
  if (product.itinerary?.skipTheLine === true) {
    derivedFlags.push('SKIP_THE_LINE');
  }
  
  // PRIVATE_TOUR: itinerary.privateTour is true OR title suggests private
  if (product.itinerary?.privateTour === true || isPrivateTour) {
    derivedFlags.push('PRIVATE_TOUR');
  }
  
  // SPECIAL_OFFER: has discount pricing
  if (hasDiscount) {
    derivedFlags.push('SPECIAL_OFFER');
  }
  
  // LIKELY_TO_SELL_OUT: check tags for 20757 or high review count with high rating
  const tags = product.tags || [];
  if (tags.includes(20757) || (reviewCount > 500 && parseFloat(rating) >= 4.5)) {
    derivedFlags.push('LIKELY_TO_SELL_OUT');
  }
  
  // Merge with any flags from search results (if present)
  const flags = [...new Set([...(product.flags || []), ...derivedFlags])];
  
  // Languages - handle potential object format
  const languages = product.languageGuides?.map(lg => {
    if (typeof lg === 'string') return lg;
    return lg.language || lg.name || extractString(lg);
  }).filter(Boolean) || [];

  return {
    id: productCode,
    name: product.title,
    description: product.description || '',
    duration,
    durationMinutes,
    rating,
    reviewCount,
    price,
    originalPrice,      // Original price before discount (null if no discount)
    hasDiscount,        // True if this tour has a special offer discount
    currency: 'USD',
    image,
    images,             // Array of image URLs for gallery
    flags,              // Derived flags array
    bookingLink,
    link: bookingLink,
    productCode,
    // Pricing type information
    pricingType,        // 'person' or 'group'
    pricingUnit,        // Raw value from API
    maxGroupSize,       // Max travelers for group pricing
    isPrivateTour,      // True if name suggests private tour
    // Additional details for modal
    highlights,         // From viatorUniqueContent.highlights
    insiderTips,        // From viatorUniqueContent.insiderTips
    inclusions,
    exclusions,
    itinerary,
    additionalInfo,
    cancellationPolicy,
    languages
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
    const destMap = getDestinationMap(allDestinations);
    
    // Strategy: Combine Viator freetext API with local cache search
    // This ensures we find multiple cities with the same name (Paris, France vs Paris, Texas)
    
    let apiResults = [];
    
    // Try the Viator freetext API first
    try {
      const response = await fetchWithTimeout(`${VIATOR_API_BASE}/search/freetext`, {
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
    // This catches cities the API might miss (like Paris, Texas)
    const searchLower = searchTerm.toLowerCase();
    
    const cacheResults = allDestinations
      .filter(d => {
        if (!d.name) return false;
        const nameLower = d.name.toLowerCase();
        // Match if name starts with search term or equals it exactly
        return nameLower.startsWith(searchLower) || nameLower === searchLower;
      })
      .map(d => {
        const nameLower = d.name.toLowerCase();
        let score = 0;
        
        // Exact match gets highest score
        if (nameLower === searchLower) score = 100;
        // Starts with search term
        else if (nameLower.startsWith(searchLower)) score = 80;
        
        // Boost cities over regions/countries
        if (d.type === 'CITY') score += 15;
        else if (d.type === 'REGION') score += 5;
        
        return { ...d, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 2) // Get extra for deduplication
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
    // Prefer API results, then add unique cache results
    const seenIds = new Set();
    const mergedResults = [];
    
    // Add API results first (higher quality matching)
    for (const result of apiResults) {
      if (!seenIds.has(result.destinationId)) {
        seenIds.add(result.destinationId);
        mergedResults.push(result);
      }
    }
    
    // Add cache results that weren't in API results
    for (const result of cacheResults) {
      if (!seenIds.has(result.destinationId) && mergedResults.length < limit) {
        seenIds.add(result.destinationId);
        mergedResults.push(result);
      }
    }
    
    // Remove the source field before returning
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
    const destMap = getDestinationMap(destinations);
    
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
// CACHE PRE-WARMING - Popular destinations to cache on startup
// ============================================================================

// Popular destinations to pre-warm (IDs are optional - will be looked up if missing)
const POPULAR_DESTINATIONS = [
  // Europe
  { id: 511, name: 'Rome' },
  { id: 737, name: 'Paris' },
  { id: 687, name: 'London' },
  { id: 546, name: 'Barcelona' },
  { id: 479, name: 'Amsterdam' },
  { id: 494, name: 'Florence' },
  { id: 760, name: 'Venice' },
  { id: 525, name: 'Dublin' },
  { id: 496, name: 'Lisbon' },
  { id: 538, name: 'Athens' },
  { name: 'Prague' },
  { name: 'Vienna' },
  { name: 'Santorini' },

  // United States
  { id: 684, name: 'New York City' },
  { id: 662, name: 'Las Vegas' },
  { id: 666, name: 'San Francisco' },
  { id: 721, name: 'Miami' },
  { id: 677, name: 'Los Angeles' },
  { id: 659, name: 'Honolulu' },
  { name: 'Chicago' },
  { name: 'Boston' },
  { name: 'New Orleans' },
  { name: 'Washington DC' },
  { name: 'Seattle' },
  { name: 'Orlando' },
  { name: 'San Diego' },
  { name: 'Nashville' },

  // Asia
  { id: 485, name: 'Tokyo' },
  { id: 495, name: 'Dubai' },
  { name: 'Bangkok' },
  { name: 'Singapore' },
  { name: 'Hong Kong' },
  { name: 'Seoul' },
  { name: 'Bali' },
  { name: 'Kyoto' },
  { name: 'Osaka' },
  { name: 'Taipei' },
  { name: 'Kuala Lumpur' },
  { name: 'Ho Chi Minh City' },
  { name: 'Phuket' },

  // Other popular
  { id: 618, name: 'Sydney' },
  { id: 561, name: 'Cancun' },
  { name: 'Cabo San Lucas' },
  { name: 'Reykjavik' },
  { name: 'Maui' }
];

/**
 * Pre-warm the tour cache with popular destinations
 * Call this on server startup for instant searches
 */
export async function warmTourCache() {
  logger.info(`Pre-warming tour cache with ${POPULAR_DESTINATIONS.length} popular destinations...`);

  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;

  // Process destinations sequentially to avoid overwhelming the API
  for (const dest of POPULAR_DESTINATIONS) {
    try {
      // Fetch and cache tours for this destination
      // If no ID provided, searchTours will look it up via autocomplete
      await searchTours({
        destination: dest.name,
        destinationId: dest.id?.toString(),
        resultCount: 30, // Smaller count for faster warming; users can fetch more on demand
        sortBy: 'popular'
      });

      successCount++;
      logger.info(`Warmed cache for ${dest.name} (${successCount}/${POPULAR_DESTINATIONS.length})`);

      // Small delay to be nice to the API
      await new Promise(resolve => setTimeout(resolve, 300));

    } catch (error) {
      failCount++;
      logger.warn(`Failed to warm cache for ${dest.name}: ${error.message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(`Cache warming complete: ${successCount} succeeded, ${failCount} failed in ${elapsed}s`);

  return { successCount, failCount, elapsed };
}

// ============================================================================
// ATTRACTIONS/LANDMARKS FUNCTIONS
// ============================================================================

/**
 * Search for attractions/landmarks in a destination
 * @param {number} destinationId - Viator destination ID
 * @param {object} options - Search options
 * @returns {Promise<object>} List of attractions with metadata
 */
export async function searchAttractions(destinationId, options = {}) {
  const {
    sort = 'DEFAULT', // 'DEFAULT', 'ALPHABETICAL', 'REVIEW_AVG_RATING'
    start = 1,
    count = 30
  } = options;

  // Check cache for first page
  if (start === 1 && sort === 'DEFAULT') {
    const cached = getCachedAttractions(destinationId);
    if (cached) {
      logger.info(`Returning cached attractions for destination ${destinationId}`);
      return cached;
    }
  }

  logger.info(`Searching attractions for destination: ${destinationId}`);

  const response = await fetchWithTimeout(`${VIATOR_API_BASE}/attractions/search`, {
    method: 'POST',
    headers: {
      'exp-api-key': API_KEY,
      'Accept': 'application/json;version=2.0',
      'Accept-Language': 'en-US',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      destinationId: parseInt(destinationId),
      sorting: { sort },
      pagination: { start, count }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`Attractions search error: ${response.status} - ${errorText}`);
    throw new Error(`Viator attractions API error: ${response.status}`);
  }

  const data = await response.json();

  const attractions = (data.attractions || []).map(attr => {
    // Get best image URL
    let imageUrl = null;
    if (attr.images && attr.images.length > 0) {
      const variants = attr.images[0].variants || [];
      const preferred = variants.find(v => v.width >= 300 && v.width <= 600);
      imageUrl = preferred?.url || variants[0]?.url || null;
    }

    return {
      attractionId: attr.attractionId,
      seoId: attr.seoId,
      name: attr.name,
      destinationId: attr.destinations?.[0]?.ref || destinationId,
      destinationName: attr.destinationName || null,
      productCount: attr.productsCount || attr.productCount || 0,
      rating: attr.reviews?.combinedAverageRating || null,
      reviewCount: attr.reviews?.totalReviews || 0,
      image: imageUrl
    };
  });

  const result = {
    attractions,
    totalCount: data.totalCount || attractions.length,
    hasMore: (start + count - 1) < (data.totalCount || 0)
  };

  // Cache first page
  if (start === 1 && sort === 'DEFAULT') {
    setCachedAttractions(destinationId, result);
  }

  logger.info(`Found ${attractions.length} attractions (total: ${data.totalCount})`);
  return result;
}

/**
 * Get detailed information about a specific attraction
 * @param {number} attractionId - The attraction ID
 * @returns {Promise<object>} Attraction details
 */
export async function getAttractionDetails(attractionId) {
  logger.info(`Fetching attraction details: ${attractionId}`);

  const response = await fetchWithTimeout(`${VIATOR_API_BASE}/attractions/${attractionId}`, {
    method: 'GET',
    headers: {
      'exp-api-key': API_KEY,
      'Accept': 'application/json;version=2.0',
      'Accept-Language': 'en-US'
    }
  });

  if (!response.ok) {
    throw new Error(`Viator attraction API error: ${response.status}`);
  }

  const attr = await response.json();

  const images = (attr.images || []).map(img => {
    const variants = img.variants || [];
    return {
      small: variants.find(v => v.width >= 200 && v.width < 400)?.url || variants[0]?.url,
      medium: variants.find(v => v.width >= 400 && v.width < 800)?.url || variants[0]?.url,
      large: variants.find(v => v.width >= 800)?.url || variants[0]?.url,
      caption: img.caption
    };
  }).filter(img => img.small || img.medium || img.large);

  return {
    attractionId: attr.attractionId,
    seoId: attr.seoId,
    name: attr.name,
    description: attr.overview || null,
    destinationName: attr.destinationName,
    productCount: attr.productsCount || 0,
    rating: attr.reviews?.combinedAverageRating || null,
    reviewCount: attr.reviews?.totalReviews || 0,
    image: images[0]?.medium || images[0]?.large || null,
    images,
    address: attr.address || null,
    location: attr.center ? {
      latitude: attr.center.latitude,
      longitude: attr.center.longitude
    } : null
  };
}

/**
 * Search tours by attraction/landmark using seoId
 * @param {number} attractionSeoId - The seoId from attractions search
 * @param {object} options - Search options
 * @returns {Promise<object>} List of tours
 */
export async function searchToursByAttraction(seoId, destinationId, options = {}) {
  const {
    start = 1,
    count = 50,
    sortBy = 'popular',
    flags = [],
    minPrice,
    maxPrice,
    minRating
  } = options;

  logger.info(`Searching tours for attraction seoId: ${seoId}, destinationId: ${destinationId}`);

  // Map sortBy to Viator sort
  const viatorSort = {
    popular: { sort: 'DEFAULT' },
    price_low: { sort: 'PRICE', order: 'ASCENDING' },
    price_high: { sort: 'PRICE', order: 'DESCENDING' },
    rating: { sort: 'REVIEW_AVG_RATING' },
    newest: { sort: 'DATE_ADDED', order: 'DESCENDING' }
  }[sortBy] || { sort: 'DEFAULT' };

  const body = {
    filtering: {
      destination: parseInt(destinationId),
      seoId: parseInt(seoId)  // Viator API expects seoId, not attractionId
    },
    sorting: viatorSort,
    pagination: { start, count },
    currency: 'USD'
  };

  if (flags.length > 0) body.filtering.flags = flags;
  if (minPrice !== undefined) body.filtering.lowestPrice = parseFloat(minPrice);
  if (maxPrice !== undefined) body.filtering.highestPrice = parseFloat(maxPrice);
  if (minRating !== undefined) body.filtering.rating = { from: parseFloat(minRating) };

  const response = await fetchWithTimeout(`${VIATOR_API_BASE}/products/search`, {
    method: 'POST',
    headers: {
      'exp-api-key': API_KEY,
      'Accept': 'application/json;version=2.0',
      'Accept-Language': 'en-US',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`Tour search by attraction error: ${response.status} - ${errorText}`);
    throw new Error(`Viator API error: ${response.status}`);
  }

  const data = await response.json();

  // Use existing formatTourResult function
  const tours = (data.products || []).map(p => formatTourResult(p));

  logger.info(`Found ${tours.length} tours for seoId ${seoId}`);

  return {
    tours,
    totalCount: data.totalCount || tours.length,
    hasMore: (start + count - 1) < (data.totalCount || 0)
  };
}

/**
 * Combined autocomplete for both destinations and attractions
 * @param {string} searchTerm - The search term
 * @param {number} limit - Max results per type
 * @returns {Promise<object>} { destinations, attractions }
 */
export async function combinedAutocomplete(searchTerm, limit = 8) {
  if (!searchTerm || searchTerm.length < 2) {
    return { destinations: [], attractions: [] };
  }

  logger.info(`Combined autocomplete for: "${searchTerm}"`);

  const response = await fetchWithTimeout(`${VIATOR_API_BASE}/search/freetext`, {
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
        { searchType: 'DESTINATIONS', pagination: { start: 1, count: limit } },
        { searchType: 'ATTRACTIONS', pagination: { start: 1, count: limit } }
      ],
      currency: 'USD'
    })
  });

  if (!response.ok) {
    logger.warn(`Combined autocomplete failed: ${response.status}`);
    return { destinations: [], attractions: [] };
  }

  const data = await response.json();

  // Transform destinations
  const destinations = (data.destinations?.results || []).map(d => ({
    destinationId: (d.id || d.destinationId)?.toString(),
    name: d.name || d.destinationName,
    type: d.type || 'DESTINATION',
    parentName: d.parentDestinationName || null,
    displayName: d.parentDestinationName
      ? `${d.name}, ${d.parentDestinationName}`
      : d.name,
    resultType: 'destination'
  }));

  // Transform attractions
  const attractions = (data.attractions?.results || []).map(attr => ({
    attractionId: attr.attractionId,
    seoId: attr.seoId,
    name: attr.name,
    destinationName: attr.destinationName || null,
    productCount: attr.productsCount || 0,
    displayName: attr.destinationName
      ? `${attr.name}, ${attr.destinationName}`
      : attr.name,
    resultType: 'attraction'
  }));

  logger.info(`Combined autocomplete: ${destinations.length} destinations, ${attractions.length} attractions`);

  return { destinations, attractions };
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
  searchDestinationsAutocomplete,
  searchAttractions,
  getAttractionDetails,
  searchToursByAttraction,
  combinedAutocomplete
};
