// ============================================================================
// CLAUDE AI SERVICE
// ============================================================================
// Handles all interactions with the Claude API
// Includes conversation management, context tracking, and error handling
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/errors.js';

// Initialize Claude client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ============================================================================
// SYSTEM PROMPT FOR TRAVEL AGENT
// ============================================================================

const TRAVEL_AGENT_PROMPT = `You are an enthusiastic and knowledgeable travel expert AI assistant for Viaggio.ai. Your role is to help users plan amazing trips by having natural, helpful conversations.

PERSONALITY:
- Warm, friendly, and enthusiastic about travel
- Professional but conversational
- Asks clarifying questions to understand user needs
- Provides helpful suggestions and recommendations
- Celebrates with users when they make selections

CONVERSATION FLOW:
1. Greet and ask about their destination
2. Ask about travel dates, number of travelers, and interests
3. After gathering info, suggest tours and activities
4. Help them build an itinerary

CRITICAL INSTRUCTION - CONTEXT EXTRACTION:
When users mention travel details, you MUST include a JSON block at the END of your response to capture the information. Format:

\`\`\`context
{"destination": "city name", "travelers": number, "month": "month name", "interests": ["interest1", "interest2"]}
\`\`\`

Only include fields that were mentioned. Examples:

User: "I want to visit Tokyo"
Response: "Tokyo is amazing! When are you planning to visit and how many people will be traveling?
\`\`\`context
{"destination": "Tokyo"}
\`\`\`"

User: "4 of us in July, we love history and food"
Response: "A group of 4 in July - perfect! Let me find some great tours for you.
SHOW_TOURS
\`\`\`context
{"travelers": 4, "month": "July", "interests": ["history", "food"]}
\`\`\`"

SHOWING OPTIONS:
When it's time to show tours/activities, include SHOW_TOURS on its own line.

Remember: 
1. Always extract context into the JSON block
2. Use SHOW_TOURS when ready to display activities
3. Keep the conversation natural and helpful`;

// ============================================================================
// CHAT FUNCTION
// ============================================================================

/**
 * Send a message to Claude and get a response
 * @param {Array} messages - Conversation history in Anthropic format
 * @param {Object} context - User context (destination, travelers, etc.)
 * @returns {Promise<Object>} Claude's response with parsed commands
 */
export async function chatWithClaude(messages, context = {}) {
  try {
    // Add context to system prompt
    const contextString = JSON.stringify(context, null, 2);
    const systemPrompt = `${TRAVEL_AGENT_PROMPT}\n\nCURRENT USER CONTEXT:\n${contextString}`;

    logger.debug('Sending request to Claude API', { 
      messageCount: messages.length,
      context 
    });

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    });

    // Extract text from response
    const assistantMessage = response.content[0].text;

    logger.info('Received response from Claude API', {
      responseLength: assistantMessage.length,
      model: response.model
    });

    // Parse the response for commands and context
    const parsed = parseClaudeResponse(assistantMessage, context);

    return {
      message: parsed.cleanedMessage,
      command: parsed.command,
      extractedContext: parsed.extractedContext,
      fullResponse: assistantMessage,
      usage: response.usage
    };

  } catch (error) {
    logger.error('Claude API error', { 
      error: error.message,
      type: error.type 
    });

    if (error.status === 401) {
      throw new ApiError(500, 'Invalid API key - please check configuration');
    } else if (error.status === 429) {
      throw new ApiError(429, 'Rate limit exceeded - please try again in a moment');
    } else if (error.status === 500) {
      throw new ApiError(503, 'Claude API is temporarily unavailable');
    }

    throw new ApiError(500, 'Failed to communicate with AI service');
  }
}

// ============================================================================
// RESPONSE PARSER
// ============================================================================

/**
 * Parse Claude's response for commands and context
 * @param {string} response - Raw response from Claude
 * @param {Object} existingContext - Previous context
 * @returns {Object} Parsed response with command, cleaned message, and extracted context
 */
function parseClaudeResponse(response, existingContext = {}) {
  let command = null;
  let cleanedMessage = response;
  let extractedContext = { ...existingContext };

  // Extract context JSON block
  const contextMatch = response.match(/```context\s*\n?([\s\S]*?)\n?```/);
  if (contextMatch) {
    try {
      const contextJson = JSON.parse(contextMatch[1].trim());
      // Merge with existing context (new values override)
      extractedContext = { ...existingContext, ...contextJson };
      // Remove context block from message
      cleanedMessage = cleanedMessage.replace(/```context\s*\n?[\s\S]*?\n?```/g, '').trim();
      
      logger.info('Extracted context from Claude response', { extractedContext });
    } catch (e) {
      logger.warn('Failed to parse context JSON', { error: e.message });
    }
  }

  // Check for command keywords
  if (cleanedMessage.includes('SHOW_FLIGHTS')) {
    command = 'SHOW_FLIGHTS';
    cleanedMessage = cleanedMessage.replace(/SHOW_FLIGHTS/g, '').trim();
  } else if (cleanedMessage.includes('SHOW_HOTELS')) {
    command = 'SHOW_HOTELS';
    cleanedMessage = cleanedMessage.replace(/SHOW_HOTELS/g, '').trim();
  } else if (cleanedMessage.includes('SHOW_TOURS')) {
    command = 'SHOW_TOURS';
    cleanedMessage = cleanedMessage.replace(/SHOW_TOURS/g, '').trim();
  }

  return { command, cleanedMessage, extractedContext };
}

