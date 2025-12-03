// ============================================================================
// CLAUDE AI SERVICE
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/errors.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const TRAVEL_AGENT_PROMPT = `You are a travel expert for Viaggio.ai. You help users find and book tours.

CRITICAL: You have access to REAL bookable tours via Viator. When users ask about activities or things to do, you MUST show them real tours - NOT text descriptions.

HOW TO SHOW TOURS:
Include this at the END of your response:
\`\`\`context
{"destination": "Boston", "travelers": 3, "month": "July", "startDate": "2025-07-15", "endDate": "2025-07-22", "searchTerms": "food", "resultCount": 5, "command": "SHOW_TOURS"}
\`\`\`

RULES:
1. ALWAYS include a context block at the end of every response
2. Set "command": "SHOW_TOURS" whenever user wants to see activities/tours
3. Set "command": null only for greetings or when asking questions
4. Keep searchTerms to 1-2 words max (e.g., "food" or "history")
5. Keep your text SHORT when showing tours - let the tour cards speak
6. Set sortBy based on user preference: "reviews", "rating", "price_low", "price_high", "newest", or "popular" (default)
7. When user provides travel dates, include startDate and endDate in YYYY-MM-DD format

DATE HANDLING:
- When user gives specific dates like "July 15-22" or "December 10 to 15", convert to startDate/endDate
- Use YYYY-MM-DD format (e.g., "2025-07-15")
- If user says "next month" or just a month name, estimate reasonable dates
- Today's date is ${new Date().toISOString().split('T')[0]}

SORTBY OPTIONS:
- "popular" (default) - Most popular/featured tours
- "reviews" - Tours with the MOST REVIEWS (use when user says "most reviews", "most popular", "most booked")
- "rating" - Highest rated tours
- "price_low" - Cheapest first  
- "price_high" - Most expensive first
- "newest" - Newest tours

WHEN TO SHOW TOURS (command = "SHOW_TOURS"):
- "What are the top activities in X?"
- "Things to do in X"
- "Show me tours"
- User gives number of travelers
- User mentions interests (food, history, etc.)
- "What would you recommend?"

WHEN NOT TO SHOW TOURS (command = null):
- Just saying hello
- You need to ask what city they want

EXAMPLES:

User: "What are the top 5 things to do in Boston in July?"
You: "Here are the top activities in Boston for July!
\`\`\`context
{"destination": "Boston", "month": "July", "resultCount": 5, "command": "SHOW_TOURS"}
\`\`\`"

User: "There are 3 of us"  
You: "Great, here are the best tours for your group of 3:
\`\`\`context
{"travelers": 3, "command": "SHOW_TOURS"}
\`\`\`"

User: "Show me tours with the most reviews"
You: "Here are the most reviewed tours:
\`\`\`context
{"sortBy": "reviews", "command": "SHOW_TOURS"}
\`\`\`"

User: "Show me the cheapest food tours"
You: "Here are the most affordable food tours:
\`\`\`context
{"searchTerms": "food", "sortBy": "price_low", "command": "SHOW_TOURS"}
\`\`\`"

User: "Show me food tours instead"
You: "Here are the best food tours:
\`\`\`context
{"searchTerms": "food", "command": "SHOW_TOURS"}
\`\`\`"

User: "I want to visit Paris"
You: "Paris is wonderful! When are you planning to go and how many travelers?
\`\`\`context
{"destination": "Paris", "command": null}
\`\`\`"

User: "We're going July 15-22"
You: "Perfect! Here are tours available for your dates:
\`\`\`context
{"startDate": "2025-07-15", "endDate": "2025-07-22", "command": "SHOW_TOURS"}
\`\`\`"

User: "What about December 10th to the 15th?"
You: "Here are tours for December 10-15:
\`\`\`context
{"startDate": "2025-12-10", "endDate": "2025-12-15", "command": "SHOW_TOURS"}
\`\`\`"

REMEMBER: Short text + SHOW_TOURS = User sees real bookable tours!`;

// ============================================================================
// CHAT FUNCTION
// ============================================================================

