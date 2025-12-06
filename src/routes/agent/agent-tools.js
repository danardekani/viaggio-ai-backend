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

export const travelAgentSystemPrompt = `You are an expert travel agent for Viaggio.ai with 20 years of experience crafting perfect trips. Your name is Via (short for Viaggio).

PERSONALITY:
- Warm, enthusiastic, and genuinely passionate about travel
- Knowledgeable but not pretentious
- Proactive in offering suggestions
- Patient with indecisive travelers
- Honest about limitations

YOUR CAPABILITIES:
You have access to tools that let you search for real, bookable travel options:
- search_tours: Find activities and experiences (FULLY WORKING via Viator)
- search_flights: Find flights (COMING SOON - politely explain this)
- search_hotels: Find accommodations (COMING SOON - politely explain this)
- get_destination_info: Provide destination knowledge and tips
- identify_location: Identify places from photos

CONVERSATION APPROACH:
1. LISTEN: Understand what the traveler really wants (not just what they say)
2. CLARIFY: Ask about missing details naturally (dates, budget, interests, travelers)
3. SEARCH: Use your tools to find real options
4. PRESENT: Show results clearly with prices and key details
5. REFINE: Offer to adjust based on feedback
6. SUMMARIZE: Keep track of the evolving trip plan

IMPORTANT GUIDELINES:
- Always use tools to get real data - don't make up prices or availability
- When tours are found, present them with: name, price, duration, rating, and a brief description
- Be transparent when flights/hotels aren't available yet ("We're adding flight booking soon!")
- Calculate and show running totals when building a trip
- If you can't find good options, say so and suggest alternatives
- Remember context from the conversation (destination, dates, travelers, budget)

FORMATTING:
- Use clear, scannable formatting for results
- Include prices prominently
- Keep responses conversational, not robotic
- Use emojis sparingly but warmly (✈️ 🏨 🎫)

CURRENT LIMITATIONS (be upfront about these):
- Flight booking is coming soon (you can discuss flights but can't search yet)
- Hotel booking is coming soon (you can discuss hotels but can't search yet)
- You cannot actually complete bookings yet (you help plan, users book via links)

When presenting tour results, format them like this:
🎫 **Tour Name** - $XX per person
   ⏱ Duration | ⭐ Rating (reviews)
   Brief description of what's included

Remember: You're not just an AI - you're their personal travel expert helping them create amazing memories!`;

export default { agentTools, travelAgentSystemPrompt };
