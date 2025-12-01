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

// ============================================================================
// DESTINATION SEARCH
// ============================================================================

/**
 * Search for a destination to get its ID
 * @param {string} query - City or region name (e.g., "Florence", "Paris")
 * @returns {Object} Destination details including destId
 */
export async function searchDestination(query) {
  // Debug: Log what we're working with
  const maskedKey = API_KEY ? `${API_KEY.substring(0, 8)}...${API_KEY.substring(API_KEY.length - 4)}` : 'UNDEFINED';
  logger.info(`Viator API Key (masked): ${maskedKey}`);
  
  if (!API_KEY) {
    logger.error('VIATOR_API_KEY environment variable is not set!');
    throw new Error('Viator API key not configured');
  }

  const url = `${VIATOR_API_BASE}/destinations`;
  logger.info(`Calling Viator destinations: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json',
        'Accept-Language': 'en-US'
      }
    });

    logger.info(`Viator destinations response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Viator destinations error: ${response.status} - ${errorText}`);
      throw new Error(`Viator API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Handle different response formats
    const destinations = data.destinations || data.data || data || [];
    logger.info(`Viator returned ${Array.isArray(destinations) ? destinations.length : 'unknown'} destinations`);
    
    if (!Array.isArray(destinations)) {
      logger.error('Unexpected destinations format:', JSON.stringify(data).substring(0, 200));
      throw new Error('Unexpected API response format');
    }

    // Find matching destination
    const match = destinations.find(dest => {
      const name = dest.destinationName || dest.name || '';
      return name.toLowerCase().includes(query.toLowerCase());
    });

    if (!match) {
      logger.warn(`Destination not found: ${query}`);
      return null;
    }

    const destId = match.destinationId || match.id;
    const destName = match.destinationName || match.name;
    
    logger.info(`Found destination: ${destName} (ID: ${destId})`);

    return {
      destId: destId,
      name: destName,
      type: match.destinationType || match.type
    };

  } catch (error) {
    logger.error('Viator destination search error:', error.message);
    throw error;
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
  try {
    logger.info(`Starting tour search for: ${destination}`);
    
    // First, get the destination ID
    const destInfo = await searchDestination(destination);
    
    if (!destInfo) {
      logger.warn(`No destination found for: ${destination}`);
      return [];
    }

    // Search for products at this destination
    const searchBody = {
      filtering: {
        destination: destInfo.destId.toString()
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
    logger.info(`Calling Viator products search: ${url}`);
    logger.info(`Search body: ${JSON.stringify(searchBody)}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(searchBody)
    });

    logger.info(`Viator products response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Viator search error: ${response.status} - ${errorText}`);
      throw new Error(`Viator API error: ${response.status}`);
    }

    const data = await response.json();
    const products = data.products || data.data || [];
    
    logger.info(`Found ${products.length} tours for ${destination}`);

    // Format results with affiliate tracking links
    return products.map(product => formatTourResult(product, destination, startDate, adults));

  } catch (error) {
    logger.error('Viator tour search error:', error.message);
    throw error;
  }
}

// ============================================================================
// FREETEXT SEARCH (Alternative method)
// ============================================================================

/**
 * Search for tours using freetext query
 * This is an alternative if destination-based search doesn't work
 */
export async function searchToursFreetxt(query) {
  try {
    logger.info(`Freetext search for: ${query}`);

    const url = `${VIATOR_API_BASE}/search/freetext`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        searchTerm: query,
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
    const products = data.products || data.data || [];
    
    logger.info(`Freetext found ${products.length} tours`);

    return products.map(product => formatTourResult(product, query, null, 2));

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
        'Accept': 'application/json',
        'Accept-Language': 'en-US'
      }
    });

    if (!response.ok) {
      throw new Error(`Viator API error: ${response.status}`);
    }

    const product = await response.json();
    return formatTourResult(product, null, null, 2);

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
function formatTourResult(product, destination, date, adults) {
  // Extract pricing - handle various response formats
  const price = product.pricing?.summary?.fromPrice || 
                product.pricing?.fromPrice ||
                product.price?.fromPrice || 
                product.fromPrice ||
                0;

  // Extract duration
  let duration = 'Varies';
  if (product.duration?.fixedDurationInMinutes) {
    const hours = Math.floor(product.duration.fixedDurationInMinutes / 60);
    const mins = product.duration.fixedDurationInMinutes % 60;
    duration = mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
  } else if (product.duration?.variableDurationFromMinutes) {
    const fromHours = Math.round(product.duration.variableDurationFromMinutes / 60);
    const toHours = Math.round(product.duration.variableDurationToMinutes / 60);
    duration = `${fromHours}-${toHours} hours`;
  } else if (product.duration) {
    duration = product.duration;
  }

  // Extract rating
  const rating = product.reviews?.combinedAverageRating?.toFixed(1) || 
                 product.rating?.toFixed(1) ||
                 product.averageRating?.toFixed(1) ||
                 'New';
  const reviewCount = product.reviews?.totalReviews || product.reviewCount || 0;

  // Get image URL - handle various formats
  let image = null;
  if (product.images && product.images.length > 0) {
    const img = product.images[0];
    image = img.variants?.find(v => v.width >= 300)?.url || img.url || img;
  }
  image = image || product.thumbnailURL || product.thumbnail || null;

  // Get product code
  const productCode = product.productCode || product.code || product.id;

  // Build affiliate tracking link
  const bookingLink = buildAffiliateLink(productCode, destination);

  return {
    id: productCode,
    name: product.title || product.productName || product.name,
    description: truncateText(product.description || product.shortDescription, 200),
    duration: duration,
    rating: rating,
    reviewCount: reviewCount,
    price: price,
    currency: 'USD',
    image: image,
    date: date || 'Flexible',
    time: 'Various times available',
    highlights: product.highlights?.slice(0, 3) || [],
    inclusions: product.inclusions?.slice(0, 5) || [],
    
    // IMPORTANT: Affiliate tracking link
    bookingLink: bookingLink,
    link: bookingLink, // Also set 'link' for backwards compatibility
    
    // Original product code for reference
    productCode: productCode
  };
}

/**
 * Build a Viator affiliate tracking link
 */
function buildAffiliateLink(productCode, destination) {
  // Viator deep link format with affiliate tracking
  const baseUrl = `https://www.viator.com/tours/${productCode}`;
  
  // Add affiliate tracking parameters
  const params = new URLSearchParams({
    pid: AFFILIATE_ID || 'P00278785',  // Fallback to known ID
    mcid: '42383',
    medium: 'link'
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

export default {
  searchDestination,
  searchTours,
  searchToursFreetxt,
  getTourDetails
};