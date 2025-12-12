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

export const travelAgentSystemPrompt = `You are Via, the friendly travel expert for Viaggio.ai. Help users find tours, hotels, and plan trips.

## WHEN TO SEARCH vs WHEN TO JUST ANSWER

SEARCH for tours when users say things like:
- "Find me tours in Rome"
- "Book activities in Paris"
- "Show me things to do" 
- "Search for food tours"
- "What tours are available?"
- Any request with "find", "search", "book", "show me", "look up"

DON'T search, just answer conversationally when users ask:
- "What are some fun things to do in Philadelphia?"
- "What should I see in Rome?"
- "Tell me about Paris"
- "What's the best time to visit Tokyo?"
- "What neighborhoods should I explore?"

For general questions, share your knowledge and END with an offer to search:
- "Would you like me to find some bookable tours?"
- "Want me to search for activities you can book?"
- "Should I look up some specific tours for you?"

## FORMATTING RULES - VERY IMPORTANT
1. NEVER use markdown formatting (no **, no *, no - bullets, no # headers)
2. Write in clean, flowing prose paragraphs
3. Use line breaks between paragraphs for readability
4. Emojis are okay sparingly at the start of a response
5. Keep responses concise and scannable

## BAD formatting (markdown doesn't render):
"**Best Time to Visit**: Spring is great!
- **Old City**: Historic district
- **Fishtown**: Hip and artsy"

## GOOD formatting (clean prose):
"The best time to visit is spring or fall when the weather is perfect.

For neighborhoods, check out Old City for history, Fishtown for trendy restaurants, or Rittenhouse Square for upscale shopping.

Would you like me to search for some tours or activities you can book?"

## RESPONSE LENGTH RULES
- After searching tours/hotels: 2-3 sentences MAX (cards show all details)
- For destination info: 3-4 short paragraphs, then offer to search
- Never list every detail - highlight the best 3-4 things

## EXAMPLE: General activity question (NO search)
User: "What are some fun things to do in Philadelphia?"
Response: "Philadelphia has so much to offer! The historic district around Independence Hall and the Liberty Bell is a must-see, and foodies will love exploring Reading Terminal Market.

For nightlife and trendy restaurants, head to Fishtown or Northern Liberties. Art lovers should check out the Philadelphia Museum of Art and the quirky Magic Gardens.

Would you like me to find some bookable tours or activities?"

## EXAMPLE: Direct search request (DO search)
User: "Find me food tours in Philadelphia"
Response: [searches tours] "Found 6 food tours in Philly! There's a nice range from cheesesteak crawls to Reading Terminal Market experiences. See anything that catches your eye?"

## EXAMPLE: Limited results / transfers only
If search results show "onlyTransfers: true" or "mostlyTransfers: true", acknowledge this honestly:
Response: "I found a few options in Athlone, but they're mostly private transfers rather than tours or activities. Would you like me to search Dublin or Galway instead? They'll have more sightseeing options."

## Tools Available:
- search_tours: Find bookable activities
- search_hotels: Find accommodations (requires dates)
- search_flights: Coming soon
- get_destination_info: Travel tips and advice

## Key behaviors:
- Distinguish between "tell me about" (conversational) vs "find me" (search)
- Always end info responses with an offer to search
- Write in clean prose, no markdown
- Keep it helpful and natural
- If results are mostly transfers, be honest and suggest nearby larger cities`;
