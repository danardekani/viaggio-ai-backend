# Viaggio.ai - Phase 2: Amadeus Integration

## Overview

Phase 2 builds on the affiliate-based MVP by integrating Amadeus APIs for **data enrichment**, **advanced features**, and laying groundwork for **future direct booking** capabilities.

**Prerequisites:** Phase 1 MVP complete and generating revenue  
**Timeline:** 6-8 weeks  
**Budget:** ~$300-400/month (Amadeus + existing costs)

---

## Why Amadeus in Phase 2?

| Capability | Phase 1 (Affiliates) | Phase 2 (+ Amadeus) |
|------------|---------------------|---------------------|
| Flight prices | ✅ Skyscanner | ✅ Skyscanner (booking) + Amadeus (enrichment) |
| Seat maps | ❌ | ✅ Amadeus Seatmap Display |
| Airport info | ❌ | ✅ Amadeus Airport & City Search |
| Flight status | ❌ | ✅ Amadeus On-Demand Flight Status |
| Travel insights | ❌ | ✅ Amadeus Travel Recommendations |
| Train booking | ❌ | ⚠️ Limited (Trainline affiliate instead) |
| Complex itineraries | ❌ | ✅ Multi-city, open-jaw routing |
| Direct booking (future) | ❌ | 🔜 Foundation laid |

---

## Architecture Evolution

```
┌─────────────────┐     ┌───────────────────────────────────────────────────────────┐
│                 │     │                      EXPRESS BACKEND                       │
│  React Frontend │────▶│                                                           │
│  (Vercel)       │     │  ┌───────────────────────────────────────────────────┐   │
│                 │     │  │                Claude AI Service                   │   │
└─────────────────┘     │  │   (Enhanced with Amadeus-powered recommendations)  │   │
                        │  └───────────────────────────────────────────────────┘   │
                        │                          │                                │
                        │         ┌────────────────┼────────────────┐              │
                        │         ▼                ▼                ▼              │
                        │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
                        │  │   BOOKING   │  │ ENRICHMENT  │  │  ADVANCED   │       │
                        │  │   LAYER     │  │   LAYER     │  │  FEATURES   │       │
                        │  │             │  │             │  │             │       │
                        │  │ • Skyscanner│  │ • Amadeus   │  │ • Amadeus   │       │
                        │  │ • Booking   │  │   Seatmaps  │  │   Insights  │       │
                        │  │ • Viator    │  │ • Amadeus   │  │ • Amadeus   │       │
                        │  │             │  │   Airport   │  │   Trip      │       │
                        │  │ (Prices +   │  │   Info      │  │   Purpose   │       │
                        │  │  Links)     │  │             │  │             │       │
                        │  └─────────────┘  └─────────────┘  └─────────────┘       │
                        │         │                │                │              │
                        │         │                └────────────────┘              │
                        │         │                        │                       │
                        │         ▼                        ▼                       │
                        │  ┌─────────────┐         ┌─────────────────┐            │
                        │  │   Redis     │         │  Amadeus APIs   │            │
                        │  │   Cache     │         │  (Self-Service) │            │
                        │  └─────────────┘         └─────────────────┘            │
                        │                                                          │
                        └──────────────────────────────────────────────────────────┘
```

---

## Amadeus Self-Service APIs to Integrate

### Tier 1: High Value (Implement First)

| API | Purpose | Cost | Priority |
|-----|---------|------|----------|
| **Airport & City Search** | Autocomplete for airports | FREE quota | 🔴 High |
| **Airline Code Lookup** | Get airline names/logos | FREE quota | 🔴 High |
| **Seatmap Display** | Show aircraft seat layouts | ~$0.05/call | 🔴 High |
| **Flight Offers Search** | Backup/enrichment data | ~$0.35/call | 🟡 Medium |

### Tier 2: Enhanced Experience

