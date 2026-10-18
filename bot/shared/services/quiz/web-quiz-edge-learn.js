'use strict';
/**
 * The portal learns the page switches before its first page (app_settings web_quiz_edge_learn, default off, fail off).
 * Only the stored JSON boolean true turns it on: the string 'true', 1, {}, no row or a failed read are off.
 *
 * Each portal process remembers a few switches it learns from a quiz or hub payload (`fast`, `brand`, `rt`, `ui`,
 * `one_face`, `wait_ux`); after a deploy it knows none of them until its first page. GET /api/internal/wq/edge answers:
 *   off → { learn: false } and nothing else (the portal then stops asking: one ask per process);
 *   on  → { learn: true, fast, brand, rt[, ui], one_face, wait_ux, wait_share }: exactly those payload fields, read through the same
 *         cached switches the payloads use (no child, teacher or class data, no ids). `one_face` and `wait_ux` are always
 *         there as true or false, so the portal can tell "off" from a bot that does not say (absent: it keeps what it had).
 *         `wait_ux` and `wait_share` (wait_ux and web_quiz_hub_fanout both on) come from the same batched read as this
 *         switch (no read of its own).
 * The key rides the hub's one batched settings read (web-quiz-hub-flags.js KEYS, 30 s cache), never a read of its own.
 * carry(): the hub answer says `edge_learn: true` while on (from that read's cache, no read), so a portal process that
 * stopped asking (the switch was off) starts again after a flip on; off, the hub answer is untouched, byte for byte.
 */
const Flags = require('./web-quiz-hub-flags');

const KEY = Flags.EDGE_LEARN_KEY;
const FIELD = 'edge_learn';

/** The hub's batched switch read (cached 30 s); fail closed. Never throws. */
async function hubFlags() {
  try { return (await Flags.flags()) || {}; } catch (_) { return {}; }
}

/** The switch, waited for (the hub's batched read, cached 30 s). Never throws. */
async function flag() {
  return (await hubFlags()).edgeLearn === true;
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
  const f = await hubFlags();
  if (f.edgeLearn !== true) return { learn: false };
  // As the payloads read them: fast and one_face never wait (their cached value); rt, ui and the brand from their caches.
  const fast = require('./web-quiz-fast').on();
  const oneFace = require('./web-quiz-one-face').on();
  // web_quiz_edge_warm (web-quiz-edge-warm.js): `edge_warm: true` and the hub's switches touched, while on
  const [brand, rt, ui, warm] = await Promise.all([brandKey(), require('./web-quiz-telemetry').flag(), require('./web-quiz-ur-polish').ui(), require('./web-quiz-edge-warm').field()]);
  // wait_share: the frame's read share, on with wait_ux AND web_quiz_hub_fanout (as web-quiz-wait-ux.js carry()), same read.
  const waitUx = f.waitUx === true;
  // wait_hops: the bar while the page is left, on with wait_ux AND web_quiz_wait_hops (as web-quiz-wait-ux.js carry()), same read.
  // plain_paint (a guessed first paint says no words) is on only with the fast page; closed_lang (the closed pages in the
  // child's language): both from this same batched read, as the payloads say them (web-quiz-plain-paint.js, -closed-lang.js).
  // wait_home: the kept Home in the early frame, on with wait_ux AND web_quiz_wait_home (as carry()), same read.
  return { learn: true, fast, brand, rt: rt === true, ...(ui ? { ui } : {}), one_face: oneFace === true, wait_ux: waitUx, wait_share: waitUx && f.fanout === true, wait_hops: waitUx && f.hops === true, wait_home: waitUx && f.home === true, plain_paint: fast === true && f.plainPaint === true, closed_lang: f.closedLang === true, busy_page: f.busyPage === true, busy_retry: f.busyPage === true && f.busyRetry === true, ...warm };
}

/** The hub answer (or its promise) with `edge_learn: true` added while on; the same answer, untouched, while off. */
function carry(outP) {
  return Promise.resolve(outP).then((out) => {
    if (on() && out && typeof out === 'object' && !Array.isArray(out) && Array.isArray(out.kids)) out[FIELD] = true;
    return out;
  });
}

module.exports = { flag, on, answer, carry, KEY, FIELD, _reset: () => Flags._resetCache() };
