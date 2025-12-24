// ============================================================================
// AGENTIC CHAT ROUTES 
// ============================================================================
// This is the agentic version of the chat endpoint.
// Claude can autonomously use tools to help users plan trips.
// ============================================================================

import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { agentTools, travelAgentSystemPrompt } from './agent-tools.js';
import { executeTool } from './agent-executor.js';

const router = express.Router();

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Simple logger
const logger = {
  info: (...args) => console.log('[Agent Chat]', ...args),
  warn: (...args) => console.warn('[Agent Chat]', ...args),
  error: (...args) => console.error('[Agent Chat]', ...args)
};

// ==========================================================================
// CORS MIDDLEWARE - Ensure CORS headers are always set
// ==========================================================================
const ALLOWED_ORIGINS = [
  'https://viaggio-ai.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
];

router.use((req, res, next) => {
  const origin = req.headers.origin;
  
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Configuration
const MAX_TOOL_ITERATIONS = 5;
const MODEL = 'claude-sonnet-4-20250514';
const REQUEST_TIMEOUT_MS = 55000;

// ============================================================================
// BUILD CONTEXT-AWARE SYSTEM PROMPT
// ============================================================================

function buildSystemPrompt(currentResults) {
  let systemPrompt = travelAgentSystemPrompt;
  
  // If there are currently displayed results, add them to context (limit to 10 to save tokens)
  if (currentResults && currentResults.tours?.length > 0) {
    systemPrompt += `\n\n## CURRENTLY DISPLAYED RESULTS\n`;
    systemPrompt += `The user is viewing search results. When they reference "these" or ask "which one", use this info:\n\n`;
    
    // Only include first 10 tours to save tokens
    const toursToShow = currentResults.tours.slice(0, 10);
    toursToShow.forEach((tour, i) => {
      systemPrompt += `${i + 1}. "${tour.name}" - $${tour.price}, ${tour.rating}★\n`;
    });
    
    if (currentResults.tours.length > 10) {
      systemPrompt += `(+ ${currentResults.tours.length - 10} more tours)\n`;
    }
  }

  return systemPrompt;
}

// ============================================================================
// POST /api/agent/chat - Agentic Chat Endpoint
// ============================================================================

router.post('/chat', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { messages, context = {}, currentResults = null } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        error: 'Messages array is required' 
      });
    }

    logger.info(`Processing agentic chat request with ${messages.length} messages`);
    
    if (currentResults) {
      logger.info(`Context includes ${currentResults.tours?.length || 0} tours, ${currentResults.activities?.length || 0} activities`);
    }

    // Build context-aware system prompt
    const systemPrompt = buildSystemPrompt(currentResults);

    // Build conversation history for Claude - LIMIT to last 10 messages to save tokens
    const MAX_HISTORY_MESSAGES = 10;
    const recentMessages = messages.slice(-MAX_HISTORY_MESSAGES);
    let conversationMessages = recentMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    
    if (messages.length > MAX_HISTORY_MESSAGES) {
      logger.info(`Trimmed conversation from ${messages.length} to ${MAX_HISTORY_MESSAGES} messages`);
    }

    // Track tool usage for this request
    const toolsUsed = [];
    const toursFound = [];
    const activitiesFound = [];
    let searchDestination = null;
    let searchDestinationId = null;
    let searchTerms = null;
    let hasMoreTours = false;
    let hasMoreActivities = false;
    let iterations = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // =======================================================================
    // THE AGENTIC LOOP
    // =======================================================================

    while (iterations < MAX_TOOL_ITERATIONS) {
      const elapsed = Date.now() - startTime;
      if (elapsed > REQUEST_TIMEOUT_MS) {
        logger.warn(`Request timing out after ${elapsed}ms`);
        const partialText = conversationMessages
          .filter(m => m.role === 'assistant' && typeof m.content === 'string')
          .map(m => m.content)
          .join('\n');
        
        return res.json({
          message: partialText || "I'm taking a bit longer than expected. Could you try a more specific request?",
          tours: toursFound,
          activities: activitiesFound,
          searchDestination: searchDestination,
          searchDestinationId: searchDestinationId,
          searchTerms: searchTerms,
          hasMore: hasMoreTours || hasMoreActivities,
          toolsUsed,
          iterations,
          warning: 'Request timeout - partial response',
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens
          }
        });
      }

      iterations++;
      logger.info(`Agent loop iteration ${iterations} (${elapsed}ms elapsed)`);

      // Call Claude with tools
      let response;
      try {
        response = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          tools: agentTools,
          messages: conversationMessages
        });
      } catch (apiError) {
        const errorMessage = apiError.message || '';
        logger.error('Claude API error:', errorMessage);
        
        if (errorMessage.includes('429') || errorMessage.includes('rate_limit')) {
          return res.json({
            message: "I'm a bit busy right now! Please wait a moment and try again. 😊",
            error: true,
            errorType: 'rate_limit',
            toolsUsed,
            iterations
          });
        }
        
        return res.json({
          message: "I'm having trouble connecting right now. Could you try again in a moment?",
          error: true,
          toolsUsed,
          iterations
        });
      }

      // Track token usage
      totalInputTokens += response.usage?.input_tokens || 0;
      totalOutputTokens += response.usage?.output_tokens || 0;

      // Process the response
      const contentBlocks = response.content || [];
      
      // Check for text response
      const textBlock = contentBlocks.find(b => b.type === 'text');
      
      // Check for tool use
      const toolUseBlocks = contentBlocks.filter(b => b.type === 'tool_use');

      // If no tool use, we're done - return the text response
      if (toolUseBlocks.length === 0) {
        const finalText = textBlock?.text || "I'm not sure how to help with that. Could you tell me more?";
        
        logger.info(`Final response after ${iterations} iterations, ${toolsUsed.length} tools used`);
        
        return res.json({
          message: finalText,
          tours: toursFound,
          activities: activitiesFound,
          searchDestination: searchDestination,
          searchDestinationId: searchDestinationId,
          searchTerms: searchTerms,
          hasMore: hasMoreTours || hasMoreActivities,
          toolsUsed,
          iterations,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens
          }
        });
      }

      // Process tool calls
      const toolResults = [];
      
      for (const toolUse of toolUseBlocks) {
        logger.info(`Executing tool: ${toolUse.name}`);
        toolsUsed.push(toolUse.name);
        
        try {
          const result = await executeTool(toolUse.name, toolUse.input);
          
          // Collect tours for card display (from Viator)
          if (result.tours && Array.isArray(result.tours)) {
            toursFound.push(...result.tours);
            if (result.destination) {
              searchDestination = result.destination;
            }
            if (result.destinationId) {
              searchDestinationId = result.destinationId;
            }
            if (result.searchTerms) {
              searchTerms = result.searchTerms;
            }
            if (result.hasMore) {
              hasMoreTours = true;
            }
          }

          // Collect activities for card display (from HotelBeds)
          if (result.activities && Array.isArray(result.activities)) {
            activitiesFound.push(...result.activities);
            if (result.destination) {
              searchDestination = result.destination;
            }
            if (result.hasMore) {
              hasMoreActivities = true;
            }
          }
          
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });
        } catch (toolError) {
          logger.error(`Tool ${toolUse.name} failed:`, toolError.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: toolError.message }),
            is_error: true
          });
        }
      }

      // Add assistant response and tool results to conversation
      conversationMessages.push({
        role: 'assistant',
        content: contentBlocks
      });
      
      conversationMessages.push({
        role: 'user',
        content: toolResults
      });
    }

    // Max iterations reached
    logger.warn(`Max iterations (${MAX_TOOL_ITERATIONS}) reached`);

    return res.json({
      message: "Let me summarize what I found so far. Could you try a more specific question?",
      tours: toursFound,
      activities: activitiesFound,
      searchDestination: searchDestination,
      searchDestinationId: searchDestinationId,
      searchTerms: searchTerms,
      hasMore: hasMoreTours || hasMoreActivities,
      toolsUsed,
      iterations,
      warning: 'Maximum iterations reached',
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens
      }
    });

  } catch (error) {
    logger.error('Agentic chat error:', error);
    
    return res.status(500).json({
      error: 'Failed to process request',
      message: error.message
    });
  }
});

// ============================================================================
// GET /api/agent/health - Health Check
// ============================================================================

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'agentic',
    model: MODEL,
    toolsAvailable: agentTools.map(t => t.name),
    maxIterations: MAX_TOOL_ITERATIONS
  });
});

// ============================================================================
// GET /api/agent/tools - List Available Tools
// ============================================================================

router.get('/tools', (req, res) => {
  const toolSummaries = agentTools.map(tool => ({
    name: tool.name,
    description: tool.description.split('\n')[0],
    requiredParams: tool.input_schema.required || [],
    status: getToolStatus(tool.name)
  }));

  res.json({
    tools: toolSummaries
  });
});

function getToolStatus(toolName) {
  switch (toolName) {
    case 'search_tours':
    case 'get_destination_info':
    case 'identify_location':
      return 'active';
    case 'search_flights':
    case 'search_hotels':
      return 'coming_soon';
    default:
      return 'unknown';
  }
}

export default router;
