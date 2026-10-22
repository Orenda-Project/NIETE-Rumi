'use strict';
/**
 * "Add a child" on the coach's list (app_settings `sa_add_child`, default OFF): ON, the coach can seat a child who is
 * not on the roster (first name, grade, section) on the open list; the child is written to the roster
 * (sa-api.service addChild → draw.addChild). OFF on every host unless its row says true.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_add_child';
const TTL_MS = 30 * 1000;
let cache = null;

async function on(at = Date.now()) {
  if (cache && at - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([KEY], () => supabase().from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa add child: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `addChild`, else the setting. */
async function enabled(deps = {}) {
  if (deps.addChild !== undefined) return typeof deps.addChild === 'function' ? (await deps.addChild()) === true : deps.addChild === true;
  return on();
}

module.exports = { KEY, on, enabled };
