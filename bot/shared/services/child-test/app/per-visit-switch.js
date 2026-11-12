'use strict';
/**
 * Children per visit (app_settings `sa_per_visit`, absent = 5): how many children a new visit list holds before its 2
 * alternates. The caller reads it and passes `perVisit` to draw.todaysList; a list already drawn keeps its size.
 *
 *   count()    30 s cache; a whole number (JSON number or numeric text) clamped to 1–5; no row, any other value or a
 *              read error is 5
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_per_visit';
const DEFAULT = 5;
const TTL_MS = 30 * 1000;
let cache = null;

function clamp(v) {
  const n = typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) ? Math.min(DEFAULT, Math.max(1, n)) : DEFAULT;
}

async function read(at = Date.now(), client = null) {
  if (cache && at - cache.at < TTL_MS) return cache.n;
  try {
    const { data, error } = await Snap.rows([KEY], () => (client || supabase()).from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r && r.key === KEY);
    cache = { at, n: row ? clamp(row.value) : DEFAULT };
    return cache.n;
  } catch (err) {
    logToFile('⚠️ sa per visit: settings lookup failed — 5', { error: err.message }, 'warn');
    return DEFAULT;
  }
}

/** The number as a handler sees it: a test's `perVisit`, else the setting (read with the caller's client, if any). */
async function count(deps = {}, at = Date.now()) {
  if (deps.perVisit !== undefined) return clamp(typeof deps.perVisit === 'function' ? await deps.perVisit() : deps.perVisit);
  return read(at, deps.supabase || null);
}

module.exports = { KEY, DEFAULT, count };
