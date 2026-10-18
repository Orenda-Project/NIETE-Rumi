'use strict';
/**
 * A cut-short or junk link on the door, join and teacher pages (app_settings quiz_cut_link_page, default OFF).
 *
 * A link from WhatsApp that was wrapped, forwarded in part or half copied carries a token that does not parse. Today it
 * falls through every edge router to the portal's own page. With the switch ON the door (/quiz/go/:token), the join
 * (/quiz/join/:token) and the teacher home (/quiz/teacher/:token, /stories, /send) answer it with the expired page a
 * tampered token already gets — its words and its one "Open WhatsApp" tap — with status 410 and no bot call. A token
 * that parses is never touched. The maker page and the family door (/m, /f) are not changed.
 *
 * Default OFF. ON only when the stored value is the JSON boolean true: the string 'true', '"true"', 1, {}, no row,
 * no database client, or a failed read with nothing read before are all OFF (a failed read after a good one keeps
 * the last good value for 30 s).
 *
 * The read: ONE `.in('key', KEYS)` on app_settings, asked only on the junk path (a token that parses never asks). It
 * never waits: a cold or stale cache answers at once with the last value this process read (OFF when none) and starts
 * ONE background read (at most one per 30 s per process, callers share the one in flight, one log line per failed
 * read). So the first junk link on a cold process gets today's page even with the switch ON, never a wrong page. The
 * same read carries web_quiz_adventure_look (JSON true only, `on.adv()`), so a page skin on these pages costs no read
 * of its own; nothing here draws differently by it.
 */
const KEY = 'quiz_cut_link_page';
const ADV_KEY = 'web_quiz_adventure_look';
const KEYS = Object.freeze([KEY, ADV_KEY]);
const TTL_MS = 30 * 1000;

/** Only a real JSON boolean true. */
const isTrue = (value) => value === true;

/**
 * The shared switch cache's shape (get / peek / fresh / reset), carried here until the shared settings cache lands;
 * moving to it is the one line `const { cachedSwitch } = require(<switch-cache>)` in place of this function.
 * peek(now) never waits: a fresh good read → its value; else it starts the shared get(now) in the background (at most
 * one start per ttlMs) and answers the last good value, else `off`. A failed read is logged once and kept for ttlMs.
 */
function cachedSwitch({ ttlMs, read, off, log } = {}) {
  let good = null;
  let failedAt = null;
  let inflight = null;
  let gen = 0;
  let peekAt = -Infinity;
  const offValue = () => (typeof off === 'function' ? off() : off);
  const fallback = () => (good ? good.value : offValue());
  const fresh = (now = Date.now()) => Boolean(good) && now - good.at < ttlMs;
  async function readOnce(now) {
    const mine = gen;
    try {
      const value = await read(now);
      if (mine === gen) { good = { at: now, value }; failedAt = null; }
      return value;
    } catch (err) {
      if (mine === gen) failedAt = now;
      try { if (log) log(err || new Error('settings read failed')); } catch (_) { /* never throws */ }
      return fallback();
    }
  }
  async function get(now = Date.now()) {
    if (fresh(now)) return good.value;
    if (failedAt !== null && now - failedAt < ttlMs) return fallback();
    if (!inflight) {
      const p = readOnce(now).finally(() => { if (inflight === p) inflight = null; });
      inflight = p;
    }
    return inflight;
  }
  function peek(now = Date.now()) {
    if (fresh(now)) return good.value;
    if (now - peekAt >= ttlMs) {
      peekAt = now;
      get(now).catch(() => {});
    }
    return fallback();
  }
  function reset() { gen += 1; good = null; failedAt = null; inflight = null; peekAt = -Infinity; }
  return { get, peek, fresh, reset };
}

/**
 * createCutLinkFlag({ db, now, log }) → on(). `db()` gives the portal's database client (or null); `now` the clock.
 * on() answers at once (never waits on the read); on.adv() the adventure key from the same read; on.ready() resolves
 * when the read in flight (if any) has landed (tests).
 */
function createCutLinkFlag({ db = () => require('../config/supabase'), now = Date.now, log = defaultLog } = {}) {
  let last = null;
  async function query() {
    const client = db();
    if (!client) return {};
    const { data, error } = await client.from('app_settings').select('key, value').in('key', KEYS);
    if (error) throw new Error(error.message || 'app_settings read failed');
    return Object.fromEntries((Array.isArray(data) ? data : []).filter((r) => r && KEYS.includes(r.key)).map((r) => [r.key, r.value]));
  }
  const read = () => { const p = query(); last = p.then(() => {}, () => {}); return p; };
  const sw = cachedSwitch({ ttlMs: TTL_MS, read, off: () => ({}), log });
  const by = () => { try { return sw.peek(now()) || {}; } catch (_) { return {}; } };
  function on() { return isTrue(by()[KEY]); }
  on.adv = () => isTrue(by()[ADV_KEY]);
  on.ready = () => (last ? last.then(() => new Promise((r) => setImmediate(r))) : Promise.resolve());
  return on;
}

/** One line per failed read (at most one per 30 s per process): the reason only, never a link or a token. */
function defaultLog(err) {
  console.warn('cut link page: settings read failed, answering the last known value', String((err && err.message) || err).slice(0, 200));
}

let shared = null;
/** The process's one switch (shared by the three routers). */
function cutLinkOn() {
  if (!shared) shared = createCutLinkFlag();
  return shared();
}

/** true only when the switch answers true; never waits, never throws. */
function isOn(on) {
  try { return typeof on === 'function' && on() === true; } catch (_) { return false; }
}

/** The switch a router was handed (tests), else the process's one. */
const switchOf = (opts) => (opts && typeof opts.cutLinkOn === 'function' ? opts.cutLinkOn : cutLinkOn);

module.exports = { KEY, ADV_KEY, KEYS, TTL_MS, cachedSwitch, createCutLinkFlag, cutLinkOn, isOn, switchOf };