// ============================================================================
// CONTEXT EXTRACTION (Fallback)
// ============================================================================

/**
 * Extract travel planning context from user messages
 * This is a fallback in case Claude doesn't include context block
 * @param {string} userMessage - Latest message from user
 * @param {Object} existingContext - Previous context
 * @returns {Object} Updated context
 */
export function extractContext(userMessage, existingContext = {}) {
  const lower = userMessage.toLowerCase();
  const context = { ...existingContext };

  // List of common destinations to detect
  const destinations = [
    'florence', 'rome', 'venice', 'milan', 'naples', 'italy',
    'paris', 'nice', 'lyon', 'france',
    'london', 'edinburgh', 'manchester', 'uk', 'england', 'scotland',
    'barcelona', 'madrid', 'seville', 'spain',
    'amsterdam', 'netherlands',
    'berlin', 'munich', 'germany',
    'vienna', 'austria',
    'prague', 'czech',
    'lisbon', 'portugal',
    'athens', 'santorini', 'greece',
    'dublin', 'ireland',
    'tokyo', 'kyoto', 'osaka', 'japan',
    'bangkok', 'thailand',
    'singapore',
    'hong kong',
    'sydney', 'melbourne', 'australia',
    'auckland', 'new zealand',
    'bali', 'indonesia',
    'new york', 'nyc', 'los angeles', 'la', 'san francisco', 'sf',
    'las vegas', 'vegas', 'miami', 'orlando', 'chicago', 'boston',
    'seattle', 'san diego', 'washington', 'dc', 'new orleans', 'hawaii',
    'honolulu', 'maui',
    'cancun', 'mexico city', 'mexico',
    'dubai', 'abu dhabi',
    'cairo', 'egypt',
    'cape town', 'south africa',
    'rio', 'rio de janeiro', 'brazil',
    'buenos aires', 'argentina'
  ];

  // Extract destination
  for (const dest of destinations) {
    if (lower.includes(dest)) {
      // Capitalize properly
      context.destination = dest.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      // Handle special cases
      if (dest === 'nyc') context.destination = 'New York';
      if (dest === 'la') context.destination = 'Los Angeles';
      if (dest === 'sf') context.destination = 'San Francisco';
      if (dest === 'vegas') context.destination = 'Las Vegas';
      if (dest === 'dc') context.destination = 'Washington DC';
      if (dest === 'rio') context.destination = 'Rio de Janeiro';
      
      break;
    }
  }

  // Extract number of travelers
  const travelersPatterns = [
    /(\d+)\s*(person|people|adult|adults|traveler|travelers|of us|guests)/i,
    /group of\s*(\d+)/i,
    /party of\s*(\d+)/i,
    /(\d+)\s*of us/i
  ];
  
  for (const pattern of travelersPatterns) {
    const match = lower.match(pattern);
    if (match) {
      context.travelers = parseInt(match[1]);
      break;
    }
  }

  // Extract month
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  
  for (const month of months) {
    if (lower.includes(month)) {
      context.month = month.charAt(0).toUpperCase() + month.slice(1);
      break;
    }
  }

  // Extract specific dates if mentioned
  const dateMatch = lower.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dateMatch) {
    context.startDate = dateMatch[0];
  }

  // Extract budget
  const budgetPatterns = [
    /\$\s*(\d+,?\d*)/,
    /(\d+,?\d*)\s*(dollar|usd|budget)/i
  ];
  
  for (const pattern of budgetPatterns) {
    const match = lower.match(pattern);
    if (match) {
      context.budget = parseInt(match[1].replace(',', ''));
      break;
    }
  }

  // Extract interests
  const interestKeywords = {
    'history': ['history', 'historic', 'historical', 'museum', 'museums'],
    'food': ['food', 'foodie', 'cuisine', 'culinary', 'eating', 'restaurants', 'dining'],
    'art': ['art', 'arts', 'artistic', 'gallery', 'galleries'],
    'adventure': ['adventure', 'adventurous', 'hiking', 'outdoor', 'outdoors'],
    'beach': ['beach', 'beaches', 'swimming', 'snorkeling', 'diving'],
    'nightlife': ['nightlife', 'clubs', 'clubbing', 'bars', 'party', 'partying'],
    'shopping': ['shopping', 'shop', 'shops', 'markets', 'market'],
    'sports': ['sports', 'sport', 'game', 'games', 'stadium'],
    'wine': ['wine', 'winery', 'wineries', 'vineyard', 'vineyards'],
    'nature': ['nature', 'wildlife', 'national park', 'hiking', 'scenic']
  };
  
  const interests = [];
  for (const [interest, keywords] of Object.entries(interestKeywords)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        interests.push(interest);
        break;
      }
    }
  }
  
  if (interests.length > 0) {
    context.interests = [...new Set([...(context.interests || []), ...interests])];
  }

  logger.debug('Extracted context from user message', { 
    userMessage: userMessage.substring(0, 50),
    extractedContext: context 
  });

  return context;
}

export default {
  chatWithClaude,
  extractContext
};
