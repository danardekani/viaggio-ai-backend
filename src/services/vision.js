// ============================================================================
// VISION SERVICE - Google Cloud Vision + AI Fallback
// ============================================================================
// Identifies locations from images using:
// 1. Google Cloud Vision API (landmark detection + web detection)
// 2. AI fallback (Gemini or Claude - toggle below)
// ============================================================================

import { logger } from '../utils/logger.js';

// --------------------------------------------------------------------------
// CLAUDE
// --------------------------------------------------------------------------
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});
const AI_PROVIDER = 'claude';

// ============================================================================
// GOOGLE CLOUD VISION - LANDMARK & WEB DETECTION
// ============================================================================

const VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || VISION_API_KEY;

/**
 * Detect landmarks and web entities using Google Cloud Vision API
 */
async function detectLandmarks(imageBase64) {
  if (!VISION_API_KEY) {
    logger.warn('Google Vision API key not configured');
    return { landmarks: [], webEntities: [], bestGuessLabels: [], detectedText: '' };
  }

  try {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: imageBase64 },
            features: [
              { type: 'LANDMARK_DETECTION', maxResults: 10 },
              { type: 'WEB_DETECTION', maxResults: 15 },
              { type: 'TEXT_DETECTION', maxResults: 5 },
              { type: 'LABEL_DETECTION', maxResults: 10 }
            ]
          }]
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error('Vision API error:', error);
      return { landmarks: [], webEntities: [], bestGuessLabels: [], detectedText: '' };
    }

    const data = await response.json();
    const result = data.responses?.[0] || {};

    // Extract landmarks with coordinates
    const landmarks = (result.landmarkAnnotations || []).map(l => ({
      name: l.description,
      score: l.score,
      locations: l.locations?.map(loc => ({
        latitude: loc.latLng?.latitude,
        longitude: loc.latLng?.longitude
      }))
    }));

    // Extract web entities (places, things recognized from the web)
    const webDetection = result.webDetection || {};
    const webEntities = (webDetection.webEntities || [])
      .filter(e => e.score > 0.5)
      .map(e => ({
        name: e.description,
        score: e.score
      }));

    // Best guess labels from web (very useful!)
    const bestGuessLabels = (webDetection.bestGuessLabels || []).map(l => l.label);

    // Pages with matching images (can reveal location)
    const pagesWithMatchingImages = (webDetection.pagesWithMatchingImages || [])
      .slice(0, 5)
      .map(p => ({
        url: p.url,
        title: p.pageTitle
      }));

    // Detected text in image (signs, etc.)
    const textAnnotations = result.textAnnotations || [];
    const detectedText = textAnnotations[0]?.description || '';

    // Labels (general scene understanding)
    const labels = (result.labelAnnotations || []).map(l => ({
      name: l.description,
      score: l.score
    }));

    logger.info(`Vision API results: ${landmarks.length} landmarks, ${webEntities.length} web entities, ${bestGuessLabels.length} best guesses`);
    
    if (bestGuessLabels.length > 0) {
      logger.info(`Best guess labels: ${bestGuessLabels.join(', ')}`);
    }

    return {
      landmarks,
      webEntities,
      bestGuessLabels,
      pagesWithMatchingImages,
      detectedText,
      labels
    };

  } catch (error) {
    logger.error('Vision API error:', error);
    return { landmarks: [], webEntities: [], bestGuessLabels: [], detectedText: '' };
  }
}

// ============================================================================
// GOOGLE PLACES API - ENRICH WITH COORDINATES & DETAILS
// ============================================================================

