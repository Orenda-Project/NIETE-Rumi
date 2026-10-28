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
 *
 * keepOnError (opt-in, the SA routers' sa_r8_switch_hold): when keepOnError() answers true, a failed read (a throw or a
 * database error) keeps the last value read instead of OFF. No row and no client stay real reads of OFF.
 * on.state() is 'unread' before any read landed, 'held' while the last read failed, else 'fresh'.
 */
const KEY = 'web_quiz_brotli';
const TTL_MS = 30 * 1000;

/** Only a real JSON boolean true. */
function isOn(value) {
  return value === true;
}

/**
 * createBrotliFlag({ db, now, key }) → on(). `db()` gives the portal's database client (or null); `now` the clock;
 * `key` another app_settings key read by the same rule and cache (default web_quiz_brotli).
 * on.ready() resolves when the read in flight (if any) has landed (for tests).
 */
function createBrotliFlag({ db = () => require('../config/supabase'), now = Date.now, key = KEY, keepOnError = null } = {}) {
  let at = -Infinity;
  let val = false;
  let reading = null;
  let landed = false;
  let failed = false;
  const FAILED = Symbol('failed');

  async function read() {
    try {
      const client = db();
      if (!client) return false;
      const { data, error } = await client.from('app_settings').select('value').eq('key', key).maybeSingle();
      if (error) return FAILED;
      return data ? isOn(data.value) : false;
    } catch (_) {
      return FAILED;
    }
  }

  function keep() {
    try { return typeof keepOnError === 'function' && keepOnError() === true; } catch (_) { return false; }
  }

  function settle(next) {
    if (next === FAILED) {
      failed = true;
      if (!keep()) val = false;
      return;
    }
    failed = false;
    landed = true;
    val = next === true;
  }

  function refresh() {
    const job = read().then(settle, () => settle(FAILED))
      .then(() => { at = now(); if (reading === job) reading = null; });
    reading = job;
    return job;
  }

  function on() {
    if (!reading && now() - at >= TTL_MS) {
      at = now(); // one read per 30 s even while it is in flight
      refresh();
    }
    return val === true;
  }
  on.ready = () => reading || Promise.resolve();
  on.state = () => (!landed ? 'unread' : failed ? 'held' : 'fresh');
  return on;
}

let shared = null;
/** The process's one switch (the web quiz router's). */
function brotliOn() {
  if (!shared) shared = createBrotliFlag();
  return shared();
}

module.exports = { KEY, TTL_MS, isOn, createBrotliFlag, brotliOn };
