# OWASP Top 10 Security Audit Report

**Project:** Viaggio.ai Backend
**Date:** 2025-12-18
**Auditor:** Claude Security Review

---

## Executive Summary

This security audit analyzes the Viaggio.ai backend against the OWASP Top 10 (2021) vulnerabilities. The application is an Express.js travel assistant API that integrates with Claude AI, Viator, HotelBeds, Google Vision, and Gemini APIs.

### Risk Summary

| Category | Risk Level | Issues Found |
|----------|------------|--------------|
| A01: Broken Access Control | **HIGH** | 4 |
| A02: Cryptographic Failures | LOW | 0 |
| A03: Injection | MEDIUM | 2 |
| A04: Insecure Design | **HIGH** | 3 |
| A05: Security Misconfiguration | **HIGH** | 5 |
| A06: Vulnerable Components | LOW | 1 |
| A07: Authentication Failures | **CRITICAL** | 3 |
| A08: Integrity Failures | LOW | 2 |
| A09: Logging Failures | MEDIUM | 3 |
| A10: SSRF | LOW | 1 |

---

## Detailed Findings

### A01:2021 - Broken Access Control (HIGH)

#### Finding 1.1: Statistics Endpoints Unprotected
**Severity:** HIGH
**Location:** `src/routes/feedback.js:76`, `src/routes/tracking.js:84`

The `/api/feedback/stats` and `/api/tracking/stats` endpoints expose analytics data without authentication. Comments acknowledge this: "protected - add auth in production!"

```javascript
// src/routes/feedback.js:76
router.get('/stats', async (req, res, next) => {
  // No authentication check
  const stats = await getFeedbackStats();
  // ...
});
```

**Recommendation:** Add authentication middleware before these routes.

#### Finding 1.2: Debug Endpoint Exposed
**Severity:** MEDIUM
**Location:** `src/routes/tours.js:211`

The debug endpoint `/api/tours/debug/destinations` is accessible in production, potentially exposing internal API structure.

**Recommendation:** Remove or protect debug endpoints in production using environment checks.

#### Finding 1.3: No Authorization Framework
**Severity:** HIGH
**Location:** Application-wide

No role-based access control (RBAC) or authorization framework exists. Any client can access any endpoint.

**Recommendation:** Implement an authorization layer for sensitive operations.

#### Finding 1.4: Agent Chat Route Bypasses Global CORS
**Severity:** LOW
**Location:** `src/routes/agent/chat-agent.js:36`

The agent routes implement their own CORS middleware, potentially with different rules than the global config.

**Recommendation:** Use consistent CORS configuration across all routes.

---

### A02:2021 - Cryptographic Failures (LOW)

#### Positive Findings:
- API keys stored in environment variables (good practice)
- HotelBeds uses SHA-256 for signature generation (`src/services/affiliates/hotelbeds.js:176`)
- No sensitive data stored in plaintext

**No significant cryptographic vulnerabilities identified.**

---

### A03:2021 - Injection (MEDIUM)

#### Finding 3.1: Log Injection Vulnerability
**Severity:** MEDIUM
**Location:** Multiple files

User-controlled input is logged directly without sanitization, potentially allowing log injection attacks.

```javascript
// src/routes/identify.js:51
logger.info(`Processing image (${Math.round(imageSizeBytes / 1024)}KB)`);

// src/routes/tours.js:98
logger.info(`Tour search: dest="${destination}", terms="${searchTerms}"...`);
```

**Recommendation:** Sanitize user input before logging to prevent log forging/injection.

#### Finding 3.2: No Input Sanitization on Feedback Comments
**Severity:** LOW
**Location:** `src/routes/feedback.js:47`

User comments are stored without sanitization:
```javascript
comment: comment || '',
```

**Recommendation:** Sanitize or validate comment content before storage.

---

### A04:2021 - Insecure Design (HIGH)

