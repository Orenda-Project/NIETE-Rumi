'use strict';
/**
 * Any school (app_settings `sa_any_school`, default OFF): ON for a user, the coach app's Learning assessment lists every
 * live programme school (active, not a probable test school), not only the user's own (leader_schools), and opens a
 * list or seats a child at any of them (sa-api.service). For the people who support the visits without schools of their
 * own. ON = the row's value is JSON `true` (every user) or a list of users.id naming this user.
 *
 *   onFor(userId)          30 s cache of the row, fails closed (no row, any other value, no user or a read error is off)
 *   enabledFor(userId, deps)  a test's `anySchool` (a boolean, or a function of the user) first, else onFor
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_any_school';
const TTL_MS = 30 * 1000;
let cache = null;

async function valueOf(at) {
  if (cache && at - cache.at < TTL_MS) return cache.value;
  const { data, error } = await Snap.rows([KEY], () => supabase().from('app_settings').select('key, value').eq('key', KEY));
  if (error) throw new Error(error.message || 'app_settings read failed');
  const row = (data || []).find((r) => r && r.key === KEY);
  cache = { at, value: row ? row.value : null };
  return cache.value;
}

async function onFor(userId, at = Date.now()) {
  if (!userId) return false;
  try {
    const value = await valueOf(at);
    if (value === true) return true;
    return Array.isArray(value) && value.some((id) => typeof id === 'string' && id === userId);
  } catch (err) {
    logToFile('⚠️ sa any school: settings lookup failed — off', { error: err.message });
    return false;
  }
}

async function enabledFor(userId, deps = {}) {
  if (deps.anySchool !== undefined) {
    return typeof deps.anySchool === 'function' ? (await deps.anySchool(userId)) === true : deps.anySchool === true;
  }
  return onFor(userId);
}

/** Tests only: forget the cached row. */
function __reset() { cache = null; }

module.exports = { KEY, onFor, enabledFor, __reset };
