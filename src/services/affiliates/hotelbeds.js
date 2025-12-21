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
  // United States (with state codes for proper display)
  { code: 'NYC', name: 'New York City', stateCode: 'NY', countryCode: 'US' },
  { code: 'LAX', name: 'Los Angeles', stateCode: 'CA', countryCode: 'US' },
  { code: 'CHI', name: 'Chicago', stateCode: 'IL', countryCode: 'US' },
  { code: 'MIA', name: 'Miami', stateCode: 'FL', countryCode: 'US' },
  { code: 'SFO', name: 'San Francisco', stateCode: 'CA', countryCode: 'US' },
  { code: 'LAS', name: 'Las Vegas', stateCode: 'NV', countryCode: 'US' },
  { code: 'ORL', name: 'Orlando', stateCode: 'FL', countryCode: 'US' },
  { code: 'BOS', name: 'Boston', stateCode: 'MA', countryCode: 'US' },
  { code: 'WAS', name: 'Washington', stateCode: 'DC', countryCode: 'US' },
  { code: 'SEA', name: 'Seattle', stateCode: 'WA', countryCode: 'US' },
  { code: 'DEN', name: 'Denver', stateCode: 'CO', countryCode: 'US' },
  { code: 'ATL', name: 'Atlanta', stateCode: 'GA', countryCode: 'US' },
  { code: 'PHX', name: 'Phoenix', stateCode: 'AZ', countryCode: 'US' },
  { code: 'SAN', name: 'San Diego', stateCode: 'CA', countryCode: 'US' },
  { code: 'AUS', name: 'Austin', stateCode: 'TX', countryCode: 'US' },
  { code: 'NAS', name: 'Nashville', stateCode: 'TN', countryCode: 'US' },
  { code: 'NOL', name: 'New Orleans', stateCode: 'LA', countryCode: 'US' },
  { code: 'PHL', name: 'Philadelphia', stateCode: 'PA', countryCode: 'US' },
  { code: 'HNL', name: 'Honolulu', stateCode: 'HI', countryCode: 'US' },
  // Europe - Spain
  { code: 'BCN', name: 'Barcelona', countryCode: 'ES' },
  { code: 'MAD', name: 'Madrid', countryCode: 'ES' },
  { code: 'SEV', name: 'Seville', countryCode: 'ES' },
  { code: 'VLC', name: 'Valencia', countryCode: 'ES' },
  { code: 'AGP', name: 'Malaga', countryCode: 'ES' },
  { code: 'GRX', name: 'Granada', countryCode: 'ES' },
  // Europe - Portugal
  { code: 'LIS', name: 'Lisbon', countryCode: 'PT' },
  { code: 'OPO', name: 'Porto', countryCode: 'PT' },
  { code: 'FAO', name: 'Faro', countryCode: 'PT' },
  // Europe - UK & Ireland
  { code: 'LON', name: 'London', countryCode: 'GB' },
  { code: 'EDI', name: 'Edinburgh', countryCode: 'GB' },
  { code: 'MAN', name: 'Manchester', countryCode: 'GB' },
  { code: 'DUB', name: 'Dublin', countryCode: 'IE' },
  // Europe - France
  { code: 'PAR', name: 'Paris', countryCode: 'FR' },
  { code: 'NCE', name: 'Nice', countryCode: 'FR' },
  { code: 'LYS', name: 'Lyon', countryCode: 'FR' },
  // Europe - Italy
  { code: 'ROM', name: 'Rome', countryCode: 'IT' },
  { code: 'MIL', name: 'Milan', countryCode: 'IT' },
  { code: 'VCE', name: 'Venice', countryCode: 'IT' },
  { code: 'FLR', name: 'Florence', countryCode: 'IT' },
  { code: 'NAP', name: 'Naples', countryCode: 'IT' },
  // Europe - Germany & Austria
  { code: 'BER', name: 'Berlin', countryCode: 'DE' },
  { code: 'MUC', name: 'Munich', countryCode: 'DE' },
  { code: 'FRA', name: 'Frankfurt', countryCode: 'DE' },
  { code: 'VIE', name: 'Vienna', countryCode: 'AT' },
  // Europe - Other
  { code: 'AMS', name: 'Amsterdam', countryCode: 'NL' },
  { code: 'PRG', name: 'Prague', countryCode: 'CZ' },
  { code: 'BUD', name: 'Budapest', countryCode: 'HU' },
  { code: 'ATH', name: 'Athens', countryCode: 'GR' },
  { code: 'IST', name: 'Istanbul', countryCode: 'TR' },
  { code: 'ZRH', name: 'Zurich', countryCode: 'CH' },
  { code: 'GVA', name: 'Geneva', countryCode: 'CH' },
  { code: 'BRU', name: 'Brussels', countryCode: 'BE' },
  { code: 'CPH', name: 'Copenhagen', countryCode: 'DK' },
  { code: 'OSL', name: 'Oslo', countryCode: 'NO' },
  { code: 'STO', name: 'Stockholm', countryCode: 'SE' },
  { code: 'HEL', name: 'Helsinki', countryCode: 'FI' },
  { code: 'WAW', name: 'Warsaw', countryCode: 'PL' },
  { code: 'KRK', name: 'Krakow', countryCode: 'PL' },
  // Asia
  { code: 'TYO', name: 'Tokyo', countryCode: 'JP' },
  { code: 'SIN', name: 'Singapore', countryCode: 'SG' },
  { code: 'BKK', name: 'Bangkok', countryCode: 'TH' },
  { code: 'HKG', name: 'Hong Kong', countryCode: 'HK' },
  { code: 'SEL', name: 'Seoul', countryCode: 'KR' },
  { code: 'PEK', name: 'Beijing', countryCode: 'CN' },
  { code: 'SHA', name: 'Shanghai', countryCode: 'CN' },
  { code: 'DEL', name: 'Delhi', countryCode: 'IN' },
  { code: 'BOM', name: 'Mumbai', countryCode: 'IN' },
  { code: 'KUL', name: 'Kuala Lumpur', countryCode: 'MY' },
  { code: 'HAN', name: 'Hanoi', countryCode: 'VN' },
  { code: 'SGN', name: 'Ho Chi Minh City', countryCode: 'VN' },
  { code: 'DPS', name: 'Bali', countryCode: 'ID' },
  // Oceania
  { code: 'SYD', name: 'Sydney', countryCode: 'AU' },
  { code: 'MEL', name: 'Melbourne', countryCode: 'AU' },
  { code: 'AKL', name: 'Auckland', countryCode: 'NZ' },
  // Americas
  { code: 'CUN', name: 'Cancun', countryCode: 'MX' },
  { code: 'MEX', name: 'Mexico City', countryCode: 'MX' },
  { code: 'RIO', name: 'Rio de Janeiro', countryCode: 'BR' },
  { code: 'SAO', name: 'Sao Paulo', countryCode: 'BR' },
  { code: 'BUE', name: 'Buenos Aires', countryCode: 'AR' },
  { code: 'LIM', name: 'Lima', countryCode: 'PE' },
  { code: 'BOG', name: 'Bogota', countryCode: 'CO' },
  { code: 'SCL', name: 'Santiago', countryCode: 'CL' },
  // Middle East & Africa
  { code: 'DXB', name: 'Dubai', countryCode: 'AE' },
  { code: 'AUH', name: 'Abu Dhabi', countryCode: 'AE' },
  { code: 'DOH', name: 'Doha', countryCode: 'QA' },
  { code: 'TLV', name: 'Tel Aviv', countryCode: 'IL' },
  { code: 'CAI', name: 'Cairo', countryCode: 'EG' },
  { code: 'CPT', name: 'Cape Town', countryCode: 'ZA' },
  { code: 'JNB', name: 'Johannesburg', countryCode: 'ZA' },
  { code: 'CMN', name: 'Casablanca', countryCode: 'MA' },
  { code: 'RAK', name: 'Marrakech', countryCode: 'MA' },
];