#### Finding 4.1: Chat Rate Limiter Not Applied
**Severity:** HIGH
**Location:** `src/middleware/rateLimiter.js`, `src/server.js`

A `chatRateLimiter` is defined but never applied to the agent chat endpoint, which is the most expensive operation (Claude API calls).

```javascript
// Defined but never used:
export const chatRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many chat requests, please slow down.',
});
```

**Recommendation:** Apply `chatRateLimiter` to `/api/agent/chat`.

#### Finding 4.2: Large Request Body Limit
**Severity:** MEDIUM
**Location:** `src/server.js:53`

```javascript
app.use(express.json({ limit: '50mb'}));
```

A 50MB body limit is excessive and could be abused for denial-of-service attacks.

**Recommendation:** Reduce to a reasonable limit (e.g., 5-10MB) and use separate limits for image upload endpoints.

#### Finding 4.3: No Request Timeout on External API Calls
**Severity:** MEDIUM
**Location:** `src/services/affiliates/viator.js`, `src/services/affiliates/hotelbeds.js`

External API calls don't have explicit timeouts, which could hang requests indefinitely.

**Recommendation:** Add timeout parameters to all `fetch()` calls using `AbortController`.

---

### A05:2021 - Security Misconfiguration (HIGH)

#### Finding 5.1: CORS Allows Null Origin
**Severity:** HIGH
**Location:** `src/middleware/cors.js:22`

```javascript
if (!origin) return callback(null, true);
```

Allowing requests without an origin enables cross-site request forgery from file:// URLs or some proxies.

**Recommendation:** Remove this bypass or implement proper CSRF protection.

#### Finding 5.2: Development URLs in Production CORS
**Severity:** MEDIUM
**Location:** `src/middleware/cors.js:18-19`

Localhost URLs are hardcoded in the CORS config:
```javascript
'http://localhost:5173',
'http://localhost:3000'
```

**Recommendation:** Use environment variables to control allowed origins based on deployment.

#### Finding 5.3: Environment Exposed in Health Check
**Severity:** LOW
**Location:** `src/server.js:88`

```javascript
res.json({
  environment: process.env.NODE_ENV
});
```

**Recommendation:** Remove environment information from health check responses.

#### Finding 5.4: API Service Configuration Exposed
**Severity:** LOW
**Location:** `src/routes/identify.js:92-100`

The health endpoint reveals which services are configured:
```javascript
services: {
  googleVision: process.env.GOOGLE_VISION_API_KEY ? 'configured' : 'not configured',
  // ...
}
```

**Recommendation:** Remove service configuration details from public endpoints.

#### Finding 5.5: Sandbox API URLs in Production Code
**Severity:** LOW
**Location:** `src/services/affiliates/hotelbeds.js:17-18`

```javascript
const BOOKING_API_BASE = 'https://api.test.hotelbeds.com/hotel-api/1.0';  // Sandbox
```

**Recommendation:** Use environment variables for API base URLs.

---

### A06:2021 - Vulnerable and Outdated Components (LOW)

#### Finding 6.1: No Lock File Present
**Severity:** LOW
**Location:** Project root

No `package-lock.json` exists, making dependency versions unpredictable.

**Recommendation:**
1. Generate and commit `package-lock.json`
2. Run `npm audit` regularly
3. Consider using Dependabot or Snyk for automated vulnerability scanning

---

### A07:2021 - Identification and Authentication Failures (CRITICAL)

#### Finding 7.1: No Authentication System
**Severity:** CRITICAL
**Location:** Application-wide

The entire API has no authentication mechanism. Any client can access all endpoints.

**Recommendation:** Implement authentication (JWT, API keys, OAuth2) for protected endpoints.

#### Finding 7.2: Anonymous User Sessions
**Severity:** HIGH
**Location:** `src/routes/feedback.js:48`, `src/routes/tracking.js:55`

```javascript
sessionId: sessionId || 'anonymous',
```

Users can submit data anonymously without any identity verification.

