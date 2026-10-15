'use strict';
/**
 * The child identity store's switches (app_settings), read like web-quiz-hub-flags.js
 * (30 s cache, fail closed). Each is effective only with its parent on:
 *
 *   canon      = web_quiz_identity_canon && web_quiz_hub    fold ids through canonicalStudentIds + merged_into
 *   phoneBind  = web_quiz_phone_bind     && canon && WQ_TOMB_SALT set   family phone bindings read and written
 *   guestHome  = web_quiz_guest_home     && phoneBind       an unknown phone's /quiz gets a guest hub
 *
 * All off → every caller's path is today's.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const HubFlags = require('./web-quiz-hub-flags');

const CANON_KEY = 'web_quiz_identity_canon';
const PHONE_BIND_KEY = 'web_quiz_phone_bind';
const GUEST_HOME_KEY = 'web_quiz_guest_home';
const TTL_MS = 30 * 1000;
const OFF = Object.freeze({ canon: false, phoneBind: false, guestHome: false });
let cache = null; // { at, canon, phoneBind, guestHome }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** → { canon, phoneBind, guestHome }; all false on a failed read. Never throws. */
async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [CANON_KEY, PHONE_BIND_KEY, GUEST_HOME_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    const hub = Boolean((await HubFlags.flags(now)).hub);
    const canon = hub && isTrue(by[CANON_KEY]);
    // WQ_TOMB_SALT is a hard parent: without it the store writes nothing and a family's JUGNU- message would meet silence.
    const phoneBind = canon && isTrue(by[PHONE_BIND_KEY]) && Boolean(process.env.WQ_TOMB_SALT);
    const guestHome = phoneBind && isTrue(by[GUEST_HOME_KEY]);
    cache = { at: now, canon, phoneBind, guestHome };
    return cache;
  } catch (err) {
    logToFile('⚠️ child identity: settings lookup failed — identity switches off', { error: err.message });
    return { ...OFF };
  }
}

module.exports = { flags, isTrue, CANON_KEY, PHONE_BIND_KEY, GUEST_HOME_KEY, _resetCache: () => { cache = null; } };
