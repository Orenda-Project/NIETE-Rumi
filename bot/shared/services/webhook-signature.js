'use strict';
/**
 * Meta's request signature on every inbound webhook and Flow endpoint request.
 *
 * Meta signs each POST it sends with
 *   X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the RAW request body, keyed with the App Secret>
 * where the App Secret is that of the Meta app subscribed to this number's WABA (for a Flow endpoint,
 * the app connected to the Flow — the same app here). Without this check anyone who knows the URL can
 * POST a message "from" any phone number and the bot treats it as that teacher's.
 *
 * Three modes, one switch:
 *   off      no check at all
 *   log      check, log the verdict, process the request anyway        ← the default
 *   enforce  refuse a missing or invalid signature before any handler runs
 *            (/webhook → 401; the Flow endpoint → 432, Meta's documented code for a failed signature)
 *
 * The mode comes from the app_settings row `webhook_signature_mode` when it holds one of the three
 * words (so it can be flipped, or rolled back, without a deploy), else WHATSAPP_WEBHOOK_SIGNATURE_MODE,
 * else `log`. An unknown word is ignored, never read as `off`. The app_settings read never holds a
 * request up: a request uses the last value read (or the env) and a stale cache refreshes behind it.
 *
 * The secret is WHATSAPP_APP_SECRET. Without it, `log` processes everything and says
 * `webhook.signature_secret_missing` once per process; `enforce` refuses everything (a check that
 * cannot run is not waved through), which the app_settings switch can roll back to `log` in seconds.
 *
 * Log events (names only, never a secret or a signature):
 *   webhook.signature_config          { mode, secret: set|missing }            once, at boot (the env's mode)
 *   webhook.signature_mode_override   { mode, envMode }                       at boot, when app_settings differs
 *   webhook.signature_valid           { route, mode }                         log mode only
 *   webhook.signature_missing         { route, mode }
 *   webhook.signature_invalid         { route, mode, reason }  reason: mismatch | malformed | no_body | secret_missing
 *   webhook.signature_secret_missing  { mode }                                once per process
 *
 * The raw bytes come from express.json's `verify` hook (captureRawBody), so req.body is parsed
 * exactly as before and every handler reads it unchanged.
 */
const crypto = require('crypto');
const { logToFile } = require('../utils/logger');
const { cachedSwitch } = require('./settings/switch-cache');

// The app_settings TTL every switch reader uses: 30 s, or APP_SETTINGS_FLAG_TTL_MS (a whole number of ms up to an hour)
// for a test lane. Read here rather than from a shared config module so this check carries no dependency a branch
// that receives it as a cherry-pick might not have.
const SETTINGS_TTL_MS = (() => {
  const raw = String(process.env.APP_SETTINGS_FLAG_TTL_MS || '').trim();
  const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 3600000 ? n : 30 * 1000;
})();

const MODES = Object.freeze(['off', 'log', 'enforce']);
const DEFAULT_MODE = 'log';
const SETTINGS_KEY = 'webhook_signature_mode';
const HEADER = 'x-hub-signature-256';
const SIG_RE = /^sha256=([0-9a-f]{64})$/i;

/** One of MODES, or null for anything else (absent, junk, a typo). */
function parseMode(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* a bare word */ }
  }
  if (typeof v !== 'string') return null;
  const m = v.trim().toLowerCase();
  return MODES.includes(m) ? m : null;
}

const envMode = () => parseMode(process.env.WHATSAPP_WEBHOOK_SIGNATURE_MODE) || DEFAULT_MODE;
const appSecret = () => String(process.env.WHATSAPP_APP_SECRET || '').trim();

let settingsMode = null; // the last app_settings value read (null: no row, junk, or never read)
const settingsSwitch = cachedSwitch({
  ttlMs: SETTINGS_TTL_MS,
  off: null,
  read: async () => {
    const supabase = require('../config/supabase');
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    settingsMode = parseMode(data && data.value);
    return settingsMode;
  },
  log: (err) => logToFile('webhook.signature_mode_read_failed', { error: err && err.message }, 'warn'),
});

