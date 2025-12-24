// ============================================================================
// HOTELBEDS ACTIVITIES API SERVICE
// ============================================================================
// Integration with HotelBeds Activities Booking API and Content API
// API Docs: https://developer.hotelbeds.com/documentation/activities/
// ============================================================================

import crypto from 'crypto';
import { logger } from '../../utils/logger.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// API Base URLs - Sandbox
const BOOKING_API_BASE = 'https://api.test.hotelbeds.com/activity-booking-api/1.0';
const CONTENT_API_BASE = 'https://api.test.hotelbeds.com/activity-content-api/3.0';

// For Production, change to:
// const BOOKING_API_BASE = 'https://api.hotelbeds.com/activity-booking-api/1.0';
// const CONTENT_API_BASE = 'https://api.hotelbeds.com/activity-content-api/3.0';

const API_KEY = process.env.ACTIVITIES_HOTELBEDS_API_KEY;
const API_SECRET = process.env.ACTIVITIES_HOTELBEDS_API_SECRET;

// Cache configuration
const destinationsCache = new Map();
const DESTINATIONS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const countriesCache = new Map();
const COUNTRIES_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Generate HotelBeds X-Signature header
 * Signature = SHA-256(ApiKey + ApiSecret + Timestamp)
 */
function generateSignature() {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHash('sha256')
    .update(API_KEY + API_SECRET + timestamp)
    .digest('hex');
  
  return { signature, timestamp };
}

/**
 * Get standard headers for HotelBeds API requests
 */
function getHeaders() {
  const { signature } = generateSignature();
  
  return {
    'Api-key': API_KEY,
    'X-Signature': signature,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip'
  };
}

// ============================================================================
// CONTENT API - DESTINATIONS
// ============================================================================

/**
 * Fetch countries from Content API
 * Cached for 30 days
 */
export async function fetchCountries(language = 'en') {
  const cacheKey = `countries_${language}`;
  const cached = countriesCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < COUNTRIES_CACHE_TTL) {
    logger.info(`Using cached countries (${cached.data.length} countries)`);
    return cached.data;
  }

  logger.info('Fetching countries from HotelBeds Activities Content API...');

  try {
    const response = await fetch(
      `${CONTENT_API_BASE}/countries/${language}`,
      {
        method: 'GET',
        headers: getHeaders()
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`HotelBeds Activities Content API Error: ${response.status} - ${errorText}`);
      throw new Error(`HotelBeds Activities Content API error: ${response.status}`);
    }

    const data = await response.json();
    const countries = data.countries || [];
    
    countriesCache.set(cacheKey, {
      data: countries,
      timestamp: Date.now()
    });

    logger.info(`Cached ${countries.length} countries for activities`);
    return countries;

  } catch (error) {
    logger.error('Error fetching countries:', error);
    throw error;
  }
}

/**
 * Fetch destinations for a country from Content API
 * Cached for 24 hours
 */
export async function fetchDestinations(countryCode, language = 'en') {
  const cacheKey = `destinations_${countryCode}_${language}`;
  const cached = destinationsCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < DESTINATIONS_CACHE_TTL) {
    logger.info(`Using cached destinations for ${countryCode} (${cached.data.length} destinations)`);
    return cached.data;
  }

  logger.info(`Fetching destinations for ${countryCode} from HotelBeds Activities Content API...`);

  try {
    const response = await fetch(
      `${CONTENT_API_BASE}/destinations/${language}/${countryCode}`,
      {
        method: 'GET',
        headers: getHeaders()
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`HotelBeds Activities Content API Error: ${response.status} - ${errorText}`);
      throw new Error(`HotelBeds Activities Content API error: ${response.status}`);
    }

    const data = await response.json();
    const destinations = data.destinations || [];
    
    destinationsCache.set(cacheKey, {
      data: destinations,
      timestamp: Date.now()
    });

    logger.info(`Cached ${destinations.length} destinations for ${countryCode}`);
    return destinations;

  } catch (error) {
    logger.error(`Error fetching destinations for ${countryCode}:`, error);
    throw error;
  }
}

