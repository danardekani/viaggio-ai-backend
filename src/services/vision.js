// ============================================================================
// VISION SERVICE - Google Cloud Vision + AI Enhancement
// ============================================================================
// Identifies locations from images using:
// 1. Google Cloud Vision API (landmark detection)
// 2. AI enhancement (always used to add city/country context and descriptions)
// ============================================================================

// ==========================================================================
// AI PROVIDER TOGGLE - Uncomment ONE of the following sections
// ==========================================================================

// --------------------------------------------------------------------------
// OPTION A: GEMINI (commented out)
// --------------------------------------------------------------------------
// import { GoogleGenerativeAI } from '@google/generative-ai';
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// const AI_PROVIDER = 'gemini';

// --------------------------------------------------------------------------
// OPTION B: CLAUDE (currently active)
// --------------------------------------------------------------------------
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});
const AI_PROVIDER = 'claude';

// ==========================================================================

// Simple logger (uses console)
const logger = {
  info: (...args) => console.log('[Vision]', ...args),
  warn: (...args) => console.warn('[Vision]', ...args),
  error: (...args) => console.error('[Vision]', ...args)
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const GOOGLE_VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

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
          { type: 'LANDMARK_DETECTION', maxResults: 10 },
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
// CLAUDE - AI IMAGE ANALYSIS WITH RICH CONTEXT (currently active)
// ============================================================================

/**
 * Use Claude to analyze an image and identify the location with rich context
 * @param {string} imageBase64 - Base64 encoded image
 * @param {string} mediaType - Image MIME type (e.g., 'image/jpeg')
 * @param {Object} visionContext - Context from Google Vision (landmarks, labels, text)
 * @returns {Promise<Object>} - Identified location information with description
 */
async function analyzeImageWithClaude(imageBase64, mediaType = 'image/jpeg', visionContext = {}) {
  try {
    logger.info('Analyzing image with Claude for location identification...');

    // Build context from Vision API results
    let contextHints = '';
    if (visionContext.landmarks?.length > 0) {
      const landmarkNames = visionContext.landmarks.map(l => l.name).join(', ');
      contextHints += `Google Vision detected these landmarks: ${landmarkNames}. `;
    }
    if (visionContext.labels?.length > 0) {
      contextHints += `Labels detected: ${visionContext.labels.slice(0, 5).map(l => l.name).join(', ')}. `;
    }
    if (visionContext.detectedText) {
      contextHints += `Text found: "${visionContext.detectedText.substring(0, 200)}"`;
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
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
              text: `Identify this travel destination and provide rich context for travelers.
${contextHints}

You MUST respond with ONLY valid JSON (no markdown, no code blocks, no extra text):
{
  "identified": true,
  "confidence": "high",
  "destination": {
    "name": "City Name",
    "country": "Country Name",
    "fullName": "City Name, Country Name"
  },
  "landmark": "Specific landmark name if visible, or null",
  "description": "A 2-3 sentence description of this location that would be helpful for a traveler. Include what makes this place special, interesting history, or travel tips.",
  "reasoning": "Brief explanation of how you identified this location"
}

IMPORTANT:
- "destination" must ALWAYS include the CITY and COUNTRY, not just the landmark name
- For example, if you see the Colosseum, destination.name should be "Rome", not "Colosseum"
- The "landmark" field is for the specific landmark (e.g., "Colosseum")
- The "description" should be engaging travel-focused content about this specific place
- If you cannot identify the location, set "identified" to false and explain in "reasoning"`
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
// GEMINI - AI IMAGE ANALYSIS WITH RICH CONTEXT (commented out)
// ============================================================================

// async function analyzeImageWithGemini(imageBase64, mediaType = 'image/jpeg', visionContext = {}) {
//   try {
//     logger.info('Analyzing image with Gemini for location identification...');
//
//     const model = genAI.getGenerativeModel({
//       model: 'gemini-2.0-flash',
//       generationConfig: {
//         temperature: 0.3,
//         maxOutputTokens: 800,
//       }
//     });
//
//     let contextHints = '';
//     if (visionContext.landmarks?.length > 0) {
//       const landmarkNames = visionContext.landmarks.map(l => l.name).join(', ');
//       contextHints += `Google Vision detected these landmarks: ${landmarkNames}. `;
//     }
//     if (visionContext.labels?.length > 0) {
//       contextHints += `Labels detected: ${visionContext.labels.slice(0, 5).map(l => l.name).join(', ')}. `;
//     }
//     if (visionContext.detectedText) {
//       contextHints += `Text found: "${visionContext.detectedText.substring(0, 200)}"`;
//     }
//
//     const prompt = `Identify this travel destination and provide rich context for travelers.
// ${contextHints}
//
// You MUST respond with ONLY valid JSON (no markdown, no code blocks, no extra text):
// {
//   "identified": true,
//   "confidence": "high",
//   "destination": {
//     "name": "City Name",
//     "country": "Country Name",
//     "fullName": "City Name, Country Name"
//   },
//   "landmark": "Specific landmark name if visible, or null",
//   "description": "A 2-3 sentence description helpful for travelers",
//   "reasoning": "Brief explanation"
// }
//
// IMPORTANT: destination must be the CITY, not the landmark. For Colosseum, destination.name = "Rome".`;
//
//     const imagePart = {
//       inlineData: {
//         data: imageBase64,
//         mimeType: mediaType
//       }
//     };
//
//     const result = await model.generateContent([prompt, imagePart]);
//     const response = result.response;
//     const responseText = response.text().trim();
//
//     try {
//       let jsonText = responseText;
//       if (jsonText.startsWith('```')) {
//         jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
//       }
//
//       const analysis = JSON.parse(jsonText);
//       logger.info(`Gemini identified location: ${analysis.destination?.fullName || 'Unknown'} (${analysis.confidence})`);
//
//       return {
//         success: true,
//         ...analysis
//       };
//     } catch (parseError) {
//       logger.error('Failed to parse Gemini response as JSON:', responseText);
//       return {
//         success: false,
//         identified: false,
//         reasoning: 'Failed to parse AI response',
//         rawResponse: responseText
//       };
//     }
//
//   } catch (error) {
//     logger.error('Gemini image analysis error:', error);
//     return {
//       success: false,
//       identified: false,
//       error: error.message
//     };
//   }
// }

// ============================================================================
// AI ANALYSIS ROUTER - Routes to active provider
// ============================================================================

/**
 * Analyze image with the currently active AI provider
 */
async function analyzeImageWithAI(imageBase64, mediaType = 'image/jpeg', visionContext = {}) {
  // CLAUDE (currently active)
  return await analyzeImageWithClaude(imageBase64, mediaType, visionContext);
  
  // GEMINI (commented out)
  // return await analyzeImageWithGemini(imageBase64, mediaType, visionContext);
}

// ============================================================================
// MAIN IDENTIFICATION FUNCTION
// ============================================================================

/**
 * Identify location from an image using Vision API + AI enhancement
 * ALWAYS uses AI to get rich context (city, country, description)
 * 
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
    description: null,
    reasoning: null
  };

  // Step 1: Try Google Cloud Vision for landmark detection
  const visionResult = await detectLandmarks(imageBase64);

  // Step 2: ALWAYS use AI to get rich context (city, country, description)
  // Pass Vision results as context hints to help AI
  logger.info(`Calling ${AI_PROVIDER} for rich context and description...`);
  const aiResult = await analyzeImageWithAI(imageBase64, mediaType, visionResult);

  if (aiResult.success && aiResult.identified) {
    result.success = true;
    result.source = visionResult.landmarks?.length > 0 ? 'google_vision_enhanced' : `${AI_PROVIDER}_ai`;
    result.destination = aiResult.destination;
    result.landmark = aiResult.landmark || (visionResult.landmarks?.[0]?.name || null);
    result.confidence = aiResult.confidence;
    result.description = aiResult.description;
    result.reasoning = aiResult.reasoning;

    // Add coordinates from Google Vision if available
    if (visionResult.landmarks?.[0]?.location) {
      result.coordinates = visionResult.landmarks[0].location;
    }

    logger.info(`Location identified: ${result.destination?.fullName} (landmark: ${result.landmark})`);
    return result;
  }

  // Step 3: If AI failed but Google Vision found something, use that as fallback
  if (visionResult.landmarks?.length > 0) {
    const topLandmark = visionResult.landmarks[0];
    
    result.success = true;
    result.source = 'google_vision_fallback';
    result.landmark = topLandmark.name;
    result.confidence = topLandmark.confidence > 0.8 ? 'high' : 'medium';
    result.coordinates = topLandmark.location;
    
    // Try to provide a reasonable destination even without AI
    // This is a fallback - ideally AI would have worked
    result.destination = {
      name: topLandmark.name,
      fullName: topLandmark.name
    };
    result.reasoning = `Identified landmark: ${topLandmark.name}. For best results with hotels and tours, please try searching for the city name directly.`;
    result.description = `This appears to be ${topLandmark.name}. Try searching for hotels and tours in the city where this landmark is located.`;

    logger.warn(`AI enhancement failed, using Vision-only fallback for: ${topLandmark.name}`);
    return result;
  }

  // Step 4: Could not identify location
  result.success = false;
  result.reasoning = aiResult.reasoning || 'Could not identify the location in this image. Try uploading a clearer photo of a recognizable landmark or destination.';

  logger.info('Could not identify location from image');
  return result;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  detectLandmarks,
  analyzeImageWithAI,
  identifyLocation
};
