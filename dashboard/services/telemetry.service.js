/**
 * Telemetry sink for the dashboard / portal process.
 *
 * WHY THIS IS NOT THE BOT'S LOGGER
 * --------------------------------
 * The bot has a perfectly good structured logger with an Axiom batcher in it,
 * and the obvious move is to require that. It does not work: the bot's logger
 * needs `pino`, which lives in the bot's dependency set. The portal service
 * installs `dashboard/package.json` only, so the require fails at runtime with
 * `Cannot find module 'pino'` — in a process that otherwise looks healthy.
 *
 * That exact failure already shipped once. The middleware was changed to call
 * the bot's logger, the unit test passed (it mocked the logger), the deploy
 * succeeded, and staging still emitted nothing but a stderr line saying the
 * logger was unavailable. Requiring across the two deploy units is a mistake
 * this codebase has now made twice.
 *
 * So this module depends on NOTHING but Node built-ins. It is a deliberately
 * small copy of the one behaviour the dashboard needs — batch events, POST
 * ndjson to Axiom — rather than a shared abstraction across two services that
 * do not share a node_modules.
 *
 * EVERY FAILURE IS SILENT BY DESIGN
 * ---------------------------------
 * This is instrumentation. It must never be the reason a teacher's request
 * fails, so an unconfigured dataset, a dead socket, a non-200 from Axiom and a
 * throwing transport all degrade to "console only" and nothing else. Console
 * logging stays the floor and is handled by the caller.
 */

const https = require('https');

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 10_000;

let buffer = [];
let flushTimer = null;

/** Read config at call time, not at require time, so tests can set env freely. */
function config() {
  return {
    dataset: process.env.AXIOM_DATASET,
    token: process.env.AXIOM_TOKEN,
    // Matches the bot's tagging so both services are queryable the same way.
    service: process.env.RAILWAY_SERVICE_NAME || process.env.SERVICE_NAME || 'dashboard',
    region: process.env.REGION || undefined,
    env: process.env.NODE_ENV || undefined,
  };
}

function enabled() {
  const { dataset, token } = config();
  return Boolean(dataset && token);
}

function ensureTimer() {
  if (flushTimer || !enabled()) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  // Never hold the process open for telemetry.
  if (flushTimer.unref) flushTimer.unref();
}

/**
 * Queue one semantic event. Same signature as the bot's `logEvent(event, data)`
 * so call sites read identically across the two services.
 */
function logEvent(event, data = {}) {
  if (!enabled()) return;
  try {
    const { service, region, env } = config();
    buffer.push({
      _time: new Date().toISOString(),
      event,
      service,
      ...(region ? { region } : {}),
      ...(env ? { env } : {}),
      ...data,
    });
    if (buffer.length >= BATCH_SIZE) flush();
    else ensureTimer();
  } catch {
    // A malformed payload must not reach the caller.
    buffer = [];
  }
}

/** Ship whatever is queued. Safe to call when empty or unconfigured. */
function flush() {
  if (!enabled() || buffer.length === 0) return;

  const batch = buffer.splice(0, buffer.length);
  const ndjson = batch.map(o => JSON.stringify(o)).join('\n');
  const { dataset, token } = config();

  try {
    const req = https.request({
      hostname: 'api.axiom.co',
      port: 443,
      path: `/v1/datasets/${dataset}/ingest`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-ndjson',
        'Content-Length': Buffer.byteLength(ndjson),
      },
    }, (res) => {
      // Drain so the socket is released; report only a hard failure.
      res.on('data', () => {});
      res.on('end', () => {
        if (res.statusCode !== 200) {
          process.stderr.write(`[telemetry] Axiom ingest returned ${res.statusCode}\n`);
        }
      });
    });

    req.on('error', (err) => {
      process.stderr.write(`[telemetry] Axiom ingest failed: ${err.message}\n`);
    });
    if (req.setTimeout) {
      req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy());
    }

    req.write(ndjson);
    req.end();
  } catch (err) {
    // Dropped telemetry is acceptable; a thrown request is not.
    process.stderr.write(`[telemetry] Axiom transport error: ${err.message}\n`);
  }
}

// Best-effort delivery of anything still queued at shutdown.
process.on('beforeExit', flush);
process.on('SIGTERM', flush);
process.on('SIGINT', flush);

module.exports = { logEvent, flush, isEnabled: enabled };