/**
 * Get activity content (images, descriptions, etc.) from Content API
 */
export async function getActivityContent(activityCode, modalityCode = null, language = 'en') {
  logger.info(`Fetching activity content: ${activityCode}`);

  try {
    // Use single content endpoint if we have modality, otherwise use multi
    if (modalityCode) {
      const response = await fetch(
        `${CONTENT_API_BASE}/activities/${language}/${activityCode}/${modalityCode}`,
        {
          method: 'GET',
          headers: getHeaders()
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Activity content API error: ${response.status} - ${errorText}`);
        throw new Error(`Activity content API error: ${response.status}`);
      }

      const data = await response.json();
      return data.activity || null;
    } else {
      // Use multi-content endpoint for just the activity code
      const response = await fetch(
        `${CONTENT_API_BASE}/activities`,
        {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            codes: [{ activityCode, modalityCodes: [] }],
            language
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Activity content API error: ${response.status} - ${errorText}`);
        throw new Error(`Activity content API error: ${response.status}`);
      }

      const data = await response.json();
      return data.activities?.[0] || null;
    }

  } catch (error) {
    logger.error('Error fetching activity content:', error);
    throw error;
  }
}

// ============================================================================
// BOOKING API - SEARCH ACTIVITIES
// ============================================================================

/**
 * Search activities by destination
 * 
 * @param {Object} params Search parameters
 * @param {string} params.destination - Destination code (e.g., 'PMI' for Palma de Mallorca)
 * @param {string} params.from - Start date (YYYY-MM-DD)
 * @param {string} params.to - End date (YYYY-MM-DD)
 * @param {Array} params.paxes - Array of pax objects with age (e.g., [{age: 30}, {age: 30}])
 * @param {number} params.resultCount - Number of results to return (default: 20)
 * @param {string} params.language - Language code (default: 'en')
 */
export async function searchActivities({
  destination,
  from,
  to,
  paxes = [{ age: 30 }, { age: 30 }],
  resultCount = 20,
  language = 'en'
}) {
  logger.info(`Searching activities in ${destination} from ${from} to ${to}`);

  const requestBody = {
    filters: [{
      searchFilterItems: [{
        type: 'destination',
        value: destination
      }]
    }],
    from,
    to,
    language,
    paxes,
    pagination: {
      itemsPerPage: Math.min(resultCount, 50),
      page: 1
    },
    order: 'DEFAULT'
  };

  try {
    const response = await fetch(`${BOOKING_API_BASE}/activities`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`HotelBeds Activities Booking API Error: ${response.status} - ${errorText}`);
      throw new Error(`HotelBeds Activities Booking API error: ${response.status}`);
    }

    const data = await response.json();
    const activities = data.activities || [];

    logger.info(`Found ${activities.length} activities in ${destination}`);

    // Format the results
    const formattedActivities = activities.slice(0, resultCount).map(activity => 
      formatActivityResult(activity)
    );

    return formattedActivities;

  } catch (error) {
    logger.error('Activity search error:', error);
    throw error;
  }
}

/**
 * Search activities by geolocation
 */
export async function searchActivitiesByLocation({
  latitude,
  longitude,
  radius = 30,
  from,
  to,
  paxes = [{ age: 30 }, { age: 30 }],
  resultCount = 20,
  language = 'en'
}) {
  logger.info(`Searching activities near (${latitude}, ${longitude}) radius ${radius}km`);

  const requestBody = {
    filters: [{
      searchFilterItems: [{
        type: 'geolocation',
        latitude,
        longitude,
        radius
      }]
    }],
    from,
    to,
    language,
    paxes,
    pagination: {
      itemsPerPage: Math.min(resultCount, 50),
      page: 1
    },
    order: 'DEFAULT'
  };

  try {
    const response = await fetch(`${BOOKING_API_BASE}/activities`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`HotelBeds Activities API Error: ${response.status} - ${errorText}`);
      throw new Error(`HotelBeds Activities API error: ${response.status}`);
    }

    const data = await response.json();
    const activities = data.activities || [];

    logger.info(`Found ${activities.length} activities near (${latitude}, ${longitude})`);

    const formattedActivities = activities.slice(0, resultCount).map(activity => 
      formatActivityResult(activity)
    );

    return formattedActivities;

  } catch (error) {
    logger.error('Activity geolocation search error:', error);
    throw error;
  }
}

