// ============================================================================
// HOTELBEDS API SERVICE - GEOLOCATION BASED
// ============================================================================
// Uses Google Geocoding API to convert city names to coordinates,
// then searches HotelBeds Booking API by geolocation for reliable results.
// ============================================================================

import crypto from 'crypto';
import { logger } from '../../utils/logger.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BOOKING_API_BASE = 'https://api.test.hotelbeds.com/hotel-api/1.0';
const CONTENT_API_BASE = 'https://api.test.hotelbeds.com/hotel-content-api/1.0';

// For production, change to:
// const BOOKING_API_BASE = 'https://api.hotelbeds.com/hotel-api/1.0';
// const CONTENT_API_BASE = 'https://api.hotelbeds.com/hotel-content-api/1.0';

const API_KEY = process.env.HOTELBEDS_API_KEY;
const API_SECRET = process.env.HOTELBEDS_API_SECRET;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Cache for geocoding results (24 hour TTL)
const geocodeCache = new Map();
const GEOCODE_CACHE_TTL = 24 * 60 * 60 * 1000;

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Generate HotelBeds API authentication headers
 * Signature = SHA256(apiKey + secret + timestamp)
 */
function getHeaders() {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash('sha256')
    .update(API_KEY + API_SECRET + timestamp)
    .digest('hex');

  return {
    'Api-key': API_KEY,
    'X-Signature': signature,
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip',
    'Content-Type': 'application/json'
  };
}

// ============================================================================
// GEOCODING - Convert city names to coordinates
// ============================================================================

/**
 * Geocode a city/destination name to latitude/longitude using Google Geocoding API
 */
async function geocodeCity(cityName) {
  // Check cache first
  const cacheKey = cityName.toLowerCase().trim();
  const cached = geocodeCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < GEOCODE_CACHE_TTL) {
    logger.info(`Using cached geocode for "${cityName}"`);
    return cached.data;
  }

  if (!GOOGLE_MAPS_API_KEY) {
    logger.error('GOOGLE_MAPS_API_KEY is not configured');
    throw new Error('Geocoding service not configured');
  }

  logger.info(`Geocoding city: "${cityName}"`);

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(cityName)}&key=${GOOGLE_MAPS_API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'ZERO_RESULTS') {
      logger.warn(`No geocoding results for "${cityName}"`);
      return null;
    }

    if (data.status !== 'OK') {
      logger.error(`Geocoding API error: ${data.status} - ${data.error_message || ''}`);
      throw new Error(`Geocoding failed: ${data.status}`);
    }

    if (data.results && data.results.length > 0) {
      const result = data.results[0];
      const location = result.geometry.location;
      
      const geoData = {
        latitude: location.lat,
        longitude: location.lng,
        formattedAddress: result.formatted_address,
        placeId: result.place_id
      };

      // Cache the result
      geocodeCache.set(cacheKey, {
        data: geoData,
        timestamp: Date.now()
      });

      logger.info(`Geocoded "${cityName}" → ${geoData.latitude}, ${geoData.longitude} (${geoData.formattedAddress})`);
      return geoData;
    }

    return null;

  } catch (error) {
    logger.error('Geocoding error:', error.message);
    throw error;
  }
}

// ============================================================================
// HOTEL SEARCH - Main search function using geolocation
// ============================================================================

