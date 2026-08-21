/**
 * Latency Logging Middleware
 *
 * Tracks request duration and logs to console/Axiom.
 * Alerts on slow requests exceeding threshold.
 *
 * Issue: No visibility into request latency patterns
 * Solution: Log all request durations, alert on slow requests
 */

// Emit through the dashboard's OWN telemetry sink.
//
// This middleware used to guard both of its emits with `if (global.logEvent)`.
// Nothing in this repository ever assigns that global, so both branches were
// dead: the service carried AXIOM_DATASET + AXIOM_TOKEN, looked instrumented,
// and shipped nothing. Axiom held no rows for this service at all.
//
// The first attempt at a fix required the BOT's structured logger. That fails
// in this process: the bot's logger needs `pino`, which is in the bot's
// dependency set, not the dashboard's. It failed silently in exactly the way
// the original bug did — deploy green, telemetry still absent — so the sink is
// now local and depends only on Node built-ins. Do not reintroduce a
// cross-service require here.
//
// The cost of the blind spot was real: a report of "training levels are not
// visible in the portal" could not be diagnosed, because no record of the
// teacher's request survived. The platform log buffer keeps only minutes.
const telemetry = require('../services/telemetry.service');

/** Emit a semantic event. Instrumentation must never break a response. */
function emit(event, data) {
  try {
    telemetry.logEvent(event, data);
  } catch (err) {
    process.stderr.write(`[latency-logger] emit failed for ${event}: ${err.message}\n`);
  }
}

// Threshold for "slow" request alerts (milliseconds)
const SLOW_REQUEST_THRESHOLD = 5000; // 5 seconds

// Routes to exclude from logging (too noisy)
const EXCLUDED_ROUTES = [
  '/health',
  '/favicon.ico'
];

// Static file extensions to log at reduced verbosity
const STATIC_EXTENSIONS = ['.css', '.js', '.png', '.jpg', '.svg', '.ico', '.woff', '.woff2'];

/**
 * Determine if a path is a static file
 * @param {string} path - Request path
 * @returns {boolean}
 */
function isStaticFile(path) {
  return STATIC_EXTENSIONS.some(ext => path.endsWith(ext)) ||
         path.startsWith('/assets/') ||
         path.startsWith('/css/') ||
         path.startsWith('/js/') ||
         path.startsWith('/images/');
}

/**
 * Create latency logging middleware
 * @param {Object} options - Configuration options
 * @param {number} options.slowThreshold - Threshold for slow request alerts (ms)
 * @param {boolean} options.logStaticFiles - Whether to log static file requests
 * @returns {Function} Express middleware
 */
function createLatencyLogger(options = {}) {
  const config = {
    slowThreshold: options.slowThreshold || SLOW_REQUEST_THRESHOLD,
    logStaticFiles: options.logStaticFiles !== false // Default true
  };

  return function latencyLogger(req, res, next) {
    // Skip excluded routes
    if (EXCLUDED_ROUTES.includes(req.path)) {
      return next();
    }

    const startTime = Date.now();
    const startHrTime = process.hrtime();

    // Capture response finish
    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const [seconds, nanoseconds] = process.hrtime(startHrTime);
      const preciseMs = (seconds * 1000 + nanoseconds / 1000000).toFixed(2);

      const isStatic = isStaticFile(req.path);

      // Skip static file logging if disabled
      if (isStatic && !config.logStaticFiles) {
        return;
      }

      // Build log data
      const logData = {
        event: 'http.request.completed',
        path: req.path,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: parseFloat(preciseMs),
        userAgent: req.get('User-Agent'),
        isStatic,
        timestamp: new Date().toISOString()
      };

      // Log to console (brief format for static, full for API)
      if (isStatic) {
        // Only log slow static files
        if (durationMs > 1000) {
          console.log(`[LATENCY] ${req.method} ${req.path} - ${preciseMs}ms (slow static)`);
        }
      } else {
        console.log(`[LATENCY] ${req.method} ${req.path} - ${preciseMs}ms - ${res.statusCode}`);
      }

      // Ship the request record to the structured logger (Axiom).
      emit('http.request.completed', logData);

      // Alert on slow requests
      if (durationMs > config.slowThreshold) {
        console.warn(`[SLOW REQUEST] ${req.method} ${req.path} took ${preciseMs}ms (threshold: ${config.slowThreshold}ms)`);

        const slowLogData = {
          event: 'http.request.slow',
          path: req.path,
          method: req.method,
          statusCode: res.statusCode,
          durationMs: parseFloat(preciseMs),
          threshold: config.slowThreshold,
          userAgent: req.get('User-Agent'),
          timestamp: new Date().toISOString()
        };

        emit('http.request.slow', slowLogData);
      }
    });

    next();
  };
}

/**
 * Simple latency logger middleware with default settings
 */
const latencyLogger = createLatencyLogger();

module.exports = {
  latencyLogger,
  createLatencyLogger,
  SLOW_REQUEST_THRESHOLD
};
