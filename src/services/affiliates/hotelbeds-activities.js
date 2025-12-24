// ============================================================================
// HOTELBEDS ACTIVITIES API SERVICE
// ============================================================================
// Integration with HotelBeds Activities API for tours and experiences
// API Docs: https://developer.hotelbeds.com/documentation/activities/
// ============================================================================

import crypto from 'crypto';
import { logger } from '../../utils/logger.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// API Base URLs - Sandbox
const ACTIVITY_API_BASE = 'https://api.test.hotelbeds.com/activity-api/3.0';
const ACTIVITY_CONTENT_API_BASE = 'https://api.test.hotelbeds.com/activity-content-api/3.0';

// For Production, change to:
// const ACTIVITY_API_BASE = 'https://api.hotelbeds.com/activity-api/3.0';
// const ACTIVITY_CONTENT_API_BASE = 'https://api.hotelbeds.com/activity-content-api/3.0';

const API_KEY = process.env.HOTELBEDS_API_KEY;
const API_SECRET = process.env.HOTELBEDS_API_SECRET;

const FETCH_TIMEOUT_MS = 15000; // 15 second timeout

// ============================================================================
// CACHE
// ============================================================================

const activityCache = new Map();
const ACTIVITY_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const contentCache = new Map();
const CONTENT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================================
// DESTINATION MAPPING
// Maps destination names to HotelBeds destination codes
// ============================================================================

const DESTINATION_CODES = {
  // United States
  'new york': 'NYC', 'new york city': 'NYC', 'manhattan': 'NYC',
  'los angeles': 'LAX', 'la': 'LAX',
  'chicago': 'CHI',
  'miami': 'MIA', 'miami beach': 'MIA',
  'san francisco': 'SFO',
  'las vegas': 'LAS', 'vegas': 'LAS',
  'orlando': 'ORL',
  'boston': 'BOS',
  'washington': 'WAS', 'washington dc': 'WAS', 'dc': 'WAS',
  'seattle': 'SEA',
  'denver': 'DEN',
  'atlanta': 'ATL',
  'phoenix': 'PHX',
  'san diego': 'SAN',
  'austin': 'AUS',
  'nashville': 'NAS',
  'new orleans': 'NOL',
  'philadelphia': 'PHL',
  'honolulu': 'HNL', 'hawaii': 'HNL', 'oahu': 'HNL',

  // Europe - Spain
  'barcelona': 'BCN',
  'madrid': 'MAD',
  'seville': 'SEV', 'sevilla': 'SEV',
  'valencia': 'VLC',
  'malaga': 'AGP',
  'granada': 'GRX',

  // Europe - Portugal
  'lisbon': 'LIS', 'lisboa': 'LIS',
  'porto': 'OPO',
  'faro': 'FAO', 'algarve': 'FAO',

  // Europe - UK & Ireland
  'london': 'LON',
  'edinburgh': 'EDI',
  'manchester': 'MAN',
  'dublin': 'DUB',

  // Europe - France
  'paris': 'PAR',
  'nice': 'NCE',
  'lyon': 'LYS',

  // Europe - Italy
  'rome': 'ROM', 'roma': 'ROM',
  'milan': 'MIL', 'milano': 'MIL',
  'venice': 'VCE', 'venezia': 'VCE',
  'florence': 'FLR', 'firenze': 'FLR',
  'naples': 'NAP', 'napoli': 'NAP',

  // Europe - Germany & Austria
  'berlin': 'BER',
  'munich': 'MUC', 'munchen': 'MUC',
  'frankfurt': 'FRA',
  'vienna': 'VIE', 'wien': 'VIE',

  // Europe - Other
  'amsterdam': 'AMS',
  'prague': 'PRG', 'praha': 'PRG',
  'budapest': 'BUD',
  'athens': 'ATH',
  'istanbul': 'IST',
  'zurich': 'ZRH',
  'geneva': 'GVA',
  'brussels': 'BRU',
  'copenhagen': 'CPH',
  'oslo': 'OSL',
  'stockholm': 'STO',
  'helsinki': 'HEL',
  'warsaw': 'WAW',
  'krakow': 'KRK',

  // Asia
  'tokyo': 'TYO',
  'singapore': 'SIN',
  'bangkok': 'BKK',
  'hong kong': 'HKG',
  'seoul': 'SEL',
  'beijing': 'PEK',
  'shanghai': 'SHA',
  'delhi': 'DEL', 'new delhi': 'DEL',
  'mumbai': 'BOM', 'bombay': 'BOM',
  'kuala lumpur': 'KUL', 'kl': 'KUL',
  'hanoi': 'HAN',
  'ho chi minh': 'SGN', 'ho chi minh city': 'SGN', 'saigon': 'SGN',
  'bali': 'DPS', 'denpasar': 'DPS',

  // Oceania
  'sydney': 'SYD',
  'melbourne': 'MEL',
  'auckland': 'AKL',

  // Americas
  'cancun': 'CUN',
  'mexico city': 'MEX',
  'rio de janeiro': 'RIO', 'rio': 'RIO',
  'sao paulo': 'SAO',
  'buenos aires': 'BUE',
  'lima': 'LIM',
  'bogota': 'BOG',
  'santiago': 'SCL',

  // Middle East & Africa
  'dubai': 'DXB',
  'abu dhabi': 'AUH',
  'doha': 'DOH',
  'tel aviv': 'TLV',
  'cairo': 'CAI',
  'cape town': 'CPT',
  'johannesburg': 'JNB',
  'casablanca': 'CMN',
  'marrakech': 'RAK', 'marrakesh': 'RAK',
};

