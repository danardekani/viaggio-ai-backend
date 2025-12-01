// ============================================================================
// VIATOR AFFILIATE API SERVICE
// ============================================================================
// Fetches real tour and activity data from Viator Partner API
// All booking links include affiliate tracking for commission
// ============================================================================

import { logger } from '../../utils/logger.js';

// Viator Partner API base URL
// Use sandbox for testing, production when ready
const VIATOR_API_BASE = process.env.VIATOR_SANDBOX === 'true' 
  ? 'https://api.sandbox.viator.com/partner'
  : 'https://api.viator.com/partner';

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
  try {
    const response = await fetch(`${VIATOR_API_BASE}/v1/taxonomy/destinations`, {
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

    const data = await response.json();
    
    // Find matching destination
    const destinations = data.data || [];
    const match = destinations.find(dest => 
      dest.destinationName?.toLowerCase().includes(query.toLowerCase())
    );

    if (!match) {
      logger.warn(`Destination not found: ${query}`);
      return null;
    }

    return {
      destId: match.destinationId,
      name: match.destinationName,
      type: match.destinationType
    };

  } catch (error) {
    logger.error('Viator destination search error:', error);
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
    // First, get the destination ID
    const destInfo = await searchDestination(destination);
    
    if (!destInfo) {
      // Return empty array if destination not found
      return [];
    }

    // Search for products at this destination
    const searchBody = {
      filtering: {
        destination: destInfo.destId.toString(),
        lowestPrice: 1,
        highestPrice: 500
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

    const response = await fetch(`${VIATOR_API_BASE}/products/search`, {
      method: 'POST',
      headers: {
        'exp-api-key': API_KEY,
        'Accept': 'application/json',
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

    // Format results with affiliate tracking links
    return products.map(product => formatTourResult(product, destination, startDate, adults));

  } catch (error) {
    logger.error('Viator tour search error:', error);
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
  // Extract pricing
  const price = product.pricing?.summary?.fromPrice || 
                product.price?.fromPrice || 
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
  }

  // Extract rating
  const rating = product.reviews?.combinedAverageRating?.toFixed(1) || 
                 product.rating?.toFixed(1) || 
                 'New';
  const reviewCount = product.reviews?.totalReviews || 0;

  // Get image URL
  const image = product.images?.[0]?.variants?.find(v => v.width >= 300)?.url ||
                product.images?.[0]?.url ||
                product.thumbnailURL ||
                null;

  // Build affiliate tracking link
  const bookingLink = buildAffiliateLink(product.productCode, destination);

  return {
    id: product.productCode,
    name: product.title || product.productName,
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
    
    // Original product code for reference
    productCode: product.productCode
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
    pid: AFFILIATE_ID,           // Partner/Affiliate ID
    mcid: '42383',               // Media campaign ID (standard)
    medium: 'link'               // Traffic medium
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
  getTourDetails
};
