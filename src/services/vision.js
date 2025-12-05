// ============================================================================
// VISION SERVICE - Google Cloud Vision + Claude Fallback
// ============================================================================
// Identifies locations from images using:
// 1. Google Cloud Vision API (landmark detection)
// 2. Claude AI fallback (text/scene analysis)
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const GOOGLE_VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ============================================================================
// GOOGLE CLOUD VISION - LANDMARK DETECTION
// ============================================================================

/**
 * Detect landmarks in an image using Google Cloud Vision API
 * @param {string} imageBase64 - Base64 encoded image (without data:image prefix)
 * @returns {Promise<Object>} - Detected landmarks with location data
 */
export async function detectLandmarks(imageBase64) {
  if (!GOOGLE_VISION_API_KEY) {
    logger.warn('Google Vision API key not configured, skipping landmark detection');
    return { landmarks: [], error: 'API key not configured' };
  }

  try {
    logger.info('Calling Google Cloud Vision for landmark detection...');

    const requestBody = {
      requests: [{
        image: {
          content: imageBase64
        },
        features: [
          { type: 'LANDMARK_DETECTION', maxResults: 5 },
          { type: 'LABEL_DETECTION', maxResults: 10 },
          { type: 'TEXT_DETECTION', maxResults: 5 }
        ]
      }]
    };

    const response = await fetch(`${GOOGLE_VISION_ENDPOINT}?key=${GOOGLE_VISION_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Google Vision API error: ${response.status} - ${errorText}`);
      return { landmarks: [], error: `API error: ${response.status}` };
    }

    const data = await response.json();
    const result = data.responses?.[0] || {};

    // Extract landmarks
    const landmarks = (result.landmarkAnnotations || []).map(landmark => ({
      name: landmark.description,
      confidence: landmark.score,
      location: landmark.locations?.[0]?.latLng || null,
      boundingBox: landmark.boundingPoly?.vertices || null
    }));

    // Extract labels (useful for scene understanding)
    const labels = (result.labelAnnotations || []).map(label => ({
      name: label.description,
      confidence: label.score
    }));

    // Extract any text found in the image
    const textAnnotations = result.textAnnotations || [];
    const detectedText = textAnnotations.length > 0 ? textAnnotations[0].description : '';

    logger.info(`Vision API found ${landmarks.length} landmarks, ${labels.length} labels`);

    return {
      landmarks,
      labels,
      detectedText,
      success: true
    };

  } catch (error) {
    logger.error('Google Vision API error:', error);
    return { landmarks: [], labels: [], error: error.message };
  }
}

// ============================================================================
// CLAUDE FALLBACK - AI IMAGE ANALYSIS
// ============================================================================

/**
 * Use Claude to analyze an image and identify the location
 * @param {string} imageBase64 - Base64 encoded image
 * @param {string} mediaType - Image MIME type (e.g., 'image/jpeg')
 * @param {Object} visionContext - Context from Google Vision (labels, text)
 * @returns {Promise<Object>} - Identified location information
 */
