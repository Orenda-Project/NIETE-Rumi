/**
 * bd-2z5fuc (queue #305, P0 26 Nov) — JSON body limits for internal (portal → bot) routes that carry more than 100kb.
 *
 * The bot parses every JSON body with ONE app-level express.json(), at body-parser's default 100kb limit. That stays
 * the limit for everything else: the Meta webhook, the Flow endpoint, every other route, and any caller without the
 * internal key.
 *
 * The portal's coaching report page (GET /api/portal/coaching-session/:id) posts the session's WHOLE analysis_data to
 * POST /api/internal/coaching/breakdown. On 26 Nov analysis_data grew (shadow + v3_fico; p50 body 52 KB → 75 KB) and
 * one session's body was 105,504 bytes: the bot answered 413 PayloadTooLargeError, the portal answered 500, and the
 * teacher's report page would not open. A route listed here gets its own parser, mounted BEFORE the global one; once
 * it has parsed the body the global parser passes it by (body-parser marks req._body), so the body is read once.
 *
 * Only a caller presenting the internal key gets the larger limit; any other request falls through to the global
 * 100kb parser, so the larger limit is never offered to the open internet. The route's own requireInternalKey still
 * runs after the parse, exactly as before.
 */
const crypto = require('crypto');
const express = require('express');

/** path → limit (body-parser's notation). Bounded: a new entry needs a measured reason, never "unlimited". */
const INTERNAL_JSON_LIMITS = Object.freeze({
  // A whole coaching analysis_data: 105.5 KB on 26 Nov, rising; 1mb is ~10x the largest seen.
  '/api/internal/coaching/breakdown': '1mb',
});

/** The internal key, compared in constant time. False when the bot has no key set. */
function hasInternalKey(req) {
  const expected = process.env.INTERNAL_API_KEY;
  const given = req.headers['x-api-key'];
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Mount each route's own JSON parser on `app`. Call BEFORE the app's global express.json().
 * @param {import('express').Express} app
 * @param {{verify?: Function}} [opts] the same `verify` hook the global parser uses (it keeps req.rawBody).
 */
function mountInternalJsonLimits(app, { verify } = {}) {
  for (const [route, limit] of Object.entries(INTERNAL_JSON_LIMITS)) {
    const parse = express.json({ limit, ...(verify ? { verify } : {}) });
    app.post(route, (req, res, next) => (hasInternalKey(req) ? parse(req, res, next) : next()));
  }
}

module.exports = { INTERNAL_JSON_LIMITS, mountInternalJsonLimits };
