// ============================================================================
// VIATOR AFFILIATE API SERVICE
// ============================================================================

import { logger } from '../../utils/logger.js';

const VIATOR_API_BASE = 'https://api.viator.com/partner';
const API_KEY = process.env.VIATOR_API_KEY;
const AFFILIATE_ID = process.env.VIATOR_AFFILIATE_ID;

// Cache for destinations
let destinationsCache = null;
let destinationsCacheTime = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================================
// FETCH DESTINATIONS
// ============================================================================

async function fetchDestinations() {
  if (destinationsCache && destinationsCacheTime && 
      (Date.now() - destinationsCacheTime) < CACHE_DURATION) {
    return destinationsCache;
  }

  logger.info('Fetching destinations from Viator...');

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

    // Try exact match first
    let match = destinations.find(dest => {
      const name = (dest.destinationName || '').toLowerCase();
      return name === normalizedQuery;
    });

    // Try includes match
    if (!match) {
      match = destinations.find(dest => {
        const name = (dest.destinationName || '').toLowerCase();
        return name.includes(normalizedQuery) || normalizedQuery.includes(name);
      });
    }

    if (match) {
      return {
        id: match.destinationId.toString(),
        name: match.destinationName
      };
    }

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
  
  // If no results with search terms, try just the destination
  if (products.length === 0 && terms) {
    logger.info(`No results with terms, trying destination only: "${destination}"`);
    return await searchToursWithTerms(destination, '', resultCount);
  }
  
  return products.map(p => formatTourResult(p));
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
