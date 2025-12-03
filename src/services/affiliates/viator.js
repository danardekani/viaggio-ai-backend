// ============================================================================
// VIATOR AFFILIATE API SERVICE
// ============================================================================

import { logger } from '../../utils/logger.js';

const VIATOR_API_BASE = 'https://api.viator.com/partner';
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
// FIND DESTINATION
// ============================================================================

// Fallback mapping for smaller destinations to larger nearby areas
const REGIONAL_FALLBACKS = {
  // New York State
  'lake placid': 'Adirondacks',
  'adirondacks': 'New York State',
  'saratoga springs': 'Albany',
  'cooperstown': 'New York State',
  'finger lakes': 'New York State',
  'ithaca': 'New York State',
  'catskills': 'New York State',
  'hudson valley': 'New York State',
  
  // Maine
  'portland, me': 'Portland',
  'portland maine': 'Portland',
  'bar harbor': 'Acadia National Park',
  'acadia': 'Acadia National Park',
  'kennebunkport': 'Maine',
  'ogunquit': 'Maine',
  'camden': 'Maine',
  
  // Vermont
  'burlington': 'Vermont',
  'stowe': 'Vermont',
  'killington': 'Vermont',
  'woodstock': 'Vermont',
  
  // New Hampshire
  'white mountains': 'New Hampshire',
  'north conway': 'New Hampshire',
  'portsmouth': 'New Hampshire',
  
  // Other Northeast
  'cape cod': 'Massachusetts',
  'martha\'s vineyard': 'Massachusetts',
  'nantucket': 'Massachusetts',
  'berkshires': 'Massachusetts',
  'newport': 'Rhode Island',
  'providence': 'Rhode Island',
  
  // California
  'napa': 'Napa Valley',
  'sonoma': 'Napa Valley',
  'carmel': 'Monterey',
  'big sur': 'Monterey',
  'lake tahoe': 'Lake Tahoe',
  'palm springs': 'Palm Springs',
  'santa barbara': 'Santa Barbara',
  
  // Florida
  'key west': 'Key West',
  'fort lauderdale': 'Fort Lauderdale',
  'naples': 'Naples',
  'sarasota': 'Sarasota',
  'clearwater': 'Tampa',
  'st augustine': 'St. Augustine',
  
  // Southwest
  'sedona': 'Sedona',
  'scottsdale': 'Phoenix',
  'santa fe': 'Santa Fe',
  'taos': 'Santa Fe',
  'moab': 'Moab',
  'park city': 'Salt Lake City',
  
  // Pacific Northwest  
  'bend': 'Oregon',
  'olympic national park': 'Seattle',
  'mt rainier': 'Seattle',
  
  // Southeast
  'asheville': 'Asheville',
  'charleston': 'Charleston',
  'savannah': 'Savannah',
  'hilton head': 'Savannah',
  'outer banks': 'North Carolina',
  
  // Other
  'jackson hole': 'Jackson Hole',
  'yellowstone': 'Yellowstone National Park',
  'grand canyon': 'Grand Canyon National Park',
  'zion': 'Zion National Park',
  'yosemite': 'Yosemite National Park',
  'glacier': 'Glacier National Park'
};

// State abbreviations to full names
const STATE_ABBREVS = {
  'al': 'alabama', 'ak': 'alaska', 'az': 'arizona', 'ar': 'arkansas',
  'ca': 'california', 'co': 'colorado', 'ct': 'connecticut', 'de': 'delaware',
  'fl': 'florida', 'ga': 'georgia', 'hi': 'hawaii', 'id': 'idaho',
  'il': 'illinois', 'in': 'indiana', 'ia': 'iowa', 'ks': 'kansas',
  'ky': 'kentucky', 'la': 'louisiana', 'me': 'maine', 'md': 'maryland',
  'ma': 'massachusetts', 'mi': 'michigan', 'mn': 'minnesota', 'ms': 'mississippi',
  'mo': 'missouri', 'mt': 'montana', 'ne': 'nebraska', 'nv': 'nevada',
  'nh': 'new hampshire', 'nj': 'new jersey', 'nm': 'new mexico', 'ny': 'new york',
  'nc': 'north carolina', 'nd': 'north dakota', 'oh': 'ohio', 'ok': 'oklahoma',
  'or': 'oregon', 'pa': 'pennsylvania', 'ri': 'rhode island', 'sc': 'south carolina',
  'sd': 'south dakota', 'tn': 'tennessee', 'tx': 'texas', 'ut': 'utah',
  'vt': 'vermont', 'va': 'virginia', 'wa': 'washington', 'wv': 'west virginia',
  'wi': 'wisconsin', 'wy': 'wyoming', 'dc': 'washington dc'
};