/**
 * Search for hotels using geolocation
 * 
 * @param {Object} params - Search parameters
 * @param {string} params.destination - City or location name
 * @param {string} params.checkIn - Check-in date (YYYY-MM-DD)
 * @param {string} params.checkOut - Check-out date (YYYY-MM-DD)
 * @param {number} params.adults - Number of adults (default: 2)
 * @param {number} params.children - Number of children (default: 0)
 * @param {number} params.rooms - Number of rooms (default: 1)
 * @param {string} params.currency - Currency code (default: USD)
 * @param {number} params.resultCount - Max results to return (default: 20)
 * @returns {Array} - Array of formatted hotel results
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

  // Validate inputs
  if (!destination) {
    throw new Error('Destination is required');
  }
  if (!checkIn || !checkOut) {
    throw new Error('Check-in and check-out dates are required');
  }

  // STEP 1: Geocode the destination
  const geo = await geocodeCity(destination);
  
  if (!geo) {
    throw new Error(`Could not find location: ${destination}. Please check the spelling or try a different city name.`);
  }

  // STEP 2: Build occupancy structure for each room
  const occupancies = [];
  const adultsPerRoom = Math.ceil(adults / rooms);
  
  for (let i = 0; i < rooms; i++) {
    const roomOccupancy = {
      rooms: 1,
      adults: adultsPerRoom,
      children: 0
    };
    
    // Add children ages if needed (HotelBeds requires ages for children)
    if (children > 0 && i === 0) {
      roomOccupancy.children = children;
      roomOccupancy.paxes = [];
      for (let c = 0; c < children; c++) {
        roomOccupancy.paxes.push({ type: 'CH', age: 8 }); // Default age 8
      }
    }
    
    occupancies.push(roomOccupancy);
  }

  // STEP 3: Build the search request
  const requestBody = {
    stay: {
      checkIn,
      checkOut
    },
    occupancies,
    geolocation: {
      latitude: geo.latitude,
      longitude: geo.longitude,
      radius: 30,
      unit: 'km'
    },
    filter: {
      maxHotels: Math.min(resultCount * 2, 50), // Get extra for filtering
      maxRooms: 5
    }
  };

  logger.info(`Searching HotelBeds API near ${geo.latitude}, ${geo.longitude}...`);

  // STEP 4: Call HotelBeds Booking API
  try {
    const response = await fetch(
      `${BOOKING_API_BASE}/hotels`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`HotelBeds Booking API Error: ${response.status} - ${errorText}`);
      
      // Parse error for better messaging
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error) {
          throw new Error(`HotelBeds API: ${errorData.error.message || errorData.error.code}`);
        }
      } catch (parseErr) {
        // If can't parse, throw generic error
      }
      
      throw new Error(`HotelBeds API error: ${response.status}`);
    }

    const data = await response.json();
    const hotels = data.hotels?.hotels || [];

    logger.info(`Found ${hotels.length} hotels near ${destination}`);

    if (hotels.length === 0) {
      return [];
    }

    // STEP 5: Format and return results
    const formattedHotels = hotels
      .slice(0, resultCount)
      .map(hotel => formatHotelResult(hotel, checkIn, checkOut, geo.formattedAddress));

    return formattedHotels;

  } catch (error) {
    logger.error('Hotel search error:', error.message);
    throw error;
  }
}

// ============================================================================
// HOTEL DETAILS - Get detailed info for a specific hotel
// ============================================================================

/**
 * Get detailed information about a specific hotel with availability
 */
export async function getHotelDetails(hotelCode, checkIn, checkOut, adults = 2) {
  logger.info(`Getting hotel details: ${hotelCode}, ${checkIn} to ${checkOut}`);

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
    const response = await fetch(
      `${BOOKING_API_BASE}/hotels`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`HotelBeds API Error: ${response.status} - ${errorText}`);
      throw new Error(`HotelBeds API error: ${response.status}`);
    }

    const data = await response.json();
    const hotels = data.hotels?.hotels || [];

    if (hotels.length === 0) {
      throw new Error('Hotel not found or not available for these dates');
    }

    return formatHotelResult(hotels[0], checkIn, checkOut);

  } catch (error) {
    logger.error('Hotel details error:', error.message);
    throw error;
  }
}

// ============================================================================
// RESULT FORMATTING
// ============================================================================

/**
 * Format a hotel from the API response into a consistent structure
 */