/**
 * Search activities near a specific hotel
 */
export async function searchActivitiesByHotel({
  hotelCode,
  from,
  to,
  paxes = [{ age: 30 }, { age: 30 }],
  resultCount = 20,
  language = 'en'
}) {
  logger.info(`Searching activities near hotel ${hotelCode}`);

  const requestBody = {
    filters: [{
      searchFilterItems: [{
        type: 'hotel',
        value: hotelCode
      }]
    }],
    from,
    to,
    language,
    paxes,
    pagination: {
      itemsPerPage: Math.min(resultCount, 50),
      page: 1
    },
    order: 'DEFAULT'
  };

  try {
    const response = await fetch(`${BOOKING_API_BASE}/activities`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`HotelBeds Activities API Error: ${response.status} - ${errorText}`);
      throw new Error(`HotelBeds Activities API error: ${response.status}`);
    }

    const data = await response.json();
    const activities = data.activities || [];

    logger.info(`Found ${activities.length} activities near hotel ${hotelCode}`);

    const formattedActivities = activities.slice(0, resultCount).map(activity => 
      formatActivityResult(activity)
    );

    return formattedActivities;

  } catch (error) {
    logger.error('Activity hotel search error:', error);
    throw error;
  }
}

// ============================================================================
// BOOKING API - ACTIVITY DETAILS
// ============================================================================

/**
 * Get detailed activity information with availability
 * 
 * @param {string} activityCode - The activity code (e.g., 'E-E10-HIGHARTIST')
 * @param {string} from - Start date (YYYY-MM-DD)
 * @param {string} to - End date (YYYY-MM-DD)
 * @param {Array} paxes - Array of pax objects with age
 * @param {string} language - Language code (default: 'en')
 * @param {boolean} fullDetails - Whether to fetch full details (default: false)
 */
export async function getActivityDetails(
  activityCode,
  from,
  to,
  paxes = [{ age: 30 }, { age: 30 }],
  language = 'en',
  fullDetails = false
) {
  logger.info(`Fetching activity details: ${activityCode} (full: ${fullDetails})`);

  const endpoint = fullDetails 
    ? `${BOOKING_API_BASE}/activities/details/full`
    : `${BOOKING_API_BASE}/activities/details`;

  const requestBody = {
    code: activityCode,
    from,
    to,
    language,
    paxes
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Activity details API error: ${response.status} - ${errorText}`);
      throw new Error(`Activity details API error: ${response.status}`);
    }

    const data = await response.json();
    const activity = data.activity;

    if (!activity) {
      throw new Error('Activity not found or not available');
    }

    return formatActivityDetailResult(activity, fullDetails);

  } catch (error) {
    logger.error('Error fetching activity details:', error);
    throw error;
  }
}

// ============================================================================
// BOOKING API - EXCURSION PICKUPS
// ============================================================================

/**
 * Get pickup points for an excursion
 * Required before booking excursions that need pickup
 */
export async function getExcursionPickups(pickupRetrievalKey, from, to) {
  logger.info(`Fetching pickups for key: ${pickupRetrievalKey}`);

  const requestBody = {
    pickupRetrievalKey,
    from,
    to,
    pagination: {
      itemsPerPage: 50,
      page: 1
    }
  };

  try {
    const response = await fetch(`${BOOKING_API_BASE}/activities/excursions/retrievePickups`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Pickups API error: ${response.status} - ${errorText}`);
      throw new Error(`Pickups API error: ${response.status}`);
    }

    const data = await response.json();
    return data.pickups || [];

  } catch (error) {
    logger.error('Error fetching pickups:', error);
    throw error;
  }
}

// ============================================================================
// FORMAT HELPERS
// ============================================================================

/**
 * Format activity search result for frontend
 */
