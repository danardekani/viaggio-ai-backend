// ============================================================================
// VISION SERVICE - OPTIMIZED WITH GEMINI 2.0 FLASH
// ============================================================================

import { logger } from '../utils/logger.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const AI_PROVIDER = 'gemini';

const VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || VISION_API_KEY;

// ============================================================================
// DESTINATION ID CACHE
// ============================================================================

const DESTINATION_ID_CACHE = {
  'rome': 511, 'florence': 517, 'venice': 522, 'milan': 507, 'naples': 518,
  'sicily': 205, 'catania': 22664, 'palermo': 4947, 'amalfi coast': 4875,
  'tuscany': 4859, 'cinque terre': 22362, 'paris': 479, 'nice': 485,
  'marseille': 471, 'lyon': 467, 'provence': 4838, 'barcelona': 562,
  'madrid': 566, 'seville': 573, 'valencia': 576, 'london': 737,
  'edinburgh': 731, 'manchester': 733, 'athens': 496, 'santorini': 800,
  'mykonos': 4503, 'crete': 4502, 'new york': 712, 'new york city': 712,
  'los angeles': 684, 'san francisco': 651, 'las vegas': 684, 'miami': 662,
  'chicago': 656, 'boston': 678, 'washington': 657, 'hawaii': 282,
  'maui': 4688, 'amsterdam': 525, 'berlin': 531, 'prague': 540,
  'vienna': 454, 'lisbon': 538, 'dublin': 723, 'tokyo': 334,
  'sydney': 357, 'dubai': 828, 'bangkok': 343, 'singapore': 306
};

function getDestinationId(cityName) {
  if (!cityName) return null;
  const normalized = cityName.toLowerCase().trim();
  if (DESTINATION_ID_CACHE[normalized]) return DESTINATION_ID_CACHE[normalized];
  for (const [key, id] of Object.entries(DESTINATION_ID_CACHE)) {
    if (normalized.includes(key) || key.includes(normalized)) return id;
  }
  return null;
}

// ============================================================================
// GOOGLE CLOUD VISION API
// ============================================================================

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
              { type: 'LANDMARK_DETECTION', maxResults: 5 },
              { type: 'WEB_DETECTION', maxResults: 10 },
              { type: 'TEXT_DETECTION', maxResults: 3 }
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

    const landmarks = (result.landmarkAnnotations || []).map(l => ({
      name: l.description,
      score: l.score,
      locations: l.locations?.map(loc => ({
        latitude: loc.latLng?.latitude,
        longitude: loc.latLng?.longitude
      }))
    }));

    const webDetection = result.webDetection || {};
    const webEntities = (webDetection.webEntities || [])
      .filter(e => e.score > 0.5)
      .map(e => ({ name: e.description, score: e.score }));

    const bestGuessLabels = (webDetection.bestGuessLabels || []).map(l => l.label);
    const detectedText = result.textAnnotations?.[0]?.description || '';

    logger.info(`Vision API: ${landmarks.length} landmarks, guesses: [${bestGuessLabels.join(', ')}]`);

    return { landmarks, webEntities, bestGuessLabels, detectedText };
  } catch (error) {
    logger.error('Vision API error:', error);
    return { landmarks: [], webEntities: [], bestGuessLabels: [], detectedText: '' };
  }
}

// ============================================================================
// GEMINI 2.0 FLASH - IMAGE ANALYSIS
// ============================================================================

async function analyzeImageWithGemini(imageBase64, mediaType, visionContext) {
  try {
    const startTime = Date.now();
    logger.info('Analyzing image with Gemini 2.0 Flash...');

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
    });

    let contextHints = '';
    if (visionContext.landmarks?.length > 0) {
      contextHints += `Landmarks: ${visionContext.landmarks.map(l => l.name).join(', ')}. `;
    }
    if (visionContext.bestGuessLabels?.length > 0) {
      contextHints += `Web suggests: ${visionContext.bestGuessLabels.join(', ')}. `;
    }
    if (visionContext.detectedText) {
      contextHints += `Text: "${visionContext.detectedText.substring(0, 100)}". `;
    }

    const prompt = `You are a travel expert. Identify the SPECIFIC location in this image.

${contextHints ? `Detection hints: ${contextHints}` : ''}

IMPORTANT: For landmarks, provide the OFFICIAL/FULL NAME (e.g., "Cathedral of Sant'Agata" not just "Catania Cathedral", "Basilica di San Marco" not just "Venice Cathedral").

Return ONLY valid JSON (no markdown, no explanation):
{"identified":true,"confidence":"high","destination":{"name":"City","region":"Region","country":"Country","fullName":"City, Country"},"landmark":"FULL official name of landmark or null","reasoning":"One sentence"}`;

    const imagePart = {
      inlineData: { data: imageBase64, mimeType: mediaType }
    };

    const result = await model.generateContent([prompt, imagePart]);
    const responseText = result.response.text().trim();
    
    logger.info(`Gemini response in ${Date.now() - startTime}ms`);

    let jsonText = responseText.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
    const analysis = JSON.parse(jsonText);
    
    if (analysis.destination?.name) {
      const destId = getDestinationId(analysis.destination.name);
      if (destId) {
        analysis.destination.viatorId = destId;
        logger.info(`Mapped "${analysis.destination.name}" to Viator ID: ${destId}`);
      }
    }

    logger.info(`Gemini identified: ${analysis.destination?.fullName || 'Unknown'} (${analysis.confidence})`);
    return { success: analysis.identified, ...analysis };
  } catch (error) {
    logger.error('Gemini analysis error:', error);
    return { success: false, identified: false, error: error.message };
  }
}

