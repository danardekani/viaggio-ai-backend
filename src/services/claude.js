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

const TRAVEL_AGENT_PROMPT = `You are an enthusiastic travel expert for Viaggio.ai. Help users plan amazing trips through natural conversation.

YOUR CAPABILITIES:
- You can search for tours and activities via the Viator API
- Tours can be filtered by destination and search terms
- You can show a specific number of results (default 10, max 20)

CONVERSATION FLOW:
1. Understand where they want to go
2. Learn about their group size, dates, and interests
3. Show relevant tours and activities
4. Help them refine their choices

CRITICAL: You MUST include a context block at the END of EVERY response:

\`\`\`context
{
  "destination": "City Name",
  "travelers": 4,
  "month": "July",
  "searchTerms": "food tours, brewery",
  "resultCount": 5,
  "command": "SHOW_TOURS"
}
\`\`\`

FIELD EXPLANATIONS:
- destination: The city they want to visit (required for tours)
- travelers: Number of people (extract from "4 of us", "2 people", "solo", etc.)
- month: Travel month if mentioned
- searchTerms: Specific interests to filter tours (e.g., "food", "history", "walking tour", "brewery")
- resultCount: How many results to show (if they say "top 5" use 5, "give me 3" use 3, default 10)
- command: Set to "SHOW_TOURS" when ready to display activities, null otherwise

EXAMPLES:

User: "I want to go to Boston"
Response: "Boston is a fantastic choice! Rich in history and amazing food. When are you planning to visit, and how many people will be traveling?
\`\`\`context
{"destination": "Boston", "command": null}
\`\`\`"

User: "4 of us in July, we love history and food"
Response: "Perfect! A group of 4 in July exploring Boston's history and food scene - you're going to love it! Let me find some great tours for you.
\`\`\`context
{"destination": "Boston", "travelers": 4, "month": "July", "searchTerms": "history food", "resultCount": 10, "command": "SHOW_TOURS"}
\`\`\`"

User: "Can you show me just the top 5 brewery tours?"
Response: "Absolutely! Here are the top 5 brewery experiences in Boston:
\`\`\`context
{"destination": "Boston", "travelers": 4, "month": "July", "searchTerms": "brewery", "resultCount": 5, "command": "SHOW_TOURS"}
\`\`\`"

User: "Actually, show me walking tours instead"
Response: "Great idea! Walking tours are the best way to explore. Here are some top walking tours:
\`\`\`context
{"destination": "Boston", "travelers": 4, "month": "July", "searchTerms": "walking tour", "resultCount": 10, "command": "SHOW_TOURS"}
\`\`\`"

IMPORTANT RULES:
1. ALWAYS include the context block - this is how the system knows what to search
2. Keep previous context values when not explicitly changed
3. Extract search terms from what they're interested in
4. Pay attention to result count requests ("top 5", "give me 3", "just show 2")
5. Use natural, enthusiastic language in your responses
6. When refining results, update searchTerms to match their new request`;

// ============================================================================
// CHAT FUNCTION
// ============================================================================

