# Viaggio.ai - Phase 1: Affiliate API MVP

## Overview

Phase 1 focuses on building a functional MVP using **affiliate APIs** where prices displayed always match the booking destination. This ensures user trust and a seamless experience.

**Timeline:** 4-6 weeks  
**Budget:** ~$50-100/month (mostly Claude API costs)  
**Revenue Model:** Commission from affiliate bookings (4-10%)

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────────────────┐
│                 │     │                    EXPRESS BACKEND                    │
│  React Frontend │────▶│                                                      │
│  (Vercel)       │     │  ┌──────────────────────────────────────────────┐   │
│                 │     │  │              Claude AI Service                │   │
└─────────────────┘     │  │   (Conversation + Intent Extraction)          │   │
                        │  └──────────────────────────────────────────────┘   │
                        │                        │                             │
                        │                        ▼                             │
                        │  ┌──────────────────────────────────────────────┐   │
                        │  │           Affiliate Service Router            │   │
                        │  └──────────────────────────────────────────────┘   │
                        │         │              │              │              │
                        │         ▼              ▼              ▼              │
                        │  ┌───────────┐  ┌───────────┐  ┌───────────┐        │
                        │  │ Skyscanner│  │Booking.com│  │  Viator   │        │
                        │  │  Service  │  │  Service  │  │  Service  │        │
                        │  └───────────┘  └───────────┘  └───────────┘        │
                        │                                                      │
                        └──────────────────────────────────────────────────────┘
                                    │              │              │
                                    ▼              ▼              ▼
                        ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
                        │  Skyscanner   │ │  Booking.com  │ │    Viator     │
                        │  Affiliate    │ │  Affiliate    │ │   Partner     │
                        │  API          │ │  API          │ │   API         │
                        └───────────────┘ └───────────────┘ └───────────────┘
                        
                        ✅ Prices ALWAYS match booking destination
```

---

## Affiliate Partner Overview

### 1. Flights: Skyscanner Affiliate API

| Item | Details |
|------|---------|
| **Sign Up** | [partners.skyscanner.net](https://partners.skyscanner.net) |
| **API Type** | REST API |
| **Cost** | FREE |
| **Commission** | 50% revenue share on CPC |
| **What You Get** | Flight search + prices + deep links that match |

### 2. Hotels: Booking.com Affiliate Partner API

| Item | Details |
|------|---------|
| **Sign Up** | [booking.com/affiliate-program](https://www.booking.com/affiliate-program/v2/index.html) |
| **API Type** | REST/XML API |
| **Cost** | FREE |
| **Commission** | 25-40% of Booking.com's commission (effectively 4-6% of booking) |
| **What You Get** | Hotel search + real-time prices + affiliate booking links |

### 3. Tours: Viator Partner API

| Item | Details |
|------|---------|
| **Sign Up** | [viator.com/partners](https://www.viator.com/partners) |
| **API Type** | REST API |
| **Cost** | FREE |
| **Commission** | 8% per booking |
| **What You Get** | 300,000+ tours/activities + prices + booking links |

---

## Backend File Structure

```
viaggio-backend/
├── src/
│   ├── server.js
│   │
│   ├── routes/
│   │   ├── chat.js                 # Claude chat (existing)
│   │   ├── flights.js              # NEW: Flight search
│   │   ├── hotels.js               # NEW: Hotel search
│   │   ├── tours.js                # NEW: Tours search
│   │   ├── tracking.js             # Affiliate tracking (existing)
│   │   └── feedback.js             # User feedback (existing)
│   │
│   ├── services/
│   │   ├── claude.js               # Claude AI (existing)
│   │   ├── affiliates/
│   │   │   ├── skyscanner.js       # NEW: Skyscanner API client
│   │   │   ├── booking.js          # NEW: Booking.com API client
│   │   │   └── viator.js           # NEW: Viator API client
│   │   └── cache.js                # NEW: Simple in-memory cache
│   │
│   ├── middleware/
│   │   ├── cors.js                 # (existing)
│   │   └── rateLimiter.js          # (existing)
│   │
│   └── utils/
│       ├── errors.js               # (existing)
│       └── logger.js               # (existing)
│
├── package.json
└── .env
```

---

## Implementation Details

### Step 1: Sign Up for Affiliate Programs (Week 1)

**Action Items:**
1. [ ] Apply to Skyscanner Partner Program
2. [ ] Apply to Booking.com Affiliate Program  
3. [ ] Apply to Viator Partner Program
4. [ ] Wait for approvals (typically 1-7 days)
5. [ ] Collect API credentials for each

**Note:** Apply to all three simultaneously — approval can take time.

---

### Step 2: Skyscanner Integration (Week 2)

#### Environment Variables
```env
SKYSCANNER_API_KEY=your_api_key
SKYSCANNER_AFFILIATE_ID=your_affiliate_id
```

#### Service: `services/affiliates/skyscanner.js`

```javascript
// ============================================================================
// SKYSCANNER AFFILIATE API SERVICE
// ============================================================================

