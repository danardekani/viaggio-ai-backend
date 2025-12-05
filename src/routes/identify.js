// ============================================================================
// IDENTIFY LOCATION ROUTES
// ============================================================================
// API endpoint for the "Where Is This?" feature
// Accepts image uploads and returns identified travel destinations
// ============================================================================

import express from 'express';
import { identifyLocation } from '../services/vision.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// POST /api/identify - Identify location from uploaded image
// ============================================================================

/**
 * Identify a travel destination from an uploaded image
 * 
 * Request body (JSON):
 * {
 *   image: "base64_encoded_image_data",  // Required - base64 image WITHOUT data URL prefix
 *   mediaType: "image/jpeg"               // Optional - defaults to image/jpeg
 * }
 * 
 * OR multipart/form-data with 'image' file field
 * 
 * Response:
 * {
 *   success: true,
 *   source: "google_vision" | "claude_ai",
 *   destination: {
 *     name: "Santorini",
 *     region: "Cyclades",
 *     country: "Greece",
 *     fullName: "Santorini, Greece"
 *   },
 *   landmark: "Oia Blue Domes",
 *   confidence: "high" | "medium" | "low",
 *   coordinates: { latitude: 36.4618, longitude: 25.3753 },
 *   reasoning: "Identified the iconic blue-domed churches...",
 *   travelTips: "Famous for stunning sunsets and traditional Cycladic architecture."
 * }
 */
router.post('/', async (req, res, next) => {
  try {
    let imageBase64;
    let mediaType = 'image/jpeg';

    // Handle JSON body with base64 image
    if (req.body.image) {
      imageBase64 = req.body.image;
      mediaType = req.body.mediaType || 'image/jpeg';
      
      // Remove data URL prefix if present
      if (imageBase64.includes('base64,')) {
        const parts = imageBase64.split('base64,');
        imageBase64 = parts[1];
        
        // Extract media type from data URL
        const mediaMatch = parts[0].match(/data:([^;]+)/);
        if (mediaMatch) {
          mediaType = mediaMatch[1];
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'No image provided. Send base64 image in request body.'
      });
    }

    // Validate image size (max 10MB base64 ≈ 7.5MB actual)
    const imageSizeBytes = (imageBase64.length * 3) / 4;
    const maxSizeBytes = 10 * 1024 * 1024; // 10MB
    
    if (imageSizeBytes > maxSizeBytes) {
      return res.status(400).json({
        success: false,
        error: 'Image too large. Maximum size is 10MB.'
      });
    }

    logger.info(`Processing image for location identification (${Math.round(imageSizeBytes / 1024)}KB, ${mediaType})`);

    // Identify the location
    const result = await identifyLocation(imageBase64, mediaType);

    if (result.success) {
      res.json({
        success: true,
        source: result.source,
        destination: result.destination,
        landmark: result.landmark,
        confidence: result.confidence,
        coordinates: result.coordinates,
        reasoning: result.reasoning,
        travelTips: result.travelTips
      });
    } else {
      res.json({
        success: false,
        message: 'Could not identify the location in this image.',
        reasoning: result.reasoning,
        suggestion: 'Try uploading a clearer image with visible landmarks, signs, or distinctive scenery.'
      });
    }

  } catch (error) {
    logger.error('Location identification error:', error);
    next(error);
  }
});

// ============================================================================
// GET /api/identify/health - Health check for the vision service
// ============================================================================

router.get('/health', (req, res) => {
  const hasVisionKey = !!process.env.GOOGLE_VISION_API_KEY;
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

  res.json({
    status: 'ok',
    services: {
      googleVision: hasVisionKey ? 'configured' : 'not configured',
      claudeAI: hasAnthropicKey ? 'configured' : 'not configured'
    },
    message: hasVisionKey || hasAnthropicKey 
      ? 'Location identification service is ready'
      : 'Warning: No API keys configured'
  });
});

export default router;
