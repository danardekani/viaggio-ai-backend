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
        result_count: {
          type: 'number',
          description: 'Number of results to return (default: 5, max: 10)'
        }
      },
      required: ['destination']
    }
  },

  // ==========================================================================
  // FLIGHT SEARCH TOOL (Placeholder - for future Amadeus/Duffel integration)
  // ==========================================================================
  {
    name: 'search_flights',
    description: `Search for flights between two cities.
    
Use this tool when the user wants to:
- Find flights to a destination
- Compare flight prices
- Look for flights on specific dates
- Check flight options for a trip

NOTE: This tool is not yet connected to a live API. It will return a placeholder response.`,
    input_schema: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: 'Departure city or airport code (e.g., "New York" or "JFK")'
        },
        destination: {
          type: 'string',
          description: 'Arrival city or airport code (e.g., "Paris" or "CDG")'
        },
        departure_date: {
          type: 'string',
          description: 'Departure date in YYYY-MM-DD format'
        },
        return_date: {
          type: 'string',
          description: 'Return date in YYYY-MM-DD format (optional for one-way)'
        },
        passengers: {
          type: 'number',
          description: 'Number of passengers (default: 1)'
        },
        cabin_class: {
          type: 'string',
          enum: ['economy', 'premium_economy', 'business', 'first'],
          description: 'Preferred cabin class (default: economy)'
        }
      },
      required: ['origin', 'destination', 'departure_date']
    }
  },

  // ==========================================================================
  // HOTEL SEARCH TOOL (Active - uses HotelBeds API)
  // ==========================================================================
  {
    name: 'search_hotels',
    description: `Search for hotels and accommodations in a destination using the HotelBeds API.
    
Use this tool when the user wants to:
- Find hotels in a city
- Look for accommodations for specific dates
- Compare hotel prices and options
- Find hotels within a budget
- Get hotel recommendations

The tool returns real, bookable hotels with prices, star ratings, amenities, and availability. 
Hotels are sourced from HotelBeds' inventory of 180K+ properties worldwide.

IMPORTANT: Use full city names like "New York", "London", "Paris" - not abbreviations like "NYC" or "LON".`,
    input_schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: 'Full city name (e.g., "New York", "London", "Paris", "Rome") - use complete names, not abbreviations'
        },
        check_in: {
          type: 'string',
          description: 'Check-in date in YYYY-MM-DD format (must be today or future date)'
        },
        check_out: {
          type: 'string',
          description: 'Check-out date in YYYY-MM-DD format (must be after check-in)'
        },
        guests: {
          type: 'number',
          description: 'Total number of guests/adults (default: 2)'
        },
        rooms: {
          type: 'number',
          description: 'Number of rooms needed (default: 1)'
        },
        max_price_per_night: {
          type: 'number',
          description: 'Maximum price per night in USD (optional filter)'
        },
        star_rating: {
          type: 'number',
          description: 'Minimum star rating 1-5 (optional, not currently implemented)'
        }
      },
      required: ['destination', 'check_in', 'check_out']
    }
  },

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

export const travelAgentSystemPrompt = `You are Via, a friendly and knowledgeable AI travel agent for Viaggio.ai. Your goal is to help users plan amazing trips by finding tours, hotels, and providing destination advice.

## Your Personality
- Warm, enthusiastic, and helpful
- You love travel and get excited about helping people explore
- You're efficient - you search for what users need rather than asking too many questions
- You give concise responses with the key information

## How to Help Users

### When users want to find tours/activities:
1. Use the search_tours tool immediately with their destination
2. If they mention specific interests (food, history, adventure), include those
3. If they want to sort by reviews, rating, price, etc., use the sort_by parameter
4. Present the results in a friendly way, highlighting key details

### When users want hotels:
1. Ask for dates if not provided (check-in and check-out are required)
2. Use search_hotels with full city names (not abbreviations)
3. Present options with prices and key amenities

### When users want destination info:
1. Use get_destination_info for travel tips and advice
2. Share your knowledge enthusiastically

### When users want flights:
1. Let them know flight search is coming soon
2. Offer to help with tours or hotels instead

## Response Style
- Be conversational but efficient
- Don't repeat back all the search parameters
- Focus on the results and why they're good options
- Use emojis sparingly but warmly ✈️ 🏨 🎯
- Keep responses concise - let the tour/hotel cards speak for themselves

## Important Notes
- Always use tools when users want to search for something
- Don't make up tour or hotel information - only use real results from tools
- If a search returns no results, suggest alternatives
- For sorting by reviews, use sort_by: "reviews"
- For sorting by rating, use sort_by: "rating"`;
