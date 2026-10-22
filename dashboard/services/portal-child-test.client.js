/**
 * Portal child-test client (bd-s1oo0.7) — the portal's only route to the coach
 * app's child test. Mirrors portal-coaching.client.js, for the same reason: the
 * draw, store and scoring code needs bot/ dependencies that do not resolve on
 * the portal service, so every call goes to the bot over the internal API
 * (bot/shared/routes/child-test-app.routes.js).
 *
 * IDENTITY STAYS HERE. Callers pass the userId read from the SESSION; the bot
 * checks every visit and session against it.
 *
 * FAILURE POLICY. A 4xx from the bot is an ANSWER (not yours, not scored yet,
 * already checked…) and comes back as { httpStatus, body }. Unconfigured,
 * unreachable or a 5xx THROWS, so the route answers 502 and a failed save can
 * never read as saved.
 */

const axios = require('axios');

const TIMEOUT_MS = 20_000;

async function call(path, body) {
  const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
  const apiKey = process.env.INTERNAL_API_KEY || '';
  if (!baseUrl || !apiKey) {
    throw new Error('portal child-test API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  }
  const res = await axios.post(`${baseUrl}/api/internal/child-test/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: TIMEOUT_MS,
    validateStatus: (s) => s >= 200 && s < 500,
  });
  return { httpStatus: res.status, body: res.data || {} };
}

module.exports = { call };
