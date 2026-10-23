'use strict';
/**
 * FreeformSwitch — app_settings.freeform_lp, the ONE switch of the free-form lesson-plan engine.
 *
 * DEFAULT OFF. A missing row, a read that throws, invalid JSON, or JSON that is not a config object
 * all return the OFF sentinel `{ mode: 'off' }`: a failure must leave the bot doing exactly what it
 * does today (the inverse of a gate that stays ON when it cannot read).
 *
 * Cached 30 s per process: a row edit is live within 30 s + the next request. No deploy is ever
 * needed to turn it off.
 *
 * Row shape — the same as the other Rumi deployment's, so one runbook covers both:
 *   { mode_by_segment: { NIETE | '*': 'off'|'shadow'|'ab'|'on' }, ab_share: { NIETE | '*': 0..1 },
 *     testers: ['92300…'], handoff: { niete_catalogue_miss: true, … }, engine: {…}, … }
 * This deployment has one segment, 'NIETE'. A door that only reaches the engine behind its own
 * hand-off flag (the typed-topic catalogue miss is one) needs `handoff.<name> === true` as well as
 * the mode. Testers (digits-only match) win over every mode.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const SETTING_KEY = 'freeform_lp';
const CACHE_MS = 30 * 1000;
const OFF = Object.freeze({ mode: 'off' });
const MODES = new Set(['off', 'shadow', 'ab', 'on']);
const ELIGIBLE_SOURCE = 'gamma_standard';
const ELIGIBLE_CONTENT = 'lesson_plan';
const SEGMENT = 'NIETE';

// Entries that reach the engine only behind their own hand-off flag.
const ENTRY_HANDOFF = {
  followup: 'followup',
  quiz_followup: 'followup',
  portal_followup: 'followup',
  niete_catalogue_miss: 'niete_catalogue_miss',
};

let cache = { at: 0, value: null };

function isConfig(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && !!v.mode_by_segment && typeof v.mode_by_segment === 'object' && !Array.isArray(v.mode_by_segment);
}

function parseRow(raw) {
  if (raw === null || raw === undefined) return OFF;
  let v = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch (err) {
      logToFile('fflp switch: freeform_lp is not valid JSON, staying OFF', { error: err.message }, 'warn');
      return OFF;
    }
  }
  if (!isConfig(v)) {
    logToFile('fflp switch: freeform_lp has no mode_by_segment object, staying OFF', {}, 'warn');
    return OFF;
  }
  return v;
}

/** Read the row (memoised 30 s). Never throws; every failure is OFF. */
async function read() {
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_MS) return cache.value;
  let value = OFF;
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle();
    if (error) throw new Error(error.message || String(error));
    value = parseRow(data ? data.value : null);
  } catch (err) {
    logToFile('fflp switch: app_settings read failed, staying OFF', { error: err.message }, 'warn');
    value = OFF;
  }
  cache = { at: now, value };
  return value;
}

function _resetCache() { cache = { at: 0, value: null }; }

const digits = (p) => String(p == null ? '' : p).replace(/\D/g, '');

function testerIn(row, phone) {
  const d = digits(phone);
  if (!d || !row || !Array.isArray(row.testers)) return false;
  return row.testers.some((t) => digits(t) === d);
}

/** Deterministic A/B bucket in [0, 1]: parseInt(md5(userId).hex.slice(0, 8), 16) / 0xffffffff. */
function abBucket(userId) {
  const hash = crypto.createHash('md5').update(String(userId)).digest('hex').slice(0, 8);
  return parseInt(hash, 16) / 0xffffffff;
}

/** This deployment is one segment. Kept as a function so the row shape matches the other deployment's. */
function segmentOf() { return SEGMENT; }

function lookup(map, segment) {
  if (!map || typeof map !== 'object') return undefined;
  if (map[segment] !== undefined) return map[segment];
  return map['*'];
}

function modeFor(row, segment) {
  const m = lookup(row && row.mode_by_segment, segment);
  return MODES.has(m) ? m : 'off';
}

function handoffFlag(row, name) {
  return !!(row && row.handoff && row.handoff[name] === true);
}

/**
 * PURE given the parsed row (the predicate table test).
 * @returns {{track:string, segment:string|null, mode:string, reason:string}}
 */
function decidePure(row, { source = ELIGIBLE_SOURCE, contentType = ELIGIBLE_CONTENT, user = {}, entry = 'unknown' } = {}) {
  if (source !== ELIGIBLE_SOURCE || contentType !== ELIGIBLE_CONTENT) {
    return { track: source, segment: null, mode: 'off', reason: 'not_eligible' };
  }
  if (!isConfig(row)) return { track: ELIGIBLE_SOURCE, segment: null, mode: 'off', reason: 'switch_off' };
  const segment = segmentOf();
  const mode = modeFor(row, segment);
  const gate = ENTRY_HANDOFF[entry];
  if (gate && !handoffFlag(row, gate)) {
    return { track: ELIGIBLE_SOURCE, segment, mode, reason: `handoff_off:${gate}` };
  }
  if (testerIn(row, user && user.phone)) return { track: 'freeform_v1', segment, mode, reason: 'tester' };
  if (mode === 'on') return { track: 'freeform_v1', segment, mode, reason: 'mode_on' };
  if (mode === 'shadow') return { track: 'freeform_shadow', segment, mode, reason: 'mode_shadow' };
  if (mode === 'ab') {
    const share = Number(lookup(row.ab_share, segment)) || 0;
    const inB = !!(user && user.id) && abBucket(user.id) < share;
    return { track: inB ? 'freeform_v1' : ELIGIBLE_SOURCE, segment, mode, reason: inB ? 'ab_in' : 'ab_out' };
  }
  return { track: ELIGIBLE_SOURCE, segment, mode, reason: 'mode_off' };
}

/** decidePure over the live (memoised) row. Never throws. */
async function decide(args) {
  try {
    if (!args || args.source !== ELIGIBLE_SOURCE || args.contentType !== ELIGIBLE_CONTENT) {
      return decidePure(null, args || {});
    }
    return decidePure(await read(), args);
  } catch (err) {
    logToFile('fflp switch: decide failed, staying on today\'s track', { error: err.message }, 'warn');
    return { track: (args && args.source) || ELIGIBLE_SOURCE, segment: null, mode: 'off', reason: 'error' };
  }
}

/** get('engine.author_model', dflt) etc. — the default when absent or OFF. */
async function get(path, dflt) {
  const row = await read();
  if (!isConfig(row)) return dflt;
  let cur = row;
  for (const k of String(path).split('.')) {
    if (cur === null || typeof cur !== 'object' || !(k in cur)) return dflt;
    cur = cur[k];
  }
  return cur === undefined ? dflt : cur;
}

module.exports = {
  SETTING_KEY, OFF, read, decide, decidePure, segmentOf, abBucket, get, _resetCache,
};