| API | Purpose | Cost | Priority |
|-----|---------|------|----------|
| **Points of Interest** | Nearby attractions | FREE quota | 🟡 Medium |
| **Tours and Activities** | Supplement Viator | ~$0.05/call | 🟡 Medium |
| **Location Score** | Neighborhood ratings | FREE quota | 🟡 Medium |
| **Travel Recommendations** | AI-powered suggestions | ~$0.05/call | 🟡 Medium |

### Tier 3: Advanced (Phase 2.5+)

| API | Purpose | Cost | Priority |
|-----|---------|------|----------|
| **Flight Price Analysis** | Price predictions | ~$0.10/call | 🟢 Low |
| **Trip Purpose Prediction** | Business vs leisure | ~$0.05/call | 🟢 Low |
| **On-Demand Flight Status** | Real-time updates | ~$0.02/call | 🟢 Low |

---

## Implementation Plan

### Step 1: Amadeus Account Setup (Week 1)

1. [ ] Create account at [developers.amadeus.com](https://developers.amadeus.com)
2. [ ] Create a "Self-Service" application
3. [ ] Get API Key and Secret
4. [ ] Test in sandbox environment (FREE)
5. [ ] Apply for production access when ready

**Environment Variables:**
```env
AMADEUS_CLIENT_ID=your_client_id
AMADEUS_CLIENT_SECRET=your_client_secret
AMADEUS_HOSTNAME=test  # Change to 'production' when ready
```

---

### Step 2: Amadeus Client Setup (Week 1)

#### Install SDK:
```bash
npm install amadeus
```

#### Service: `services/amadeus/client.js`

```javascript
// ============================================================================
// AMADEUS API CLIENT
// ============================================================================

import Amadeus from 'amadeus';
import { logger } from '../../utils/logger.js';

let amadeusClient = null;

export function getAmadeusClient() {
  if (!amadeusClient) {
    amadeusClient = new Amadeus({
      clientId: process.env.AMADEUS_CLIENT_ID,
      clientSecret: process.env.AMADEUS_CLIENT_SECRET,
      hostname: process.env.AMADEUS_HOSTNAME || 'test',
      logger: {
        log: (level, ...args) => {
          if (level === 'error') {
            logger.error('Amadeus:', ...args);
          } else {
            logger.debug('Amadeus:', ...args);
          }
        }
      }
    });
  }
  return amadeusClient;
}

// Helper to handle Amadeus responses
export function handleAmadeusResponse(response) {
  if (response.statusCode >= 400) {
    throw new Error(`Amadeus API error: ${response.statusCode}`);
  }
  return response.data;
}
```

---

### Step 3: Airport Autocomplete (Week 2)

Add smart airport search to improve UX:

#### Service: `services/amadeus/airports.js`

```javascript
// ============================================================================
// AMADEUS AIRPORT & CITY SEARCH
// ============================================================================

import { getAmadeusClient, handleAmadeusResponse } from './client.js';
import { getCached, setCache } from '../cache.js';
import { logger } from '../../utils/logger.js';

/**
 * Autocomplete airport/city search
 * @param {string} keyword - Search term (e.g., "New York", "JFK", "Paris")
 * @returns {Array} List of matching airports/cities
 */
export async function searchAirports(keyword) {
  const cacheKey = `airports:${keyword.toLowerCase()}`;
  
  // Check cache first (airports don't change often)
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const amadeus = getAmadeusClient();
    
    const response = await amadeus.referenceData.locations.get({
      keyword: keyword,
      subType: 'AIRPORT,CITY',
      view: 'LIGHT'
    });

    const results = handleAmadeusResponse(response).map(location => ({
      code: location.iataCode,
      name: location.name,
      cityName: location.address?.cityName,
      countryName: location.address?.countryName,
      type: location.subType, // AIRPORT or CITY
      displayName: `${location.iataCode} - ${location.name}, ${location.address?.countryName || ''}`
    }));

    // Cache for 24 hours (airport data rarely changes)
    await setCache(cacheKey, results, 86400);
    
    return results;

  } catch (error) {
    logger.error('Airport search error:', error);
    throw error;
  }
}

/**
 * Get airline details
 * @param {string} airlineCode - IATA airline code (e.g., "UA", "DL")
 */
export async function getAirlineInfo(airlineCode) {
  const cacheKey = `airline:${airlineCode}`;
  
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const amadeus = getAmadeusClient();
    
    const response = await amadeus.referenceData.airlines.get({
      airlineCodes: airlineCode
    });

    const airline = handleAmadeusResponse(response)[0];
    const result = {
      code: airline?.iataCode,
      name: airline?.businessName || airline?.commonName,
      logo: `https://content.airhex.com/content/logos/airlines_${airlineCode}_200_200_s.png`
    };

    await setCache(cacheKey, result, 604800); // Cache 7 days
    
    return result;

  } catch (error) {
    logger.error('Airline lookup error:', error);
    return { code: airlineCode, name: airlineCode, logo: null };
  }
}
```

#### Route: `routes/airports.js`

```javascript
// ============================================================================
// AIRPORT ROUTES
// ============================================================================