function formatActivityResult(activity) {
  // Get the first/cheapest modality
  const modality = activity.modalities?.[0];
  const rate = modality?.rates?.[0];
  
  // Extract price info
  const amount = rate?.amount || 0;
  const currency = activity.currency || 'EUR';
  
  // Get images from content if available
  const images = activity.content?.media?.images || [];
  const primaryImage = images.find(img => img.visualizationOrder === 1) || images[0];
  
  return {
    // Core identification
    code: activity.code,
    name: activity.name,
    type: activity.type, // TICKET or EXCURSION
    
    // Location
    destinationCode: activity.destinationCode,
    destinationName: activity.destinationName,
    country: activity.country,
    
    // Pricing
    price: parseFloat(amount),
    currency,
    priceType: rate?.rateDetails?.[0]?.pricingType || 'ADULT', // ADULT, CHILD, PER_GROUP, etc.
    
    // Main modality info
    modalityCode: modality?.code,
    modalityName: modality?.name,
    duration: modality?.duration?.value 
      ? `${modality.duration.value} ${modality.duration.metric || 'hours'}`
      : null,
    
    // Content
    description: activity.content?.description || activity.description,
    shortDescription: truncateText(activity.content?.description || activity.description, 200),
    
    // Images
    image: primaryImage?.urls?.find(u => u.sizeType === 'LARGE')?.resource 
        || primaryImage?.urls?.[0]?.resource
        || null,
    images: images.map(img => ({
      url: img.urls?.find(u => u.sizeType === 'LARGE')?.resource || img.urls?.[0]?.resource,
      caption: img.visualizationOrder
    })),
    
    // Availability
    operationDays: activity.operationDays || [],
    
    // Booking info
    rateKey: rate?.rateKey,
    
    // Features
    features: extractFeatures(activity),
    
    // Provider
    provider: 'hotelbeds',
    providerActivityCode: activity.code
  };
}

/**
 * Format detailed activity result
 */
function formatActivityDetailResult(activity, fullDetails = false) {
  const base = formatActivityResult(activity);
  
  // Add detailed information
  return {
    ...base,
    
    // Full description
    description: activity.content?.description || activity.description,
    
    // All modalities with their rates
    modalities: (activity.modalities || []).map(modality => ({
      code: modality.code,
      name: modality.name,
      duration: modality.duration?.value 
        ? `${modality.duration.value} ${modality.duration.metric || 'hours'}`
        : null,
      rates: (modality.rates || []).map(rate => ({
        rateKey: rate.rateKey,
        amount: parseFloat(rate.amount || 0),
        currency: activity.currency || 'EUR',
        operationDates: rate.operationDates || [],
        sessions: rate.sessions || [],
        cancellationPolicies: rate.cancellationPolicies || []
      }))
    })),
    
    // Location details
    location: activity.content?.location || null,
    meetingPoint: activity.content?.meetingPoint || null,
    
    // Highlights and inclusions
    highlights: activity.content?.highlights || [],
    includedServices: activity.content?.featureGroups?.find(g => g.groupCode === 'INCLUDED')?.features || [],
    excludedServices: activity.content?.featureGroups?.find(g => g.groupCode === 'NOT_INCLUDED')?.features || [],
    
    // Booking requirements
    voucherInfo: activity.content?.redeemInfo || null,
    importantInfo: activity.content?.importantInfo || [],
    
    // Categories and segments
    categories: activity.content?.segmentationGroups || [],
    
    // Reviews if available
    reviewCount: activity.reviewCount || 0,
    averageRating: activity.averageRating || null,
    
    // Full details flag
    isFullDetails: fullDetails
  };
}

/**
 * Extract features/tags from activity
 */