/** The mode for this request. Never waits: a stale settings read refreshes in the background. */
function currentMode() {
  if (!settingsSwitch.fresh()) settingsSwitch.get().catch(() => {});
  return settingsMode || envMode();
}

/** Read the app_settings switch now (boot, and tests). Resolves to the mode in force. Never throws. */
async function primeSignatureMode() {
  try { await settingsSwitch.get(); } catch (_) { /* the env decides */ }
  return settingsMode || envMode();
}

let secretMissingSaid = false;
function saySecretMissingOnce(mode) {
  if (secretMissingSaid) return;
  secretMissingSaid = true;
  logToFile('webhook.signature_secret_missing', { mode, secret: 'WHATSAPP_APP_SECRET' }, 'warn');
}

/** express.json({ verify }) hook: keep the exact bytes Meta signed. */
function captureRawBody(req, _res, buf) {
  req.rawBody = buf;
}

/**
 * The verdict for one request. Pure.
 *   { ok: true }  |  { ok: false, reason: 'missing' | 'malformed' | 'mismatch' | 'no_body' | 'secret_missing' }
 * Constant-time on the digest: both sides are 32 bytes before timingSafeEqual sees them.
 */
function checkSignature({ rawBody, header, secret }) {
  if (!secret) return { ok: false, reason: 'secret_missing' };
  if (header === undefined || header === null || String(header).trim() === '') return { ok: false, reason: 'missing' };
  const m = SIG_RE.exec(String(header).trim());
  if (!m) return { ok: false, reason: 'malformed' };
  if (!Buffer.isBuffer(rawBody)) return { ok: false, reason: 'no_body' };
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(m[1], 'hex');
  return crypto.timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/**
 * Express middleware for one Meta-signed route. POST only (Meta's GET subscribe handshake is not signed).
 * `route` names the surface in the logs; `rejectStatus` is what enforce answers with.
 */
function requireMetaSignature({ route, rejectStatus = 401 }) {
  return function metaSignature(req, res, next) {
    if (req.method !== 'POST') return next();
    const mode = currentMode();
    if (mode === 'off') return next();

    const secret = appSecret();
    if (!secret && mode === 'log') {
      saySecretMissingOnce(mode);
      return next();
    }
    const verdict = checkSignature({ rawBody: req.rawBody, header: req.get(HEADER), secret });
    if (verdict.ok) {
      if (mode === 'log') logToFile('webhook.signature_valid', { route, mode });
      return next();
    }
    if (verdict.reason === 'missing') logToFile('webhook.signature_missing', { route, mode }, 'warn');
    else logToFile('webhook.signature_invalid', { route, mode, reason: verdict.reason }, 'warn');
    if (verdict.reason === 'secret_missing') saySecretMissingOnce(mode);

    if (mode === 'enforce') return res.status(rejectStatus).send('invalid signature');
    return next();
  };
}

/** The boot line: the mode this process starts in and whether it has a secret. Never throws. */
function logSignatureConfig() {
  try {
    const mode = envMode();
    const secret = appSecret() ? 'set' : 'missing';
    logToFile('webhook.signature_config', { mode, secret, settingsKey: SETTINGS_KEY });
    if (secret === 'missing' && mode !== 'off') saySecretMissingOnce(mode);
    primeSignatureMode().then((now) => {
      if (now !== mode) logToFile('webhook.signature_mode_override', { mode: now, envMode: mode, settingsKey: SETTINGS_KEY });
    }).catch(() => {});
  } catch (_) { /* a log line must not stop the bot starting */ }
}

module.exports = {
  captureRawBody,
  checkSignature,
  requireMetaSignature,
  logSignatureConfig,
  primeSignatureMode,
  parseMode,
  MODES,
  SETTINGS_KEY,
};