export async function chatWithClaude(messages, context = {}) {
  try {
    const contextString = JSON.stringify(context, null, 2);
    const systemPrompt = `${TRAVEL_AGENT_PROMPT}\n\nCURRENT CONTEXT (keep these values unless changed):\n${contextString}`;

    logger.info('Sending request to Claude API', { 
      messageCount: messages.length,
      currentContext: context 
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    });

    const assistantMessage = response.content[0].text;

    logger.info('Received response from Claude API', {
      responseLength: assistantMessage.length
    });

    const parsed = parseClaudeResponse(assistantMessage, context);

    return {
      message: parsed.cleanedMessage,
      command: parsed.command,
      extractedContext: parsed.extractedContext,
      usage: response.usage
    };

  } catch (error) {
    logger.error('Claude API error', { error: error.message });

    if (error.status === 401) {
      throw new ApiError(500, 'Invalid API key');
    } else if (error.status === 429) {
      throw new ApiError(429, 'Rate limit exceeded');
    }

    throw new ApiError(500, 'Failed to communicate with AI service');
  }
}

// ============================================================================
// RESPONSE PARSER
// ============================================================================

function parseClaudeResponse(response, existingContext = {}) {
  let cleanedMessage = response;
  let extractedContext = { ...existingContext };
  let command = null;

  // Extract context JSON block
  const contextMatch = response.match(/```context\s*\n?([\s\S]*?)\n?```/);
  if (contextMatch) {
    try {
      const contextJson = JSON.parse(contextMatch[1].trim());
      
      // Merge with existing context
      extractedContext = { 
        ...existingContext,
        ...contextJson
      };
      
      // Extract command
      if (contextJson.command) {
        command = contextJson.command;
        delete extractedContext.command;
      }
      
      // Remove context block from message
      cleanedMessage = cleanedMessage.replace(/```context\s*\n?[\s\S]*?\n?```/g, '').trim();
      
      logger.info('Extracted context from Claude', { extractedContext, command });
    } catch (e) {
      logger.warn('Failed to parse context JSON', { error: e.message });
    }
  }

  // Fallback: check for command keywords
  if (!command) {
    if (cleanedMessage.includes('SHOW_TOURS')) {
      command = 'SHOW_TOURS';
      cleanedMessage = cleanedMessage.replace(/SHOW_TOURS/g, '').trim();
    }
  }

  return { command, cleanedMessage, extractedContext };
}

// ============================================================================
// FALLBACK CONTEXT EXTRACTION
// ============================================================================