import { logger } from '../utils/logger.js';

const SKYSCANNER_API_BASE = 'https://partners.api.skyscanner.net/apiservices/v3';

/**
 * Search for flights using Skyscanner API
 * Returns prices that MATCH the booking links
 */
export async function searchFlights({ origin, destination, departDate, returnDate, adults = 1, cabinClass = 'economy' }) {
  try {
    // Step 1: Create a search session
    const sessionResponse = await fetch(`${SKYSCANNER_API_BASE}/flights/live/search/create`, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.SKYSCANNER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: {
          market: 'US',
          locale: 'en-US',
          currency: 'USD',
          queryLegs: [
            {
              originPlaceId: { iata: origin },
              destinationPlaceId: { iata: destination },
              date: { year: parseInt(departDate.split('-')[0]), month: parseInt(departDate.split('-')[1]), day: parseInt(departDate.split('-')[2]) }
            },
            // Add return leg if round trip
            ...(returnDate ? [{
              originPlaceId: { iata: destination },
              destinationPlaceId: { iata: origin },
              date: { year: parseInt(returnDate.split('-')[0]), month: parseInt(returnDate.split('-')[1]), day: parseInt(returnDate.split('-')[2]) }
            }] : [])
          ],
          adults: adults,
          cabinClass: cabinClass.toUpperCase()
        }
      })
    });

    const sessionData = await sessionResponse.json();
    const sessionToken = sessionData.sessionToken;

    // Step 2: Poll for results
    const results = await pollFlightResults(sessionToken);
    
    // Step 3: Format results with affiliate deep links
    return formatFlightResults(results, origin, destination, departDate, returnDate, adults);

  } catch (error) {
    logger.error('Skyscanner API error:', error);
    throw error;
  }
}

