// ============================================================================
// HOTELBEDS API SERVICE - PRODUCTION READY
// ============================================================================
// Complete integration with Content API and Booking API
// Implements proper two-step search: Get hotel codes → Check availability
// API Docs: https://developer.hotelbeds.com/documentation/hotels/
// ============================================================================

import crypto from 'crypto';
import { logger } from '../../utils/logger.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// API Base URLs
const BOOKING_API_BASE = 'https://api.test.hotelbeds.com/hotel-api/1.0';  // Sandbox
const CONTENT_API_BASE = 'https://api.test.hotelbeds.com/hotel-content-api/1.0';  // Sandbox

// For Production, change to:
// const BOOKING_API_BASE = 'https://api.hotelbeds.com/hotel-api/1.0';
// const CONTENT_API_BASE = 'https://api.hotelbeds.com/hotel-content-api/1.0';

const API_KEY = process.env.HOTELBEDS_API_KEY;
const API_SECRET = process.env.HOTELBEDS_API_SECRET;

// Cache configuration
const hotelCache = new Map();
const HOTEL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

let destinationsCache = null;
let destinationsCacheTime = null;
const DESTINATIONS_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

// ============================================================================
// FALLBACK POPULAR DESTINATIONS
// Used when HotelBeds API is unavailable (quota exhausted, etc.)
// ============================================================================

const POPULAR_DESTINATIONS = [
  { code: 'NYC', name: 'New York', countryCode: 'US' },
  { code: 'LAX', name: 'Los Angeles', countryCode: 'US' },
  { code: 'CHI', name: 'Chicago', countryCode: 'US' },
  { code: 'MIA', name: 'Miami', countryCode: 'US' },
  { code: 'SFO', name: 'San Francisco', countryCode: 'US' },
  { code: 'LAS', name: 'Las Vegas', countryCode: 'US' },
  { code: 'ORL', name: 'Orlando', countryCode: 'US' },
  { code: 'BOS', name: 'Boston', countryCode: 'US' },
  { code: 'WAS', name: 'Washington D.C.', countryCode: 'US' },
  { code: 'SEA', name: 'Seattle', countryCode: 'US' },
  { code: 'DEN', name: 'Denver', countryCode: 'US' },
  { code: 'ATL', name: 'Atlanta', countryCode: 'US' },
  { code: 'PHX', name: 'Phoenix', countryCode: 'US' },
  { code: 'SAN', name: 'San Diego', countryCode: 'US' },
  { code: 'AUS', name: 'Austin', countryCode: 'US' },
  { code: 'NAS', name: 'Nashville', countryCode: 'US' },
  { code: 'NOL', name: 'New Orleans', countryCode: 'US' },
  { code: 'PHL', name: 'Philadelphia', countryCode: 'US' },
  { code: 'HNL', name: 'Honolulu', countryCode: 'US' },
  { code: 'LON', name: 'London', countryCode: 'GB' },
  { code: 'PAR', name: 'Paris', countryCode: 'FR' },
  { code: 'ROM', name: 'Rome', countryCode: 'IT' },
  { code: 'BCN', name: 'Barcelona', countryCode: 'ES' },
  { code: 'MAD', name: 'Madrid', countryCode: 'ES' },
  { code: 'AMS', name: 'Amsterdam', countryCode: 'NL' },
  { code: 'DUB', name: 'Dublin', countryCode: 'IE' },
  { code: 'LIS', name: 'Lisbon', countryCode: 'PT' },
  { code: 'BER', name: 'Berlin', countryCode: 'DE' },
  { code: 'MUC', name: 'Munich', countryCode: 'DE' },
  { code: 'VIE', name: 'Vienna', countryCode: 'AT' },
  { code: 'PRG', name: 'Prague', countryCode: 'CZ' },
  { code: 'BUD', name: 'Budapest', countryCode: 'HU' },
  { code: 'ATH', name: 'Athens', countryCode: 'GR' },
  { code: 'IST', name: 'Istanbul', countryCode: 'TR' },
  { code: 'TYO', name: 'Tokyo', countryCode: 'JP' },
  { code: 'SIN', name: 'Singapore', countryCode: 'SG' },
  { code: 'BKK', name: 'Bangkok', countryCode: 'TH' },
  { code: 'HKG', name: 'Hong Kong', countryCode: 'HK' },
  { code: 'SYD', name: 'Sydney', countryCode: 'AU' },
  { code: 'CUN', name: 'Cancun', countryCode: 'MX' },
  { code: 'MEX', name: 'Mexico City', countryCode: 'MX' },
  { code: 'RIO', name: 'Rio de Janeiro', countryCode: 'BR' },
  { code: 'DXB', name: 'Dubai', countryCode: 'AE' },
  { code: 'CPT', name: 'Cape Town', countryCode: 'ZA' },
  { code: 'CAI', name: 'Cairo', countryCode: 'EG' },
  { code: 'MIL', name: 'Milan', countryCode: 'IT' },
  { code: 'VCE', name: 'Venice', countryCode: 'IT' },
  { code: 'FLR', name: 'Florence', countryCode: 'IT' },
  { code: 'NCE', name: 'Nice', countryCode: 'FR' },
  { code: 'EDI', name: 'Edinburgh', countryCode: 'GB' },
];

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Safely get destination name - handles both API format and fallback format
 * HotelBeds API returns: { name: { content: "New York" } }
 * Fallback returns: { name: "New York" }
 */
