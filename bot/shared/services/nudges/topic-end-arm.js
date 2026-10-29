'use strict';
/**
 * The topic-end nudge test (bd-pw1ccr.4): its switch and its group.
 *
 * Switch: app_settings.topic_end_nudge_enabled. Fail closed: no row, a value other than true, or a read error is off.
 * Group: the teacher's school in niete_topic_nudge_ab_assignment, written once at the draw. Only group B is nudged;
 * group A, a school outside the draw, no school or a read error all get nothing. Same pattern as
 * coaching/ab-v10-switch.js + coaching/ab-v10-arms.js, its own table so the two tests never share a draw.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const FLAG_KEY = 'topic_end_nudge_enabled';
const TABLE = 'niete_topic_nudge_ab_assignment';
const FLAG_TTL_MS = 30 * 1000;
let flagCache = null; // { at, on }

function isOn(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* keep the raw string */ }
  }
  if (v === true) return true;
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

async function enabled(now = Date.now()) {
  if (flagCache && now - flagCache.at < FLAG_TTL_MS) return flagCache.on;
  try {
    const { data, error } = await supabase
      .from('app_settings').select('key,value').eq('key', FLAG_KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    flagCache = { at: now, on: Boolean(data && isOn(data.value)) };
    return flagCache.on;
  } catch (err) {
    // Fail closed, and do not cache the failure.
    logToFile('topic nudge: switch lookup failed — treating as off', { error: err.message });
    return false;
  }
}

/** True only for a teacher whose school was drawn into group B. Never throws. */
async function inGroupB(userId) {
  if (!userId) return false;
  try {
    const { data: user, error: uErr } = await supabase
      .from('users').select('id, school_id').eq('id', userId).maybeSingle();
    if (uErr) throw new Error(uErr.message);
    if (!user || !user.school_id) return false;
    const { data: row, error } = await supabase
      .from(TABLE).select('school_id, ab_group').eq('school_id', user.school_id).maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(row && row.ab_group === 'B');
  } catch (err) {
    logToFile('topic nudge: group lookup failed — not nudged', { userId, error: err.message });
    return false;
  }
}

function _resetCache() { flagCache = null; }

module.exports = { FLAG_KEY, TABLE, enabled, inGroupB, _resetCache };