// Coordinates for GPS-based search fallback
const DESTINATION_COORDS = {
  'NYC': { lat: 40.7128, lng: -74.0060 },
  'LAX': { lat: 34.0522, lng: -118.2437 },
  'CHI': { lat: 41.8781, lng: -87.6298 },
  'MIA': { lat: 25.7617, lng: -80.1918 },
  'SFO': { lat: 37.7749, lng: -122.4194 },
  'LAS': { lat: 36.1699, lng: -115.1398 },
  'ORL': { lat: 28.5383, lng: -81.3792 },
  'BOS': { lat: 42.3601, lng: -71.0589 },
  'WAS': { lat: 38.9072, lng: -77.0369 },
  'SEA': { lat: 47.6062, lng: -122.3321 },
  'BCN': { lat: 41.3851, lng: 2.1734 },
  'MAD': { lat: 40.4168, lng: -3.7038 },
  'PAR': { lat: 48.8566, lng: 2.3522 },
  'LON': { lat: 51.5074, lng: -0.1278 },
  'ROM': { lat: 41.9028, lng: 12.4964 },
  'VCE': { lat: 45.4408, lng: 12.3155 },
  'FLR': { lat: 43.7696, lng: 11.2558 },
  'AMS': { lat: 52.3676, lng: 4.9041 },
  'PRG': { lat: 50.0755, lng: 14.4378 },
  'VIE': { lat: 48.2082, lng: 16.3738 },
  'LIS': { lat: 38.7223, lng: -9.1393 },
  'DUB': { lat: 53.3498, lng: -6.2603 },
  'TYO': { lat: 35.6762, lng: 139.6503 },
  'SIN': { lat: 1.3521, lng: 103.8198 },
  'BKK': { lat: 13.7563, lng: 100.5018 },
  'DXB': { lat: 25.2048, lng: 55.2708 },
  'SYD': { lat: -33.8688, lng: 151.2093 },
  'CUN': { lat: 21.1619, lng: -86.8515 },
};

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
// FETCH WITH TIMEOUT
// ============================================================================

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// DESTINATION LOOKUP
// ============================================================================

/**
 * Find destination code from search query
 */
function findDestination(query) {
  const normalized = query.toLowerCase().trim();

  // Direct match
  if (DESTINATION_CODES[normalized]) {
    const code = DESTINATION_CODES[normalized];
    return {
      code,
      coords: DESTINATION_COORDS[code] || null
    };
  }

  // Partial match
  for (const [key, code] of Object.entries(DESTINATION_CODES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return {
        code,
        coords: DESTINATION_COORDS[code] || null
      };
    }
  }

  return null;
}

// ============================================================================
// ACTIVITY SEARCH
// ============================================================================

/**
 * Search for activities in a destination
 *
 * @param {Object} options Search options
 * @param {string} options.destination Destination name (e.g., "Barcelona", "New York")
 * @param {string} options.startDate Start date (YYYY-MM-DD)
 * @param {string} options.endDate End date (YYYY-MM-DD)
 * @param {number} options.resultCount Max results to return
 * @param {string} options.sortBy Sort order: 'popular', 'price_low', 'price_high', 'name'
 * @returns {Promise<Object>} Search results with normalized activity data
 */
