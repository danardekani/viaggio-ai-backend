// ============================================================================
// CORS MIDDLEWARE
// ============================================================================
// Configures Cross-Origin Resource Sharing to allow frontend to call backend
// ============================================================================

export const corsConfig = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    // Allowed origins from environment and localhost
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'https://viaggio-ai-frontend.vercel.app',
      'https://staging-viaggio-ai.vercel.app',
      'http://localhost:5173',
      'http://localhost:3000',
    ];

    // Add any additional origins from environment variable (comma-separated)
    if (process.env.ALLOWED_ORIGINS) {
      const extraOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
      allowedOrigins.push(...extraOrigins);
    }

    // Check exact match
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }

    // Allow Vercel preview URLs for this specific project only
    // Pattern: *-danardekanis-projects.vercel.app
    if (origin.endsWith('-danardekanis-projects.vercel.app')) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
