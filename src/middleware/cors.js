// ============================================================================
// CORS MIDDLEWARE
// ============================================================================
// Configures Cross-Origin Resource Sharing to allow frontend to call backend
// ============================================================================

export const corsConfig = {
  origin: function (origin, callback) {
    // Allow requests from your frontend domain
    const allowedOrigins = [
      process.env.FRONTEND_URL,

      // Test/Preview branches
      'https://viaggio-ai-git-viaggio-ai-frontend-test-danardekanis-projects.vercel.app',
      'https://viaggio-a7dvl0g3r-danardekanis-projects.vercel.app',
      'https://viaggio-ai.vercel.app',
      
      'http://localhost:5173',  // Local development
      'http://localhost:3000'   // Alternative local port
    ];
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
