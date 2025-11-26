// ============================================================================
// ANALYTICS SERVICE
// ============================================================================
// Tracks affiliate clicks, conversions, and user behavior
// Uses simple JSON file storage for MVP (can be upgraded to database)
// ============================================================================

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Data file paths
const DATA_DIR = join(__dirname, '../../data');
const CLICKS_FILE = join(DATA_DIR, 'clicks.json');
const FEEDBACK_FILE = join(DATA_DIR, 'feedback.json');

// ============================================================================
// FILE UTILITIES
// ============================================================================

/**
 * Ensure data directory and files exist
 */
async function ensureDataFiles() {
  try {
    // Create data directory if it doesn't exist
    await fs.mkdir(DATA_DIR, { recursive: true });

    // Create clicks file if it doesn't exist
    try {
      await fs.access(CLICKS_FILE);
    } catch {
      await fs.writeFile(CLICKS_FILE, JSON.stringify([], null, 2));
    }

    // Create feedback file if it doesn't exist
    try {
      await fs.access(FEEDBACK_FILE);
    } catch {
      await fs.writeFile(FEEDBACK_FILE, JSON.stringify([], null, 2));
    }
  } catch (error) {
    logger.error('Error ensuring data files', { error: error.message });
  }
}

/**
 * Read data from JSON file
 */
async function readData(filepath) {
  await ensureDataFiles();
  const data = await fs.readFile(filepath, 'utf-8');
  return JSON.parse(data);
}

/**
 * Write data to JSON file
 */
async function writeData(filepath, data) {
  await ensureDataFiles();
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
}

// ============================================================================
// AFFILIATE CLICK TRACKING
// ============================================================================

/**
 * Track an affiliate link click
 * @param {Object} clickData - Information about the click
 * @returns {Promise<Object>} Tracked click with unique ID
 */
export async function trackClick(clickData) {
  try {
    const clicks = await readData(CLICKS_FILE);

    const click = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      type: clickData.type, // 'flight', 'hotel', 'tour'
      provider: clickData.provider, // 'booking.com', 'viator', etc.
      itemId: clickData.itemId, // ID of the flight/hotel/tour
      sessionId: clickData.sessionId, // User session ID
      userAgent: clickData.userAgent,
      referrer: clickData.referrer,
      metadata: clickData.metadata || {}
    };

    clicks.push(click);
    await writeData(CLICKS_FILE, clicks);

    logger.info('Affiliate click tracked', { 
      id: click.id, 
      type: click.type,
      provider: click.provider 
    });

    return click;
  } catch (error) {
    logger.error('Error tracking click', { error: error.message });
    throw error;
  }
}

/**
 * Get affiliate click statistics
 * @returns {Promise<Object>} Click statistics
 */
export async function getClickStats() {
  try {
    const clicks = await readData(CLICKS_FILE);

    const stats = {
      total: clicks.length,
      byType: {},
      byProvider: {},
      last24Hours: 0,
      last7Days: 0,
      last30Days: 0
    };

    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    clicks.forEach(click => {
      const clickDate = new Date(click.timestamp);

      // Count by type
      stats.byType[click.type] = (stats.byType[click.type] || 0) + 1;

      // Count by provider
      stats.byProvider[click.provider] = (stats.byProvider[click.provider] || 0) + 1;

      // Count by time period
      if (clickDate > oneDayAgo) stats.last24Hours++;
      if (clickDate > sevenDaysAgo) stats.last7Days++;
      if (clickDate > thirtyDaysAgo) stats.last30Days++;
    });

    return stats;
  } catch (error) {
    logger.error('Error getting click stats', { error: error.message });
    throw error;
  }
}

// ============================================================================
// USER FEEDBACK COLLECTION
// ============================================================================

/**
 * Save user feedback
 * @param {Object} feedbackData - User feedback
 * @returns {Promise<Object>} Saved feedback with unique ID
 */
export async function saveFeedback(feedbackData) {
  try {
    const feedbacks = await readData(FEEDBACK_FILE);

    const feedback = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      rating: feedbackData.rating, // 1-5 stars
      comment: feedbackData.comment,
      sessionId: feedbackData.sessionId,
      page: feedbackData.page, // Where feedback was given
      metadata: feedbackData.metadata || {}
    };

    feedbacks.push(feedback);
    await writeData(FEEDBACK_FILE, feedbacks);

    logger.info('User feedback saved', { 
      id: feedback.id, 
      rating: feedback.rating 
    });

    return feedback;
  } catch (error) {
    logger.error('Error saving feedback', { error: error.message });
    throw error;
  }
}

/**
 * Get feedback statistics
 * @returns {Promise<Object>} Feedback statistics
 */
export async function getFeedbackStats() {
  try {
    const feedbacks = await readData(FEEDBACK_FILE);

    if (feedbacks.length === 0) {
      return {
        total: 0,
        averageRating: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      };
    }

    const stats = {
      total: feedbacks.length,
      averageRating: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };

    let totalRating = 0;
    feedbacks.forEach(feedback => {
      totalRating += feedback.rating;
      stats.distribution[feedback.rating]++;
    });

    stats.averageRating = (totalRating / feedbacks.length).toFixed(2);

    return stats;
  } catch (error) {
    logger.error('Error getting feedback stats', { error: error.message });
    throw error;
  }
}
