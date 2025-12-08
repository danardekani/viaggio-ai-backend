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

NOTE: This tool is not yet connected to a live API. It will return a message indicating flights are coming soon.`,
    input_schema: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: 'Departure city name or airport code (e.g., "Philadelphia", "PHL", "New York", "JFK")'
        },
        destination: {
          type: 'string',
          description: 'Arrival city name or airport code (e.g., "Rome", "FCO", "Paris", "CDG")'
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
          description: 'Cabin class preference (default: economy)'
        }
      },
      required: ['origin', 'destination', 'departure_date']
    }
  },

  // ==========================================================================
  // HOTEL SEARCH TOOL (Placeholder - for future Booking.com integration)
  // ==========================================================================
  {
    name: 'search_hotels',
    description: `Search for hotels and accommodations in a destination.
    
Use this tool when the user wants to:
- Find hotels in a city
- Look for accommodations for specific dates
- Compare hotel prices
- Find hotels within a budget

NOTE: This tool is not yet connected to a live API. It will return a message indicating hotels are coming soon.`,
    input_schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: 'City or area name (e.g., "Rome", "Paris", "Manhattan")'
        },
        check_in: {
          type: 'string',
          description: 'Check-in date in YYYY-MM-DD format'
        },
        check_out: {
          type: 'string',
          description: 'Check-out date in YYYY-MM-DD format'
        },
        guests: {
          type: 'number',
          description: 'Number of guests (default: 2)'
        },
        rooms: {
          type: 'number',
          description: 'Number of rooms (default: 1)'
        },
        max_price_per_night: {
          type: 'number',
          description: 'Maximum price per night in USD (optional)'
        },
        star_rating: {
          type: 'number',
          description: 'Minimum star rating 1-5 (optional)'
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
- Get recommendations for areas to stay
- Understand the best time to visit
- Get local tips and cultural information

This tool uses AI knowledge to provide helpful destination information.`,
    input_schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: 'City, region, or country name'
        },
        topics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific topics to cover (e.g., ["weather", "neighborhoods", "food", "safety", "transportation"])'
        }
      },
      required: ['destination']
    }
  },

  // ==========================================================================
  // IDENTIFY LOCATION TOOL (Uses Google Vision + Claude)
  // ==========================================================================
  {
    name: 'identify_location',
    description: `Identify a travel destination from an image. This is used with the "Where Is This?" feature.
    
Use this tool when the user:
- Uploads an image and asks where it is
- Wants to identify a landmark or destination from a photo
- Shares a travel photo and wants to visit that place

The tool uses Google Cloud Vision for landmark detection and AI analysis for scene recognition.`,
    input_schema: {
      type: 'object',
      properties: {
        image_base64: {
          type: 'string',
          description: 'Base64 encoded image data'
        },
        media_type: {
          type: 'string',
          description: 'Image MIME type (e.g., "image/jpeg", "image/png")'
        }
      },
      required: ['image_base64']
    }
  }
];

// ==========================================================================
// SYSTEM PROMPT FOR TRAVEL AGENT
// ==========================================================================

export const travelAgentSystemPrompt = `You are Via, the travel expert for Viaggio.ai. Friendly, knowledgeable, and concise.

TOOLS:
- search_tours: Find activities (WORKING)
- search_flights/search_hotels: COMING SOON (mention this if asked)
- get_destination_info: Destination tips
- identify_location: ID places from photos

RESPONSE STYLE:
- Keep responses under 100 words when possible
- Be warm but brief - no lengthy paragraphs
- Tour results appear as cards automatically - don't list them all
- After searching tours, count the actual tours returned and mention that exact number
- Give 1-2 specific tour highlights, then ask a follow-up question

EXAMPLE GOOD RESPONSE (after finding tours):
"Found 8 great tours in Rome! ðŸŽ‰ Prices range from $31-$105. The Vatican skip-the-line tour is super popular, and the Colosseum arena floor access is a unique experience. What interests you more - history, food, or art?"

IMPORTANT: Count the tours in the API response accurately - if 7 tours were returned, say "Found 7 tours", not "Found 5 tours".

DON'T:
- Write long paragraphs
- List every tour with details (cards do that)
- Over-explain
- Use bullet points
- Guess at tour counts - count them accurately

DO:
- Be conversational and warm
- Count actual results accurately
- Give 1-2 specific recommendations
- Ask ONE follow-up question
- Mention price ranges briefly`;

export default { agentTools, travelAgentSystemPrompt };
