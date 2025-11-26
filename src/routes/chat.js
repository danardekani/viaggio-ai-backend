// ============================================================================
// CHAT ROUTES
// ============================================================================
// Handles AI conversation requests from the frontend
// ============================================================================

import express from 'express';
import { chatWithClaude, extractContext } from '../services/claude.js';
import { chatRateLimiter } from '../middleware/rateLimiter.js';
import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Apply stricter rate limiting to chat endpoint
router.use(chatRateLimiter);

// ============================================================================
// POST /api/chat
// ============================================================================
// Main chat endpoint - sends user message to Claude and returns response
// 
// Request body:
// {
//   "messages": [...],        // Conversation history
//   "context": {...}          // Current conversation context
// }
// 
// Response:
// {
//   "message": "...",         // Claude's response text
//   "command": "...",         // Special command (SHOW_FLIGHTS, etc.)
//   "context": {...},         // Updated context
//   "usage": {...}            // Token usage
// }
// ============================================================================

router.post('/', async (req, res, next) => {
  try {
    const { messages, context = {} } = req.body;

    // Validate request
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new ApiError(400, 'Messages array is required');
    }

    // Get the last user message for context extraction
    const lastUserMessage = messages[messages.length - 1];
    if (lastUserMessage.role !== 'user') {
      throw new ApiError(400, 'Last message must be from user');
    }

    // Extract context from the latest message
    const updatedContext = extractContext(lastUserMessage.content, context);

    logger.debug('Processing chat request', {
      messageCount: messages.length,
      context: updatedContext
    });

    // Get response from Claude
    const response = await chatWithClaude(messages, updatedContext);

    // Return response with updated context
    res.json({
      message: response.message,
      command: response.command,
      context: updatedContext,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      }
    });

  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/chat/health
// ============================================================================
// Check if Claude API is accessible
// ============================================================================

router.get('/health', async (req, res, next) => {
  try {
    // Simple test message to verify API key works
    const testMessages = [
      { role: 'user', content: 'Hello, are you working?' }
    ];

    await chatWithClaude(testMessages);

    res.json({ 
      status: 'healthy',
      message: 'Claude API is accessible' 
    });

  } catch (error) {
    logger.error('Claude API health check failed', { error: error.message });
    res.status(503).json({ 
      status: 'unhealthy',
      message: 'Claude API is not accessible' 
    });
  }
});

export default router;
