// ============================================================================
// VIATOR AFFILIATE API SERVICE
// ============================================================================
// Fetches real tour and activity data from Viator Partner API
// All booking links include affiliate tracking for commission
// ============================================================================

import { logger } from '../../utils/logger.js';

// Viator Partner API base URL
const VIATOR_API_BASE = 'https://api.viator.com/partner';

// Your affiliate credentials (from environment variables)
const API_KEY = process.env.VIATOR_API_KEY;
const AFFILIATE_ID = process.env.VIATOR_AFFILIATE_ID;

// Cache for destinations (so we don't fetch every time)
let destinationsCache = null;
let destinationsCacheTime = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================================
// FETCH DESTINATIONS
// ============================================================================

/**
 * Fetch all destinations from Viator API
 * Results are cached for 24 hours
 */
async function fetchDestinations() {
  // Return cached if still valid
  if (destinationsCache && destinationsCacheTime && 
      (Date.now() - destinationsCacheTime) < CACHE_DURATION) {
    logger.info(`Using cached destinations (${destinationsCache.length} destinations)`);
    return destinationsCache;
  }

  logger.info('Fetching destinations from Viator API...');

  try {
    const response = await fetch(`${VIATOR_API_BASE}/destinations`, {
      method: 'GET',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-US'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Viator destinations error: ${response.status} - ${errorText}`);
      throw new Error(`Viator API error: ${response.status}`);
    }

    const data = await response.json();
    const destinations = data.destinations || data.data || data || [];
    
    logger.info(`Fetched ${destinations.length} destinations from Viator`);

    // Cache the results
    destinationsCache = destinations;
    destinationsCacheTime = Date.now();

    return destinations;

  } catch (error) {
    logger.error('Failed to fetch destinations:', error.message);
    throw error;
  }
}

// ============================================================================
// DESTINATION LOOKUP
// ============================================================================

/**
 * Find destination ID by city/region name
 * @param {string} query - City or region name (e.g., "Florence", "Paris")
 * @returns {Object|null} Destination object with id and name, or null
 */
async function findDestination(query) {
  try {
    const destinations = await fetchDestinations();
    const normalizedQuery = query.toLowerCase().trim();

    // Try exact match first
    let match = destinations.find(dest => {
      const name = (dest.destinationName || dest.name || '').toLowerCase();
      return name === normalizedQuery;
    });

    // Try includes match
    if (!match) {
      match = destinations.find(dest => {
        const name = (dest.destinationName || dest.name || '').toLowerCase();
        return name.includes(normalizedQuery) || normalizedQuery.includes(name);
      });
    }

    if (match) {
      const destId = match.destinationId || match.id;
      const destName = match.destinationName || match.name;
      logger.info(`Found destination: ${destName} (ID: ${destId})`);
      return {
        id: destId.toString(),
        name: destName
      };
    }

    logger.warn(`Destination not found: ${query}`);
    return null;

  } catch (error) {
    logger.error('Destination lookup error:', error.message);
    return null;
  }
}

// ============================================================================
// PRODUCT (TOUR) SEARCH
// ============================================================================

/**
 * Search for tours and activities at a destination
 * @param {Object} params - Search parameters
 * @param {string} params.destination - Destination name (e.g., "Florence")
 * @param {string} params.startDate - Start date (YYYY-MM-DD)
 * @param {string} params.endDate - End date (YYYY-MM-DD)
 * @param {number} params.adults - Number of adults (default: 2)
 * @returns {Array} List of tours with affiliate booking links
 */
export async function searchTours({ destination, startDate, endDate, adults = 2 }) {
  const maskedKey = API_KEY ? `${API_KEY.substring(0, 8)}...` : 'UNDEFINED';
  logger.info(`Viator search - Destination: ${destination}, API Key: ${maskedKey}`);
  
  if (!API_KEY) {
    logger.error('VIATOR_API_KEY environment variable is not set!');
    throw new Error('Viator API key not configured');
  }

  try {
    // Find destination ID dynamically
    const destInfo = await findDestination(destination);
    
    if (!destInfo) {
      logger.warn(`Destination not found, trying freetext search for: ${destination}`);
      return await searchToursFreetxt(destination);
    }

    // Build request body
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
        count: 20
      },
      currency: 'USD'
    };

    // Add date filtering if dates provided
    if (startDate) {
      searchBody.filtering.startDate = startDate;
    }
    if (endDate) {
      searchBody.filtering.endDate = endDate;
    }

    const url = `${VIATOR_API_BASE}/products/search`;
    logger.info(`Calling Viator: ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(searchBody)
    });

    logger.info(`Viator response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Viator error: ${response.status} - ${errorText}`);
      throw new Error(`Viator API error: ${response.status}`);
    }

    const data = await response.json();
    const products = data.products || [];
    
    logger.info(`Found ${products.length} tours for ${destination}`);

    return products.map(product => formatTourResult(product, destination));

  } catch (error) {
    logger.error('Viator tour search error:', error.message);
    throw error;
  }
}

// ============================================================================
// FREETEXT SEARCH (Fallback)
// ============================================================================

/**
 * Search for tours using freetext query (when destination ID not found)
 */
export async function searchToursFreetxt(query) {
  try {
    logger.info(`Freetext search for: ${query}`);

    const url = `${VIATOR_API_BASE}/search/freetext`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        searchTerm: query + ' tours',
        currency: 'USD',
        pagination: {
          start: 1,
          count: 20
        }
      })
    });

    logger.info(`Viator freetext response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Viator freetext error: ${response.status} - ${errorText}`);
      throw new Error(`Viator API error: ${response.status}`);
    }

    const data = await response.json();
    const products = data.products || [];
    
    logger.info(`Freetext found ${products.length} tours`);

    return products.map(product => formatTourResult(product, query));

  } catch (error) {
    logger.error('Viator freetext search error:', error.message);
    throw error;
  }
}

// ============================================================================
// GET PRODUCT DETAILS
// ============================================================================

/**
 * Get detailed information about a specific tour
 * @param {string} productCode - Viator product code
 * @returns {Object} Detailed product information
 */
export async function getTourDetails(productCode) {
  try {
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
    return formatTourResult(product, null);

  } catch (error) {
    logger.error('Viator product details error:', error);
    throw error;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format a Viator product into our standard tour format
 */
function formatTourResult(product, destination) {
  // Extract pricing
  const price = product.pricing?.summary?.fromPrice || 
                product.pricing?.fromPrice ||
                0;

  // Extract duration
  let duration = 'Varies';
  if (product.duration?.fixedDurationInMinutes) {
    const hours = Math.floor(product.duration.fixedDurationInMinutes / 60);
    const mins = product.duration.fixedDurationInMinutes % 60;
    if (hours === 0) {
      duration = `${mins} minutes`;
    } else if (mins === 0) {
      duration = `${hours} hours`;
    } else {
      duration = `${hours}h ${mins}m`;
    }
  } else if (product.duration?.variableDurationFromMinutes) {
    const fromHours = Math.round(product.duration.variableDurationFromMinutes / 60);
    const toHours = Math.round(product.duration.variableDurationToMinutes / 60);
    duration = `${fromHours}-${toHours} hours`;
  }

  // Extract rating
  const rating = product.reviews?.combinedAverageRating?.toFixed(1) || 'New';
  const reviewCount = product.reviews?.totalReviews || 0;

  // Get image URL - find a good size
  let image = null;
  if (product.images && product.images.length > 0) {
    const img = product.images[0];
    if (img.variants && img.variants.length > 0) {
      // Find image around 480px wide
      const variant = img.variants.find(v => v.width >= 400 && v.width <= 720) || 
                      img.variants[img.variants.length - 1];
      image = variant?.url;
    }
  }

  // Get product code
  const productCode = product.productCode;

  // Use the productUrl from API (already has affiliate tracking!) or build our own
  const bookingLink = product.productUrl || buildAffiliateLink(productCode);

  return {
    id: productCode,
    name: product.title,
    description: truncateText(product.description, 200),
    duration: duration,
    rating: rating,
    reviewCount: reviewCount,
    price: price,
    currency: 'USD',
    image: image,
    date: 'Flexible',
    time: 'Various times available',
    flags: product.flags || [],
    
    // Booking link with affiliate tracking
    bookingLink: bookingLink,
    link: bookingLink,
    
    productCode: productCode
  };
}

/**
 * Build a Viator affiliate tracking link
 */
function buildAffiliateLink(productCode) {
  const baseUrl = `https://www.viator.com/tours/${productCode}`;
  const params = new URLSearchParams({
    pid: AFFILIATE_ID || 'P00278785',
    mcid: '42383',
    medium: 'api',
    api_version: '2.0'
  });
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Truncate text to a maximum length
 */
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}

// ============================================================================
// EXPORTS
// ============================================================================

export { findDestination, fetchDestinations };

export default {
  searchTours,
  searchToursFreetxt,
  getTourDetails,
  findDestination,
  fetchDestinations
};