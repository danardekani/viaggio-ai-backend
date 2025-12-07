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
  'http://localhost:5173',  // Local development
  'http://localhost:3000'   // Local development alternative
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
const MAX_TOOL_ITERATIONS = 5;  // Reduced from 10 for faster responses
const MODEL = 'claude-sonnet-4-20250514';
const REQUEST_TIMEOUT_MS = 55000;  // 55 seconds (under Railway's 60s limit)

// ============================================================================
// POST /api/agent/chat - Agentic Chat Endpoint
// ============================================================================

router.post('/chat', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { messages, context = {} } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        error: 'Messages array is required' 
      });
    }

    logger.info(`Processing agentic chat request with ${messages.length} messages`);

    // Build conversation history for Claude
    let conversationMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Track tool usage for this request
    const toolsUsed = [];
    let iterations = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // =======================================================================
    // THE AGENTIC LOOP
    // =======================================================================
    // Keep calling Claude until it gives a final text response (no tool use)
    // =======================================================================

    while (iterations < MAX_TOOL_ITERATIONS) {
      // Check if we're running out of time
      const elapsed = Date.now() - startTime;
      if (elapsed > REQUEST_TIMEOUT_MS) {
        logger.warn(`Request timing out after ${elapsed}ms`);
        const partialText = conversationMessages
          .filter(m => m.role === 'assistant' && typeof m.content === 'string')
          .map(m => m.content)
          .join('\n');
        
        return res.json({
          message: partialText || "I'm taking a bit longer than expected. Could you try a more specific request?",
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
          max_tokens: 4096,
          system: travelAgentSystemPrompt,
          tools: agentTools,
          messages: conversationMessages
        });
      } catch (apiError) {
        logger.error('Claude API error:', apiError.message);
        return res.json({
          message: "I'm having trouble connecting to my brain right now. Could you try again in a moment?",
          error: apiError.message,
          toolsUsed,
          iterations
        });
      }

      // Track token usage
      totalInputTokens += response.usage?.input_tokens || 0;
      totalOutputTokens += response.usage?.output_tokens || 0;

      // Check stop reason
      const stopReason = response.stop_reason;
      logger.info(`Stop reason: ${stopReason}`);

      // Look for tool use in the response
      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
      const textBlocks = response.content.filter(block => block.type === 'text');

      // If no tool use, we have our final response
      if (toolUseBlocks.length === 0 || stopReason === 'end_turn') {
        const finalText = textBlocks.map(b => b.text).join('\n');
        
        logger.info(`Agent complete after ${iterations} iterations, ${toolsUsed.length} tool calls`);

        return res.json({
          message: finalText,
          toolsUsed,
          iterations,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens
          }
        });
      }

      // =======================================================================
      // TOOL EXECUTION
      // =======================================================================

      // Add Claude's response (with tool use) to conversation
      conversationMessages.push({
        role: 'assistant',
        content: response.content
      });

      // Execute each tool and collect results
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        logger.info(`Executing tool: ${toolUse.name}`);
        
        // Execute the tool
        const result = await executeTool(toolUse.name, toolUse.input);
        
        // Track tool usage
        toolsUsed.push({
          tool: toolUse.name,
          input: toolUse.input,
          success: !result.error
        });

        // Add result to collection
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      // Add tool results to conversation
      conversationMessages.push({
        role: 'user',
        content: toolResults
      });
    }

    // If we hit max iterations, return what we have
    logger.warn(`Hit max iterations (${MAX_TOOL_ITERATIONS})`);
    
    return res.json({
      message: "I've been working on this for a while. Let me summarize what I found so far. Could you try a more specific question?",
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
    description: tool.description.split('\n')[0], // First line only
    requiredParams: tool.input_schema.required || [],
    status: getToolStatus(tool.name)
  }));

  res.json({
    tools: toolSummaries
  });
});

// Helper to indicate tool status
function getToolStatus(toolName) {
  switch (toolName) {
    case 'search_tours':
      return 'active';
    case 'search_flights':
    case 'search_hotels':
      return 'coming_soon';
    case 'get_destination_info':
    case 'identify_location':
      return 'active';
    default:
      return 'unknown';
  }
}

export default router;