function getDestinationName(destination) {
  if (!destination) return '';
  
  // Handle HotelBeds API format: { name: { content: "..." } }
  if (destination.name && typeof destination.name === 'object' && destination.name.content) {
    return destination.name.content;
  }
  
  // Handle simple string format (fallback destinations)
  if (typeof destination.name === 'string') {
    return destination.name;
  }
  
  // Fallback to code if name is not available
  return destination.code || '';
}

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
 * Fetch all available destinations from HotelBeds Content API
 * Results are cached for 30 days
 */
export async function fetchDestinations() {
  // Check cache first
  if (destinationsCache && destinationsCacheTime && 
      (Date.now() - destinationsCacheTime) < DESTINATIONS_CACHE_TTL) {
    const hoursAgo = Math.round((Date.now() - destinationsCacheTime) / (60 * 60 * 1000));
    logger.info(`Using cached destinations (${destinationsCache.length} destinations, cached ${hoursAgo}h ago)`);
    return destinationsCache;
  }

  logger.info('Fetching destinations from HotelBeds Content API...');

  try {
    const response = await fetch(
      `${CONTENT_API_BASE}/locations/destinations?fields=all&language=ENG`,
      {
        method: 'GET',
        headers: getHeaders()
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`HotelBeds Content API Error: ${response.status} - ${errorText}`);
      throw new Error(`HotelBeds Content API error: ${response.status}`);
    }

    const data = await response.json();
    destinationsCache = data.destinations || [];
    destinationsCacheTime = Date.now();

    logger.info(`Cached ${destinationsCache.length} destinations`);
    return destinationsCache;

  } catch (error) {
    logger.error('Error fetching destinations:', error);
    throw error;
  }
}

/**
 * Find destination by name (fuzzy matching)
 */
async function findDestination(destinationName) {
  let destinations;
  
  try {
    destinations = await fetchDestinations();
  } catch (error) {
    // API failed, try fallback destinations
    logger.warn(`Using fallback destinations for search: ${error.message}`);
    destinations = POPULAR_DESTINATIONS;
  }
  
  const searchLower = destinationName.toLowerCase().trim();
  
  // Try exact match first
  let match = destinations.find(d => 
    getDestinationName(d).toLowerCase() === searchLower
  );
  
  // Try partial match
  if (!match) {
    match = destinations.find(d => 
      getDestinationName(d).toLowerCase().includes(searchLower)
    );
  }
  
  if (match) {
    logger.info(`Matched destination: "${destinationName}" → ${getDestinationName(match)} (${match.code})`);
  }
  
  return match;
}

