// ============================================================================
// AGENT TOOLS - GEMINI FORMAT
// ============================================================================
// Tool definitions for Google Gemini 2.0 Flash.
// These use Gemini's function declaration format.
// ============================================================================

export const geminiTools = [
  // ==========================================================================
  // TOUR SEARCH TOOL
  // ==========================================================================
  {
    name: 'search_tours',
    description: `Search for tours, activities, and experiences in a destination using the Viator API. Use this tool when the user wants to find things to do in a city, look for specific activities (food tours, walking tours, museums, etc.), browse experiences for a trip, or find tours within a budget or date range. The tool returns real, bookable tours with prices, ratings, and availability.`,
    parameters: {
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
  // FLIGHT SEARCH TOOL
  // ==========================================================================
  {
    name: 'search_flights',
    description: `Search for flights between two cities. Use this tool when the user wants to find flights to a destination, compare flight prices, look for flights on specific dates, or check flight options for a trip. NOTE: This tool is not yet connected to a live API. It will return a message indicating flights are coming soon.`,
    parameters: {
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
  // HOTEL SEARCH TOOL
  // ==========================================================================
  {
    name: 'search_hotels',
    description: `Search for hotels and accommodations in a destination. Use this tool when the user wants to find hotels in a city, look for accommodations for specific dates, compare hotel prices, or find hotels within a budget. NOTE: This tool is not yet connected to a live API. It will return a message indicating hotels are coming soon.`,
    parameters: {
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
  // DESTINATION INFO TOOL
  // ==========================================================================
  {
    name: 'get_destination_info',
    description: `Get information about a travel destination including best time to visit, local tips, neighborhoods, and travel advice. Use this tool when the user wants to learn about a destination before booking, get recommendations for areas to stay, understand the best time to visit, or get local tips and cultural information. This tool uses AI knowledge to provide helpful destination information.`,
    parameters: {
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
  // IDENTIFY LOCATION TOOL
  // ==========================================================================
  {
    name: 'identify_location',
    description: `Identify a travel destination from an image. This is used with the "Where Is This?" feature. Use this tool when the user uploads an image and asks where it is, wants to identify a landmark or destination from a photo, or shares a travel photo and wants to visit that place. The tool uses Google Cloud Vision for landmark detection and AI analysis for scene recognition.`,
    parameters: {
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
- search_tours: Find activities (WORKING - returns real Viator tours)
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
"Found 8 great tours in Rome! 🎉 Prices range from $31-$105. The Vatican skip-the-line tour is super popular, and the Colosseum arena floor access is a unique experience. What interests you more - history, food, or art?"

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

export default { geminiTools, travelAgentSystemPrompt };
