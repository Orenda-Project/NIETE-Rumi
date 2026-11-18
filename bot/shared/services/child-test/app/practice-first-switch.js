'use strict';
/**
 * Round 19, the practice school first (app_settings `sa_r19_practice_first`, default OFF): ON, the coach's school list
 * for the Learning assessment (sa-api listSchools) and the WhatsApp /egra picker (conversation/context coachSchools)
 * put the practice school (schools.is_probable_test) at the top, above today's visit and the coach's own schools, and
 * listSchools marks each school `practice`. OFF, both answers are exactly as before.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r19_practice_first';
const TTL_MS = 30 * 1000;
let cache = null;

async function on(at = Date.now(), client = null) {
  if (cache && at - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([KEY], () => (client || supabase()).from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa practice first: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `practiceFirst`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.practiceFirst !== undefined) return typeof deps.practiceFirst === 'function' ? (await deps.practiceFirst()) === true : deps.practiceFirst === true;
  return on(Date.now(), deps.supabase || null);
}

function __reset() { cache = null; }

module.exports = { KEY, on, enabled, __reset };
