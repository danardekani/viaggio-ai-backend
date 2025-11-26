// ============================================================================
// LOGGER UTILITY
// ============================================================================
// Simple logging system with timestamps
// In production, you might want to use Winston or Pino
// ============================================================================

const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG'
};

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(data && { data })
  };
  
  // In development, log to console
  if (process.env.NODE_ENV === 'development') {
    console.log(JSON.stringify(logEntry, null, 2));
  } else {
    // In production, you might send to a logging service
    console.log(JSON.stringify(logEntry));
  }
}

export const logger = {
  info: (message, data) => log(LOG_LEVELS.INFO, message, data),
  warn: (message, data) => log(LOG_LEVELS.WARN, message, data),
  error: (message, data) => log(LOG_LEVELS.ERROR, message, data),
  debug: (message, data) => log(LOG_LEVELS.DEBUG, message, data),
};