// ============================================================================
// COUNTRY CODE TO NAME MAPPING
// ============================================================================

const COUNTRY_NAMES = {
  'US': 'United States',
  'ES': 'Spain',
  'PT': 'Portugal',
  'GB': 'United Kingdom',
  'IE': 'Ireland',
  'FR': 'France',
  'IT': 'Italy',
  'DE': 'Germany',
  'AT': 'Austria',
  'NL': 'Netherlands',
  'CZ': 'Czech Republic',
  'HU': 'Hungary',
  'GR': 'Greece',
  'TR': 'Turkey',
  'CH': 'Switzerland',
  'BE': 'Belgium',
  'DK': 'Denmark',
  'NO': 'Norway',
  'SE': 'Sweden',
  'FI': 'Finland',
  'PL': 'Poland',
  'JP': 'Japan',
  'SG': 'Singapore',
  'TH': 'Thailand',
  'HK': 'Hong Kong',
  'KR': 'South Korea',
  'CN': 'China',
  'IN': 'India',
  'MY': 'Malaysia',
  'VN': 'Vietnam',
  'ID': 'Indonesia',
  'AU': 'Australia',
  'NZ': 'New Zealand',
  'MX': 'Mexico',
  'BR': 'Brazil',
  'AR': 'Argentina',
  'PE': 'Peru',
  'CO': 'Colombia',
  'CL': 'Chile',
  'AE': 'United Arab Emirates',
  'QA': 'Qatar',
  'IL': 'Israel',
  'EG': 'Egypt',
  'ZA': 'South Africa',
  'MA': 'Morocco'
};