export async function searchActivities({
  destination,
  startDate,
  endDate,
  resultCount = 50,
  sortBy = 'popular',
  minPrice,
  maxPrice
}) {
  if (!API_KEY || !API_SECRET) {
    logger.warn('HotelBeds API credentials not configured');
    return { activities: [], totalCount: 0, provider: 'hotelbeds' };
  }

  const destInfo = findDestination(destination);
  if (!destInfo) {
    logger.warn(`Destination not found for HotelBeds Activities: ${destination}`);
    return { activities: [], totalCount: 0, provider: 'hotelbeds' };
  }

  // Generate cache key
  const cacheKey = `${destInfo.code}_${startDate}_${endDate}_${sortBy}_${minPrice}_${maxPrice}`;
  const cached = activityCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ACTIVITY_CACHE_TTL) {
    logger.info(`[HotelBeds Activities] Cache hit for ${destination}`);
    const activities = cached.data.slice(0, resultCount);
    return {
      activities,
      totalCount: cached.totalCount,
      hasMore: cached.totalCount > resultCount,
      provider: 'hotelbeds'
    };
  }

  // Build default dates if not provided (next 30 days)
  const today = new Date();
  const defaultStart = startDate || today.toISOString().split('T')[0];
  const defaultEnd = endDate || new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Build search filters
  const searchFilterItems = [];

  // Try destination code first
  searchFilterItems.push({ type: 'destination', value: destInfo.code });

  // Add price filters if provided
  if (minPrice) {
    searchFilterItems.push({ type: 'priceFrom', value: String(minPrice) });
  }
  if (maxPrice) {
    searchFilterItems.push({ type: 'priceTo', value: String(maxPrice) });
  }

  const requestBody = {
    filters: [{
      searchFilterItems
    }],
    from: defaultStart,
    to: defaultEnd,
    language: 'en',
    pagination: {
      itemsPerPage: Math.min(resultCount * 2, 100), // Fetch more to allow for filtering
      page: 1
    },
    order: mapSortOrder(sortBy)
  };

  logger.info(`[HotelBeds Activities] Searching: ${destination} (${destInfo.code}), ${defaultStart} to ${defaultEnd}`);

  try {
    const response = await fetchWithTimeout(`${ACTIVITY_API_BASE}/activities`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[HotelBeds Activities] API error ${response.status}:`, errorText);

      // If destination code fails, try GPS coordinates
      if (destInfo.coords && response.status === 400) {
        return searchActivitiesByGPS({
          coords: destInfo.coords,
          destination,
          startDate: defaultStart,
          endDate: defaultEnd,
          resultCount,
          sortBy,
          minPrice,
          maxPrice
        });
      }

      return { activities: [], totalCount: 0, provider: 'hotelbeds' };
    }

    const data = await response.json();
    const activities = data.activities || [];

    logger.info(`[HotelBeds Activities] Found ${activities.length} activities in ${destination}`);

    // Fetch content for images and descriptions
    const activityCodes = activities.map(a => a.code).filter(Boolean);
    const contentMap = await fetchActivityContent(activityCodes);

    // Normalize activities to match Viator format
    const normalizedActivities = activities.map(activity =>
      normalizeActivity(activity, contentMap.get(activity.code), destination)
    );

    // Cache the results
    activityCache.set(cacheKey, {
      data: normalizedActivities,
      totalCount: data.totalItems || normalizedActivities.length,
      timestamp: Date.now()
    });

    return {
      activities: normalizedActivities.slice(0, resultCount),
      totalCount: data.totalItems || normalizedActivities.length,
      hasMore: (data.totalItems || normalizedActivities.length) > resultCount,
      provider: 'hotelbeds'
    };

  } catch (error) {
    logger.error('[HotelBeds Activities] Search error:', error.message);
    return { activities: [], totalCount: 0, provider: 'hotelbeds' };
  }
}

/**
 * Search activities by GPS coordinates (fallback)
 */
async function searchActivitiesByGPS({
  coords,
  destination,
  startDate,
  endDate,
  resultCount = 50,
  sortBy = 'popular',
  minPrice,
  maxPrice
}) {
  const searchFilterItems = [
    { type: 'gps', latitude: coords.lat, longitude: coords.lng }
  ];

  if (minPrice) {
    searchFilterItems.push({ type: 'priceFrom', value: String(minPrice) });
  }
  if (maxPrice) {
    searchFilterItems.push({ type: 'priceTo', value: String(maxPrice) });
  }

  const requestBody = {
    filters: [{
      searchFilterItems
    }],
    from: startDate,
    to: endDate,
    language: 'en',
    pagination: {
      itemsPerPage: Math.min(resultCount * 2, 100),
      page: 1
    },
    order: mapSortOrder(sortBy)
  };

  logger.info(`[HotelBeds Activities] GPS search: ${destination} (${coords.lat}, ${coords.lng})`);

  try {
    const response = await fetchWithTimeout(`${ACTIVITY_API_BASE}/activities`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[HotelBeds Activities] GPS search error ${response.status}:`, errorText);
      return { activities: [], totalCount: 0, provider: 'hotelbeds' };
    }

    const data = await response.json();
    const activities = data.activities || [];

    logger.info(`[HotelBeds Activities] GPS search found ${activities.length} activities`);

    // Fetch content for images
    const activityCodes = activities.map(a => a.code).filter(Boolean);
    const contentMap = await fetchActivityContent(activityCodes);

    // Normalize activities
    const normalizedActivities = activities.map(activity =>
      normalizeActivity(activity, contentMap.get(activity.code), destination)
    );

    return {
      activities: normalizedActivities.slice(0, resultCount),
      totalCount: data.totalItems || normalizedActivities.length,
      hasMore: (data.totalItems || normalizedActivities.length) > resultCount,
      provider: 'hotelbeds'
    };

  } catch (error) {
    logger.error('[HotelBeds Activities] GPS search error:', error.message);
    return { activities: [], totalCount: 0, provider: 'hotelbeds' };
  }
}