// ============================================================================
// CONTENT API - HOTELS BY DESTINATION
// ============================================================================

/**
 * Fetch hotel codes for a specific destination
 * This is the critical step before checking availability
 * Results are cached for 24 hours
 */
async function getHotelsByDestination(destinationCode, limit = 100) {
  const cacheKey = `${destinationCode}-${limit}`;
  const cached = hotelCache.get(cacheKey);
  
  // Check cache
  if (cached && (Date.now() - cached.timestamp) < HOTEL_CACHE_TTL) {
    logger.info(`Using cached hotels for ${destinationCode} (${cached.hotels.length} hotels)`);
    return cached.hotels;
  }

  logger.info(`Fetching hotels for destination ${destinationCode}...`);

  try {
    const response = await fetch(
      `${CONTENT_API_BASE}/hotels?fields=all&destinationCodes=${destinationCode}&language=ENG&from=1&to=${limit}`,
      {
        method: 'GET',
        headers: getHeaders()
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`HotelBeds Content API Error: ${response.status} - ${errorText}`);
      throw new Error(`HotelBeds Content API error: ${response.status}`);
    }

    const data = await response.json();
    const hotels = data.hotels || [];
    
    logger.info(`Found ${hotels.length} hotels for destination ${destinationCode}`);

    // Cache results
    hotelCache.set(cacheKey, {
      hotels,
      timestamp: Date.now()
    });

    return hotels;

  } catch (error) {
    logger.error('Error fetching hotels by destination:', error);
    throw error;
  }
}

// ============================================================================
// BOOKING API - HOTEL AVAILABILITY SEARCH
// ============================================================================

/**
 * Search for hotel availability
 * Two-step process:
 *   1. Get hotel codes from Content API
 *   2. Check availability with Booking API
 */
export async function searchHotels({
  destination,
  checkIn,
  checkOut,
  adults = 2,
  children = 0,
  rooms = 1,
  currency = 'USD',
  resultCount = 20
}) {
  
  logger.info(`Hotel search: ${destination}, ${checkIn} to ${checkOut}, ${adults} adults, ${rooms} rooms`);

  // STEP 1: Find the destination
  const dest = await findDestination(destination);
  
  if (!dest) {
    throw new Error(`Destination not found: ${destination}`);
  }

  // STEP 2: Get hotel codes for this destination (Content API)
  const destinationHotels = await getHotelsByDestination(dest.code, 150);
  
  if (destinationHotels.length === 0) {
    logger.info(`No hotels found in destination: ${dest.name}`);
    return [];
  }

  // Extract hotel codes (limit to prevent huge requests)
  const hotelCodes = destinationHotels
    .slice(0, Math.min(100, resultCount * 5)) // Get more than needed for filtering
    .map(h => parseInt(h.code));

  logger.info(`Checking availability for ${hotelCodes.length} hotels...`);

  // STEP 3: Build occupancy structure for Booking API
  const occupancies = [];
  const adultsPerRoom = Math.floor(adults / rooms);
  const childrenPerRoom = children > 0 ? Math.floor(children / rooms) : 0;
  
  for (let i = 0; i < rooms; i++) {
    occupancies.push({
      rooms: 1,
      adults: adultsPerRoom,
      children: childrenPerRoom
    });
  }

  // STEP 4: Check availability using Booking API
  const requestBody = {
    stay: {
      checkIn,
      checkOut
    },
    occupancies,
    hotels: {
      hotel: hotelCodes  // Array of hotel codes (not destination!)
    }
  };

  try {
    const response = await fetch(`${BOOKING_API_BASE}/hotels`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`HotelBeds Booking API Error: ${response.status} - ${errorText}`);
      throw new Error(`HotelBeds Booking API error: ${response.status}`);
    }

    const data = await response.json();
    const hotels = data.hotels?.hotels || [];
    
    logger.info(`Received ${hotels.length} hotels with availability`);

    // Format and return results
    const formattedHotels = hotels
      .map(hotel => formatHotelResult(hotel, checkIn, checkOut, destinationHotels))
      .slice(0, resultCount);

    return formattedHotels;

  } catch (error) {
    logger.error('Hotel search error:', error);
    throw error;
  }
}