async function pollFlightResults(sessionToken, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${SKYSCANNER_API_BASE}/flights/live/search/poll/${sessionToken}`, {
      headers: {
        'x-api-key': process.env.SKYSCANNER_API_KEY
      }
    });
    
    const data = await response.json();
    
    if (data.status === 'RESULT_STATUS_COMPLETE' || data.content?.results?.itineraries) {
      return data;
    }
    
    // Wait 1 second before polling again
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error('Flight search timed out');
}

function formatFlightResults(data, origin, destination, departDate, returnDate, adults) {
  const itineraries = data.content?.results?.itineraries || {};
  const legs = data.content?.results?.legs || {};
  const carriers = data.content?.results?.carriers || {};
  const places = data.content?.results?.places || {};

  const flights = Object.values(itineraries).slice(0, 10).map(itinerary => {
    const pricingOption = itinerary.pricingOptions?.[0];
    const outboundLegId = itinerary.legIds?.[0];
    const outboundLeg = legs[outboundLegId];
    
    const carrierIds = outboundLeg?.operatingCarrierIds || [];
    const carrier = carriers[carrierIds[0]] || {};
    
    return {
      id: itinerary.id,
      airline: carrier.name || 'Multiple Airlines',
      airlineLogo: carrier.imageUrl,
      price: pricingOption?.price?.amount ? parseFloat(pricingOption.price.amount) / 1000 : null,
      currency: 'USD',
      route: `${origin} → ${destination}`,
      departure: outboundLeg?.departureDateTime?.substring(0, 16).replace('T', ' '),
      arrival: outboundLeg?.arrivalDateTime?.substring(0, 16).replace('T', ' '),
      duration: formatDuration(outboundLeg?.durationInMinutes),
      stops: outboundLeg?.stopCount === 0 ? 'Nonstop' : `${outboundLeg?.stopCount} stop(s)`,
      
      // THIS IS THE KEY: Deep link that matches the price shown
      bookingLink: pricingOption?.items?.[0]?.deepLink || buildSkyscannerDeepLink(origin, destination, departDate, returnDate, adults)
    };
  });

  return flights.filter(f => f.price !== null);
}

function formatDuration(minutes) {
  if (!minutes) return 'N/A';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function buildSkyscannerDeepLink(origin, destination, departDate, returnDate, adults) {
  const baseUrl = 'https://www.skyscanner.com/transport/flights';
  const dateFormatted = departDate.replace(/-/g, '').substring(2); // YYMMDD
  const returnFormatted = returnDate ? returnDate.replace(/-/g, '').substring(2) : '';
  
  return `${baseUrl}/${origin.toLowerCase()}/${destination.toLowerCase()}/${dateFormatted}/${returnFormatted}/?adultsv2=${adults}&ref=viaggio&associateId=${process.env.SKYSCANNER_AFFILIATE_ID}`;
}
```

#### Route: `routes/flights.js`

```javascript
// ============================================================================
// FLIGHT ROUTES
// ============================================================================

import express from 'express';
import { searchFlights } from '../services/affiliates/skyscanner.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.post('/search', async (req, res, next) => {
  try {
    const { origin, destination, departDate, returnDate, adults = 1 } = req.body;

    // Validate required fields
    if (!origin || !destination || !departDate) {
      return res.status(400).json({ 
        error: 'Missing required fields: origin, destination, departDate' 
      });
    }

    logger.info(`Flight search: ${origin} → ${destination} on ${departDate}`);

    const flights = await searchFlights({
      origin,
      destination,
      departDate,
      returnDate,
      adults
    });

    res.json({ 
      flights,
      searchParams: { origin, destination, departDate, returnDate, adults }
    });

  } catch (error) {
    logger.error('Flight search error:', error);
    next(error);
  }
});

export default router;
```

---

### Step 3: Booking.com Integration (Week 3)

#### Environment Variables
```env
BOOKING_AFFILIATE_ID=your_affiliate_id
BOOKING_API_KEY=your_api_key
```

#### Service: `services/affiliates/booking.js`

```javascript
// ============================================================================
// BOOKING.COM AFFILIATE API SERVICE
// ============================================================================

import { logger } from '../utils/logger.js';

const BOOKING_API_BASE = 'https://distribution-xml.booking.com/2.0/json';

/**
 * Search for hotels using Booking.com Affiliate API
 * Prices returned MATCH the booking links
 */
export async function searchHotels({ cityName, checkIn, checkOut, adults = 2, rooms = 1 }) {
  try {
    const auth = Buffer.from(`${process.env.BOOKING_API_KEY}:`).toString('base64');

    // Step 1: Get city ID
    const cityResponse = await fetch(
      `${BOOKING_API_BASE}/autocomplete?text=${encodeURIComponent(cityName)}&language=en`,
      {
        headers: { 'Authorization': `Basic ${auth}` }
      }
    );
    const cityData = await cityResponse.json();
    const cityId = cityData.result?.[0]?.city_ufi;

    if (!cityId) {
      throw new Error(`City not found: ${cityName}`);
    }

    // Step 2: Search hotels
    const hotelsResponse = await fetch(
      `${BOOKING_API_BASE}/hotels?city_ids=${cityId}&checkin=${checkIn}&checkout=${checkOut}&guest_qty=${adults}&room_qty=${rooms}&rows=20&language=en`,
      {
        headers: { 'Authorization': `Basic ${auth}` }
      }
    );
    const hotelsData = await hotelsResponse.json();

    // Step 3: Format results with affiliate links
    return formatHotelResults(hotelsData.result || [], checkIn, checkOut, adults);

  } catch (error) {
    logger.error('Booking.com API error:', error);
    throw error;
  }
}

function formatHotelResults(hotels, checkIn, checkOut, adults) {
  return hotels.map(hotel => ({
    id: hotel.hotel_id,
    name: hotel.hotel_name,
    location: hotel.city_name || hotel.address,
    rating: hotel.review_score ? (hotel.review_score / 2).toFixed(1) : 'N/A', // Convert to 5-star scale
    reviewScore: hotel.review_score,
    reviewCount: hotel.review_nr,
    price: hotel.min_total_price || hotel.price,
    currency: hotel.currency_code || 'USD',
    image: hotel.main_photo_url?.replace('square60', 'square300'),
    amenities: extractAmenities(hotel),
    
    // Affiliate booking link - price MATCHES what user sees
    bookingLink: `https://www.booking.com/hotel/${hotel.country_code?.toLowerCase()}/${hotel.hotel_name_trans?.toLowerCase().replace(/\s+/g, '-')}.html?aid=${process.env.BOOKING_AFFILIATE_ID}&checkin=${checkIn}&checkout=${checkOut}&group_adults=${adults}`
  }));
}

