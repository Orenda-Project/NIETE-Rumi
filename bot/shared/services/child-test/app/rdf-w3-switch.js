'use strict';
/**
 * The RDF auto / RDF manual forms (app_settings `sa_rdf_w3_forms`, default OFF): ON, the hand-over card may offer
 * "RDF auto" and "RDF manual" and the server accepts blocks 'rdf_auto' and 'rdf_manual' (the form's rdf_auto[] list,
 * sa/build-w3.js); the battery files carry the W3 tasks only while it is ON (routes/sa-battery-switches.js).
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_rdf_w3_forms';
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
    logToFile('⚠️ sa rdf w3 forms: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `rdfW3Forms`, else the setting. */
async function enabled(deps = {}) {
  if (deps.rdfW3Forms !== undefined) return typeof deps.rdfW3Forms === 'function' ? (await deps.rdfW3Forms()) === true : deps.rdfW3Forms === true;
  return on();
}

module.exports = { KEY, on, enabled };