**Recommendation:** Implement session management or require authentication for data submission.

#### Finding 7.3: No Rate Limiting on AI Chat
**Severity:** HIGH
**Location:** `src/routes/agent/chat-agent.js`

The most expensive endpoint (Claude API calls) has no rate limiting, enabling:
- Financial abuse (high API costs)
- Denial of service

**Recommendation:** Apply the defined `chatRateLimiter` middleware.

---

### A08:2021 - Software and Data Integrity Failures (LOW)

#### Finding 8.1: External API Data Not Validated
**Severity:** LOW
**Location:** `src/services/affiliates/viator.js`, `src/services/affiliates/hotelbeds.js`

Data from external APIs (Viator, HotelBeds) is used without schema validation.

**Recommendation:** Implement JSON schema validation for external API responses.

#### Finding 8.2: Non-Atomic File Operations
**Severity:** LOW
**Location:** `src/services/analytics.js:64-67`

```javascript
async function writeData(filepath, data) {
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
}
```

File writes are not atomic, risking data corruption during concurrent access.

**Recommendation:** Use atomic file operations (write to temp file, then rename).

---

### A09:2021 - Security Logging and Monitoring Failures (MEDIUM)

#### Finding 9.1: Basic Logging Only
**Severity:** MEDIUM
**Location:** `src/utils/logger.js`

Simple console-based logging without:
- Log levels filtering
- Log rotation
- Centralized logging
- Structured security events

**Recommendation:** Implement a production logging solution (Winston, Pino) with log aggregation.

#### Finding 9.2: No Security Event Logging
**Severity:** MEDIUM
**Location:** Application-wide

No logging of:
- Failed authentication attempts (N/A currently)
- Rate limit hits
- Suspicious activity patterns
- Error anomalies

**Recommendation:** Add security event logging for monitoring and alerting.

#### Finding 9.3: Stack Traces in Development
**Severity:** LOW
**Location:** `src/utils/errors.js:39`

```javascript
message: process.env.NODE_ENV === 'development' ? err.message : undefined
```

While appropriately hidden in production, ensure `NODE_ENV` is always set correctly.

**Recommendation:** Verify deployment scripts set `NODE_ENV=production`.

---

### A10:2021 - Server-Side Request Forgery (SSRF) (LOW)

#### Finding 10.1: Potential URL-Based Image Analysis
**Severity:** LOW
**Location:** `src/routes/agent/agent-tools.js:162-166`

The `identify_location` tool schema accepts `image_url` parameter:
```javascript
image_url: {
  type: 'string',
  description: 'URL of the image to analyze'
}
```

If implemented, this could enable SSRF attacks against internal services.

**Recommendation:**
1. Validate and sanitize any URL inputs
2. Use allowlists for URL schemes and hosts
3. Prevent access to internal network addresses (127.0.0.1, 10.x.x.x, etc.)

---

## Recommendations Summary

### Critical Priority (Fix Immediately)
1. Implement authentication for all sensitive endpoints
2. Apply rate limiting to the AI chat endpoint
3. Fix CORS null origin bypass

### High Priority (Fix Soon)
1. Protect statistics endpoints with authentication
2. Remove/protect debug endpoints
3. Reduce request body size limit

### Medium Priority (Fix in Next Sprint)
1. Implement proper logging infrastructure
2. Sanitize user input before logging
3. Add timeouts to external API calls

### Low Priority (Technical Debt)
1. Generate and maintain package-lock.json
2. Use environment variables for API URLs
3. Remove environment info from health checks
4. Implement atomic file writes

---

## Compliance Notes

This application handles:
- User feedback and ratings
- Travel search data
- Session identifiers (anonymous allowed)

For GDPR/CCPA compliance, consider:
- Data retention policies for analytics files
- User consent for data collection
- Right to erasure implementation

---

*Report generated by automated security review. Manual penetration testing recommended before production deployment.*