function extractAmenities(hotel) {
  const amenities = [];
  if (hotel.is_free_cancellable) amenities.push('Free cancellation');
  if (hotel.has_free_parking) amenities.push('Free parking');
  if (hotel.has_swimming_pool) amenities.push('Swimming pool');
  if (hotel.breakfast_included) amenities.push('Breakfast included');
  return amenities;
}
```

#### Route: `routes/hotels.js`

```javascript
// ============================================================================
// HOTEL ROUTES
// ============================================================================

import express from 'express';
import { searchHotels } from '../services/affiliates/booking.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.post('/search', async (req, res, next) => {
  try {
    const { cityName, checkIn, checkOut, adults = 2, rooms = 1 } = req.body;

    if (!cityName || !checkIn || !checkOut) {
      return res.status(400).json({ 
        error: 'Missing required fields: cityName, checkIn, checkOut' 
      });
    }

    logger.info(`Hotel search: ${cityName}, ${checkIn} to ${checkOut}`);

    const hotels = await searchHotels({
      cityName,
      checkIn,
      checkOut,
      adults,
      rooms
    });

    res.json({ 
      hotels,
      searchParams: { cityName, checkIn, checkOut, adults, rooms }
    });

  } catch (error) {
    logger.error('Hotel search error:', error);
    next(error);
  }
});

export default router;
```

---

### Step 4: Viator Integration (Week 3-4)

#### Environment Variables
```env
VIATOR_API_KEY=your_api_key
VIATOR_CAMPAIGN_ID=your_campaign_id
```

#### Service: `services/affiliates/viator.js`

```javascript
// ============================================================================
// VIATOR PARTNER API SERVICE
// ============================================================================

import { logger } from '../utils/logger.js';

const VIATOR_API_BASE = 'https://api.viator.com/partner';

/**
 * Search for tours and activities using Viator Partner API
 * Prices returned MATCH the booking links
 */
export async function searchTours({ destination, startDate, endDate }) {
  try {
    // Step 1: Get destination ID
    const destResponse = await fetch(
      `${VIATOR_API_BASE}/v1/taxonomy/destinations`,
      {
        method: 'GET',
        headers: {
          'exp-api-key': process.env.VIATOR_API_KEY,
          'Accept': 'application/json'
        }
      }
    );
    const destData = await destResponse.json();
    
    // Find matching destination
    const dest = findDestination(destData.data, destination);
    if (!dest) {
      throw new Error(`Destination not found: ${destination}`);
    }

    // Step 2: Search products
    const searchResponse = await fetch(
      `${VIATOR_API_BASE}/products/search`,
      {
        method: 'POST',
        headers: {
          'exp-api-key': process.env.VIATOR_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          filtering: {
            destination: dest.ref,
            startDate: startDate,
            endDate: endDate
          },
          sorting: { sort: 'TRAVELER_RATING', order: 'DESC' },
          pagination: { start: 1, count: 20 },
          currency: 'USD'
        })
      }
    );

    const searchData = await searchResponse.json();
    
    return formatTourResults(searchData.products || []);

  } catch (error) {
    logger.error('Viator API error:', error);
    throw error;
  }
}

function findDestination(destinations, searchTerm) {
  const lower = searchTerm.toLowerCase();
  return destinations?.find(d => 
    d.destinationName?.toLowerCase().includes(lower)
  );
}

