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

    // Extract context from user message (fallback method)
    const userExtractedContext = extractContext(lastUserMessage.content, context);

    // Clean messages - Claude API only accepts 'role' and 'content'
    const cleanedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    logger.info('Processing chat request', {
      messageCount: messages.length,
      context: userExtractedContext
    });

    // Get response from Claude (pass the extracted context)
    const response = await chatWithClaude(cleanedMessages, userExtractedContext);

    // Merge contexts: user-extracted + Claude-extracted (Claude takes priority)
    const finalContext = {
      ...userExtractedContext,
      ...(response.extractedContext || {})
    };

    logger.info('Final context after merge', { finalContext });

    // Return response with updated context
    res.json({
      message: response.message,
      command: response.command,
      context: finalContext,
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

router.get('/health', async (req, res, next) => {
  try {
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
