/**
 * Training bands + language client — the portal's route to two writes it cannot do itself.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * Not a refactor for tidiness. Saving your grades in Teacher Training answered **500** on
 * sandbox:
 *
 *   POST /training/bands
 *   Error: Cannot find module 'dotenv'
 *   Require stack:
 *     /app/bot/shared/config/supabase.js
 *     /app/bot/shared/services/training/band-selection.service.js
 *     /app/dashboard/routes/portal.routes.js
 *
 * It is NOT a missing dependency. `dashboard/package.json` declares `dotenv` and
 * `@supabase/supabase-js`, and both are installed. Node resolves from the REQUIRING FILE'S
 * directory, so a file under `/app/bot/` searches `/app/bot/node_modules` then
 * `/app/node_modules` — and never `/app/dashboard/node_modules`, where they actually are. The
 * portal service builds with `npm install` at the repo ROOT, whose package.json declares four
 * packages and not these; `bot/` is never installed on that service at all.
 *
 * `band-selection.service` already carried a `deps()` lazy require added for this very class of
 * problem. Lazy only moved the failure from module load to CALL time: the route stopped killing
 * the process at boot and started killing the request instead — so it looked fine until a
 * teacher pressed save.
 *
 * This is the same trap `certificates.service.js` documents in its own words — *"not a style
 * choice; module resolution forces it"* — and the same one the lesson-plan enqueue fell into,
 * where a swallowed require degraded silently for two days. HTTP to the bot is the answer that
 * already works here.
 *
 * WHAT THE PORTAL KEEPS
 * ---------------------
 * Only identity. Every function takes the `userId` the caller read from the SESSION
 * (`req.session.portalUserId`), never from a request body. No band rules, no cooldown
 * arithmetic, no language offer, no Supabase handle.
 *
 * FAILURE POLICY
 * --------------
 * A transport failure THROWS and the route turns it into a 5xx she can retry. A REFUSAL — the
 * 48-hour cooldown, an empty selection, a language this deployment does not serve — is not a
 * failure: it comes back as data, so the route can answer 429 or 400 with the bot's own message
 * rather than a generic error.
 */

const axios = require('axios');

const TIMEOUT_MS = 15_000;

function config() {
  return {
    baseUrl: (process.env.MAIN_BOT_URL || '').replace(/\/$/, ''),
    apiKey: process.env.INTERNAL_API_KEY || '',
  };
}

async function ask(path, body) {
  const { baseUrl, apiKey } = config();
  if (!baseUrl || !apiKey) {
    throw new Error('Training bands API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  }

  const res = await axios.post(`${baseUrl}/api/internal/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: TIMEOUT_MS,
    // 400 is a real answer for the language route ("we do not serve that one"), carrying the
    // offer so the caller can say what IS available. Everything else is a fault.
    validateStatus: (s) => (s >= 200 && s < 300) || s === 400,
  });

  const data = res && res.data;
  if (res.status === 400) return { rejected: true, ...(data || {}) };
  if (!data || data.success !== true) {
    throw new Error(`Training bands API returned failure for ${path}`);
  }
  return data;
}

/**
 * What she has chosen, and whether she may change it.
 *
 * Served from the bot even though it is mostly pure logic, so there is ONE path to bands rather
 * than a read the portal does itself and a write it delegates — two paths to one feature is how
 * the K-5 catalogue drifted.
 */
async function getBands(userId) {
  const data = await ask('training/bands/state', { userId });
  return {
    options: data.options || [],
    selected: data.selected || [],
    can_change: data.can_change,
    is_first_selection: data.is_first_selection,
    hours_remaining: data.hours_remaining,
    notice: data.notice ?? null,
  };
}

/**
 * Save her choice and reconcile her program assignments.
 *
 * Returns the service's own verdict untouched — `{ ok, reason, message, ... }` — because the
 * route maps `reason` onto a status code (cooldown → 429, user_not_found → 404, else 400) and
 * shows her `message`. Flattening it here would cost both.
 */
async function applyBands(userId, bands) {
  const data = await ask('training/bands/apply', { userId, bands });
  return data.result;
}

/**
 * Set her language THROUGH THE ONE WRITER.
 *
 * The tempting shortcut is a direct `users.preferred_language` update — the portal has a
 * Supabase client right there. That would be a second writer: it sets no lock and invalidates
 * neither Redis key, so the 24-hour cache keeps serving the old language and a later classroom
 * recording overwrites her choice. Going through the bot is what keeps `setUserLanguage` the
 * only writer.
 *
 * `{ rejected: true, offered: [...] }` when this deployment does not serve the language —
 * rejected rather than clamped, so she is told instead of silently given English.
 */
async function setLanguage(userId, language) {
  return ask('me/language', { userId, language });
}

module.exports = { getBands, applyBands, setLanguage };
