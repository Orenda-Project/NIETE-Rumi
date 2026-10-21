'use strict';
/**
 * The RDF short form of the coach battery (app_settings `sa_rdf_form`, default OFF): ON, the hand-over card may offer
 * "RDF" next to "Full battery" and the server accepts block 'rdf' (the form's rdf[] list, build.js RULING #42).
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_rdf_form';
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
    logToFile('⚠️ sa rdf form: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `rdfForm`, else the setting. */
async function enabled(deps = {}) {
  if (deps.rdfForm !== undefined) return typeof deps.rdfForm === 'function' ? (await deps.rdfForm()) === true : deps.rdfForm === true;
  return on();
}

module.exports = { KEY, on, enabled };