function formatHotelResult(hotel, checkIn, checkOut, locationContext = '') {
  // Get the cheapest room/rate
  const rooms = hotel.rooms || [];
  let cheapestRate = null;
  let cheapestRoom = null;

  for (const room of rooms) {
    for (const rate of room.rates || []) {
      const price = parseFloat(rate.net);
      if (!cheapestRate || price < parseFloat(cheapestRate.net)) {
        cheapestRate = rate;
        cheapestRoom = room;
      }
    }
  }

  const totalPrice = cheapestRate ? parseFloat(cheapestRate.net) : null;
  const nights = calculateNights(checkIn, checkOut);
  const pricePerNight = totalPrice && nights > 0 ? (totalPrice / nights).toFixed(2) : null;

  // Build amenities list from facilities if available
  const amenities = [];
  if (hotel.facilities) {
    hotel.facilities.slice(0, 6).forEach(f => {
      if (f.description?.content) {
        amenities.push(f.description.content);
      }
    });
  }

  return {
    id: hotel.code?.toString(),
    code: hotel.code?.toString(),
    name: hotel.name || 'Unknown Hotel',
    description: hotel.description?.content || null,
    
    // Location
    location: formatLocation(hotel, locationContext),
    address: hotel.address?.content || null,
    city: hotel.city?.content || hotel.destinationName || null,
    
    // Coordinates
    latitude: hotel.latitude,
    longitude: hotel.longitude,
    
    // Category/Rating
    category: hotel.categoryName || hotel.categoryCode,
    categoryCode: hotel.categoryCode,
    stars: parseStarRating(hotel.categoryCode),
    
    // Pricing
    price: totalPrice,
    totalPrice: totalPrice,
    pricePerNight: pricePerNight ? parseFloat(pricePerNight) : null,
    currency: cheapestRate?.currency || 'USD',
    
    // Room info
    roomType: cheapestRoom?.name || null,
    boardType: cheapestRate?.boardName || cheapestRate?.boardCode || null,
    
    // Availability
    available: rooms.length > 0,
    roomsAvailable: cheapestRate?.allotment || null,
    
    // Policies
    cancellationPolicy: formatCancellationPolicy(cheapestRate?.cancellationPolicies),
    paymentType: cheapestRate?.paymentType,
    
    // Images
    image: hotel.images?.[0]?.path 
      ? `https://photos.hotelbeds.com/giata/bigger/${hotel.images[0].path}`
      : null,
    images: (hotel.images || []).slice(0, 5).map(img => 
      `https://photos.hotelbeds.com/giata/bigger/${img.path}`
    ),
    
    // Amenities
    amenities: amenities.length > 0 ? amenities : ['WiFi', 'Air Conditioning'],
    
    // Dates
    checkIn,
    checkOut,
    nights,
    
    // Links
    bookingLink: `/book/hotel/${hotel.code}?checkIn=${checkIn}&checkOut=${checkOut}`,
    
    // Raw data for advanced use
    rateKey: cheapestRate?.rateKey || null
  };
}

/**
 * Format location string from hotel data
 */
function formatLocation(hotel, locationContext = '') {
  const parts = [];
  
  if (hotel.zoneName) {
    parts.push(hotel.zoneName);
  }
  if (hotel.destinationName) {
    parts.push(hotel.destinationName);
  }
  
  if (parts.length > 0) {
    return parts.join(', ');
  }
  
  if (locationContext) {
    return locationContext;
  }
  
  return 'Location not specified';
}

/**
 * Parse star rating from category code (e.g., "4EST" -> 4)
 */
