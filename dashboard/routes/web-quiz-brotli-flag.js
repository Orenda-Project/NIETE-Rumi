'use strict';
/**
 * The switch for the child pages' file serving (web-quiz-static.js): app_settings web_quiz_brotli.
 *
 * Default OFF. ON only when the stored value is the JSON boolean true: the string 'true', '"true"', 'yes', 1,
 * {enabled: true}, no row, no database client or a failed read are all OFF.
 *
 * on() runs on every /wq request, so it never waits and never reads per request: it answers the remembered value
 * and, when that is 30 s old or more and no read is in flight, starts ONE background read (so at most one read per
 * 30 s per process). The first answers after a start are OFF until that read lands; a failed read is OFF for 30 s.
 */
const KEY = 'web_quiz_brotli';
const TTL_MS = 30 * 1000;

/** Only a real JSON boolean true. */
function isOn(value) {
  return value === true;
}

/**
 * The keys the process reads together, in ONE query on ONE 30 s timer: a switch that rides this read never adds a
 * read of its own. web_quiz_brotli (this file's), quiz_edge_security_headers (the relays' page security headers),
 * web_quiz_child_csp (the child pages' report-only policy, child-csp.js).
 */
const KEYS = Object.freeze([KEY, 'quiz_edge_security_headers', 'web_quiz_child_csp']);

/**
 * createSettingsReader({ db, now, keys }) → { on(key), ready() }. One reader for `keys`: on(key) answers that key's
 * remembered value (JSON true only) and, when the values are 30 s old or more and no read is in flight, starts ONE
 * background read for all of them. One key: `.eq('key', k).maybeSingle()` (today's read, unchanged); several:
 * `.in('key', keys)`, each key taking its own row's value (no row, a failed read or no client: every key OFF).
 */
function createSettingsReader({ db = () => require('../config/supabase'), now = Date.now, keys = [KEY] } = {}) {
  const want = [...keys];
  let at = -Infinity;
  let vals = {};
  let reading = null;

  async function read() {
    try {
      const client = db();
      if (!client) return {};
      if (want.length === 1) {
        const { data, error } = await client.from('app_settings').select('value').eq('key', want[0]).maybeSingle();
        return !error && data ? { [want[0]]: isOn(data.value) } : {};
      }
      const { data, error } = await client.from('app_settings').select('key, value').in('key', want);
      if (error || !Array.isArray(data)) return {};
      const out = {};
      data.forEach((r) => { if (r && want.includes(r.key)) out[r.key] = isOn(r.value); });
      return out;
    } catch (_) {
      return {};
    }
  }

  function refresh() {
    const job = read().then((next) => { vals = next && typeof next === 'object' ? next : {}; }, () => { vals = {}; })
      .then(() => { at = now(); if (reading === job) reading = null; });
    reading = job;
    return job;
  }

  function on(key) {
    if (!reading && now() - at >= TTL_MS) {
      at = now(); // one read per 30 s even while it is in flight
      refresh();
    }
    return vals[key] === true;
  }
  return { on, ready: () => reading || Promise.resolve() };
}

/**
 * createBrotliFlag({ db, now, key }) → on(). `db()` gives the portal's database client (or null); `now` the clock;
 * `key` another app_settings key read by the same rule (default web_quiz_brotli), on a reader of its own (tests).
 * on.ready() resolves when the read in flight (if any) has landed (for tests).
 */
function createBrotliFlag({ db = () => require('../config/supabase'), now = Date.now, key = KEY } = {}) {
  const reader = createSettingsReader({ db, now, keys: [key] });
  const on = () => reader.on(key);
  on.ready = reader.ready;
  return on;
}

let shared = null;
/** The process's one reader of KEYS. */
function sharedReader() {
  if (!shared) shared = createSettingsReader({ keys: KEYS });
  return shared;
}

/** The process's switch for one of KEYS, from the one grouped read (any other key: OFF, and nothing is read). */
function settingOn(key) {
  if (!KEYS.includes(key)) return false;
  return sharedReader().on(key);
}

/** The process's one switch (the web quiz router's). */
function brotliOn() {
  return settingOn(KEY);
}

module.exports = { KEY, KEYS, TTL_MS, isOn, createSettingsReader, createBrotliFlag, settingOn, brotliOn };