async function lookupPlace(searchQuery) {
  if (!MAPS_API_KEY) {
    return { success: false };
  }

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places:searchText`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': MAPS_API_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.editorialSummary'
        },
        body: JSON.stringify({
          textQuery: searchQuery,
          maxResultCount: 1
        })
      }
    );

    if (!response.ok) {
      return { success: false };
    }

    const data = await response.json();
    const place = data.places?.[0];

    if (place) {
      return {
        success: true,
        name: place.displayName?.text,
        address: place.formattedAddress,
        coordinates: place.location ? {
          latitude: place.location.latitude,
          longitude: place.location.longitude
        } : null,
        googleMapsUrl: place.googleMapsUri,
        description: place.editorialSummary?.text
      };
    }

    return { success: false };
  } catch (error) {
    logger.error('Places API error:', error);
    return { success: false };
  }
}

// ============================================================================
// CLAUDE - ENHANCED AI IMAGE ANALYSIS (currently active)
// ============================================================================

async function analyzeImageWithClaude(imageBase64, mediaType = 'image/jpeg', visionContext = {}) {
  try {
    logger.info('Analyzing image with Claude for location identification...');

    // Build rich context from Vision API results
    let contextHints = '';
    
    if (visionContext.landmarks?.length > 0) {
      const landmarkNames = visionContext.landmarks.map(l => `${l.name} (${Math.round(l.score * 100)}% confidence)`).join(', ');
      contextHints += `\n- LANDMARK DETECTION: ${landmarkNames}`;
    }
    
    if (visionContext.bestGuessLabels?.length > 0) {
      contextHints += `\n- WEB IMAGE SEARCH suggests this might be: ${visionContext.bestGuessLabels.join(', ')}`;
    }
    
    if (visionContext.webEntities?.length > 0) {
      const topEntities = visionContext.webEntities.slice(0, 8).map(e => e.name).join(', ');
      contextHints += `\n- RELATED ENTITIES from web: ${topEntities}`;
    }

    if (visionContext.pagesWithMatchingImages?.length > 0) {
      const pageTitles = visionContext.pagesWithMatchingImages
        .filter(p => p.title)
        .slice(0, 3)
        .map(p => p.title)
        .join('; ');
      if (pageTitles) {
        contextHints += `\n- WEB PAGES with similar images: ${pageTitles}`;
      }
    }
    
    if (visionContext.detectedText) {
      const cleanText = visionContext.detectedText.substring(0, 300).replace(/\n/g, ' ');
      contextHints += `\n- TEXT VISIBLE IN IMAGE: "${cleanText}"`;
    }

    if (visionContext.labels?.length > 0) {
      const topLabels = visionContext.labels.slice(0, 6).map(l => l.name).join(', ');
      contextHints += `\n- SCENE LABELS: ${topLabels}`;
    }

    const prompt = `You are an expert travel destination identifier with encyclopedic knowledge of world landmarks, cities, architecture, landscapes, and cultural sites.

TASK: Identify the specific travel destination shown in this image.

${contextHints ? `CLUES FROM IMAGE ANALYSIS:${contextHints}` : ''}

ANALYSIS APPROACH:
1. First, examine the image carefully for distinctive features:
   - Architecture style (Gothic, Baroque, Modern, Islamic, Asian, etc.)
   - Landscape features (mountains, coastline, desert, tropical, etc.)
   - Vegetation and climate indicators
   - Signs, text, or language visible
   - People's clothing and cultural indicators
   - Vehicles, infrastructure, street patterns
   - Famous landmarks or monuments

2. Cross-reference with the clues provided above (if any)

3. Consider multiple possibilities and choose the most likely match

4. If this appears to be a FAMOUS LANDMARK, identify both:
   - The specific landmark name (e.g., "Eiffel Tower", "Colosseum")
   - The city/destination where it's located (e.g., "Paris", "Rome")

CRITICAL RULES:
- The "destination" field must be a CITY or REGION name (where a tourist would search for tours)
- NOT the landmark name itself
- Example: If you see the Colosseum, destination.name = "Rome", landmark = "Colosseum"
- Example: If you see Machu Picchu, destination.name = "Cusco" or "Machu Picchu" (since it's a destination itself)
- Example: If you see a beach in Thailand, destination.name = "Phuket" or "Krabi" (be specific if possible)
- Example: If you see Big Ben, destination.name = "London", landmark = "Big Ben"
- IMPORTANT: For UK locations, always use "United Kingdom" as the country, or be specific like "London, England, United Kingdom"

CONFIDENCE LEVELS:
- "high": You are very confident (famous landmark, clear signs, distinctive architecture)
- "medium": Reasonably confident but some uncertainty (generic cityscape with some clues)
- "low": Best guess based on limited information

RESPOND WITH ONLY THIS JSON (no markdown, no explanation, no code blocks):
{
  "identified": true,
  "confidence": "high",
  "destination": {
    "name": "City Name",
    "region": "State/Province if applicable",
    "country": "Country Name",
    "fullName": "City Name, Country Name"
  },
  "landmark": "Specific landmark name if visible, otherwise null",
  "reasoning": "2-3 sentences explaining what features led to this identification"
}

If you truly cannot identify the location (generic indoor shot, too blurry, no distinguishing features):
{
  "identified": false,
  "confidence": "low",
  "destination": null,
  "landmark": null,
  "reasoning": "Explain why identification was not possible"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
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
          { type: 'text', text: prompt }
        ]
      }]
    });

    const responseText = response.content[0].text.trim();

    // Parse the JSON response
    try {
      let jsonText = responseText;
      // Remove markdown code blocks if present
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
      }

      const analysis = JSON.parse(jsonText);
      logger.info(`Claude identified location: ${analysis.destination?.fullName || 'Unknown'} (confidence: ${analysis.confidence})`);

      return {
        success: analysis.identified,
        ...analysis
      };
    } catch (parseError) {
      logger.error('Failed to parse Claude response as JSON:', responseText.substring(0, 500));
      
      // Try to extract location from raw text as fallback
      const locationMatch = responseText.match(/destination["\s:]+{[^}]*name["\s:]+["']([^"']+)["']/i);
      if (locationMatch) {
        return {
          success: true,
          identified: true,
          confidence: 'low',
          destination: { name: locationMatch[1], fullName: locationMatch[1] },
          reasoning: 'Extracted from partial response'
        };
      }
      
      return {
        success: false,
        identified: false,
        reasoning: 'Failed to parse AI response',
        rawResponse: responseText.substring(0, 200)
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
// AI ANALYSIS ROUTER - Routes to active provider
// ============================================================================

async function analyzeImageWithAI(imageBase64, mediaType = 'image/jpeg', visionContext = {}) {
  return await analyzeImageWithClaude(imageBase64, mediaType, visionContext);
}

// ============================================================================
// MAIN IDENTIFICATION FUNCTION
// ============================================================================

/**
 * Identify location from an image using Vision API + AI
 * @param {string} imageBase64 - Base64 encoded image (without data URL prefix)
 * @param {string} mediaType - Image MIME type
 * @returns {Promise<Object>} - Complete identification result
 */
export async function identifyLocation(imageBase64, mediaType = 'image/jpeg') {
  logger.info(`Starting location identification (AI Provider: ${AI_PROVIDER})...`);

  const result = {
    success: false,
    source: null,
    destination: null,
    landmark: null,
    confidence: null,
    coordinates: null,
    googleMapsUrl: null,
    reasoning: null
  };

  // Step 1: Get rich context from Google Cloud Vision
  const visionResult = await detectLandmarks(imageBase64);

  // Step 2: If Vision API found high-confidence landmarks, use those directly
  if (visionResult.landmarks?.length > 0) {
    const topLandmark = visionResult.landmarks[0];
    
    if (topLandmark.score > 0.7) {
      logger.info(`High-confidence landmark detected: ${topLandmark.name} (${topLandmark.score})`);
      
      // Still use AI to get the destination city name
      const aiResult = await analyzeImageWithAI(imageBase64, mediaType, visionResult);
      
      if (aiResult.success && aiResult.destination) {
        result.success = true;
        result.source = 'google_vision_enhanced';
        result.destination = aiResult.destination;
        result.landmark = topLandmark.name;
        result.confidence = 'high';
        result.reasoning = aiResult.reasoning || `Identified landmark: ${topLandmark.name}`;
        
        // Get coordinates from Vision API
        if (topLandmark.locations?.[0]) {
          result.coordinates = topLandmark.locations[0];
        }
        
        // Enrich with Places API
        const searchQuery = `${topLandmark.name} ${aiResult.destination?.name || ''}`;
        const placeData = await lookupPlace(searchQuery);
        if (placeData.success) {
          result.googleMapsUrl = placeData.googleMapsUrl;
          if (!result.coordinates && placeData.coordinates) {
            result.coordinates = placeData.coordinates;
          }
        }
        
        return result;
      }
    }
  }

  // Step 3: Use AI with all Vision context for analysis
  logger.info(`Using ${AI_PROVIDER} for full image analysis...`);
  const aiResult = await analyzeImageWithAI(imageBase64, mediaType, visionResult);

  if (aiResult.success && aiResult.identified && aiResult.destination) {
    result.success = true;
    result.source = `${AI_PROVIDER}_ai`;
    result.destination = aiResult.destination;
    result.landmark = aiResult.landmark || null;
    result.confidence = aiResult.confidence;
    result.reasoning = aiResult.reasoning;

    // Try to get coordinates and Google Maps URL via Places API
    const searchQuery = aiResult.landmark 
      ? `${aiResult.landmark} ${aiResult.destination.name}`
      : aiResult.destination.fullName;
    
    const placeData = await lookupPlace(searchQuery);
    if (placeData.success) {
      result.coordinates = placeData.coordinates;
      result.googleMapsUrl = placeData.googleMapsUrl;
    }

    logger.info(`Location identified via ${AI_PROVIDER}: ${result.destination?.fullName} (${result.confidence})`);
    return result;
  }

  // Step 4: Could not identify location
  result.success = false;
  result.reasoning = aiResult.reasoning || 'Could not identify the location in this image';

  logger.info('Could not identify location from image');
  return result;
}

// ============================================================================
// EXPORTS
// ============================================================================

export { identifyLocation, detectLandmarks, lookupPlace, analyzeImageWithAI };

export default {
  identifyLocation,
  detectLandmarks,
  lookupPlace,
  analyzeImageWithAI
};