function parseStarRating(categoryCode) {
  if (!categoryCode) return null;
  const match = categoryCode.match(/^(\d)/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Calculate number of nights between dates
 */
function calculateNights(checkIn, checkOut) {
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const diffTime = Math.abs(end - start);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Format cancellation policy for display
 */
function formatCancellationPolicy(policies) {
  if (!policies || policies.length === 0) {
    return 'Contact hotel for cancellation policy';
  }
  
  const firstPolicy = policies[0];
  if (firstPolicy.amount === '0.00' || firstPolicy.amount === '0') {
    const fromDate = new Date(firstPolicy.from);
    return `Free cancellation until ${fromDate.toLocaleDateString()}`;
  }
  
  return 'Cancellation fees may apply';
}

// ============================================================================
// AUTOCOMPLETE - For search suggestions
// ============================================================================

/**
 * Search for destination suggestions using Google Places Autocomplete
 */
export async function searchDestinationsAutocomplete(searchTerm, limit = 8) {
  if (!searchTerm || searchTerm.length < 2) {
    return [];
  }

  if (!GOOGLE_MAPS_API_KEY) {
    logger.warn('GOOGLE_MAPS_API_KEY not configured, autocomplete unavailable');
    return [];
  }

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(searchTerm)}&types=(cities)&key=${GOOGLE_MAPS_API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`Places API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      logger.error(`Places API error: ${data.status}`);
      return [];
    }

    const predictions = data.predictions || [];
    
    return predictions.slice(0, limit).map(p => ({
      name: p.structured_formatting?.main_text || p.description,
      displayName: p.description,
      placeId: p.place_id
    }));

  } catch (error) {
    logger.error('Autocomplete error:', error.message);
    return [];
  }
}

// ============================================================================
// DESTINATIONS LIST - For UI dropdowns (uses popular cities)
// ============================================================================

/**
 * Get list of popular destinations for dropdowns
 * This returns a static list of popular destinations since we use geocoding
 */
export async function getDestinations() {
  // Return popular destinations - these will be geocoded when searched
  const popularDestinations = [
    { code: 'NYC', name: 'New York', countryCode: 'US', displayName: 'New York, USA' },
    { code: 'LON', name: 'London', countryCode: 'GB', displayName: 'London, UK' },
    { code: 'PAR', name: 'Paris', countryCode: 'FR', displayName: 'Paris, France' },
    { code: 'ROM', name: 'Rome', countryCode: 'IT', displayName: 'Rome, Italy' },
    { code: 'BCN', name: 'Barcelona', countryCode: 'ES', displayName: 'Barcelona, Spain' },
    { code: 'DXB', name: 'Dubai', countryCode: 'AE', displayName: 'Dubai, UAE' },
    { code: 'TYO', name: 'Tokyo', countryCode: 'JP', displayName: 'Tokyo, Japan' },
    { code: 'LAX', name: 'Los Angeles', countryCode: 'US', displayName: 'Los Angeles, USA' },
    { code: 'MIA', name: 'Miami', countryCode: 'US', displayName: 'Miami, USA' },
    { code: 'LAS', name: 'Las Vegas', countryCode: 'US', displayName: 'Las Vegas, USA' },
    { code: 'SFO', name: 'San Francisco', countryCode: 'US', displayName: 'San Francisco, USA' },
    { code: 'CHI', name: 'Chicago', countryCode: 'US', displayName: 'Chicago, USA' },
    { code: 'AMS', name: 'Amsterdam', countryCode: 'NL', displayName: 'Amsterdam, Netherlands' },
    { code: 'BKK', name: 'Bangkok', countryCode: 'TH', displayName: 'Bangkok, Thailand' },
    { code: 'SIN', name: 'Singapore', countryCode: 'SG', displayName: 'Singapore' },
    { code: 'SYD', name: 'Sydney', countryCode: 'AU', displayName: 'Sydney, Australia' },
    { code: 'CUN', name: 'Cancun', countryCode: 'MX', displayName: 'Cancun, Mexico' },
    { code: 'IST', name: 'Istanbul', countryCode: 'TR', displayName: 'Istanbul, Turkey' },
    { code: 'MAD', name: 'Madrid', countryCode: 'ES', displayName: 'Madrid, Spain' },
    { code: 'MIL', name: 'Milan', countryCode: 'IT', displayName: 'Milan, Italy' }
  ];

  return popularDestinations;
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

/**
 * Clear geocoding cache (useful for debugging)
 */
export function clearGeocodeCache() {
  geocodeCache.clear();
  logger.info('Geocode cache cleared');
}

/**
 * Clear all caches
 */
export function clearAllCaches() {
  geocodeCache.clear();
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
  clearGeocodeCache,
  clearAllCaches
};
