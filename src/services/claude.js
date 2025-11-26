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
2. Ask about travel dates, number of travelers, and budget
3. Suggest flights matching their criteria
4. After flight selection, suggest hotels
5. After hotel selection, suggest tours and activities
6. Offer to compile everything into a final itinerary

CRITICAL: When presenting travel options (flights, hotels, tours), you MUST respond with ONLY the following exact format:

For flights, respond EXACTLY like this:
SHOW_FLIGHTS

For hotels, respond EXACTLY like this:
SHOW_HOTELS

For tours, respond EXACTLY like this:
SHOW_TOURS

Do NOT include any other text when showing options. Just the command word on its own line.

Before showing options, you can chat normally to gather information. But when it's time to show options, use ONLY these command words.

Examples:
User: "I want to go to Florence"
AI: "Wonderful choice! Florence is magical. How many people are traveling and what are your dates?"

User: "2 people in September"
AI: "Perfect! Let me find some great flights for you.
SHOW_FLIGHTS"

User: "I'll take the United flight"
AI: "Excellent choice! Now let's find you a perfect hotel.
SHOW_HOTELS"

Remember: Use SHOW_FLIGHTS, SHOW_HOTELS, or SHOW_TOURS commands when it's time to present options!`;

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
      model: 'claude-sonnet-4-20250514', // Use latest Sonnet model
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

    // Parse the response for commands
    const parsed = parseClaudeResponse(assistantMessage);

    return {
      message: parsed.cleanedMessage,
      command: parsed.command,
      fullResponse: assistantMessage,
      usage: response.usage // Token usage for cost tracking
    };

  } catch (error) {
    logger.error('Claude API error', { 
      error: error.message,
      type: error.type 
    });

    // Handle specific API errors
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
 * Parse Claude's response for special commands
 * @param {string} response - Raw response from Claude
 * @returns {Object} Parsed response with command and cleaned message
 */
function parseClaudeResponse(response) {
  let command = null;
  let cleanedMessage = response;

  // Check for command keywords
  if (response.includes('SHOW_FLIGHTS')) {
    command = 'SHOW_FLIGHTS';
    cleanedMessage = response.replace('SHOW_FLIGHTS', '').trim();
  } else if (response.includes('SHOW_HOTELS')) {
    command = 'SHOW_HOTELS';
    cleanedMessage = response.replace('SHOW_HOTELS', '').trim();
  } else if (response.includes('SHOW_TOURS')) {
    command = 'SHOW_TOURS';
    cleanedMessage = response.replace('SHOW_TOURS', '').trim();
  }

  return { command, cleanedMessage };
}

// ============================================================================
// CONTEXT EXTRACTION
// ============================================================================

/**
 * Extract travel planning context from user messages
 * @param {string} userMessage - Latest message from user
 * @param {Object} existingContext - Previous context
 * @returns {Object} Updated context
 */
export function extractContext(userMessage, existingContext = {}) {
  const lower = userMessage.toLowerCase();
  const context = { ...existingContext };

  // Extract destination
  if (lower.includes('florence') || lower.includes('italy')) {
    context.destination = 'florence';
  } else if (lower.includes('paris') || lower.includes('france')) {
    context.destination = 'paris';
  }

  // Extract number of travelers
  const travelersMatch = lower.match(/(\d+)\s*(person|people|adult|traveler)/);
  if (travelersMatch) {
    context.travelers = parseInt(travelersMatch[1]);
  }

  // Extract budget
  const budgetMatch = lower.match(/\$?(\d+,?\d*)\s*(budget|spend|cost)/);
  if (budgetMatch) {
    context.budget = budgetMatch[1].replace(',', '');
  }

  // Extract dates (simple version - can be enhanced)
  if (lower.includes('september')) context.month = 'September';
  if (lower.includes('october')) context.month = 'October';

  return context;
}