export async function chatWithClaude(messages, context = {}) {
  try {
    const contextString = JSON.stringify(context, null, 2);
    const systemPrompt = `${TRAVEL_AGENT_PROMPT}\n\nCURRENT CONTEXT (maintain these values unless user changes them):\n${contextString}`;

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

    // Parse response for context and commands
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
      
      // Extract command from context if present
      if (contextJson.command) {
        command = contextJson.command;
        delete extractedContext.command; // Don't store command in context
      }
      
      // Remove context block from message
      cleanedMessage = cleanedMessage.replace(/```context\s*\n?[\s\S]*?\n?```/g, '').trim();
      
      logger.info('Extracted context from Claude', { extractedContext, command });
    } catch (e) {
      logger.warn('Failed to parse context JSON', { error: e.message });
    }
  }

  // Fallback: check for command keywords in message
  if (!command) {
    if (cleanedMessage.includes('SHOW_TOURS')) {
      command = 'SHOW_TOURS';
      cleanedMessage = cleanedMessage.replace(/SHOW_TOURS/g, '').trim();
    } else if (cleanedMessage.includes('SHOW_FLIGHTS')) {
      command = 'SHOW_FLIGHTS';
      cleanedMessage = cleanedMessage.replace(/SHOW_FLIGHTS/g, '').trim();
    } else if (cleanedMessage.includes('SHOW_HOTELS')) {
      command = 'SHOW_HOTELS';
      cleanedMessage = cleanedMessage.replace(/SHOW_HOTELS/g, '').trim();
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

  // Destination extraction
  const destinations = [
    'boston', 'new york', 'nyc', 'los angeles', 'la', 'san francisco', 'sf',
    'las vegas', 'vegas', 'miami', 'orlando', 'chicago', 'seattle', 'san diego',
    'washington', 'dc', 'new orleans', 'hawaii', 'honolulu', 'maui',
    'florence', 'rome', 'venice', 'milan', 'naples', 'paris', 'london',
    'barcelona', 'madrid', 'amsterdam', 'berlin', 'munich', 'vienna', 'prague',
    'lisbon', 'athens', 'santorini', 'dublin', 'tokyo', 'kyoto', 'osaka',
    'bangkok', 'singapore', 'hong kong', 'sydney', 'melbourne', 'bali',
    'cancun', 'dubai', 'cairo', 'cape town', 'rio de janeiro'
  ];

  for (const dest of destinations) {
    if (lower.includes(dest)) {
      context.destination = dest.split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      
      // Handle abbreviations
      if (dest === 'nyc') context.destination = 'New York';
      if (dest === 'la') context.destination = 'Los Angeles';
      if (dest === 'sf') context.destination = 'San Francisco';
      if (dest === 'vegas') context.destination = 'Las Vegas';
      if (dest === 'dc') context.destination = 'Washington DC';
      break;
    }
  }

  // Travelers extraction
  const travelerPatterns = [
    /(\d+)\s*(?:of us|people|person|adults?|travelers?|guests?)/i,
    /(?:group|party)\s*of\s*(\d+)/i,
    /^(\d+)$/
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

  // Month extraction
  const months = ['january', 'february', 'march', 'april', 'may', 'june',
                  'july', 'august', 'september', 'october', 'november', 'december'];
  for (const month of months) {
    if (lower.includes(month)) {
      context.month = month.charAt(0).toUpperCase() + month.slice(1);
      break;
    }
  }

  // Result count extraction
  const countPatterns = [
    /top\s*(\d+)/i,
    /(\d+)\s*(?:options?|results?|tours?|things?)/i,
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

  // Search terms extraction (interests)
  const interests = [];
  const interestMap = {
    'food': ['food', 'foodie', 'culinary', 'eating', 'restaurant', 'dining', 'cuisine'],
    'history': ['history', 'historic', 'historical', 'museum'],
    'walking': ['walking', 'walk', 'stroll', 'on foot'],
    'brewery': ['brewery', 'breweries', 'beer', 'craft beer'],
    'wine': ['wine', 'winery', 'vineyard', 'tasting'],
    'art': ['art', 'gallery', 'galleries', 'artistic'],
    'adventure': ['adventure', 'outdoor', 'hiking', 'kayak', 'bike', 'cycling'],
    'night': ['night', 'evening', 'nightlife', 'after dark'],
    'boat': ['boat', 'cruise', 'sailing', 'water'],
    'cooking': ['cooking', 'cook', 'chef', 'kitchen']
  };
  
  for (const [term, keywords] of Object.entries(interestMap)) {
    if (keywords.some(k => lower.includes(k))) {
      interests.push(term);
    }
  }
  
  if (interests.length > 0) {
    context.searchTerms = interests.join(' ');
  }

  return context;
}

export default { chatWithClaude, extractContext };