import express from 'express';
import { searchAirports, getAirlineInfo } from '../services/amadeus/airports.js';

const router = express.Router();

// Autocomplete endpoint for airport search
router.get('/search', async (req, res, next) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ airports: [] });
    }

    const airports = await searchAirports(q);
    res.json({ airports });

  } catch (error) {
    next(error);
  }
});

// Get airline info
router.get('/airline/:code', async (req, res, next) => {
  try {
    const airline = await getAirlineInfo(req.params.code);
    res.json({ airline });
  } catch (error) {
    next(error);
  }
});

export default router;
```

---

### Step 4: Seatmap Integration (Week 2-3)

Show users the aircraft layout when selecting flights:

#### Service: `services/amadeus/seatmaps.js`

```javascript
// ============================================================================
// AMADEUS SEATMAP SERVICE
// ============================================================================

import { getAmadeusClient, handleAmadeusResponse } from './client.js';
import { getCached, setCache } from '../cache.js';
import { logger } from '../../utils/logger.js';

/**
 * Get seatmap for a specific flight
 * Note: Requires flight offer data from Amadeus Flight Offers Search
 */
export async function getSeatmap(flightOffer) {
  try {
    const amadeus = getAmadeusClient();
    
    const response = await amadeus.shopping.seatmaps.post(
      JSON.stringify({
        data: [flightOffer]
      })
    );

    const seatmapData = handleAmadeusResponse(response);
    
    return formatSeatmap(seatmapData);

  } catch (error) {
    logger.error('Seatmap error:', error);
    throw error;
  }
}

function formatSeatmap(seatmapData) {
  if (!seatmapData?.[0]?.decks) {
    return null;
  }

  const deck = seatmapData[0].decks[0]; // Usually just one deck for narrow-body
  const seats = [];

  deck.seats?.forEach(seat => {
    seats.push({
      number: seat.number,
      cabin: seat.cabin,
      coordinates: {
        x: seat.coordinates?.x,
        y: seat.coordinates?.y
      },
      available: seat.travelerPricing?.[0]?.seatAvailabilityStatus === 'AVAILABLE',
      characteristics: seat.characteristicsCodes, // e.g., ['W'] for window
      price: seat.travelerPricing?.[0]?.price?.total
    });
  });

  return {
    aircraft: seatmapData[0].aircraft?.code,
    cabinClass: deck.deckConfiguration?.cabins,
    rows: deck.deckConfiguration?.rows,
    seats: seats
  };
}
```

---

### Step 5: Flight Enrichment (Week 3)

Enrich Skyscanner results with Amadeus data:

#### Service: `services/amadeus/flightEnrichment.js`

```javascript
// ============================================================================
// FLIGHT DATA ENRICHMENT
// ============================================================================

import { getAirlineInfo } from './airports.js';
import { getAmadeusClient } from './client.js';
import { logger } from '../../utils/logger.js';

