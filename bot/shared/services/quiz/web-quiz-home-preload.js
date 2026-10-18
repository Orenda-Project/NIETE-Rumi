'use strict';
/**
 * The child home starts its scripts and styles while the server answers (app_settings web_quiz_home_preload, default
 * off). On: every hub answer (GET and POST /hub, a locked one too) carries `home_pre: true`; the portal then preloads
 * the home's files in the head it sends before the next hub answer (dashboard/routes/web-quiz-home-preload.js).
 * Off: the key is absent and the answer is the hub's own, byte for byte.
 *
 * The routes wrap the hub answer with carry(), whatever builds it (the hub module, or any other path that builds the same
 * JSON), so no builder can drop the key. Only the stored JSON boolean true is on: the string 'true', 1, an object, no row
 * or a failed read are off. It rides the hub's one batched switch read (web-quiz-hub-flags.js), already warm when the
 * hub has answered, so it adds no settings read.
 */
const Flags = require('./web-quiz-hub-flags');

const KEY = Flags.HOME_PRELOAD_KEY;
const FIELD = 'home_pre';

/** The hub answer (or its promise) with `home_pre: true` while on; the same answer, untouched, while off. */
function carry(outP) {
  return Promise.resolve(outP).then(async (out) => {
    if (!out || typeof out !== 'object' || Array.isArray(out)) return out;
    let on = false;
    try { on = (await Flags.flags()).homePreload === true; } catch (_) { on = false; }
    if (on) out[FIELD] = true;
    return out;
  });
}

module.exports = { carry, KEY, FIELD };
