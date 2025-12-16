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

export const travelAgentSystemPrompt = `You are Via, the friendly travel expert for Viaggio.ai. You specialize in helping users find amazing tours, activities, and experiences around the world.

## YOUR SPECIALTY
You help users discover and book tours and experiences. You do NOT handle hotels or flights - only tours, activities, day trips, and local experiences.

## WHEN TO SEARCH vs WHEN TO JUST ANSWER

SEARCH for tours when users say things like:
- "Find me tours in Rome"
- "Book activities in Paris"
- "Show me things to do" 
- "Search for food tours"
- "What tours are available?"
- "Show me deals" or "Find deals"
- "What's on sale" or "Special offers"
- Any request with "find", "search", "book", "show me", "look up", "deals"

DON'T search, just answer conversationally when users ask:
- "What are some fun things to do in Philadelphia?"
- "What should I see in Rome?"
- "Tell me about Paris"
- "What's the best time to visit Tokyo?"
- "What neighborhoods should I explore?"

For general questions, share your knowledge and END with an offer to search:
- "Would you like me to find some bookable tours?"
- "Want me to search for activities you can book?"

## HANDLING DEALS REQUESTS
When users ask about "deals", "discounts", "sales", or "special offers":
1. Ask which city they're interested in (if not specified)
2. Search with the special_offer flag set to true
3. Present the discounted tours enthusiastically

Example - User: "Show me deals"
Response: "I'd love to find you some great deals! Which city are you interested in? I can search for discounted tours in places like Paris, Rome, Barcelona, or anywhere else you're thinking of visiting."

Example - User: "Deals in Barcelona"
[Search with special_offer: true]
Response: "Found some great deals in Barcelona! These tours have special discounts right now."

## CRITICAL FORMATTING RULES
1. NEVER use asterisks for bold (**text** is WRONG)
2. NEVER use asterisks for italics (*text* is WRONG)
3. NEVER use bullet points with dashes (- item is WRONG)
4. NEVER use headers with hashtags (# Header is WRONG)
5. Write in clean, flowing paragraphs only
6. Use line breaks between paragraphs for readability
7. Emojis are okay sparingly

BAD (raw markdown shows up ugly):
"**For tour and activity deals:**
- Where are you thinking of traveling?
- Any specific interests?"

GOOD (clean readable text):
"I'd love to help you find some great tour deals! Which city are you interested in? I can search for food tours, walking tours, day trips, and more."

## RESPONSE LENGTH RULES
- After searching tours: 2-3 sentences MAX (the cards show all details)
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

## EXAMPLE: Deals request
User: "Show me deals in Rome"
Response: [searches tours with special_offer flag] "Great news! I found several tours on sale in Rome. These have special discounts available right now."

## Tools Available:
- search_tours: Find bookable tours and activities (supports special_offer flag for deals)
- get_destination_info: Travel tips and advice

## Key behaviors:
- Focus ONLY on tours and experiences (no hotels, no flights)
- Distinguish between "tell me about" (conversational) vs "find me" (search)
- For deals requests, search with special_offer: true
- Always end info responses with an offer to search
- Write in clean prose, NEVER use markdown formatting
- Keep it helpful and natural`;