// Clean destination name - remove state abbreviations, normalize
function cleanDestinationName(query) {
  let cleaned = query.trim();
  
  // Remove state abbreviations like ", ME" or ", CA"
  cleaned = cleaned.replace(/,\s*([a-z]{2})$/i, (match, abbrev) => {
    const state = STATE_ABBREVS[abbrev.toLowerCase()];
    logger.info(`Stripped state abbreviation: "${match}" (${state || 'unknown'})`);
    return '';
  });
  
  // Remove full state names after comma
  cleaned = cleaned.replace(/,\s*(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)$/i, '');
  
  return cleaned.trim();
}

export async function findDestination(query) {
  try {
    const destinations = await fetchDestinations();
    const cleanedQuery = cleanDestinationName(query);
    const normalizedQuery = cleanedQuery.toLowerCase().trim();
    
    logger.info(`Looking up destination: "${query}" -> cleaned: "${cleanedQuery}" -> normalized: "${normalizedQuery}"`);

    // Debug: Show sample of destination structure
    if (destinations.length > 0 && !destinationsCache) {
      logger.info(`Sample destination structure: ${JSON.stringify(destinations[0])}`);
    }
    
    // Try to find the destination
    let match = findDestinationMatch(destinations, normalizedQuery);
    
    // If no match, try regional fallback
    if (!match && REGIONAL_FALLBACKS[normalizedQuery]) {
      const fallbackName = REGIONAL_FALLBACKS[normalizedQuery];
      logger.info(`No match for "${normalizedQuery}", trying regional fallback: "${fallbackName}"`);
      match = findDestinationMatch(destinations, fallbackName.toLowerCase());
    }
    
    // If still no match, try just the first word (for "Lake Placid" -> "Lake")
    if (!match && normalizedQuery.includes(' ')) {
      const firstWord = normalizedQuery.split(' ')[0];
      if (firstWord.length > 3) {
        logger.info(`Trying first word fallback: "${firstWord}"`);
        match = findDestinationMatch(destinations, firstWord);
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

    // Log helpful debugging info
    logger.warn(`No destination found for: "${query}"`);
    logger.info(`Try checking Viator directly for available tours in this area`);
    
    return null;
  } catch (error) {
    logger.error('Destination lookup error:', error.message);
    return null;
  }
}

// Helper function to find destination match
function findDestinationMatch(destinations, query) {
  // Try exact match first
  let match = destinations.find(dest => {
    const name = (dest.destinationName || dest.name || '').toLowerCase();
    return name === query;
  });

  // Try includes match (destination name contains the query)
  if (!match) {
    match = destinations.find(dest => {
      const name = (dest.destinationName || dest.name || '').toLowerCase();
      return name.includes(query);
    });
  }
  
  // Try query contains destination name (e.g., "portland maine" includes "portland")
  if (!match) {
    match = destinations.find(dest => {
      const name = (dest.destinationName || dest.name || '').toLowerCase();
      return query.includes(name) && name.length > 3;
    });
  }

  return match;
}

// ============================================================================
// SEARCH TOURS
// ============================================================================

/**
 * Search for tours with optional filtering
 * @param {Object} params
 * @param {string} params.destination - City name
 * @param {string} params.searchTerms - Keywords to filter by (e.g., "food brewery")
 * @param {number} params.resultCount - Number of results (default 10, max 20)
 * @param {string} params.sortBy - Sort option: 'popular', 'rating', 'reviews', 'price_low', 'price_high', 'newest'
 * @param {string} params.startDate - Optional start date
 * @param {string} params.endDate - Optional end date
 */
export async function searchTours({ 
  destination, 
  searchTerms = '', 
  resultCount = 10,
  sortBy = 'popular',
  startDate, 
  endDate 
}) {
  if (!API_KEY) {
    throw new Error('VIATOR_API_KEY not configured');
  }

  logger.info(`Searching tours: ${destination}, terms: "${searchTerms}", count: ${resultCount}, sort: ${sortBy}, dates: ${startDate || 'none'} to ${endDate || 'none'}`);

  try {
    // Check if we have tags for the search terms
    const tags = getTagsFromSearchTerms(searchTerms);
    
    // For "reviews" sort, we need to fetch more and sort client-side
    const needsClientSort = sortBy === 'reviews';
    const fetchCount = needsClientSort ? 50 : Math.min(resultCount * 2, 30);
    
    // Get Viator sort option
    const viatorSort = getViatorSort(sortBy);
    
    // If we have tags or need special sorting, use tag-based search
    if (tags.length > 0 || searchTerms) {
      logger.info(`Using tag-based search for "${searchTerms}" with tags [${tags.join(', ')}]`);
      return await searchByDestinationId(destination, resultCount, searchTerms, sortBy, startDate, endDate);
    }

    // Otherwise, use destination-based search
    const destInfo = await findDestination(destination);
    if (!destInfo) {
      logger.warn(`Destination not found: ${destination}, trying tag-based search`);
      return await searchByDestinationId(destination, resultCount, '', sortBy, startDate, endDate);
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

    if (startDate) searchBody.filtering.startDate = startDate;
    if (endDate) searchBody.filtering.endDate = endDate;

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
        const reviewsA = a.reviews?.totalReviews || a.reviewCount || 0;
        const reviewsB = b.reviews?.totalReviews || b.reviewCount || 0;
        return reviewsB - reviewsA; // Descending
      });
      logger.info(`Sorted by review count (top: ${products[0]?.reviews?.totalReviews || products[0]?.reviewCount || 0} reviews)`);
    }
    
    return products.slice(0, resultCount).map(p => formatTourResult(p));

  } catch (error) {
    logger.error('Tour search error:', error.message);
    throw error;
  }
}