// ============================================================================
// GOOGLE PLACES API
// ============================================================================

async function lookupPlace(searchQuery) {
  if (!MAPS_API_KEY) return { success: false };

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.googleMapsUri'
      },
      body: JSON.stringify({ textQuery: searchQuery, maxResultCount: 1 })
    });

    if (!response.ok) return { success: false };

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
        googleMapsUrl: place.googleMapsUri
      };
    }
    return { success: false };
  } catch (error) {
    logger.error('Places API error:', error);
    return { success: false };
  }
}

// ============================================================================
// MAIN IDENTIFICATION FUNCTION
// ============================================================================

async function identifyLocation(imageBase64, mediaType = 'image/jpeg') {
  const startTime = Date.now();
  logger.info('Starting location identification...');

  const result = {
    success: false,
    source: null,
    destination: null,
    landmark: null,
    confidence: null,
    coordinates: null,
    googleMapsUrl: null,
    reasoning: null,
    viatorDestinationId: null
  };

  // Step 1: Get Vision API context
  const visionResult = await detectLandmarks(imageBase64);

  // Step 2: High-confidence landmark path
  if (visionResult.landmarks?.length > 0 && visionResult.landmarks[0].score > 0.7) {
    const topLandmark = visionResult.landmarks[0];
    logger.info(`High-confidence landmark: ${topLandmark.name} (${Math.round(topLandmark.score * 100)}%)`);
    
    const aiResult = await analyzeImageWithGemini(imageBase64, mediaType, visionResult);
    
    if (aiResult.success && aiResult.destination) {
      result.success = true;
      result.source = 'vision_enhanced';
      result.destination = aiResult.destination;
      // Use Google Vision's landmark name if it's more specific (longer/detailed)
      const visionLandmark = topLandmark.name;
      const aiLandmark = aiResult.landmark;
      result.landmark = (visionLandmark && visionLandmark.length > (aiLandmark?.length || 0)) 
        ? visionLandmark 
        : (aiLandmark || visionLandmark);
      result.confidence = 'high';
      result.reasoning = `Identified landmark: ${result.landmark}`;
      result.viatorDestinationId = aiResult.destination.viatorId || getDestinationId(aiResult.destination.name);
      
      if (topLandmark.locations?.[0]) {
        result.coordinates = topLandmark.locations[0];
      }
      
      logger.info(`Location identified in ${Date.now() - startTime}ms (vision-enhanced)`);
      return result;
    }
  }

  // Step 3: Full AI analysis
  const aiResult = await analyzeImageWithGemini(imageBase64, mediaType, visionResult);

  if (aiResult.success && aiResult.identified && aiResult.destination) {
    result.success = true;
    result.source = 'gemini_ai';
    result.destination = aiResult.destination;
    result.landmark = aiResult.landmark || null;
    result.confidence = aiResult.confidence;
    result.reasoning = aiResult.reasoning;
    result.viatorDestinationId = aiResult.destination.viatorId || getDestinationId(aiResult.destination.name);

    // Quick Places lookup with timeout
    const searchQuery = aiResult.landmark 
      ? `${aiResult.landmark} ${aiResult.destination.name}`
      : aiResult.destination.fullName;
    
    try {
      const placePromise = lookupPlace(searchQuery);
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ success: false }), 1500));
      const placeData = await Promise.race([placePromise, timeoutPromise]);
      
      if (placeData.success) {
        result.coordinates = placeData.coordinates;
        result.googleMapsUrl = placeData.googleMapsUrl;
      }
    } catch (e) {
      logger.warn('Places lookup skipped');
    }

    logger.info(`Location identified in ${Date.now() - startTime}ms: ${result.destination?.fullName}`);
    return result;
  }

  // Step 4: Failed
  result.success = false;
  result.reasoning = aiResult.reasoning || 'Could not identify location';
  logger.info(`Identification failed after ${Date.now() - startTime}ms`);
  return result;
}

// ============================================================================
// EXPORTS
// ============================================================================

export { identifyLocation, detectLandmarks, lookupPlace, analyzeImageWithGemini as analyzeImageWithAI };

export default {
  identifyLocation,
  detectLandmarks,
  lookupPlace,
  analyzeImageWithAI: analyzeImageWithGemini
};