// ============================================================================
// ACTIVITY CONTENT (Images, Descriptions)
// ============================================================================

/**
 * Fetch activity content from Content API
 */
async function fetchActivityContent(activityCodes) {
  const contentMap = new Map();

  if (!activityCodes || activityCodes.length === 0) {
    return contentMap;
  }

  // Check cache first
  const uncachedCodes = [];
  for (const code of activityCodes) {
    const cached = contentCache.get(code);
    if (cached && Date.now() - cached.timestamp < CONTENT_CACHE_TTL) {
      contentMap.set(code, cached.data);
    } else {
      uncachedCodes.push(code);
    }
  }

  if (uncachedCodes.length === 0) {
    return contentMap;
  }

  // Batch fetch content (max 100 at a time)
  const BATCH_SIZE = 50;

  for (let i = 0; i < uncachedCodes.length; i += BATCH_SIZE) {
    const batch = uncachedCodes.slice(i, i + BATCH_SIZE);

    try {
      const requestBody = {
        codes: batch,
        language: 'en'
      };

      const response = await fetchWithTimeout(`${ACTIVITY_CONTENT_API_BASE}/activities`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        const data = await response.json();
        const activities = data.activitiesContent || [];

        for (const activity of activities) {
          const code = activity.code;
          contentCache.set(code, {
            data: activity,
            timestamp: Date.now()
          });
          contentMap.set(code, activity);
        }
      }
    } catch (error) {
      logger.warn('[HotelBeds Activities] Content fetch error:', error.message);
    }
  }

  return contentMap;
}

// ============================================================================
// DATA NORMALIZATION
// ============================================================================

/**
 * Map sort order to HotelBeds API format
 */
function mapSortOrder(sortBy) {
  switch (sortBy) {
    case 'price_low':
    case 'price':
      return 'PRICE';
    case 'name':
      return 'NAME';
    case 'popular':
    case 'reviews':
    case 'rating':
    default:
      return 'DEFAULT';
  }
}

/**
 * Normalize HotelBeds activity to match Viator tour format
 */