export async function analyzeImageWithClaude(imageBase64, mediaType = 'image/jpeg', visionContext = {}) {
  try {
    logger.info('Analyzing image with Claude for location identification...');

    // Build context from Vision API results
    let contextHints = '';
    if (visionContext.labels?.length > 0) {
      contextHints += `\nScene labels detected: ${visionContext.labels.map(l => l.name).join(', ')}`;
    }
    if (visionContext.detectedText) {
      contextHints += `\nText visible in image: "${visionContext.detectedText.substring(0, 500)}"`;
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: `You are a travel location identification expert. Analyze this image and identify where it was taken.
${contextHints}

Please provide your analysis in the following JSON format:
{
  "identified": true/false,
  "confidence": "high/medium/low",
  "destination": {
    "name": "City or specific location name",
    "region": "State/Province/Region if applicable",
    "country": "Country name",
    "fullName": "Complete location string (e.g., 'Santorini, Greece' or 'Grand Canyon, Arizona, USA')"
  },
  "landmark": "Specific landmark if identifiable (e.g., 'Eiffel Tower', 'Colosseum')",
  "reasoning": "Brief explanation of how you identified this location",
  "travelTips": "One sentence about what makes this destination special for travelers"
}

If you cannot identify the location with reasonable confidence, set "identified" to false and explain why in the reasoning field.

IMPORTANT: Respond ONLY with the JSON object, no other text.`
            }
          ]
        }
      ]
    });

    const responseText = response.content[0].text.trim();
    
    // Parse the JSON response
    try {
      // Remove markdown code blocks if present
      let jsonText = responseText;
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
      }
      
      const analysis = JSON.parse(jsonText);
      logger.info(`Claude identified location: ${analysis.destination?.fullName || 'Unknown'} (${analysis.confidence})`);
      
      return {
        success: true,
        ...analysis
      };
    } catch (parseError) {
      logger.error('Failed to parse Claude response as JSON:', responseText);
      return {
        success: false,
        identified: false,
        reasoning: 'Failed to parse AI response',
        rawResponse: responseText
      };
    }

  } catch (error) {
    logger.error('Claude image analysis error:', error);
    return {
      success: false,
      identified: false,
      error: error.message
    };
  }
}

// ============================================================================
// MAIN IDENTIFICATION FUNCTION
// ============================================================================

/**
 * Identify location from an image using Vision API + Claude fallback
 * @param {string} imageBase64 - Base64 encoded image (without data URL prefix)
 * @param {string} mediaType - Image MIME type
 * @returns {Promise<Object>} - Complete identification result
 */
export async function identifyLocation(imageBase64, mediaType = 'image/jpeg') {
  logger.info('Starting location identification...');

  const result = {
    success: false,
    source: null,
    destination: null,
    landmark: null,
    confidence: null,
    coordinates: null,
    reasoning: null,
    travelTips: null
  };

  // Step 1: Try Google Cloud Vision for landmark detection
  const visionResult = await detectLandmarks(imageBase64);

  if (visionResult.landmarks?.length > 0) {
    // Found a landmark!
    const topLandmark = visionResult.landmarks[0];
    
    result.success = true;
    result.source = 'google_vision';
    result.landmark = topLandmark.name;
    result.confidence = topLandmark.confidence > 0.8 ? 'high' : topLandmark.confidence > 0.5 ? 'medium' : 'low';
    result.coordinates = topLandmark.location;
    
    // Use Claude to get more context about the landmark
    const claudeResult = await analyzeImageWithClaude(imageBase64, mediaType, visionResult);
    
    if (claudeResult.success && claudeResult.identified) {
      result.destination = claudeResult.destination;
      result.reasoning = claudeResult.reasoning;
      result.travelTips = claudeResult.travelTips;
    } else {
      // Fallback: use landmark name as destination
      result.destination = {
        name: topLandmark.name,
        fullName: topLandmark.name
      };
      result.reasoning = `Identified landmark: ${topLandmark.name}`;
    }

    logger.info(`Location identified via Google Vision: ${result.landmark}`);
    return result;
  }

  // Step 2: No landmark found, use Claude as primary analyzer
  logger.info('No landmarks detected, falling back to Claude analysis...');
  
  const claudeResult = await analyzeImageWithClaude(imageBase64, mediaType, visionResult);

  if (claudeResult.success && claudeResult.identified) {
    result.success = true;
    result.source = 'claude_ai';
    result.destination = claudeResult.destination;
    result.landmark = claudeResult.landmark || null;
    result.confidence = claudeResult.confidence;
    result.reasoning = claudeResult.reasoning;
    result.travelTips = claudeResult.travelTips;

    logger.info(`Location identified via Claude: ${result.destination?.fullName}`);
    return result;
  }

  // Step 3: Could not identify location
  result.success = false;
  result.reasoning = claudeResult.reasoning || 'Could not identify the location in this image';
  
  logger.info('Could not identify location from image');
  return result;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  detectLandmarks,
  analyzeImageWithClaude,
  identifyLocation
};