function formatTourResults(tours) {
  return tours.map(tour => ({
    id: tour.productCode,
    name: tour.title,
    description: tour.description?.substring(0, 200) + '...',
    duration: tour.duration?.fixedDurationInMinutes 
      ? `${Math.round(tour.duration.fixedDurationInMinutes / 60)} hours`
      : tour.duration?.variableDurationFromMinutes 
        ? `${Math.round(tour.duration.variableDurationFromMinutes / 60)}-${Math.round(tour.duration.variableDurationToMinutes / 60)} hours`
        : 'Varies',
    rating: tour.reviews?.combinedAverageRating?.toFixed(1) || 'New',
    reviewCount: tour.reviews?.totalReviews || 0,
    price: tour.pricing?.summary?.fromPrice,
    currency: 'USD',
    image: tour.images?.[0]?.variants?.find(v => v.width >= 300)?.url,
    
    // Affiliate booking link - price MATCHES
    bookingLink: `https://www.viator.com/tours/${tour.productCode}?pid=${process.env.VIATOR_CAMPAIGN_ID}&mcid=42383&medium=link`
  }));
}
```

---

### Step 5: Update Claude Integration (Week 4)

Modify the Claude prompt to extract travel intent and trigger the appropriate API:

#### Updated: `services/claude.js`

```javascript
const TRAVEL_AGENT_PROMPT = `You are an enthusiastic travel expert for Viaggio.ai.

Your job is to help users plan trips through natural conversation. When you have enough information to search, include a JSON command block in your response.

GATHERING INFORMATION:
Before searching, you need:
- Destination city/country
- Travel dates (or at least month)
- Number of travelers

SEARCH COMMANDS:
When ready to search, include this JSON block:

For flights:
\`\`\`search
{
  "type": "FLIGHTS",
  "params": {
    "origin": "JFK",
    "destination": "FLR", 
    "departDate": "2025-09-15",
    "returnDate": "2025-09-22",
    "adults": 2
  }
}
\`\`\`

For hotels:
\`\`\`search
{
  "type": "HOTELS",
  "params": {
    "cityName": "Florence, Italy",
    "checkIn": "2025-09-15",
    "checkOut": "2025-09-22",
    "adults": 2
  }
}
\`\`\`

For tours:
\`\`\`search
{
  "type": "TOURS",
  "params": {
    "destination": "Florence",
    "startDate": "2025-09-15",
    "endDate": "2025-09-22"
  }
}
\`\`\`

CONVERSATION FLOW:
1. Greet and ask where they want to go
2. Ask about dates and number of travelers
3. Search flights first
4. After they select a flight, search hotels
5. After they select a hotel, suggest tours
6. Compile final itinerary

Be enthusiastic and helpful! Use emojis occasionally. 🌍✈️`;
```

---

### Step 6: Update Server Routes (Week 4)

#### Updated: `server.js`

```javascript
// Add new route imports
import flightRoutes from './routes/flights.js';
import hotelRoutes from './routes/hotels.js';
import tourRoutes from './routes/tours.js';

// Add routes
app.use('/api/flights', flightRoutes);
app.use('/api/hotels', hotelRoutes);
app.use('/api/tours', tourRoutes);
```

---

## Environment Variables Summary

Add these to Railway:

```env
# Existing
ANTHROPIC_API_KEY=sk-ant-...
FRONTEND_URL=https://viaggio-ai.vercel.app
NODE_ENV=production

# NEW - Skyscanner
SKYSCANNER_API_KEY=your_key
SKYSCANNER_AFFILIATE_ID=your_id

# NEW - Booking.com
BOOKING_API_KEY=your_key
BOOKING_AFFILIATE_ID=your_id

# NEW - Viator
VIATOR_API_KEY=your_key
VIATOR_CAMPAIGN_ID=your_id
```

---

## Frontend Updates Required

Update `App.jsx` to call the new endpoints and display results:

```javascript
// When Claude returns a search command, call the appropriate API:

if (data.command?.type === 'FLIGHTS') {
  const flightResults = await fetch(`${BACKEND_URL}/api/flights/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data.command.params)
  });
  const flights = await flightResults.json();
  // Display flights with bookingLink for each
}
```

---

## Cost Breakdown (Monthly)

| Item | Cost |
|------|------|
| Skyscanner API | FREE |
| Booking.com API | FREE |
| Viator API | FREE |
| Claude API (~1000 conversations) | ~$50 |
| Railway Backend | ~$20 |
| **Total** | **~$70/month** |

---

## Revenue Potential

| Component | Avg. Booking Value | Commission | Per Booking |
|-----------|-------------------|------------|-------------|
| Flights | $800 | ~$3-5 (CPC model) | $3-5 |
| Hotels | $1,000 | 4-6% | $40-60 |
| Tours | $150 | 8% | $12 |

**Example:** 50 bookings/month = $2,750 - $6,000 revenue

---

## Timeline Summary

| Week | Tasks |
|------|-------|
| **Week 1** | Apply to all affiliate programs, wait for approval |
| **Week 2** | Implement Skyscanner integration, test flights |
| **Week 3** | Implement Booking.com + Viator integrations |
| **Week 4** | Update Claude prompt, connect frontend, end-to-end testing |
| **Week 5** | Bug fixes, polish UI, soft launch |
| **Week 6** | Monitor, gather feedback, iterate |

---

## Success Criteria

- [ ] Users can search real flights with live prices
- [ ] Users can search real hotels with live prices  
- [ ] Users can search real tours with live prices
- [ ] Clicking "Book" takes users to partner site with affiliate tracking
- [ ] Prices shown in app match prices on partner sites
- [ ] Commission tracking is working

---

*Phase 1 MVP Documentation - Viaggio.ai*
