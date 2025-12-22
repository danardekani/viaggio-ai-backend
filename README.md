# Viaggio AI Backend

Backend API server for the Viaggio AI Travel Assistant - an AI-powered travel planning application.

## Features

- **Agentic AI Chat** - Claude-powered travel assistant with autonomous tool use
- **Tour Search** - Viator API integration with optimized caching and parallel fetching
- **Hotel Search** - HotelBeds API integration with geolocation search and Content API images
- **Image Recognition** - Identify travel destinations from photos using Google Vision + Gemini AI
- **Affiliate Tracking** - Click tracking and analytics for monetization

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **AI Models**: Claude Sonnet 4, Gemini 2.0 Flash
- **APIs**: Viator Partner API, HotelBeds Booking/Content API, Google Vision API, Google Places API

## Project Structure

```
viaggio-backend/
├── src/
│   ├── server.js                    # Main Express server with cache warming
│   ├── routes/
│   │   ├── agent/
│   │   │   ├── chat-agent.js        # Agentic AI chat endpoint
│   │   │   ├── agent-tools.js       # Tool definitions for Claude
│   │   │   └── agent-executor.js    # Tool execution logic
│   │   ├── tours.js                 # Tour search endpoints (Viator)
│   │   ├── hotels.js                # Hotel search endpoints (HotelBeds)
│   │   ├── identify.js              # Image-based location identification
│   │   ├── tracking.js              # Affiliate click tracking
│   │   └── feedback.js              # User feedback collection
│   ├── services/
│   │   ├── affiliates/
│   │   │   ├── viator.js            # Viator API integration
│   │   │   └── hotelbeds.js         # HotelBeds API integration
│   │   ├── vision.js                # Google Vision + Gemini AI
│   │   └── analytics.js             # Tracking analytics
│   ├── middleware/
│   │   ├── rateLimiter.js           # API rate limiting
│   │   └── cors.js                  # CORS configuration
│   └── utils/
│       ├── logger.js                # Logging utility
│       └── errors.js                # Error handling
├── .env                             # Environment variables
├── package.json
└── README.md
```

## API Endpoints

### AI Agent

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/agent/chat` | Agentic AI chat with tool use |
| GET | `/api/agent/health` | Agent health check |
| GET | `/api/agent/tools` | List available AI tools |

### Tours (Viator)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/tours/search` | Search tours by destination |
| GET | `/api/tours/:productCode` | Get tour details |
| GET | `/api/tours/destinations/autocomplete` | Destination autocomplete |
| GET | `/api/tours/destinations/search` | Find destination by query |

### Hotels (HotelBeds)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/hotels/search` | Search hotels by destination |
| GET | `/api/hotels/:hotelCode` | Get hotel details |
| GET | `/api/hotels/destinations/autocomplete` | Destination autocomplete |
| GET | `/api/hotels/destinations/list` | List all destinations |

### Location Identification

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/identify` | Identify location from image |
| GET | `/api/identify/health` | Vision service health check |

### Tracking & Feedback

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/tracking/click` | Track affiliate link click |
| GET | `/api/tracking/stats` | Get click statistics |
| POST | `/api/tracking/conversion` | Track booking conversion |
| POST | `/api/feedback` | Submit user feedback |
| GET | `/api/feedback/stats` | Get feedback statistics |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |

## Environment Variables

```env
# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# AI APIs
ANTHROPIC_API_KEY=sk-ant-...           # Claude API
GEMINI_API_KEY=...                      # Gemini 2.0 Flash

# Google APIs
GOOGLE_VISION_API_KEY=...               # Cloud Vision API
GOOGLE_MAPS_API_KEY=...                 # Places API (optional, falls back to Vision key)

# Viator Partner API
VIATOR_API_KEY=...
VIATOR_API_URL=https://api.viator.com/partner

# HotelBeds API
HOTELBEDS_API_KEY=...
HOTELBEDS_SECRET=...
HOTELBEDS_API_URL=https://api.test.hotelbeds.com  # Use api.hotelbeds.com for production

# Optional
WARM_CACHE_ON_STARTUP=true              # Pre-warm tour cache on startup
```

## Installation

```bash
# Install dependencies
npm install

# Development (with hot reload)
npm run dev

# Production
npm start
```

## Performance Optimizations

### Viator API
- **Parallel Page Fetching**: Fetches up to 10 API pages concurrently (5-10x faster)
- **Tour Search Caching**: 1-hour TTL cache for destination searches
- **Cache Pre-warming**: Popular destinations cached on server startup
- **Single-pass Filtering**: Optimized destination matching with scoring
- **Fetch Timeout**: 15-second timeout with AbortController

### HotelBeds API
- **Geolocation Search**: Falls back to lat/lng when destination codes fail
- **Content API Integration**: Fetches high-quality hotel images
- **Destination Cache**: Pre-built destination list with coordinates

## AI Agent Tools

The agentic chat uses Claude with these tools:

| Tool | Status | Description |
|------|--------|-------------|
| `search_tours` | Active | Search Viator for tours and experiences |
| `get_destination_info` | Active | Get travel tips using Claude's knowledge |
| `identify_location` | Active | Identify locations from images |
| `search_flights` | Coming Soon | Flight search integration |
| `search_hotels` | Coming Soon | Hotel search via agent |

## API Usage Examples

### Search Tours

```bash
curl -X POST http://localhost:3001/api/tours/search \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Rome",
    "searchTerms": "food tour",
    "resultCount": 10,
    "sortBy": "reviews"
  }'
```

### Search Hotels

```bash
curl -X POST http://localhost:3001/api/hotels/search \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Barcelona",
    "checkIn": "2025-07-15",
    "checkOut": "2025-07-22",
    "adults": 2,
    "rooms": 1
  }'
```

### AI Chat

```bash
curl -X POST http://localhost:3001/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Find food tours in Paris"}
    ]
  }'
```

### Identify Location

```bash
curl -X POST http://localhost:3001/api/identify \
  -H "Content-Type: application/json" \
  -d '{
    "image": "base64-encoded-image-data",
    "mediaType": "image/jpeg"
  }'
```

## Response Formats

### Tour Search Response
```json
{
  "tours": [...],
  "totalCount": 3038,
  "hasMore": true,
  "count": 100,
  "searchParams": {...}
}
```

### Hotel Search Response
```json
{
  "hotels": [...],
  "searchParams": {...},
  "count": 20
}
```

### AI Chat Response
```json
{
  "message": "I found some great tours...",
  "tours": [...],
  "searchDestination": "Paris",
  "hasMore": true,
  "toolsUsed": ["search_tours"],
  "iterations": 2,
  "usage": {
    "inputTokens": 1234,
    "outputTokens": 567
  }
}
```

## License

MIT
