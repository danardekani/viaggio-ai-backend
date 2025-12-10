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
 * Fetch all available destinations from HotelBeds Content API
 * Results are cached for 30 days
 */
export async function fetchDestinations() {
  // Check cache
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
  const destinations = await fetchDestinations();
  const searchLower = destinationName.toLowerCase().trim();
  
  // Try exact match first
  let match = destinations.find(d => 
    d.name?.toLowerCase() === searchLower
  );
  
  // Try partial match
  if (!match) {
    match = destinations.find(d => 
      d.name?.toLowerCase().includes(searchLower)
    );
  }
  
  if (match) {
    logger.info(`Matched destination: "${destinationName}" → ${match.name} (${match.code})`);
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
      `${CONTENT_API_BASE}/hotels?fields=all&destinationCodes=${destinationCode}&language=en&from=1&to=${limit}`,
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
      throw new Error(`Hotel not found: ${hotelCode}`);
    }

    return formatHotelResult(hotel, checkIn, checkOut);

  } catch (error) {
    logger.error('Hotel details error:', error);
    throw error;
  }
}

// ============================================================================
// FORMAT HOTEL RESULT
// ============================================================================

function formatHotelResult(hotel, checkIn, checkOut, destinationHotels = []) {
  // Get the cheapest room rate
  const rooms = hotel.rooms || [];
  const cheapestRoom = rooms.sort((a, b) => {
    const aPrice = a.rates?.[0]?.net || Infinity;
    const bPrice = b.rates?.[0]?.net || Infinity;
    return aPrice - bPrice;
  })[0];

  const rate = cheapestRoom?.rates?.[0];
  const price = rate?.net ? parseFloat(rate.net) : 0;
  const currency = hotel.currency || 'USD';

  // Get additional info from Content API data if available
  const contentHotel = destinationHotels.find(h => parseInt(h.code) === hotel.code);

  // Get hotel images
  let image = null;
  const images = contentHotel?.images || [];
  if (images.length > 0) {
    const mainImage = images.find(img => img.type?.code === 'HAB') || images[0];
    if (mainImage?.path) {
      image = `http://photos.hotelbeds.com/giata/${mainImage.path}`;
    }
  }

  // Calculate nights
  const nights = calculateNights(checkIn, checkOut);

  // Extract star rating from categoryCode (e.g., "4EST" = 4 stars)
  const categoryMatch = hotel.categoryCode?.match(/(\d+)/);
  const starRating = categoryMatch ? parseInt(categoryMatch[1]) : null;

  return {
    id: hotel.code?.toString(),
    hotelCode: hotel.code,
    name: hotel.name,
    location: formatLocation(hotel),
    categoryCode: hotel.categoryCode,
    categoryName: hotel.categoryName,
    rating: starRating,
    
    // Pricing
    price,
    currency,
    pricePerNight: nights > 0 ? (price / nights).toFixed(2) : price.toFixed(2),
    totalPrice: price.toFixed(2),
    nights,
    rateType: rate?.rateType || 'BOOKABLE', // BOOKABLE or RECHECK
    
    // Images
    image,
    images: images.slice(0, 5).map(img => ({
      url: `http://photos.hotelbeds.com/giata/${img.path}`,
      type: img.type?.description
    })),
    
    // Details
    description: contentHotel?.description?.content || '',
    address: contentHotel?.address?.content || '',
    city: hotel.destinationName || '',
    country: contentHotel?.countryCode || '',
    coordinates: {
      latitude: parseFloat(hotel.latitude) || null,
      longitude: parseFloat(hotel.longitude) || null
    },
    
    // Amenities/Facilities
    facilities: contentHotel?.facilities?.slice(0, 10).map(f => f.description?.content) || [],
    
    // Room information
    roomCode: cheapestRoom?.code,
    roomName: cheapestRoom?.name || 'Standard Room',
    boardCode: rate?.boardCode,
    boardName: rate?.boardName || 'Room Only',
    
    // Booking info
    rateKey: rate?.rateKey, // Important for booking!
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
 */
export async function searchDestinationsAutocomplete(searchTerm, limit = 8) {
  if (!searchTerm || searchTerm.length < 2) {
    return [];
  }

  const destinations = await fetchDestinations();
  const searchLower = searchTerm.toLowerCase();
  
  // Score and filter destinations
  const scored = destinations
    .filter(d => d.name && d.name.toLowerCase().includes(searchLower))
    .map(d => {
      const nameLower = d.name.toLowerCase();
      let score = 0;
      
      // Exact match gets highest score
      if (nameLower === searchLower) score = 100;
      // Starts with search term
      else if (nameLower.startsWith(searchLower)) score = 80;
      // Contains search term
      else score = 50;
      
      return { ...d, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(d => ({
    code: d.code,
    name: d.name,
    countryCode: d.countryCode,
    displayName: d.countryCode ? `${d.name}, ${d.countryCode}` : d.name
  }));
}

/**
 * Get list of all destinations
 */
export async function getDestinations() {
  const destinations = await fetchDestinations();
  return destinations.map(d => ({
    code: d.code,
    name: d.name,
    countryCode: d.countryCode,
    displayName: d.countryCode ? `${d.name}, ${d.countryCode}` : d.name
  }));
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
