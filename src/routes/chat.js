// ============================================================================
// CHAT ROUTES
// ============================================================================

import express from 'express';
import { chatWithClaude, extractContext } from '../services/claude.js';
import { chatRateLimiter } from '../middleware/rateLimiter.js';
import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.use(chatRateLimiter);

// ============================================================================
// POST /api/chat
// ============================================================================

router.post('/', async (req, res, next) => {
  try {
    const { messages, context = {} } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new ApiError(400, 'Messages array is required');
    }

    const lastUserMessage = messages[messages.length - 1];
    if (lastUserMessage.role !== 'user') {
      throw new ApiError(400, 'Last message must be from user');
    }

    // Extract context from user message (fallback)
    const userExtractedContext = extractContext(lastUserMessage.content, context);

    // Clean messages for Claude API
    const cleanedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    logger.info('Processing chat request', {
      messageCount: messages.length,
      incomingContext: context,
      userExtractedContext
    });

    // Get response from Claude
    const response = await chatWithClaude(cleanedMessages, userExtractedContext);

    // Merge contexts: incoming -> user-extracted -> Claude-extracted
    const finalContext = {
      ...context,
      ...userExtractedContext,
      ...(response.extractedContext || {})
    };

    logger.info('Chat response', { 
      command: response.command,
      finalContext 
    });

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

router.get('/health', async (req, res) => {
  try {
    await chatWithClaude([{ role: 'user', content: 'Hello' }]);
    res.json({ status: 'healthy' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

export default router;