function normalizeActivity(activity, content, destination) {
  // Extract price
  const priceInfo = activity.amountsFrom?.[0] || {};
  const price = priceInfo.amount || activity.amountFrom || 0;
  const currency = priceInfo.currencyCode || activity.currency || 'USD';

  // Extract duration from modalities
  let durationMinutes = null;
  let durationText = null;

  if (activity.modalities?.[0]) {
    const modality = activity.modalities[0];
    if (modality.duration) {
      // Duration might be in different formats
      const durMatch = modality.duration.match(/(\d+)\s*(hour|hr|h|minute|min|m|day|d)/i);
      if (durMatch) {
        const value = parseInt(durMatch[1]);
        const unit = durMatch[2].toLowerCase();
        if (unit.startsWith('h')) {
          durationMinutes = value * 60;
        } else if (unit.startsWith('m')) {
          durationMinutes = value;
        } else if (unit.startsWith('d')) {
          durationMinutes = value * 24 * 60;
        }
      }
      durationText = modality.duration;
    }
  }

  // Format duration display
  let duration = durationText;
  if (!duration && durationMinutes) {
    if (durationMinutes >= 60) {
      const hours = Math.floor(durationMinutes / 60);
      const mins = durationMinutes % 60;
      duration = mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
    } else {
      duration = `${durationMinutes} minutes`;
    }
  }

  // Extract images from content
  const images = extractImages(content);
  const image = images[0] || null;

  // Build flags
  const flags = [];
  if (activity.freeCancellation) flags.push('FREE_CANCELLATION');
  if (activity.instantConfirmation) flags.push('INSTANT_CONFIRMATION');

  // Extract description
  const description = content?.description ||
    content?.shortDescription ||
    activity.name || '';

  // Build booking link
  const bookingLink = buildActivityBookingLink(activity.code, destination);

  return {
    id: `hb_${activity.code}`,
    name: activity.name || content?.name || 'Activity',
    description: cleanDescription(description),
    duration,
    durationMinutes,
    rating: activity.rating || null,
    reviewCount: activity.reviewCount || 0,
    price: parseFloat(price) || 0,
    originalPrice: null,
    hasDiscount: false,
    currency,
    image,
    images,
    flags,
    bookingLink,
    link: bookingLink,
    productCode: activity.code,
    pricingType: 'person',
    pricingUnit: 'PER_PERSON',
    maxGroupSize: null,
    isPrivateTour: (activity.name || '').toLowerCase().includes('private'),
    highlights: content?.highlights || [],
    insiderTips: [],
    inclusions: content?.includes || [],
    exclusions: content?.excludes || [],
    itinerary: [],
    additionalInfo: content?.importantInfo || [],
    cancellationPolicy: activity.freeCancellation ?
      'Free cancellation available' :
      (content?.cancellationPolicy || null),
    languages: content?.languages || [],
    // Provider identification
    provider: 'hotelbeds',
    providerCode: activity.code,
    destination: destination
  };
}

/**
 * Extract images from content
 */
function extractImages(content) {
  if (!content?.media?.images) {
    return [];
  }

  // Sort by size preference (large > medium > small)
  const sizeOrder = { 'XLARGE': 1, 'LARGE': 2, 'MEDIUM': 3, 'SMALL': 4 };

  const images = content.media.images
    .filter(img => img.url)
    .sort((a, b) => (sizeOrder[a.size] || 5) - (sizeOrder[b.size] || 5))
    .slice(0, 10)
    .map(img => img.url);

  return images;
}

/**
 * Clean HTML from description
 */
function cleanDescription(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build affiliate booking link
 */
function buildActivityBookingLink(code, destination) {
  // HotelBeds doesn't have direct consumer booking links
  // This would typically go through your booking flow
  return `https://www.hotelbeds.com/activities/${encodeURIComponent(destination)}/${code}`;
}

// ============================================================================
// ACTIVITY DETAILS
// ============================================================================

/**
 * Get detailed information for a specific activity
 */
export async function getActivityDetails(activityCode, startDate, endDate) {
  if (!API_KEY || !API_SECRET) {
    throw new Error('HotelBeds API credentials not configured');
  }

  // Use default dates if not provided
  const today = new Date();
  const from = startDate || today.toISOString().split('T')[0];
  const to = endDate || new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const requestBody = {
    code: activityCode,
    from,
    to,
    language: 'en',
    paxes: [{ age: 30 }] // Default adult
  };

  logger.info(`[HotelBeds Activities] Getting details for: ${activityCode}`);

  try {
    const response = await fetchWithTimeout(`${ACTIVITY_API_BASE}/activities/details`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const activity = data.activity;

    if (!activity) {
      throw new Error('Activity not found');
    }

    // Fetch content for images
    const contentMap = await fetchActivityContent([activityCode]);
    const content = contentMap.get(activityCode);

    return normalizeActivity(activity, content, '');

  } catch (error) {
    logger.error('[HotelBeds Activities] Details error:', error.message);
    throw error;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  searchActivities,
  getActivityDetails,
  findDestination
};