/**
 * Build a display name matching Viator's format: "City, State, Country" or "City, Country"
 */
function buildDisplayName(destination) {
  const name = getDestinationName(destination);
  const stateCode = destination.stateCode;
  const countryCode = destination.countryCode;
  const countryName = COUNTRY_NAMES[countryCode] || countryCode;

  // For US destinations: "Orlando, FL, United States"
  if (countryCode === 'US' && stateCode) {
    return `${name}, ${stateCode}, ${countryName}`;
  }

  // For other destinations: "Paris, France"
  return countryName ? `${name}, ${countryName}` : name;
}

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

    // Log sample destinations to help debug
    const sampleNames = destinationsCache.slice(0, 15).map(d => getDestinationName(d));
    logger.info(`Cached ${destinationsCache.length} destinations. Sample: ${sampleNames.join(', ')}`);
    
    return destinationsCache;

  } catch (error) {
    logger.error('Error fetching destinations:', error);
    throw error;
  }
}

// Common English city names to local names mapping
const CITY_NAME_ALIASES = {
  'lisbon': ['lisboa'],
  'munich': ['münchen', 'munchen'],
  'rome': ['roma'],
  'florence': ['firenze'],
  'venice': ['venezia'],
  'milan': ['milano'],
  'naples': ['napoli'],
  'cologne': ['köln', 'koln'],
  'vienna': ['wien'],
  'prague': ['praha'],
  'warsaw': ['warszawa'],
  'athens': ['athina', 'αθήνα'],
  'moscow': ['moskva', 'москва'],
  'brussels': ['bruxelles', 'brussel'],
  'copenhagen': ['københavn', 'kobenhavn'],
  'geneva': ['genève', 'geneve'],
  'zurich': ['zürich'],
};

/**
 * Find destination by name (fuzzy matching)
 * First tries API destinations, then falls back to popular destinations
 * NOTE: HotelBeds sandbox only returns ~100 obscure destinations in the Content API,
 * but the Booking API accepts codes for major cities. So fallback codes ARE valid!
 */
