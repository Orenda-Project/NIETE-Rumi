'use strict';
/**
 * The portal learns the page switches before its first page (app_settings web_quiz_edge_learn, default off, fail off).
 * Only the stored JSON boolean true turns it on: the string 'true', 1, {}, no row or a failed read are off.
 *
 * Each portal process remembers a few switches it learns from a quiz or hub payload (`fast`, `brand`, `rt`, `ui`,
 * `one_face`); after a deploy it knows none of them until its first page. GET /api/internal/wq/edge answers:
 *   off → { learn: false } and nothing else (the portal then stops asking: one ask per process);
 *   on  → { learn: true, fast, brand, rt[, ui][, one_face] }: exactly those payload fields, read through the same cached
 *         switches the payloads use (no child, teacher or class data, no ids).
 * The key rides the hub's one batched settings read (web-quiz-hub-flags.js KEYS, 30 s cache), never a read of its own.
 * carry(): the hub answer says `edge_learn: true` while on (from that read's cache, no read), so a portal process that
 * stopped asking (the switch was off) starts again after a flip on; off, the hub answer is untouched, byte for byte.
 */
const Flags = require('./web-quiz-hub-flags');

const KEY = Flags.EDGE_LEARN_KEY;
const FIELD = 'edge_learn';

/** The switch, waited for (the hub's batched read, cached 30 s). Never throws. */
async function flag() {
  try { return (await Flags.flags()).edgeLearn === true; } catch (_) { return false; }
}

/** The switch, never waited for: the hub's cached value, off when there is none. Never throws. */
function on(now = Date.now()) {
  try { return Flags.edgeLearnNow(now); } catch (_) { return false; }
}

async function brandKey() {
  try {
    const supabase = require('../../config/supabase');
    const WebQuizBrand = require('../../config/web-quiz-brand');
    const { orgName, botName } = require('../../config/branding');
    return await WebQuizBrand.resolveBrandKey({ db: supabase, orgName, botName });
  } catch (_) {
    return null;
  }
}

/** The answer to GET /api/internal/wq/edge. */
async function answer() {
  if (!(await flag())) return { learn: false };
  // As the payloads read them: fast and one_face never wait (their cached value); rt, ui and the brand from their caches.
  const fast = require('./web-quiz-fast').on();
  const oneFace = require('./web-quiz-one-face').on();
  const [brand, rt, ui] = await Promise.all([brandKey(), require('./web-quiz-telemetry').flag(), require('./web-quiz-ur-polish').ui()]);
  return { learn: true, fast, brand, rt: rt === true, ...(ui ? { ui } : {}), ...(oneFace ? { one_face: true } : {}) };
}

/** The hub answer (or its promise) with `edge_learn: true` added while on; the same answer, untouched, while off. */
function carry(outP) {
  return Promise.resolve(outP).then((out) => {
    if (on() && out && typeof out === 'object' && !Array.isArray(out) && Array.isArray(out.kids)) out[FIELD] = true;
    return out;
  });
}

module.exports = { flag, on, answer, carry, KEY, FIELD, _reset: () => Flags._resetCache() };
