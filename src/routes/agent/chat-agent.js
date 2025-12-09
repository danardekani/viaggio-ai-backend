// ============================================================================
// AGENTIC CHAT ROUTES - gemini-2.5-flash-lite-preview-09-2025
// ============================================================================

import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { geminiTools, travelAgentSystemPrompt } from './agent-tools.js';
import { executeTool } from './agent-executor.js';

const router = express.Router();

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Simple logger
const logger = {
  info: (...args) => console.log('[Agent Chat]', ...args),
  warn: (...args) => console.warn('[Agent Chat]', ...args),
  error: (...args) => console.error('[Agent Chat]', ...args)
};

// ==========================================================================
// CORS MIDDLEWARE
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
const MODEL_NAME = 'gemini-2.5-pro';
const REQUEST_TIMEOUT_MS = 55000;

// ============================================================================
// POST /api/agent/chat - Agentic Chat Endpoint (Gemini)
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

    // Initialize Gemini model with tools
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: travelAgentSystemPrompt,
      tools: [{ functionDeclarations: geminiTools }],
      generationConfig: {
        temperature: 0.5,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048,
      }
    });

    // Convert messages to Gemini format
    const geminiHistory = [];
    const userMessage = messages[messages.length - 1].content;
    
    // Add conversation history (all messages except the last one)
    for (let i = 0; i < messages.length - 1; i++) {
      const msg = messages[i];
      geminiHistory.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }

    // =======================================================================
    // FIX: Gemini requires history to start with a user message
    // Remove any leading assistant/model messages (like welcome messages)
    // =======================================================================
    while (geminiHistory.length > 0 && geminiHistory[0].role === 'model') {
      logger.info('Removing leading model message from history');
      geminiHistory.shift();
    }

    // Start chat session with history
    const chat = model.startChat({
      history: geminiHistory
    });

    // Tool execution loop
    let iterations = 0;
    let currentMessage = userMessage;
    let finalResponse = null;
    const toolsUsed = [];
    const toursFound = [];

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      logger.info(`Tool iteration ${iterations}/${MAX_TOOL_ITERATIONS}`);

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > REQUEST_TIMEOUT_MS) {
        logger.warn(`Request timing out after ${elapsed}ms`);
        return res.json({
          message: finalResponse || "I'm taking a bit longer than expected. Could you try again?",
          toolsUsed,
          iterations,
          warning: 'Request timeout'
        });
      }

      // Send message to Gemini
      const result = await chat.sendMessage(currentMessage);
      const response = result.response;

      // Check if Gemini wants to use tools
      const functionCalls = response.functionCalls();
      
      if (!functionCalls || functionCalls.length === 0) {
        // No tools requested - this is the final response
        finalResponse = response.text();
        logger.info(`Final response generated (no tools requested)`);
        break;
      }

      logger.info(`Gemini requested ${functionCalls.length} tool(s)`);

      // Execute all requested tools
      const toolResults = [];
      
      for (const functionCall of functionCalls) {
        const toolName = functionCall.name;
        const toolInput = functionCall.args;

        logger.info(`Executing tool: ${toolName}`, JSON.stringify(toolInput));

        try {
          const toolResult = await executeTool(toolName, toolInput);
          
          // Track tool usage
          toolsUsed.push({
            tool: toolName,
            input: toolInput,
            success: !toolResult.error
          });

          // Collect tour data for card display
          if (toolName === 'search_tours' && toolResult.success && toolResult.tours) {
            toursFound.push(...toolResult.tours);
          }

          toolResults.push({
            functionResponse: {
              name: toolName,
              response: toolResult
            }
          });

          logger.info(`Tool ${toolName} completed successfully`);
        } catch (error) {
          logger.error(`Tool ${toolName} failed:`, error.message);
          
          toolsUsed.push({
            tool: toolName,
            input: toolInput,
            success: false
          });

          toolResults.push({
            functionResponse: {
              name: toolName,
              response: {
                error: true,
                message: `Tool execution failed: ${error.message}`
              }
            }
          });
        }
      }

      // Send tool results back to Gemini
      const toolResultMessage = await chat.sendMessage(toolResults);
      
      // Check if this response is final
      const nextFunctionCalls = toolResultMessage.response.functionCalls();
      
      if (!nextFunctionCalls || nextFunctionCalls.length === 0) {
        // Gemini has processed tool results and generated final response
        finalResponse = toolResultMessage.response.text();
        logger.info(`Final response generated after tool execution`);
        break;
      }

      // Gemini wants to call more tools - continue loop
      currentMessage = toolResultMessage.response.text();
    }

    // Check if we hit max iterations without a final response
    if (iterations >= MAX_TOOL_ITERATIONS && !finalResponse) {
      logger.warn(`Hit max tool iterations (${MAX_TOOL_ITERATIONS})`);
      finalResponse = "I've gathered the information, but let me know if you need anything else!";
    }

    const responseTime = Date.now() - startTime;
    logger.info(`Request completed in ${responseTime}ms`);

    // Return response (using 'message' to match frontend expectations)
    res.json({
      message: finalResponse,
      tours: toursFound,
      toolsUsed,
      iterations,
      model: MODEL_NAME,
      processingTime: responseTime
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error('Chat request failed:', error);
    
    // Handle specific Gemini errors
    if (error.message?.includes('API_KEY')) {
      return res.status(401).json({
        error: 'Invalid or missing Gemini API key',
        details: 'Please check GEMINI_API_KEY environment variable'
      });
    }
    
    if (error.message?.includes('quota')) {
      return res.status(429).json({
        error: 'API quota exceeded',
        details: 'Please check your Gemini API usage limits'
      });
    }

    res.status(500).json({
      error: 'Failed to process chat request',
      message: error.message,
      processingTime: responseTime
    });
  }
});

// ============================================================================
// Health Check Endpoint
// ============================================================================

router.get('/health', (req, res) => {
  const hasApiKey = !!process.env.GEMINI_API_KEY;
  
  res.json({
    status: 'ok',
    model: MODEL_NAME,
    provider: 'Google Gemini',
    apiKeyConfigured: hasApiKey,
    maxToolIterations: MAX_TOOL_ITERATIONS
  });
});

export default router;