export function extractContext(userMessage, existingContext = {}) {
  const lower = userMessage.toLowerCase();
  const context = { ...existingContext };

  // Destinations - check longer names first, use word boundaries
  const destinations = [
    // Multi-word cities (check first)
    { name: 'Lake Placid', patterns: ['lake placid'] },
    { name: 'Bar Harbor', patterns: ['bar harbor'] },
    { name: 'Portland, ME', patterns: ['portland, me', 'portland maine', 'portland, maine'] },
    { name: 'Philadelphia', patterns: ['philadelphia', 'philly'] },
    { name: 'San Francisco', patterns: ['san francisco', 'sf'] },
    { name: 'Los Angeles', patterns: ['los angeles', 'la'] },
    { name: 'New York', patterns: ['new york', 'nyc', 'manhattan'] },
    { name: 'Las Vegas', patterns: ['las vegas', 'vegas'] },
    { name: 'Washington DC', patterns: ['washington dc', 'washington d.c.', 'dc'] },
    { name: 'New Orleans', patterns: ['new orleans', 'nola'] },
    { name: 'San Diego', patterns: ['san diego'] },
    { name: 'Rio de Janeiro', patterns: ['rio de janeiro', 'rio'] },
    { name: 'Hong Kong', patterns: ['hong kong'] },
    { name: 'Cape Town', patterns: ['cape town'] },
    { name: 'Salt Lake City', patterns: ['salt lake city', 'salt lake'] },
    { name: 'Lake Tahoe', patterns: ['lake tahoe', 'tahoe'] },
    { name: 'Napa Valley', patterns: ['napa valley', 'napa', 'sonoma'] },
    { name: 'Palm Springs', patterns: ['palm springs'] },
    { name: 'Santa Barbara', patterns: ['santa barbara'] },
    { name: 'Cape Cod', patterns: ['cape cod'] },
    { name: 'Martha\'s Vineyard', patterns: ['martha\'s vineyard', 'marthas vineyard'] },
    { name: 'Jackson Hole', patterns: ['jackson hole', 'jackson, wy'] },
    { name: 'Park City', patterns: ['park city'] },
    { name: 'Key West', patterns: ['key west', 'florida keys'] },
    { name: 'St. Augustine', patterns: ['st augustine', 'st. augustine', 'saint augustine'] },
    { name: 'Hilton Head', patterns: ['hilton head'] },
    { name: 'Myrtle Beach', patterns: ['myrtle beach'] },
    { name: 'Outer Banks', patterns: ['outer banks', 'obx'] },
    
    // National Parks
    { name: 'Grand Canyon National Park', patterns: ['grand canyon'] },
    { name: 'Yellowstone National Park', patterns: ['yellowstone'] },
    { name: 'Yosemite National Park', patterns: ['yosemite'] },
    { name: 'Zion National Park', patterns: ['zion'] },
    { name: 'Glacier National Park', patterns: ['glacier national park', 'glacier'] },
    { name: 'Acadia National Park', patterns: ['acadia'] },
    
    // Standard US cities
    { name: 'Boston', patterns: ['boston'] },
    { name: 'Miami', patterns: ['miami'] },
    { name: 'Orlando', patterns: ['orlando'] },
    { name: 'Chicago', patterns: ['chicago'] },
    { name: 'Seattle', patterns: ['seattle'] },
    { name: 'Portland', patterns: ['portland'] },
    { name: 'Denver', patterns: ['denver'] },
    { name: 'Austin', patterns: ['austin'] },
    { name: 'Houston', patterns: ['houston'] },
    { name: 'Dallas', patterns: ['dallas'] },
    { name: 'Phoenix', patterns: ['phoenix', 'scottsdale'] },
    { name: 'Sedona', patterns: ['sedona'] },
    { name: 'Santa Fe', patterns: ['santa fe', 'taos'] },
    { name: 'Moab', patterns: ['moab'] },
    { name: 'Nashville', patterns: ['nashville'] },
    { name: 'Memphis', patterns: ['memphis'] },
    { name: 'Atlanta', patterns: ['atlanta'] },
    { name: 'Charleston', patterns: ['charleston'] },
    { name: 'Savannah', patterns: ['savannah'] },
    { name: 'Asheville', patterns: ['asheville'] },
    { name: 'Hawaii', patterns: ['hawaii', 'honolulu', 'maui', 'kauai', 'oahu'] },
    
    // International - Europe
    { name: 'Florence', patterns: ['florence'] },
    { name: 'Rome', patterns: ['rome'] },
    { name: 'Venice', patterns: ['venice'] },
    { name: 'Milan', patterns: ['milan'] },
    { name: 'Paris', patterns: ['paris'] },
    { name: 'London', patterns: ['london'] },
    { name: 'Barcelona', patterns: ['barcelona'] },
    { name: 'Madrid', patterns: ['madrid'] },
    { name: 'Amsterdam', patterns: ['amsterdam'] },
    { name: 'Berlin', patterns: ['berlin'] },
    { name: 'Munich', patterns: ['munich'] },
    { name: 'Vienna', patterns: ['vienna'] },
    { name: 'Prague', patterns: ['prague'] },
    { name: 'Lisbon', patterns: ['lisbon'] },
    { name: 'Athens', patterns: ['athens'] },
    { name: 'Santorini', patterns: ['santorini'] },
    { name: 'Dublin', patterns: ['dublin'] },
    { name: 'Edinburgh', patterns: ['edinburgh'] },
    { name: 'Copenhagen', patterns: ['copenhagen'] },
    { name: 'Stockholm', patterns: ['stockholm'] },
    { name: 'Reykjavik', patterns: ['reykjavik', 'iceland'] },
    
    // International - Asia Pacific
    { name: 'Tokyo', patterns: ['tokyo'] },
    { name: 'Kyoto', patterns: ['kyoto'] },
    { name: 'Osaka', patterns: ['osaka'] },
    { name: 'Bangkok', patterns: ['bangkok'] },
    { name: 'Singapore', patterns: ['singapore'] },
    { name: 'Sydney', patterns: ['sydney'] },
    { name: 'Melbourne', patterns: ['melbourne'] },
    { name: 'Bali', patterns: ['bali'] },
    { name: 'Dubai', patterns: ['dubai'] },
    
    // International - Americas
    { name: 'Cancun', patterns: ['cancun'] },
    { name: 'Cabo San Lucas', patterns: ['cabo', 'cabo san lucas', 'los cabos'] },
    { name: 'Puerto Vallarta', patterns: ['puerto vallarta'] },
    { name: 'Mexico City', patterns: ['mexico city', 'cdmx'] },
    { name: 'San Juan', patterns: ['san juan', 'puerto rico'] },
    { name: 'Caribbean', patterns: ['caribbean'] },
    
    // International - Other
    { name: 'Cairo', patterns: ['cairo'] }
  ];

  // Use word boundary matching for short patterns
  for (const dest of destinations) {
    for (const pattern of dest.patterns) {
      // For short patterns (2-3 chars), require word boundaries
      if (pattern.length <= 3) {
        const regex = new RegExp(`\\b${pattern}\\b`, 'i');
        if (regex.test(lower)) {
          context.destination = dest.name;
          break;
        }
      } else {
        // For longer patterns, simple includes is fine
        if (lower.includes(pattern)) {
          context.destination = dest.name;
          break;
        }
      }
    }
    if (context.destination && context.destination !== existingContext.destination) break;
  }

  // Travelers
  const travelerPatterns = [
    /(\d+)\s*(?:of us|people|person|adults?|travelers?|guests?)/i,
    /(?:group|party)\s*of\s*(\d+)/i
  ];
  
  for (const pattern of travelerPatterns) {
    const match = lower.match(pattern);
    if (match) {
      context.travelers = parseInt(match[1]);
      break;
    }
  }
  
  // Solo traveler
  if (lower.includes('solo') || lower.includes('just me') || lower.includes('by myself')) {
    context.travelers = 1;
  }
  
  // Just a number (like "3" in response to "how many people")
  const justNumber = lower.match(/^(\d+)$/);
  if (justNumber) {
    context.travelers = parseInt(justNumber[1]);
  }

  // Month
  const months = ['january', 'february', 'march', 'april', 'may', 'june',
                  'july', 'august', 'september', 'october', 'november', 'december'];
  for (const month of months) {
    if (lower.includes(month)) {
      context.month = month.charAt(0).toUpperCase() + month.slice(1);
      break;
    }
  }

  // Result count
  const countPatterns = [
    /top\s*(\d+)/i,
    /(\d+)\s*(?:options?|results?|tours?|things?|activities)/i,
    /(?:show|give|find)\s*(?:me\s*)?(\d+)/i,
    /just\s*(\d+)/i
  ];
  
  for (const pattern of countPatterns) {
    const match = lower.match(pattern);
    if (match) {
      context.resultCount = Math.min(parseInt(match[1]), 20);
      break;
    }
  }

  // Search terms
  const interestMap = {
    'food': ['food', 'foodie', 'culinary', 'eating', 'restaurant', 'dining'],
    'history': ['history', 'historic', 'historical', 'museum'],
    'walking': ['walking', 'walk', 'on foot'],
    'brewery': ['brewery', 'breweries', 'beer', 'craft beer'],
    'wine': ['wine', 'winery', 'vineyard'],
    'art': ['art', 'gallery', 'galleries'],
    'adventure': ['adventure', 'outdoor', 'hiking', 'kayak'],
    'boat': ['boat', 'cruise', 'sailing', 'harbor']
  };
  
  for (const [term, keywords] of Object.entries(interestMap)) {
    if (keywords.some(k => lower.includes(k))) {
      context.searchTerms = term;
      break;
    }
  }

  // Sort preference
  if (lower.includes('most review') || lower.includes('most popular') || lower.includes('most booked')) {
    context.sortBy = 'reviews';
  } else if (lower.includes('highest rated') || lower.includes('best rated') || lower.includes('top rated')) {
    context.sortBy = 'rating';
  } else if (lower.includes('cheapest') || lower.includes('lowest price') || lower.includes('budget') || lower.includes('affordable')) {
    context.sortBy = 'price_low';
  } else if (lower.includes('most expensive') || lower.includes('luxury') || lower.includes('premium')) {
    context.sortBy = 'price_high';
  } else if (lower.includes('newest') || lower.includes('new tour') || lower.includes('recently added')) {
    context.sortBy = 'newest';
  }

  // Date extraction
  const dates = extractDates(userMessage, context.month);
  if (dates.startDate) context.startDate = dates.startDate;
  if (dates.endDate) context.endDate = dates.endDate;

  return context;
}