// ============================================================================
// GET HOTEL DETAILS
// ============================================================================

/**
 * Get detailed information about a specific hotel with availability
 */
export async function getHotelDetails(hotelCode, checkIn, checkOut, adults = 2) {
  logger.info(`Fetching hotel details: ${hotelCode}, ${checkIn} to ${checkOut}`);

  const requestBody = {
    stay: {
      checkIn,
      checkOut
    },
    occupancies: [{
      rooms: 1,
      adults,
      children: 0
    }],
    hotels: {
      hotel: [parseInt(hotelCode)]
    }
  };

  try {
    const response = await fetch(`${BOOKING_API_BASE}/hotels`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`HotelBeds API Error: ${response.status} - ${errorText}`);
      throw new Error(`HotelBeds API error: ${response.status}`);
    }

    const data = await response.json();
    const hotel = data.hotels?.hotels?.[0];
    
    if (!hotel) {
      throw new Error('Hotel not found or not available');
    }

    return formatHotelResult(hotel, checkIn, checkOut);

  } catch (error) {
    logger.error('Error fetching hotel details:', error);
    throw error;
  }
}

// ============================================================================
// FORMAT HOTEL RESULT
// ============================================================================

function formatHotelResult(hotel, checkIn, checkOut, contentHotels = []) {
  // Try to find additional info from content API
  const contentInfo = contentHotels.find(h => h.code === hotel.code?.toString());
  
  // Get the best rate (cheapest)
  const rate = hotel.rooms?.[0]?.rates?.[0];
  const nights = calculateNights(checkIn, checkOut);
  
  // Calculate per-night price
  const totalPrice = parseFloat(rate?.net || 0);
  const pricePerNight = nights > 0 ? (totalPrice / nights).toFixed(2) : totalPrice;

  // Get hotel images
  let images = [];
  if (contentInfo?.images) {
    images = contentInfo.images
      .filter(img => img.imageTypeCode === 'GEN' || img.imageTypeCode === 'HAB')
      .slice(0, 5)
      .map(img => `https://photos.hotelbeds.com/giata/${img.path}`);
  }

  // Get amenities/facilities
  let amenities = [];
  if (contentInfo?.facilities) {
    amenities = contentInfo.facilities
      .slice(0, 10)
      .map(f => f.description?.content || f.facilityCode);
  }

  return {
    id: hotel.code,
    name: hotel.name,
    description: contentInfo?.description?.content || '',
    category: hotel.categoryName || `${hotel.categoryCode} Star`,
    stars: parseInt(hotel.categoryCode) || 0,
    location: formatLocation(hotel),
    address: contentInfo?.address?.content || '',
    
    // Pricing
    totalPrice: totalPrice.toFixed(2),
    pricePerNight,
    currency: hotel.currency || 'USD',
    nights,
    
    // Images
    image: images[0] || null,
    images,
    
    // Amenities
    amenities,
    
    // Room info
    roomType: hotel.rooms?.[0]?.name || 'Standard Room',
    boardType: rate?.boardName || 'Room Only',
    
    // Availability
    allotment: rate?.allotment, // Available rooms
    paymentType: rate?.paymentType, // AT_WEB, AT_HOTEL, etc.
    checkIn,
    checkOut,
    cancellationPolicies: rate?.cancellationPolicies || [],
    
    // Links
    bookingLink: buildBookingLink(hotel.code, checkIn, checkOut)
  };
}

