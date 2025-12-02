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

export async function findDestination(query) {
  try {
    const destinations = await fetchDestinations();
    const normalizedQuery = query.toLowerCase().trim();
    
    logger.info(`Looking up destination: "${query}" (normalized: "${normalizedQuery}") in ${destinations.length} destinations`);

    // Debug: Show sample of destination structure
    if (destinations.length > 0) {
      logger.info(`Sample destination structure: ${JSON.stringify(destinations[0])}`);
    }
    
    // Debug: Find any destinations containing the query
    const partialMatches = destinations.filter(dest => {
      const name = (dest.destinationName || dest.name || '').toLowerCase();
      return name.includes(normalizedQuery);
    });
    
    if (partialMatches.length > 0) {
      logger.info(`Found ${partialMatches.length} partial matches for "${normalizedQuery}": ${partialMatches.slice(0, 5).map(d => d.destinationName || d.name).join(', ')}`);
    } else {
      // Try searching in other fields
      const altMatches = destinations.filter(dest => {
        return JSON.stringify(dest).toLowerCase().includes(normalizedQuery);
      });
      if (altMatches.length > 0) {
        logger.info(`Found ${altMatches.length} matches in other fields: ${JSON.stringify(altMatches[0])}`);
      }
    }

    // Try exact match first
    let match = destinations.find(dest => {
      const name = (dest.destinationName || dest.name || '').toLowerCase();
      return name === normalizedQuery;
    });

    // Try includes match (only if destination name contains the query)
    if (!match) {
      match = destinations.find(dest => {
        const name = (dest.destinationName || dest.name || '').toLowerCase();
        return name.includes(normalizedQuery);
      });
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

    logger.warn(`No destination found for query: "${query}"`);
    return null;
  } catch (error) {
    logger.error('Destination lookup error:', error.message);
    return null;
  }
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
 * @param {string} params.startDate - Optional start date
 * @param {string} params.endDate - Optional end date
 */
export async function searchTours({ 
  destination, 
  searchTerms = '', 
  resultCount = 10,
  startDate, 
  endDate 
}) {
  if (!API_KEY) {
    throw new Error('VIATOR_API_KEY not configured');
  }

  logger.info(`Searching tours: ${destination}, terms: "${searchTerms}", count: ${resultCount}`);

  try {
    // If search terms provided, use freetext search
    if (searchTerms && searchTerms.trim()) {
      return await searchToursWithTerms(destination, searchTerms, resultCount);
    }

    // Otherwise, use destination-based search
    const destInfo = await findDestination(destination);
    if (!destInfo) {
      logger.warn(`Destination not found: ${destination}, trying freetext`);
      return await searchToursWithTerms(destination, '', resultCount);
    }

    logger.info(`Using destination ID ${destInfo.id} (${destInfo.name}) for search`);

    const searchBody = {
      filtering: {
        destination: destInfo.id
      },
      sorting: {
        sort: 'TRAVELER_RATING',
        order: 'DESCENDING'
      },
      pagination: {
        start: 1,
        count: Math.min(resultCount, 20)
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
    const products = data.products || [];

    logger.info(`Found ${products.length} tours for ${destination}`);
    return products.map(p => formatTourResult(p));

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
// SEARCH BY DESTINATION ID (Fallback with optional filtering)
// ============================================================================

async function searchByDestinationId(destination, resultCount, filterTerms = '') {
  const destInfo = await findDestination(destination);
  
  if (!destInfo) {
    logger.warn(`Destination not found for fallback: ${destination}`);
    return [];
  }

  // Get tags from search terms for API-level filtering
  const tags = getTagsFromSearchTerms(filterTerms);
  
  logger.info(`Fallback: Using destination ID ${destInfo.id} (${destInfo.name})${filterTerms ? ` with filter: "${filterTerms}"` : ''}${tags.length ? ` (tags: ${tags.join(', ')})` : ''}`);

  // Build the search body with tag filtering if available
  const searchBody = {
    filtering: {
      destination: destInfo.id
    },
    sorting: {
      sort: 'TRAVELER_RATING',
      order: 'DESCENDING'
    },
    pagination: {
      start: 1,
      count: Math.min(resultCount * 2, 30) // Fetch extra in case some don't match
    },
    currency: 'USD'
  };

  // Add tag filtering if we have matching tags
  if (tags.length > 0) {
    searchBody.filtering.tags = tags;
    logger.info(`Using API tag filter: [${tags.join(', ')}]`);
  }

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
      sorting: {
        sort: 'TRAVELER_RATING',
        order: 'DESCENDING'
      },
      pagination: {
        start: 1,
        count: Math.min(resultCount * 5, 50)
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
