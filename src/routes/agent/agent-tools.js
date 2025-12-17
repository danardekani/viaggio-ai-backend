// ============================================================================
// AGENT TOOLS - Tool Definitions for Agentic AI
// ============================================================================
// These definitions tell Claude what tools it can use and how to use them.
// Claude will autonomously decide when to call these based on user requests.
// ============================================================================

export const agentTools = [
  // ==========================================================================
  // TOUR SEARCH TOOL (Active - uses Viator API)
  // ==========================================================================
  {
    name: 'search_tours',
    description: `Search for tours, activities, and experiences in a destination using the Viator API.
    
Use this tool when the user wants to:
- Find things to do in a city
- Look for specific activities (food tours, walking tours, museums, etc.)
- Browse experiences for a trip
- Find tours within a budget or date range
- Sort tours by reviews, rating, price, etc.
- Find DEALS or special offers (use special_offer: true)

The tool returns real, bookable tours with prices, ratings, and availability.`,
    input_schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: 'City or region name (e.g., "Rome", "Paris", "New York", "Tuscany")'
        },
        interests: {
          type: 'array',
          items: { type: 'string' },
          description: 'Types of activities to search for (e.g., ["food", "history", "adventure", "wine", "art"]). Leave empty for general search.'
        },
        sort_by: {
          type: 'string',
          enum: ['popular', 'reviews', 'rating', 'price_low', 'price_high', 'newest', 'duration_short', 'duration_long'],
          description: 'How to sort results: "popular" (default), "reviews" (most reviewed), "rating" (highest rated), "price_low", "price_high", "newest", "duration_short", "duration_long"'
        },
        start_date: {
          type: 'string',
          description: 'Start date for availability in YYYY-MM-DD format (optional)'
        },
        end_date: {
          type: 'string',
          description: 'End date for availability in YYYY-MM-DD format (optional)'
        },
        max_price: {
          type: 'number',
          description: 'Maximum price per person in USD (optional)'
        },
        min_rating: {
          type: 'number',
          description: 'Minimum rating from 1-5 (optional, e.g., 4 for 4+ stars)'
        },
        special_offer: {
          type: 'boolean',
          description: 'Set to true to find tours with deals/discounts/special offers'
        },
        result_count: {
          type: 'number',
          description: 'Number of results to return (default: 5, max: 10)'
        }
      },
      required: ['destination']
    }
  },

  // ==========================================================================
  // FLIGHT SEARCH TOOL - MVP DISABLED
  // ==========================================================================
  /* MVP: Flights disabled for initial launch
  {
    name: 'search_flights',
    description: `Search for flights between two cities. NOTE: This tool is not yet connected to a live API.`,
    input_schema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Departure city or airport code' },
        destination: { type: 'string', description: 'Arrival city or airport code' },
        departure_date: { type: 'string', description: 'Departure date in YYYY-MM-DD format' },
        return_date: { type: 'string', description: 'Return date (optional for one-way)' },
        passengers: { type: 'number', description: 'Number of passengers (default: 1)' },
        cabin_class: { type: 'string', enum: ['economy', 'premium_economy', 'business', 'first'] }
      },
      required: ['origin', 'destination', 'departure_date']
    }
  },
  */

  // ==========================================================================
  // HOTEL SEARCH TOOL - MVP DISABLED
  // ==========================================================================
  /* MVP: Hotels disabled for initial launch
  {
    name: 'search_hotels',
    description: `Search for hotels and accommodations using HotelBeds API.`,
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'Full city name' },
        check_in: { type: 'string', description: 'Check-in date YYYY-MM-DD' },
        check_out: { type: 'string', description: 'Check-out date YYYY-MM-DD' },
        guests: { type: 'number', description: 'Number of guests (default: 2)' },
        rooms: { type: 'number', description: 'Number of rooms (default: 1)' }
      },
      required: ['destination', 'check_in', 'check_out']
    }
  },
  */

  // ==========================================================================
  // DESTINATION INFO TOOL (Uses Claude's knowledge)
  // ==========================================================================
  {
    name: 'get_destination_info',
    description: `Get information about a travel destination including best time to visit, local tips, neighborhoods, and travel advice.
    
Use this tool when the user wants to:
- Learn about a destination before booking
- Get tips for visiting a place
- Understand the best time to visit
- Learn about different neighborhoods or areas
- Get general travel advice

This uses Claude's knowledge rather than an external API.`,
    input_schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: 'City, region, or country to get information about'
        },
        topics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific topics to cover (e.g., ["best_time", "neighborhoods", "local_food", "safety", "transportation"])'
        }
      },
      required: ['destination']
    }
  },

  // ==========================================================================
  // LOCATION IDENTIFICATION TOOL (Uses Vision AI)
  // ==========================================================================
  {
    name: 'identify_location',
    description: `Identify a travel destination from an image.
    
Use this tool when the user uploads an image and wants to know:
- What place/landmark is shown
- Where the photo was taken
- Information about the location in the image

NOTE: This requires an image URL or base64 data to be provided.`,
    input_schema: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'URL of the image to analyze'
        },
        image_data: {
          type: 'string',
          description: 'Base64-encoded image data (alternative to URL)'
        }
      },
      required: []
    }
  }
];

// ============================================================================
// SYSTEM PROMPT FOR TRAVEL AGENT
// ============================================================================

export const travelAgentSystemPrompt = `You are Via, the friendly travel expert for Viaggio.ai. You help users find amazing tours, activities, and experiences.

## YOUR SPECIALTY
Tours and experiences ONLY. No hotels or flights.

## WHEN TO SEARCH vs ANSWER
SEARCH when users say: "find", "search", "book", "show me", "look up", "deals", "what tours"
ANSWER (no search) when users say: "what should I see", "tell me about", "best time to visit"

For general questions, share knowledge then offer: "Would you like me to find some bookable tours?"

## DEALS REQUESTS
When users ask for "deals", "discounts", "sales": search with special_offer: true

## FORMATTING RULES - CRITICAL
1. NEVER use markdown (**bold**, *italic*, - bullets, # headers)
2. Write clean flowing paragraphs only
3. Emojis OK sparingly
4. After searching: 2-3 sentences MAX (cards show details)
5. For info questions: 2-3 short paragraphs, then offer to search

## Tools
- search_tours: Find bookable tours (use special_offer:true for deals)
- get_destination_info: Travel tips and advice

Be helpful, natural, and concise.`;
