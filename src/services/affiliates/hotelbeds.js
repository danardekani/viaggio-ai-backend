// ============================================================================
// HOTELBEDS API SERVICE
// ============================================================================
// HotelBeds integration for hotel search and booking
// Two APIs: Content API (hotel info) and Booking API (availability/pricing)
// ============================================================================

import crypto from 'crypto';
import { logger } from '../utils/logger.js';

// API Configuration
const API_KEY = process.env.HOTELBEDS_API_KEY;
const API_SECRET = process.env.HOTELBEDS_API_SECRET;
const CONTENT_API_BASE = 'https://api.test.hotelbeds.com/hotel-content-api/1.0';
const BOOKING_API_BASE = 'https://api.test.hotelbeds.com/hotel-api/1.0';

// Cache configuration
const DESTINATIONS_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const HOTEL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

let destinationsCache = null;
let destinationsCacheTime = null;
const hotelCache = new Map();

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
      `${CONTENT_API_BASE}/locations/destinations?fields=all&language=en`,
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
    
    // DEBUG: Log sample hotel structure to verify data
    if (hotels.length > 0) {
      const sample = hotels[0];
      logger.info(`Sample Content API hotel - code: ${sample.code}, type: ${typeof sample.code}, hasImages: ${!!sample.images?.length}, hasFacilities: ${!!sample.facilities?.length}, hasDescription: ${!!sample.description?.content}`);
    }

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

  // Build a lookup map for faster matching (normalize codes to strings)
  const contentHotelMap = new Map();
  destinationHotels.forEach(h => {
    // Store by string version of code for consistent matching
    const codeStr = String(h.code);
    contentHotelMap.set(codeStr, h);
  });
  
  logger.info(`Built content hotel map with ${contentHotelMap.size} entries`);

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
    
    // DEBUG: Log sample booking API hotel
    if (hotels.length > 0) {
      const sample = hotels[0];
      logger.info(`Sample Booking API hotel - code: ${sample.code}, type: ${typeof sample.code}`);
    }

    // Format and return results - pass the lookup map
    const formattedHotels = hotels
      .map(hotel => formatHotelResult(hotel, checkIn, checkOut, contentHotelMap))
      .slice(0, resultCount);

    // DEBUG: Log how many hotels got content data
    const withImages = formattedHotels.filter(h => h.image).length;
    const withFacilities = formattedHotels.filter(h => h.facilities?.length > 0).length;
    logger.info(`Formatted ${formattedHotels.length} hotels: ${withImages} with images, ${withFacilities} with facilities`);

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

  // First, try to get content data for this specific hotel
  let contentHotel = null;
  try {
    const contentResponse = await fetch(
      `${CONTENT_API_BASE}/hotels/${hotelCode}?language=en`,
      {
        method: 'GET',
        headers: getHeaders()
      }
    );
    
    if (contentResponse.ok) {
      const contentData = await contentResponse.json();
      contentHotel = contentData.hotel;
      logger.info(`Got content data for hotel ${hotelCode}: hasImages=${!!contentHotel?.images?.length}, hasFacilities=${!!contentHotel?.facilities?.length}`);
    }
  } catch (err) {
    logger.warn(`Could not fetch content for hotel ${hotelCode}: ${err.message}`);
  }

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

    // Create a map with just this one hotel's content
    const contentMap = new Map();
    if (contentHotel) {
      contentMap.set(String(hotelCode), contentHotel);
    }

    return formatHotelResult(hotel, checkIn, checkOut, contentMap);

  } catch (error) {
    logger.error('Hotel details error:', error);
    throw error;
  }
}

// ============================================================================
// FORMAT HOTEL RESULT
// ============================================================================

function formatHotelResult(hotel, checkIn, checkOut, contentHotelMap = new Map()) {
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
  // Use string comparison for consistent matching
  const hotelCodeStr = String(hotel.code);
  const contentHotel = contentHotelMap.get(hotelCodeStr);
  
  // DEBUG: Log matching attempt
  if (!contentHotel) {
    logger.debug(`No content match for hotel code ${hotelCodeStr} (map size: ${contentHotelMap.size})`);
  }

  // Get hotel images from Content API
  let image = null;
  let images = [];
  
  if (contentHotel?.images && contentHotel.images.length > 0) {
    const contentImages = contentHotel.images;
    
    // Find main image (type HAB = room, GEN = general, COM = common areas)
    const mainImage = contentImages.find(img => img.type?.code === 'GEN') || 
                      contentImages.find(img => img.type?.code === 'HAB') || 
                      contentImages[0];
    
    if (mainImage?.path) {
      image = `https://photos.hotelbeds.com/giata/${mainImage.path}`;
    }
    
    // Get multiple images for gallery
    images = contentImages.slice(0, 10).map(img => ({
      url: `https://photos.hotelbeds.com/giata/${img.path}`,
      type: img.type?.description || 'Hotel'
    }));
  }

  // Calculate nights
  const nights = calculateNights(checkIn, checkOut);

  // Extract star rating from categoryCode (e.g., "4EST" = 4 stars)
  const categoryMatch = hotel.categoryCode?.match(/(\d+)/);
  const starRating = categoryMatch ? parseInt(categoryMatch[1]) : null;

  // Get facilities from Content API
  const facilities = [];
  if (contentHotel?.facilities && contentHotel.facilities.length > 0) {
    contentHotel.facilities.slice(0, 15).forEach(f => {
      const desc = f.description?.content;
      if (desc && !facilities.includes(desc)) {
        facilities.push(desc);
      }
    });
  }

  // Get description from Content API
  const description = contentHotel?.description?.content || '';

  // Get address from Content API
  const address = contentHotel?.address?.content || '';

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
    rateType: rate?.rateType || 'BOOKABLE',
    
    // Images (from Content API)
    image,
    images,
    
    // Details (from Content API)
    description,
    address,
    city: hotel.destinationName || '',
    country: contentHotel?.countryCode || '',
    coordinates: {
      latitude: parseFloat(hotel.latitude) || null,
      longitude: parseFloat(hotel.longitude) || null
    },
    
    // Amenities/Facilities (from Content API)
    facilities,
    
    // Room information
    roomCode: cheapestRoom?.code,
    roomName: cheapestRoom?.name || 'Standard Room',
    boardCode: rate?.boardCode,
    boardName: rate?.boardName || 'Room Only',
    
    // Booking info
    rateKey: rate?.rateKey,
    allotment: rate?.allotment,
    paymentType: rate?.paymentType,
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
  
  const scored = destinations
    .filter(d => d.name && d.name.toLowerCase().includes(searchLower))
    .map(d => {
      const nameLower = d.name.toLowerCase();
      let score = 0;
      
      if (nameLower === searchLower) score = 100;
      else if (nameLower.startsWith(searchLower)) score = 80;
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