// ============================================================================
// DATE EXTRACTION HELPER
// ============================================================================

function extractDates(message, contextMonth) {
  const lower = message.toLowerCase();
  const today = new Date();
  const currentYear = today.getFullYear();
  
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                      'july', 'august', 'september', 'october', 'november', 'december'];
  const monthAbbrev = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 
                       'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  
  // Helper to get month number (0-11)
  const getMonthNum = (monthStr) => {
    const m = monthStr.toLowerCase();
    let idx = monthNames.findIndex(name => name.startsWith(m));
    if (idx === -1) idx = monthAbbrev.findIndex(abbr => m.startsWith(abbr));
    return idx;
  };
  
  // Helper to format date as YYYY-MM-DD
  const formatDate = (year, month, day) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  
  // Helper to determine year (use next year if month has passed)
  const getYear = (monthNum) => {
    return monthNum < today.getMonth() ? currentYear + 1 : currentYear;
  };
  
  let startDate = null;
  let endDate = null;
  
  // Pattern 1: "July 15-22" or "July 15 - 22" or "July 15 to 22"
  const rangePattern1 = /(\w+)\s+(\d{1,2})\s*[-–to]+\s*(\d{1,2})/i;
  const match1 = message.match(rangePattern1);
  if (match1) {
    const monthNum = getMonthNum(match1[1]);
    if (monthNum !== -1) {
      const year = getYear(monthNum);
      startDate = formatDate(year, monthNum, parseInt(match1[2]));
      endDate = formatDate(year, monthNum, parseInt(match1[3]));
    }
  }
  
  // Pattern 2: "July 15 to July 22" or "July 15th to July 22nd"
  const rangePattern2 = /(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|through|-|–)\s*(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?/i;
  const match2 = message.match(rangePattern2);
  if (match2 && !startDate) {
    const monthNum1 = getMonthNum(match2[1]);
    const monthNum2 = getMonthNum(match2[3]);
    if (monthNum1 !== -1 && monthNum2 !== -1) {
      const year1 = getYear(monthNum1);
      const year2 = monthNum2 < monthNum1 ? year1 + 1 : year1;
      startDate = formatDate(year1, monthNum1, parseInt(match2[2]));
      endDate = formatDate(year2, monthNum2, parseInt(match2[4]));
    }
  }
  
  // Pattern 3: "15th to 22nd" or "10-15" (uses context month or next occurrence)
  const rangePattern3 = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|through|-|–)\s*(\d{1,2})(?:st|nd|rd|th)?\b/i;
  const match3 = message.match(rangePattern3);
  if (match3 && !startDate) {
    let monthNum = today.getMonth();
    if (contextMonth) {
      const ctxMonth = getMonthNum(contextMonth);
      if (ctxMonth !== -1) monthNum = ctxMonth;
    }
    const year = getYear(monthNum);
    startDate = formatDate(year, monthNum, parseInt(match3[1]));
    endDate = formatDate(year, monthNum, parseInt(match3[2]));
  }
  
  // Pattern 4: Single date "July 15" or "July 15th" (set as start date, end = start + 1 day)
  const singleDatePattern = /(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(?!\s*[-–to]|\s*\d)/i;
  const match4 = message.match(singleDatePattern);
  if (match4 && !startDate) {
    const monthNum = getMonthNum(match4[1]);
    if (monthNum !== -1) {
      const year = getYear(monthNum);
      const day = parseInt(match4[2]);
      startDate = formatDate(year, monthNum, day);
      // Default to same day if no end date
      endDate = startDate;
    }
  }
  
  // Pattern 5: "this weekend"
  if (lower.includes('this weekend') && !startDate) {
    const saturday = new Date(today);
    const dayOfWeek = today.getDay();
    saturday.setDate(today.getDate() + (6 - dayOfWeek));
    const sunday = new Date(saturday);
    sunday.setDate(saturday.getDate() + 1);
    startDate = formatDate(saturday.getFullYear(), saturday.getMonth(), saturday.getDate());
    endDate = formatDate(sunday.getFullYear(), sunday.getMonth(), sunday.getDate());
  }
  
  // Pattern 6: "next week"
  if (lower.includes('next week') && !startDate) {
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + (8 - today.getDay()));
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    startDate = formatDate(nextMonday.getFullYear(), nextMonday.getMonth(), nextMonday.getDate());
    endDate = formatDate(nextSunday.getFullYear(), nextSunday.getMonth(), nextSunday.getDate());
  }
  
  // Pattern 7: "next month"
  if (lower.includes('next month') && !startDate) {
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    startDate = formatDate(nextMonth.getFullYear(), nextMonth.getMonth(), 1);
    endDate = formatDate(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate());
  }
  
  return { startDate, endDate };
}

export default { chatWithClaude, extractContext };