function formatLocation(hotel) {
  const parts = [];
  if (hotel.zoneName) parts.push(hotel.zoneName);
  if (hotel.destinationName) parts.push(hotel.destinationName);
  return parts.join(', ') || 'Location not specified';
}

function calculateNights(checkIn, checkOut) {
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

function buildBookingLink(hotelCode, checkIn, checkOut) {
  // Your booking page URL
  return `/book/hotel/${hotelCode}?checkIn=${checkIn}&checkOut=${checkOut}`;
}

// ============================================================================
// DESTINATION SEARCH & AUTOCOMPLETE
// ============================================================================

/**
 * Search destinations for autocomplete
 * With fallback to popular destinations if API fails
 */
export async function searchDestinationsAutocomplete(searchTerm, limit = 8) {
  if (!searchTerm || searchTerm.length < 2) {
    return [];
  }

  const searchLower = searchTerm.toLowerCase();

  try {
    // Try to get destinations from HotelBeds API
    const destinations = await fetchDestinations();
    
    // Score and filter destinations
    const scored = destinations
      .filter(d => {
        const name = getDestinationName(d);
        return name && name.toLowerCase().includes(searchLower);
      })
      .map(d => {
        const nameLower = getDestinationName(d).toLowerCase();
        let score = 0;
        
        // Exact match gets highest score
        if (nameLower === searchLower) score = 100;
        // Starts with search term
        else if (nameLower.startsWith(searchLower)) score = 80;
        // Contains search term
        else score = 50;
        
        return { ...d, score, displayName: getDestinationName(d) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(d => ({
      code: d.code,
      name: d.displayName,
      countryCode: d.countryCode,
      displayName: d.countryCode ? `${d.displayName}, ${d.countryCode}` : d.displayName
    }));

  } catch (error) {
    // API failed - use fallback list of popular destinations
    logger.warn(`HotelBeds API failed, using fallback destinations: ${error.message}`);
    return searchFallbackDestinations(searchTerm, limit);
  }
}

/**
 * Search fallback popular destinations when API is unavailable
 */
function searchFallbackDestinations(searchTerm, limit = 8) {
  const searchLower = searchTerm.toLowerCase();
  
  const scored = POPULAR_DESTINATIONS
    .filter(d => {
      const name = getDestinationName(d);
      return name && name.toLowerCase().includes(searchLower);
    })
    .map(d => {
      const nameLower = getDestinationName(d).toLowerCase();
      let score = 0;
      
      if (nameLower === searchLower) score = 100;
      else if (nameLower.startsWith(searchLower)) score = 80;
      else score = 50;
      
      return { ...d, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  logger.info(`Fallback search found ${scored.length} destinations for "${searchTerm}"`);
  
  return scored.map(d => ({
    code: d.code,
    name: getDestinationName(d),
    countryCode: d.countryCode,
    displayName: `${getDestinationName(d)}, ${d.countryCode}`
  }));
}

/**
 * Get list of all destinations
 */
export async function getDestinations() {
  try {
    const destinations = await fetchDestinations();
    return destinations.map(d => {
      const name = getDestinationName(d);
      return {
        code: d.code,
        name: name,
        countryCode: d.countryCode,
        displayName: d.countryCode ? `${name}, ${d.countryCode}` : name
      };
    });
  } catch (error) {
    logger.warn(`Failed to get destinations, using fallback: ${error.message}`);
    return POPULAR_DESTINATIONS.map(d => {
      const name = getDestinationName(d);
      return {
        code: d.code,
        name: name,
        countryCode: d.countryCode,
        displayName: `${name}, ${d.countryCode}`
      };
    });
  }
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

/**
 * Clear all caches (useful for debugging or testing)
 */
export function clearAllCaches() {
  hotelCache.clear();
  destinationsCache = null;
  destinationsCacheTime = null;
  logger.info('All caches cleared');
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  searchHotels,
  getHotelDetails,
  getDestinations,
  searchDestinationsAutocomplete,
  fetchDestinations,
  clearAllCaches
};
