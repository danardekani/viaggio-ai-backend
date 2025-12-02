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
{"destination": "Boston", "travelers": 3, "month": "July", "searchTerms": "food", "resultCount": 5, "command": "SHOW_TOURS"}
\`\`\`

RULES:
1. ALWAYS include a context block at the end of every response
2. Set "command": "SHOW_TOURS" whenever user wants to see activities/tours
3. Set "command": null only for greetings or when asking questions
4. Keep searchTerms to 1-2 words max (e.g., "food" or "history")
5. Keep your text SHORT when showing tours - let the tour cards speak

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
    { name: 'Philadelphia', patterns: ['philadelphia', 'philly'] },
    { name: 'San Francisco', patterns: ['san francisco', 'sf'] },
    { name: 'Los Angeles', patterns: ['los angeles', 'la'] },
    { name: 'New York', patterns: ['new york', 'nyc'] },
    { name: 'Las Vegas', patterns: ['las vegas', 'vegas'] },
    { name: 'Washington DC', patterns: ['washington dc', 'washington d.c.', 'dc'] },
    { name: 'New Orleans', patterns: ['new orleans', 'nola'] },
    { name: 'San Diego', patterns: ['san diego'] },
    { name: 'Rio de Janeiro', patterns: ['rio de janeiro', 'rio'] },
    { name: 'Hong Kong', patterns: ['hong kong'] },
    { name: 'Cape Town', patterns: ['cape town'] },
    { name: 'Boston', patterns: ['boston'] },
    { name: 'Miami', patterns: ['miami'] },
    { name: 'Orlando', patterns: ['orlando'] },
    { name: 'Chicago', patterns: ['chicago'] },
    { name: 'Seattle', patterns: ['seattle'] },
    { name: 'Hawaii', patterns: ['hawaii', 'honolulu', 'maui'] },
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
    { name: 'Tokyo', patterns: ['tokyo'] },
    { name: 'Kyoto', patterns: ['kyoto'] },
    { name: 'Osaka', patterns: ['osaka'] },
    { name: 'Bangkok', patterns: ['bangkok'] },
    { name: 'Singapore', patterns: ['singapore'] },
    { name: 'Sydney', patterns: ['sydney'] },
    { name: 'Melbourne', patterns: ['melbourne'] },
    { name: 'Bali', patterns: ['bali'] },
    { name: 'Cancun', patterns: ['cancun'] },
    { name: 'Dubai', patterns: ['dubai'] },
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

  return context;
}

export default { chatWithClaude, extractContext };
