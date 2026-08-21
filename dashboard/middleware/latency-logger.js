/**
 * Latency Logging Middleware
 *
 * Tracks request duration and logs to console/Axiom.
 * Alerts on slow requests exceeding threshold.
 *
 * Issue: No visibility into request latency patterns
 * Solution: Log all request durations, alert on slow requests
 */

// Emit through the structured logger MODULE, not `global.logEvent`.
//
// This middleware used to guard both of its emits with `if (global.logEvent)`.
// Nothing in this repository ever assigns that global: the bot requires the
// logger as a module (`require('./shared/utils/structured-logger')`), which
// self-initialises its Axiom batcher on first require and exports `logEvent`.
// So the guard was never true, the portal shipped ZERO request telemetry, and
// Axiom held no `service == "portal"` rows at all — while the service carried
// AXIOM_DATASET + AXIOM_TOKEN and the middleware looked instrumented.
//
// The cost was a real one: a report of "training levels are not visible in the
// portal" could not be diagnosed, because no record of the teacher's request
// survived. The platform log buffer keeps only minutes of stdout.
//
// Resolved lazily and defensively. The dashboard and the bot are separate
// deploy units that do not always install the same dependency set — requiring
// bot code from the dashboard process has thrown before, and the throw was
// swallowed for two days. A logging middleware must never be the reason a
// request fails, so a resolution failure degrades to console-only.
let _logEvent = null;
let _logEventResolved = false;

function resolveLogEvent() {
  if (_logEventResolved) return _logEvent;
  _logEventResolved = true;
  try {
    // eslint-disable-next-line global-require
    const logger = require('../../bot/shared/utils/structured-logger');
    if (logger && typeof logger.logEvent === 'function') {
      _logEvent = logger.logEvent;
    }
  } catch (err) {
    // Console stays the floor — never let telemetry wiring break a response.
    process.stderr.write(
      `[latency-logger] structured logger unavailable, console only: ${err.message}\n`
    );
  }
  return _logEvent;
}

/** Emit a semantic event, tolerating an absent or throwing sink. */
function emit(event, data) {
  const fn = resolveLogEvent();
  if (!fn) return;
  try {
    fn(event, data);
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
