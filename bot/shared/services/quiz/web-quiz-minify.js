'use strict';
/**
 * Minified page files (app_settings web_quiz_minify, default off, fail off).
 *
 * On: the quiz and hub payloads say `min: true`, and the edge links the child pages' JS/CSS at `?v=<hex>m`: their
 * minified copies (made once at the edge's start-up), at their own immutable URLs. Off: today's payloads, so the
 * pages link today's raw files again (a real rollback: a raw copy and a minified copy never share a URL).
 *
 * The switch rides the hub's one batched settings read (web-quiz-hub-flags.js, 30 s cache): on() never waits and never
 * reads, so it adds no database round trip of its own. A cold or expired cache is off.
 */
const Flags = require('./web-quiz-hub-flags');

const KEY = Flags.MINIFY_KEY;

/** The switch, never waited for: the hub's cached value, off when there is none. Never throws. */
function on(now = Date.now()) {
  try { return Flags.minifyNow(now); } catch (_) { return false; }
}

/** The switch, waited for (tests): the hub's switch read, fresh. */
async function flag() {
  return Boolean((await Flags.flags()).minify);
}

module.exports = { on, flag, KEY, _reset: () => Flags._resetCache() };
