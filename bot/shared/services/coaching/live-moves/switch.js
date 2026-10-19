/**
 * Live moves (bd-v0toag.31): who sees the live list while recording.
 *
 * app_settings.live_moves = { enabled, school_ids }. On only for a group D teacher whose
 * school is listed, while enabled is true; enabled false is the kill switch whatever the
 * list says. Fail closed: no row, a read error, no school or any other group is off.
 * Same pattern as ab-v10-switch.js.
 */

const supabase = require('../../../config/supabase');
const { groupFor } = require('../ab-v10-arms');
const { logToFile } = require('../../../utils/logger');

const KEY = 'live_moves';
const TTL_MS = 60 * 1000;
let cache = null; // { at, setting }

function parse(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return null; }
  }
  return v && typeof v === 'object' ? v : null;
}

async function readSetting(db, now) {
  if (cache && now - cache.at < TTL_MS) return cache.setting;
  const { data, error } = await db.from('app_settings').select('key,value').eq('key', KEY).maybeSingle();
  if (error) throw new Error(error.message || 'app_settings read failed');
  const setting = data ? parse(data.value) : null;
  cache = { at: now, setting };
  return setting;
}

async function liveMovesOn(userId, deps = {}) {
  const db = deps.supabase || supabase;
  const group = deps.groupFor || groupFor;
  const log = deps.log || logToFile;
  const now = (deps.now || Date.now)();
  if (!userId) return false;
  try {
    const setting = await readSetting(db, now);
    if (!setting || setting.enabled !== true || !Array.isArray(setting.school_ids)) return false;
    const { data: user, error } = await db.from('users').select('id, school_id').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!user || !setting.school_ids.includes(user.school_id)) return false;
    const g = await group(userId);
    return Boolean(g && g.group === 'D');
  } catch (err) {
    // Fail closed, and do not cache the failure.
    log('live moves: switch lookup failed — off', { userId, error: err.message });
    return false;
  }
}

function _resetCache() { cache = null; }

module.exports = { KEY, liveMovesOn, _resetCache };
