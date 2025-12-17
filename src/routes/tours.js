// ============================================================================
// IDENTIFY LOCATION ROUTES - OPTIMIZED
// ============================================================================

import express from 'express';
import { identifyLocation } from '../services/vision.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// POST /api/identify - Identify location from uploaded image
// ============================================================================

router.post('/', async (req, res, next) => {
  try {
    const startTime = Date.now();
    let imageBase64;
    let mediaType = 'image/jpeg';

    if (req.body.image) {
      imageBase64 = req.body.image;
      mediaType = req.body.mediaType || 'image/jpeg';
      
      // Remove data URL prefix if present
      if (imageBase64.includes('base64,')) {
        const parts = imageBase64.split('base64,');
        imageBase64 = parts[1];
        
        const mediaMatch = parts[0].match(/data:([^;]+)/);
        if (mediaMatch) {
          mediaType = mediaMatch[1];
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'No image provided.'
      });
    }

    // Validate image size (max 10MB)
    const imageSizeBytes = (imageBase64.length * 3) / 4;
    if (imageSizeBytes > 10 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'Image too large. Maximum size is 10MB.'
      });
    }

    logger.info(`Processing image (${Math.round(imageSizeBytes / 1024)}KB)`);

    const result = await identifyLocation(imageBase64, mediaType);
    const elapsed = Date.now() - startTime;

    if (result.success) {
      logger.info(`Identified: ${result.destination?.fullName} in ${elapsed}ms`);
      
      res.json({
        success: true,
        source: result.source,
        destination: result.destination,
        landmark: result.landmark,
        confidence: result.confidence,
        coordinates: result.coordinates,
        googleMapsUrl: result.googleMapsUrl,
        reasoning: result.reasoning,
        // NEW: Include Viator ID for faster tour search
        viatorDestinationId: result.viatorDestinationId || null,
        processingTimeMs: elapsed
      });
    } else {
      res.json({
        success: false,
        message: 'Could not identify the location.',
        reasoning: result.reasoning,
        suggestion: 'Try a clearer image with visible landmarks.',
        processingTimeMs: elapsed
      });
    }

  } catch (error) {
    logger.error('Identification error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/identify/health
// ============================================================================

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    services: {
      googleVision: process.env.GOOGLE_VISION_API_KEY ? 'configured' : 'not configured',
      geminiAI: process.env.GEMINI_API_KEY ? 'configured' : 'not configured',
      claudeAI: process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured'
    }
  });
});

export default router;