/**
 * Enrich flight data from affiliates with Amadeus details
 * @param {Array} flights - Flight results from Skyscanner
 * @returns {Array} Enriched flight data
 */
export async function enrichFlightData(flights) {
  try {
    const enrichedFlights = await Promise.all(
      flights.map(async (flight) => {
        // Get airline details
        const airlineCode = flight.airlineCode || extractAirlineCode(flight.airline);
        const airlineInfo = await getAirlineInfo(airlineCode);

        return {
          ...flight,
          airline: airlineInfo.name || flight.airline,
          airlineLogo: airlineInfo.logo || flight.airlineLogo,
          airlineCode: airlineInfo.code
        };
      })
    );

    return enrichedFlights;

  } catch (error) {
    logger.error('Flight enrichment error:', error);
    return flights; // Return original if enrichment fails
  }
}

function extractAirlineCode(airlineName) {
  // Common mappings
  const mappings = {
    'united': 'UA',
    'united airlines': 'UA',
    'delta': 'DL',
    'delta air lines': 'DL',
    'american': 'AA',
    'american airlines': 'AA',
    'lufthansa': 'LH',
    'air france': 'AF',
    'british airways': 'BA',
    'emirates': 'EK',
    'qatar': 'QR',
    'qatar airways': 'QR'
  };
  
  return mappings[airlineName?.toLowerCase()] || null;
}

/**
 * Get detailed flight information from Amadeus
 * Use when user selects a specific flight for more details
 */
export async function getFlightDetails(origin, destination, departDate, returnDate, adults) {
  try {
    const amadeus = getAmadeusClient();
    
    const response = await amadeus.shopping.flightOffersSearch.get({
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate: departDate,
      returnDate: returnDate,
      adults: adults,
      max: 5,
      currencyCode: 'USD'
    });

    return response.data;

  } catch (error) {
    logger.error('Amadeus flight search error:', error);
    throw error;
  }
}
```

---

### Step 6: Destination Insights (Week 4)

Add AI-powered travel recommendations:

#### Service: `services/amadeus/insights.js`

```javascript
// ============================================================================
// AMADEUS DESTINATION INSIGHTS
// ============================================================================

import { getAmadeusClient, handleAmadeusResponse } from './client.js';
import { getCached, setCache } from '../cache.js';
import { logger } from '../../utils/logger.js';

/**
 * Get points of interest near a location
 */
export async function getPointsOfInterest(latitude, longitude, radius = 5) {
  const cacheKey = `poi:${latitude}:${longitude}:${radius}`;
  
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const amadeus = getAmadeusClient();
    
    const response = await amadeus.referenceData.locations.pointsOfInterest.get({
      latitude: latitude,
      longitude: longitude,
      radius: radius
    });

    const pois = handleAmadeusResponse(response).map(poi => ({
      id: poi.id,
      name: poi.name,
      category: poi.category,
      rank: poi.rank,
      tags: poi.tags,
      location: {
        lat: poi.geoCode?.latitude,
        lng: poi.geoCode?.longitude
      }
    }));

    await setCache(cacheKey, pois, 86400); // 24 hour cache
    
    return pois;

  } catch (error) {
    logger.error('POI search error:', error);
    throw error;
  }
}

/**
 * Get location quality scores
 */
export async function getLocationScore(latitude, longitude) {
  const cacheKey = `score:${latitude}:${longitude}`;
  
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const amadeus = getAmadeusClient();
    
    const response = await amadeus.location.analytics.categoryRatedAreas.get({
      latitude: latitude,
      longitude: longitude
    });

    const scores = handleAmadeusResponse(response)?.[0]?.categoryScores;
    
    const result = {
      sight: scores?.sight?.overall || 0,
      restaurant: scores?.restaurant?.overall || 0,
      shopping: scores?.shopping?.overall || 0,
      nightLife: scores?.nightLife?.overall || 0
    };

    await setCache(cacheKey, result, 604800); // 7 day cache
    
    return result;

  } catch (error) {
    logger.error('Location score error:', error);
    return null;
  }
}

