'use strict';
/**
 * Faster child screens and a designed wait (app_settings web_quiz_wait_ux, default off, fail off, 30 s cache).
 *
 * On:
 *   - the Games door reads what it needs side by side instead of one after another, and waits at most SAY_WAIT_MS for
 *     the rows' spoken labels (a label not ready in time is said another way, and is ready on the next open);
 *   - the hub answer carries `wait_ux: true`, so the page draws a thin progress bar for a wait over 400 ms and Jugnu's
 *     waiting moment for one over 1.5 s (dashboard/public/wq/wq-wait.js).
 * Off: the key is absent and the doors read in today's order, so every answer is today's, byte for byte.
 * (Where an answer's time went is the timing switch's job, not this one's: this switch writes no header.)
 * Only the stored JSON boolean true turns it on: the string 'true', '"true"', 1, {enabled:true}, no row or a failed read
 * are all off.
 *
 * on() never waits and never reads: it answers from the cache the hub's own switch read keeps warm
 * (web-quiz-hub-flags.js, one batched app_settings read, 30 s cache), so the switch adds no database read of its own.
 * An empty or expired cache is off (the bar and the doors are hub-only, so the hub's read has always just run).
 */
const Flags = require('./web-quiz-hub-flags');

const KEY = Flags.WAIT_UX_KEY;
const FIELD = 'wait_ux';
const SHARE_FIELD = 'wait_share';
const PREFETCH_FIELD = 'wait_pre';
const TTL_MS = 30 * 1000;
const SAY_WAIT_MS = 150;

/** The switch, waited for (tests): the hub's switch read, fresh. */
async function refresh() {
  return Boolean((await Flags.flags()).waitUx);
}

/** The switch, never waited for: the hub's cached value, off when there is none. Never throws. */
function on(now = Date.now()) {
  try { return Flags.waitUxNow(now); } catch (_) { return false; }
}

/**
 * The hub answer (or its promise) with the page's field added while on; the same answer, untouched, while off. With
 * web_quiz_hub_fanout on as well, `wait_share: true` too: the page's same child data read asked twice while the first
 * is out then rides the first (dashboard/routes/web-quiz-wait-ux.js). Fanout off: today's answer, `wait_ux` alone.
 * With web_quiz_doors_prefetch on as well, `wait_pre: true`: the page asks the Videos door's lists once the home has
 * painted (dashboard wq-doors.js warm), so a Videos tap paints whole.
 * web_quiz_wait_hops on as well (web-quiz-wait-hops.js, the same batched read, never waited for), `wait_hops: true` too:
 * the bar also shows while the page is being left.
 */
function carry(outP) {
  return Promise.resolve(outP).then((out) => {
    if (on() && out && typeof out === 'object' && !Array.isArray(out)) {
      out[FIELD] = true;
      try { if (Flags.fanoutNow()) out[SHARE_FIELD] = true; } catch (_) { /* fanout unknown: no share */ }
      try { if (Flags.prefetchNow()) out[PREFETCH_FIELD] = true; } catch (_) { /* prefetch unknown: none */ }
      try { const Hops = require('./web-quiz-wait-hops'); if (Hops.on()) out[Hops.FIELD] = true; } catch (_) { /* hops unknown: none */ }
    }
    return out;
  });
}

module.exports = { on, carry, refresh, KEY, FIELD, SHARE_FIELD, PREFETCH_FIELD, SAY_WAIT_MS, TTL_MS, _resetCache: () => Flags._resetCache() };
