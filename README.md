# viaggio-ai-backend
```
viaggio-backend/
├── src/
│   ├── server.js           # Main Express server
│   ├── routes/
│   │   ├── chat.js         # AI chat endpoint
│   │   ├── tracking.js     # Affiliate tracking
│   │   └── feedback.js     # User feedback
│   ├── services/
│   │   ├── claude.js       # Claude API integration
│   │   └── analytics.js    # Tracking analytics
│   ├── middleware/
│   │   ├── rateLimiter.js  # API rate limiting
│   │   └── cors.js         # CORS configuration
│   └── utils/
│       ├── logger.js       # Logging utility
│       └── errors.js       # Error handling
├── data/                   # Local data storage (for MVP)
│   ├── clicks.json         # Affiliate clicks
│   └── feedback.json       # User feedback
├── .env                    # Environment variables
├── .gitignore
├── package.json
└── README.md
```