/**
 * Get travel recommendations based on origin
 */
export async function getTravelRecommendations(originCity) {
  const cacheKey = `recommendations:${originCity}`;
  
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const amadeus = getAmadeusClient();
    
    const response = await amadeus.referenceData.recommendedLocations.get({
      cityCodes: originCity
    });

    const recommendations = handleAmadeusResponse(response).map(rec => ({
      destination: rec.iataCode,
      name: rec.name,
      country: rec.country?.name,
      relevance: rec.relevance,
      type: rec.subtype
    }));

    await setCache(cacheKey, recommendations, 86400);
    
    return recommendations;

  } catch (error) {
    logger.error('Recommendations error:', error);
    throw error;
  }
}
```

---

### Step 7: Redis Cache Setup (Week 1)

Essential for managing API costs:

#### Service: `services/cache.js`

```javascript
// ============================================================================
// REDIS CACHE SERVICE
// ============================================================================

import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

let redis = null;

function getRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100
    });

    redis.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    redis.on('connect', () => {
      logger.info('Redis connected');
    });
  }
  return redis;
}

/**
 * Get cached value
 */
export async function getCached(key) {
  try {
    const data = await getRedis().get(key);
    if (data) {
      logger.debug(`Cache HIT: ${key}`);
      return JSON.parse(data);
    }
    logger.debug(`Cache MISS: ${key}`);
    return null;
  } catch (error) {
    logger.error('Cache get error:', error);
    return null;
  }
}

/**
 * Set cached value with TTL
 */
export async function setCache(key, value, ttlSeconds = 3600) {
  try {
    await getRedis().setex(key, ttlSeconds, JSON.stringify(value));
    logger.debug(`Cache SET: ${key} (TTL: ${ttlSeconds}s)`);
  } catch (error) {
    logger.error('Cache set error:', error);
  }
}

/**
 * Delete cached value
 */
export async function deleteCache(key) {
  try {
    await getRedis().del(key);
  } catch (error) {
    logger.error('Cache delete error:', error);
  }
}

/**
 * Clear cache by pattern
 */
export async function clearCachePattern(pattern) {
  try {
    const keys = await getRedis().keys(pattern);
    if (keys.length > 0) {
      await getRedis().del(...keys);
      logger.info(`Cleared ${keys.length} cache keys matching: ${pattern}`);
    }
  } catch (error) {
    logger.error('Cache clear error:', error);
  }
}
```

---

## Updated File Structure

```
viaggio-backend/
├── src/
│   ├── server.js
│   │
│   ├── routes/
│   │   ├── chat.js
│   │   ├── flights.js
│   │   ├── hotels.js
│   │   ├── tours.js
│   │   ├── airports.js            # NEW
│   │   ├── insights.js            # NEW
│   │   └── tracking.js
│   │
│   ├── services/
│   │   ├── claude.js
│   │   ├── cache.js               # NEW (Redis)
│   │   │
│   │   ├── affiliates/            # Phase 1
│   │   │   ├── skyscanner.js
│   │   │   ├── booking.js
│   │   │   └── viator.js
│   │   │
│   │   └── amadeus/               # NEW - Phase 2
│   │       ├── client.js
│   │       ├── airports.js
│   │       ├── seatmaps.js
│   │       ├── flightEnrichment.js
│   │       └── insights.js
│   │
│   ├── middleware/
│   │   ├── cors.js
│   │   └── rateLimiter.js
│   │
│   └── utils/
│       ├── errors.js
│       └── logger.js
│
├── package.json
└── .env
```

---

## Environment Variables (Complete)

```env
# === EXISTING (Phase 1) ===
ANTHROPIC_API_KEY=sk-ant-...
FRONTEND_URL=https://viaggio-ai.vercel.app
NODE_ENV=production

# Affiliates
SKYSCANNER_API_KEY=...
SKYSCANNER_AFFILIATE_ID=...
BOOKING_API_KEY=...
BOOKING_AFFILIATE_ID=...
VIATOR_API_KEY=...
VIATOR_CAMPAIGN_ID=...

