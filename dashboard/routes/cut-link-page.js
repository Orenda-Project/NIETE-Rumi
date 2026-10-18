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
 * no database client, a failed read or a reader that throws are all OFF.
 *
 * The read: ONE `.in('key', KEYS)` on app_settings, asked only on the junk path (a token that parses never asks), at
 * most one read per 30 s per process. The same read carries web_quiz_adventure_look (JSON true only, `on.adv()`), so a
 * page skin on these pages costs no read of its own; nothing here draws differently by it.
 */
const KEY = 'quiz_cut_link_page';
const ADV_KEY = 'web_quiz_adventure_look';
const KEYS = Object.freeze([KEY, ADV_KEY]);
const TTL_MS = 30 * 1000;
// the longest a junk request waits for a read in flight (a cold process); past it the answer is today's
const WAIT_MS = 1500;

/** Only a real JSON boolean true. */
const isTrue = (value) => value === true;

/**
 * createCutLinkFlag({ db, now }) → on(). `db()` gives the portal's database client (or null); `now` the clock.
 * on() answers the remembered value (never waits) and starts one background read when it is 30 s old or more;
 * on.adv() the adventure key from the same read; on.ready() resolves when the read in flight (if any) has landed.
 */
function createCutLinkFlag({ db = () => require('../config/supabase'), now = Date.now } = {}) {
  let at = -Infinity;
  let by = {};
  let reading = null;

  async function read() {
    try {
      const client = db();
      if (!client) return {};
      const { data, error } = await client.from('app_settings').select('key, value').in('key', KEYS);
      if (error || !Array.isArray(data)) return {};
      return Object.fromEntries(data.filter((r) => r && KEYS.includes(r.key)).map((r) => [r.key, r.value]));
    } catch (_) {
      return {};
    }
  }

  function refresh() {
    const job = read().then((next) => { by = next || {}; }, () => { by = {}; })
      .then(() => { at = now(); if (reading === job) reading = null; });
    reading = job;
    return job;
  }

  function on() {
    if (!reading && now() - at >= TTL_MS) {
      at = now(); // one read per 30 s even while it is in flight
      refresh();
    }
    return isTrue(by[KEY]);
  }
  on.adv = () => isTrue(by[ADV_KEY]);
  on.ready = () => reading || Promise.resolve();
  return on;
}

let shared = null;
/** The process's one switch (shared by the three routers). */
function cutLinkOn() {
  if (!shared) shared = createCutLinkFlag();
  return shared();
}
cutLinkOn.ready = () => (shared ? shared.ready() : Promise.resolve());

/**
 * true only when the switch answers true; never throws. A read in flight (a cold process) is waited for, up to
 * WAIT_MS, so the first junk link after a start gets the same answer as the rest.
 */
async function isOn(on) {
  try {
    if (typeof on !== 'function') return false;
    if (on() === true) return true;
    if (typeof on.ready !== 'function') return false;
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(resolve, WAIT_MS); if (timer.unref) timer.unref(); });
    try { await Promise.race([on.ready(), late]); } finally { clearTimeout(timer); }
    return on() === true;
  } catch (_) {
    return false;
  }
}

/** The switch a router was handed (tests), else the process's one. */
const switchOf = (opts) => (opts && typeof opts.cutLinkOn === 'function' ? opts.cutLinkOn : cutLinkOn);

module.exports = { KEY, ADV_KEY, KEYS, TTL_MS, createCutLinkFlag, cutLinkOn, isOn, switchOf };