// ============================================================================
// SEARCH WITH TERMS (Freetext)
// ============================================================================

async function searchToursWithTerms(destination, searchTerms, resultCount) {
  // Use only first 2 search terms to avoid over-filtering
  const terms = searchTerms.split(' ').slice(0, 2).join(' ');
  const query = terms 
    ? `${destination} ${terms}`.trim()
    : destination;

  logger.info(`Freetext search: "${query}"`);

  const response = await fetch(`${VIATOR_API_BASE}/search/freetext`, {
    method: 'POST',
    headers: {
      'exp-api-key': API_KEY,
      'Accept': 'application/json;version=2.0',
      'Accept-Language': 'en-US',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      searchTerm: query,
      searchTypes: [{
        searchType: 'PRODUCTS',
        pagination: {
          start: 1,
          count: Math.min(resultCount, 20)
        }
      }],
      currency: 'USD'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`Viator freetext error: ${response.status} - ${errorText}`);
    throw new Error(`Viator API error: ${response.status}`);
  }

  const data = await response.json();
  
  // Log the response structure to understand it
  logger.info(`Freetext response keys: ${Object.keys(data).join(', ')}`);
  
  // Freetext returns products nested under searchTypes
  let products = [];
  
  if (data.products && Array.isArray(data.products)) {
    // Direct products array
    products = data.products;
  } else if (data.searchTypes && Array.isArray(data.searchTypes)) {
    // Nested under searchTypes
    const productsResult = data.searchTypes.find(t => t.searchType === 'PRODUCTS');
    if (productsResult?.products && Array.isArray(productsResult.products)) {
      products = productsResult.products;
    }
  } else if (data.data && Array.isArray(data.data)) {
    // Under data key
    products = data.data;
  }

  logger.info(`Freetext found ${products.length} tours for "${query}"`);
  
  // If no results with search terms, fall back to destination-based search with filtering
  if (products.length === 0 && terms) {
    logger.info(`No freetext results, falling back to destination ID search for: "${destination}" with filter: "${terms}"`);
    return await searchByDestinationId(destination, resultCount, terms);
  }
  
  return products.map(p => formatTourResult(p));
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
    'newest': { sort: 'NEW_ON_VIATOR', order: 'ASCENDING' }
  };
  return sortMap[sortBy] || { sort: 'DEFAULT' };
}

// ============================================================================
// SEARCH BY DESTINATION ID (Fallback with optional filtering)
// ============================================================================

async function searchByDestinationId(destination, resultCount, filterTerms = '', sortBy = 'popular', startDate = null, endDate = null) {
  const destInfo = await findDestination(destination);
  
  if (!destInfo) {
    logger.warn(`Destination not found for fallback: ${destination}`);
    return [];
  }

  // Get tags from search terms for API-level filtering
  const tags = getTagsFromSearchTerms(filterTerms);
  
  // For "reviews" sort, we need to fetch more and sort client-side
  const needsClientSort = sortBy === 'reviews';
  const fetchCount = needsClientSort ? 50 : Math.min(resultCount * 2, 30);
  
  const viatorSort = getViatorSort(sortBy);
  
  logger.info(`Fallback: destination=${destInfo.id} (${destInfo.name}), filter="${filterTerms}", tags=[${tags.join(',')}], sort=${sortBy}, dates=${startDate || 'none'} to ${endDate || 'none'}`);

  // Build the search body with tag filtering if available
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

  // Add tag filtering if we have matching tags
  if (tags.length > 0) {
    searchBody.filtering.tags = tags;
    logger.info(`Using API tag filter: [${tags.join(', ')}]`);
  }

  // Add date filtering
  if (startDate) searchBody.filtering.startDate = startDate;
  if (endDate) searchBody.filtering.endDate = endDate;

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
      
      // Match if ANY filter word is found in title or description
      return filterWords.some(word => searchText.includes(word));
    });

    logger.info(`Client-side filtered ${products.length} tours down to ${filteredProducts.length} matching "${filterTerms}"`);

    // Use filtered results if we found matches
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
      return reviewsB - reviewsA; // Descending
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
    description: truncateText(product.description, 200),
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
// EXPORTS
// ============================================================================

export { fetchDestinations };

export default {
  searchTours,
  getTourDetails,
  findDestination,
  fetchDestinations
};