async function findDestination(destinationName) {
  const searchLower = destinationName.toLowerCase().trim();
  
  // Get alternative names if this is a common English name
  const alternativeNames = CITY_NAME_ALIASES[searchLower] || [];
  const searchTerms = [searchLower, ...alternativeNames];
  
  // Helper function to find match in a destinations array
  const findMatch = (destinations) => {
    for (const term of searchTerms) {
      // Try exact match first
      let match = destinations.find(d => 
        getDestinationName(d).toLowerCase() === term
      );
      if (match) return match;
      
      // Try partial match (destination name contains search term)
      match = destinations.find(d => 
        getDestinationName(d).toLowerCase().includes(term)
      );
      if (match) return match;
      
      // Try reverse partial match (search term contains destination name)
      match = destinations.find(d => 
        term.includes(getDestinationName(d).toLowerCase())
      );
      if (match) return match;
    }
    
    return null;
  };
  
  // Try API destinations first
  try {
    const apiDestinations = await fetchDestinations();
    const apiMatch = findMatch(apiDestinations);
    
    if (apiMatch) {
      logger.info(`Matched destination (API): "${destinationName}" → ${getDestinationName(apiMatch)} (${apiMatch.code})`);
      return apiMatch;
    }
  } catch (error) {
    logger.warn(`API destinations failed: ${error.message}`);
  }
  
  // Try fallback popular destinations
  // These codes work with the Booking API even though they're not in the Content API destinations list
  const fallbackMatch = findMatch(POPULAR_DESTINATIONS);
  
  if (fallbackMatch) {
    logger.info(`Matched destination (fallback): "${destinationName}" → ${getDestinationName(fallbackMatch)} (${fallbackMatch.code})`);
    return fallbackMatch;
  }
  
  logger.warn(`No destination match found for: "${destinationName}"`);
  return null;
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
 * Search for hotel availability using destination-based search
 * Uses the Booking API's destination filter for accurate results
 */
export async function searchHotels({
  destination,
  destinationCode = null,  // If provided, skip destination lookup
  checkIn,
  checkOut,
  adults = 2,
  children = 0,
  rooms = 1,
  currency = 'USD',
  resultCount = 20
}) {

  logger.info(`Hotel search: ${destination}, ${checkIn} to ${checkOut}, ${adults} adults, ${rooms} rooms`);

  // STEP 1: Find the destination (or use provided code)
  let destCode = destinationCode;
  let destInfo = null;

  if (!destCode) {
    destInfo = await findDestination(destination);

    if (!destInfo) {
      throw new Error(`Destination not found: ${destination}`);
    }

    destCode = destInfo.code;
    logger.info(`Resolved destination: "${destination}" → ${destCode}`);
  } else {
    logger.info(`Using provided destination code: ${destCode}`);
  }

  // STEP 2: Build occupancy structure for Booking API
  const occupancies = [];
  const adultsPerRoom = Math.max(1, Math.floor(adults / rooms));
  const childrenPerRoom = children > 0 ? Math.floor(children / rooms) : 0;

  for (let i = 0; i < rooms; i++) {
    occupancies.push({
      rooms: 1,
      adults: adultsPerRoom,
      children: childrenPerRoom
    });
  }

  // STEP 3: Search using destination code directly in Booking API
  // This is more reliable than the two-step Content API → Booking API approach
  const requestBody = {
    stay: {
      checkIn,
      checkOut
    },
    occupancies,
    destination: {
      code: destCode  // Search by destination code directly
    }
  };

  logger.info(`Searching hotels in destination ${destCode}...`);

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

    logger.info(`Received ${hotels.length} hotels with availability in ${destCode}`);

    // Format and return results
    const formattedHotels = hotels
      .slice(0, resultCount)
      .map(hotel => formatHotelResult(hotel, checkIn, checkOut));

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

function formatHotelResult(hotel, checkIn, checkOut) {
  // Get the best rate (cheapest)
  const rate = hotel.rooms?.[0]?.rates?.[0];
  const nights = calculateNights(checkIn, checkOut);

  // Calculate per-night price
  const totalPrice = parseFloat(rate?.net || 0);
  const pricePerNight = nights > 0 ? (totalPrice / nights).toFixed(2) : totalPrice;

  // Build image URL using HotelBeds GIATA image service
  // Format: https://photos.hotelbeds.com/giata/bigger/{hotelCode}/{imageNumber}.jpg
  const hotelCode = hotel.code;
  const images = [
    `https://photos.hotelbeds.com/giata/bigger/${hotelCode}/00.jpg`,
    `https://photos.hotelbeds.com/giata/bigger/${hotelCode}/01.jpg`,
    `https://photos.hotelbeds.com/giata/bigger/${hotelCode}/02.jpg`,
    `https://photos.hotelbeds.com/giata/bigger/${hotelCode}/03.jpg`,
    `https://photos.hotelbeds.com/giata/bigger/${hotelCode}/04.jpg`
  ];

  // Extract amenities from room info if available
  const amenities = [];
  if (rate?.boardName) amenities.push(rate.boardName);
  if (rate?.paymentType === 'AT_HOTEL') amenities.push('Pay at Hotel');
  if (rate?.paymentType === 'AT_WEB') amenities.push('Pay Online');
  if (hotel.categoryCode >= 4) amenities.push('Premium Property');

  // Get review score from rate key if available (some rates include it)
  const reviewScore = hotel.reviews?.[0]?.rate || null;

  return {
    id: hotelCode,
    name: hotel.name,
    description: '', // Available in Content API if needed
    category: hotel.categoryName || `${hotel.categoryCode} Star`,
    stars: parseInt(hotel.categoryCode) || 0,
    location: formatLocation(hotel),
    address: hotel.address || formatLocation(hotel),

    // Pricing
    totalPrice: totalPrice.toFixed(2),
    pricePerNight,
    currency: hotel.currency || 'USD',
    nights,

    // Images - using GIATA image service
    image: images[0],
    images,

    // Amenities
    amenities,

    // Room info
    roomType: hotel.rooms?.[0]?.name || 'Standard Room',
    boardType: rate?.boardName || 'Room Only',

    // Review score
    reviewScore,

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
 * Searches BOTH API destinations AND fallback popular destinations for best coverage
 * NOTE: Both API and fallback destination codes work with the Booking API!
 */
export async function searchDestinationsAutocomplete(searchTerm, limit = 8) {
  if (!searchTerm || searchTerm.length < 2) {
    return [];
  }

  const searchLower = searchTerm.toLowerCase();
  
  // Get alternative names if this is a common English name
  const alternativeNames = CITY_NAME_ALIASES[searchLower] || [];
  const searchTerms = [searchLower, ...alternativeNames];
  
  // Helper to score and filter destinations
  const scoreDestinations = (destinations) => {
    return destinations
      .filter(d => {
        const name = getDestinationName(d);
        if (!name) return false;
        const nameLower = name.toLowerCase();
        // Check if any search term matches
        return searchTerms.some(term => nameLower.includes(term));
      })
      .map(d => {
        const name = getDestinationName(d);
        const nameLower = name.toLowerCase();
        let score = 0;

        // Score based on best matching search term
        for (const term of searchTerms) {
          if (nameLower === term) {
            score = Math.max(score, 100);
          } else if (nameLower.startsWith(term)) {
            score = Math.max(score, 80);
          } else if (nameLower.includes(term)) {
            score = Math.max(score, 50);
          }
        }

        return {
          code: d.code,  // Always pass the code - both API and fallback codes work!
          name: name,
          stateCode: d.stateCode,  // Preserve state code for US destinations
          countryCode: d.countryCode,
          score
        };
      });
  };

  // Try API destinations first
  let apiResults = [];
  try {
    const apiDestinations = await fetchDestinations();
    apiResults = scoreDestinations(apiDestinations);
  } catch (error) {
    logger.warn(`HotelBeds API failed for autocomplete: ${error.message}`);
  }

  // Also search fallback destinations (popular cities with working codes)
  const fallbackResults = scoreDestinations(POPULAR_DESTINATIONS);

  // Combine results, preferring fallback for popular destinations
  const seenNames = new Set();
  const combined = [];
  
  // Add fallback results first (popular cities people are more likely to search for)
  for (const result of fallbackResults) {
    const key = result.name.toLowerCase();
    if (!seenNames.has(key)) {
      seenNames.add(key);
      combined.push({ ...result, score: result.score + 20 }); // Boost popular destinations
    }
  }
  
  // Add API results that aren't duplicates
  for (const result of apiResults) {
    const key = result.name.toLowerCase();
    if (!seenNames.has(key)) {
      seenNames.add(key);
      combined.push(result);
    }
  }

  // Sort by score and limit
  const sorted = combined
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  logger.info(`Autocomplete "${searchTerm}": found ${sorted.length} matches (${apiResults.length} API, ${fallbackResults.length} fallback)`);

  return sorted.map(d => ({
    code: d.code,
    name: d.name,
    stateCode: d.stateCode,
    countryCode: d.countryCode,
    displayName: buildDisplayName(d)
  }));
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
    stateCode: d.stateCode,
    countryCode: d.countryCode,
    displayName: buildDisplayName(d)
  }));
}

/**
 * Get list of all destinations
 */
export async function getDestinations() {
  try {
    const destinations = await fetchDestinations();
    return destinations.map(d => ({
      code: d.code,
      name: getDestinationName(d),
      stateCode: d.stateCode,
      countryCode: d.countryCode,
      displayName: buildDisplayName(d)
    }));
  } catch (error) {
    logger.warn(`Failed to get destinations, using fallback: ${error.message}`);
    return POPULAR_DESTINATIONS.map(d => ({
      code: d.code,
      name: getDestinationName(d),
      stateCode: d.stateCode,
      countryCode: d.countryCode,
      displayName: buildDisplayName(d)
    }));
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