function extractFeatures(activity) {
  const features = [];
  
  // Type-based features
  if (activity.type === 'TICKET') {
    features.push({ type: 'ticket', label: 'Ticket' });
  } else if (activity.type === 'EXCURSION') {
    features.push({ type: 'excursion', label: 'Excursion' });
  }
  
  // Duration-based
  const modality = activity.modalities?.[0];
  if (modality?.duration?.value) {
    const hours = modality.duration.value;
    if (hours <= 3) {
      features.push({ type: 'duration', label: 'Short Activity' });
    } else if (hours >= 8) {
      features.push({ type: 'duration', label: 'Full Day' });
    }
  }
  
  // Content-based features
  if (activity.content?.featureGroups) {
    const bookingFeatures = activity.content.featureGroups.find(g => g.groupCode === 'BOOKING');
    if (bookingFeatures?.features) {
      bookingFeatures.features.forEach(f => {
        if (f.code === 'FREE_CANCELLATION') {
          features.push({ type: 'cancellation', label: 'Free Cancellation' });
        }
        if (f.code === 'INSTANT_CONFIRMATION') {
          features.push({ type: 'confirmation', label: 'Instant Confirmation' });
        }
        if (f.code === 'MOBILE_VOUCHER') {
          features.push({ type: 'voucher', label: 'Mobile Voucher' });
        }
      });
    }
  }
  
  return features;
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
// DESTINATION MAPPING HELPERS
// ============================================================================

// Common destination codes for HotelBeds Activities
// Note: These may differ from Hotel API destination codes
const POPULAR_ACTIVITY_DESTINATIONS = [
  { code: 'PMI', name: 'Palma de Mallorca', country: 'ES' },
  { code: 'BCN', name: 'Barcelona', country: 'ES' },
  { code: 'MAD', name: 'Madrid', country: 'ES' },
  { code: 'ROM', name: 'Rome', country: 'IT' },
  { code: 'PAR', name: 'Paris', country: 'FR' },
  { code: 'LON', name: 'London', country: 'GB' },
  { code: 'AMS', name: 'Amsterdam', country: 'NL' },
  { code: 'LIS', name: 'Lisbon', country: 'PT' },
  { code: 'NYC', name: 'New York', country: 'US' },
  { code: 'MIA', name: 'Miami', country: 'US' },
  { code: 'LAS', name: 'Las Vegas', country: 'US' },
  { code: 'CUN', name: 'Cancun', country: 'MX' },
  { code: 'DXB', name: 'Dubai', country: 'AE' },
  { code: 'BKK', name: 'Bangkok', country: 'TH' },
  { code: 'TYO', name: 'Tokyo', country: 'JP' }
];

/**
 * Find destination code by name (fuzzy matching)
 */
export function findDestinationCode(destinationName) {
  const searchTerm = destinationName.toLowerCase().trim();
  
  // Direct match on popular destinations first
  const directMatch = POPULAR_ACTIVITY_DESTINATIONS.find(d => 
    d.name.toLowerCase() === searchTerm ||
    d.code.toLowerCase() === searchTerm
  );
  
  if (directMatch) {
    return directMatch;
  }
  
  // Partial match
  const partialMatch = POPULAR_ACTIVITY_DESTINATIONS.find(d =>
    d.name.toLowerCase().includes(searchTerm) ||
    searchTerm.includes(d.name.toLowerCase())
  );
  
  if (partialMatch) {
    return partialMatch;
  }
  
  // No match found - return null, caller should handle
  return null;
}

/**
 * Autocomplete destinations for activities
 */
export async function searchDestinationsAutocomplete(query, limit = 8) {
  const searchTerm = query.toLowerCase().trim();
  
  // Search in popular destinations
  const matches = POPULAR_ACTIVITY_DESTINATIONS.filter(d =>
    d.name.toLowerCase().includes(searchTerm) ||
    d.code.toLowerCase().includes(searchTerm)
  ).slice(0, limit);
  
  return matches.map(d => ({
    code: d.code,
    name: d.name,
    country: d.country,
    displayName: `${d.name}, ${d.country}`
  }));
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

/**
 * Clear all caches
 */
export function clearAllCaches() {
  destinationsCache.clear();
  countriesCache.clear();
  logger.info('All activity caches cleared');
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Search
  searchActivities,
  searchActivitiesByLocation,
  searchActivitiesByHotel,
  
  // Details
  getActivityDetails,
  getActivityContent,
  getExcursionPickups,
  
  // Content
  fetchCountries,
  fetchDestinations,
  
  // Helpers
  findDestinationCode,
  searchDestinationsAutocomplete,
  clearAllCaches
};