# === NEW (Phase 2) ===
# Amadeus
AMADEUS_CLIENT_ID=...
AMADEUS_CLIENT_SECRET=...
AMADEUS_HOSTNAME=production  # or 'test' for sandbox

# Redis (Railway provides this)
REDIS_URL=redis://...
```

---

## Cost Breakdown (Monthly)

| Item | Estimated Calls | Cost/Call | Monthly Cost |
|------|-----------------|-----------|--------------|
| **Phase 1 Costs** | | | |
| Claude API | ~1500 | ~$0.03 | $45 |
| Railway Backend | - | - | $20 |
| **Phase 2 Additions** | | | |
| Airport Search | 2000 | FREE | $0 |
| Airline Lookup | 500 | FREE | $0 |
| Seatmap Display | 200 | $0.05 | $10 |
| Flight Enrichment | 300 | $0.35 | $105 |
| POI Search | 500 | FREE | $0 |
| Location Scores | 300 | FREE | $0 |
| Travel Recommendations | 200 | $0.05 | $10 |
| Redis (Railway addon) | - | - | $20 |
| | | | |
| **TOTAL** | | | **~$210/month** |

---

## Frontend Enhancements

### Airport Autocomplete Component

```jsx
// components/AirportSearch.jsx

import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';

export function AirportSearch({ value, onChange, placeholder }) {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (query.length >= 2) {
      fetch(`${BACKEND_URL}/api/airports/search?q=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then(data => {
          setSuggestions(data.airports || []);
          setIsOpen(true);
        });
    } else {
      setSuggestions([]);
      setIsOpen(false);
    }
  }, [query]);

  return (
    <div className="relative">
      <div className="flex items-center border rounded-lg px-3 py-2">
        <Search className="w-4 h-4 text-gray-400 mr-2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="outline-none flex-1"
        />
      </div>
      
      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((airport) => (
            <button
              key={airport.code}
              onClick={() => {
                onChange(airport);
                setQuery(airport.displayName);
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-left hover:bg-blue-50"
            >
              <span className="font-semibold">{airport.code}</span>
              <span className="text-gray-600 ml-2">{airport.name}</span>
              <span className="text-gray-400 text-sm ml-2">{airport.countryName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Phase 2 Timeline

| Week | Focus | Tasks |
|------|-------|-------|
| **Week 1** | Setup | Amadeus account, Redis setup, cache service |
| **Week 2** | Core | Airport search, airline lookup, integrate into UI |
| **Week 3** | Enrichment | Seatmap display, flight data enrichment |
| **Week 4** | Insights | POI, location scores, recommendations |
| **Week 5** | Integration | Connect everything, update Claude prompts |
| **Week 6** | Testing | End-to-end testing, performance optimization |
| **Week 7-8** | Polish | Bug fixes, monitoring, documentation |

---

## Success Criteria

- [ ] Airport autocomplete works with real-time suggestions
- [ ] Airline logos display correctly on all flights
- [ ] Seatmap shows when user clicks "View seats"
- [ ] Destination insights appear for selected locations
- [ ] Cache hit rate > 60% (reduces API costs)
- [ ] Page load time < 2 seconds with enriched data
- [ ] No increase in error rates

---

## Future: Phase 3 (Direct Booking)

Phase 2 lays the groundwork for eventually handling bookings directly:

| Capability | Phase 2 (Now) | Phase 3 (Future) |
|------------|---------------|------------------|
| Flight data | Amadeus enrichment | Amadeus booking |
| Payment | Affiliate handles | You process (Stripe) |
| Ticketing | N/A | Amadeus e-ticketing |
| Customer support | Affiliate handles | You provide |
| Revenue | 5-10% commission | Full margin |

This is a major undertaking requiring legal, financial, and operational infrastructure. Recommended only after proving product-market fit with affiliate model.

---

*Phase 2 Amadeus Integration Documentation - Viaggio.ai*
