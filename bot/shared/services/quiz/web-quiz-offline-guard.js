'use strict';
/**
 * A tap while offline stays on the page (app_settings web_quiz_offline_guard, default off, fail off, 30 s cache).
 *
 * On: the hub (the child home), the challenge menu (the Jugnu page) and the quiz answers carry `offline_guard: true`,
 * and those pages check the connection before every full navigation the child starts (the home's tile and doors, the
 * finish card's Next and Home, the fold's links, a lesson's link): offline, the page stays with the offline line and
 * Try again. Off: the key is absent, so every answer is today's, byte for byte, and the pages navigate as today. Only
 * the stored JSON boolean true turns it on: the string 'true', '"true"', 'yes', 1, {enabled:true}, no row or a failed
 * read are all off.
 *
 * on() never waits and never reads: it answers from the cache the hub's own switch read keeps warm
 * (web-quiz-hub-flags.js, one batched app_settings read, 30 s cache), so the switch adds no database read of its own.
 * An empty or expired cache is off. Each answer's own flags read has run by the time it is sent, so the step looks at the
 * switch as the answer goes out, not as the request comes in.
 *
 * mount(router): one small step before the three answers' own routes, so their lines stay as they are; with the switch
 * off the answer is untouched.
 */
const Flags = require('./web-quiz-hub-flags');

const KEY = Flags.OFFLINE_GUARD_KEY;
const FIELD = 'offline_guard';
const TTL_MS = 30 * 1000;

/** The switch, waited for (tests): the hub's switch read, fresh. */
async function flag() {
  return Boolean((await Flags.flags()).offlineGuard);
}

/** The switch, never waited for: the hub's cached value, off when there is none. Never throws. */
function on(now = Date.now()) {
  try { return Flags.offlineGuardNow(now); } catch (_) { return false; }
}

/**
 * The step before a page answer's route: when on, the answer's JSON object gets `offline_guard: true` (a 200 answer
 * only, never an error body); when off, nothing is touched. The switch is looked at as the answer is sent.
 */
function step(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(on() && res.statusCode === 200 && body && typeof body === 'object' && !Array.isArray(body) && !body.error
    ? Object.assign(body, { [FIELD]: true }) : body);
  next();
}

/** The hub (GET and POST), the challenge menu and the quiz answers: registered before their own routes. */
function mount(router) {
  router.get(['/hub/:token', '/ch/:token', '/quiz/:code'], step);
  router.post('/hub/:token', step);
}

module.exports = { on, flag, step, mount, KEY, FIELD, TTL_MS, _reset: () => Flags._resetCache() };
