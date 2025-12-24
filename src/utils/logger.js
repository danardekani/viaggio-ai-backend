// ============================================================================
// LOGGER UTILITY
// ============================================================================
// Simple logging system with timestamps and level filtering
// DEBUG logs only shown in development to prevent Railway rate limiting
// ============================================================================

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Only show DEBUG in development
const CURRENT_LOG_LEVEL = process.env.NODE_ENV === 'development' 
  ? LOG_LEVELS.DEBUG 
  : LOG_LEVELS.INFO;

function log(level, levelName, message, data = null) {
  // Skip logs below current level
  if (level > CURRENT_LOG_LEVEL) {
    return;
  }

  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level: levelName,
    message,
    ...(data && { data })
  };
  
  // In development, pretty print for readability
  if (process.env.NODE_ENV === 'development') {
    console.log(JSON.stringify(logEntry, null, 2));
  } else {
    // In production, single-line JSON for log aggregation
    console.log(JSON.stringify(logEntry));
  }
}

export const logger = {
  error: (message, data) => log(LOG_LEVELS.ERROR, 'ERROR', message, data),
  warn: (message, data) => log(LOG_LEVELS.WARN, 'WARN', message, data),
  info: (message, data) => log(LOG_LEVELS.INFO, 'INFO', message, data),
  debug: (message, data) => log(LOG_LEVELS.DEBUG, 'DEBUG', message, data),
};
