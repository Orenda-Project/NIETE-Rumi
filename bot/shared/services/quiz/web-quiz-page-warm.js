'use strict';
/**
 * The class link page's switches kept warm (app_settings web_quiz_page_warm, default off, fail off). Only the stored
 * JSON boolean true turns it on.
 *
 * Each switch the class link page (getQuiz) reads has its own 30 s cache and its own read, and the page awaits them one
 * after another: on a process whose caches went cold (no class link for half a minute), one page made ~13 settings
 * reads in a row, and the fast page (web_quiz_fast, never waited for) was off for that first answer. On, the page calls
 * touch() beside its code read: every page switch's own getter starts together (a warm one answers from its cache, so
 * a warm page reads nothing more), and the fast page is decided after them.
 *
 * This module's own switch is never waited for (onNow: the cached value; a cold or stale cache starts one read in the
 * background and answers as it was). Once it reads on, a 20 s touch (unref'd) re-reads it, so it stays known between
 * children; it stops when the switch reads off.
 *
 * web_quiz_page_keep (JSON true, with this switch on; default off): the same one read also reads every key the page
 * switch readers named (settings-snapshot.js), every 10 s, and hands the rows to them: a page on a quiet process then
 * makes no settings read at all. Off, the read's other rows are not used.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Snap = require('../settings/settings-snapshot');

const KEY = 'web_quiz_page_warm';
const KEEP_KEY = 'web_quiz_page_keep';
const TTL_MS = 30 * 1000;
const EVERY_MS = 20 * 1000;
let cache = null; // { at, on }
let reading = null;
let timer = null;
let every = null; // the running touch's interval
let keepOn = false;
let named = false; // page_keep: every page switch has named its keys once

/** The switch, read now (a read already on its way is shared). Never throws. */
function flag() {
  if (!reading) {
    reading = (async () => {
      try {
        const readKeys = [KEY, KEEP_KEY, ...Snap.keys().filter((k) => k !== KEY && k !== KEEP_KEY)];
        const at = Date.now();
        const { data, error } = await supabase.from('app_settings').select('key, value').in('key', readKeys);
        if (error) throw new Error(error.message || 'app_settings read failed');
        const val = (k) => ((data || []).find((r) => r && r.key === k) || {}).value;
        cache = { at: Date.now(), on: val(KEY) === true };
        keepOn = cache.on && val(KEEP_KEY) === true;
        if (keepOn) Snap.take(data, readKeys, at); else Snap.clear();
        // the first time it reads on: every page switch names its keys now, so the next read already holds them
        if (keepOn && !named) { named = true; touch().catch(() => {}); }
      } catch (err) {
        logToFile('⚠️ web quiz page warm: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
        keepOn = false;
        Snap.clear();
      } finally {
        reading = null;
      }
      keep();
      return cache.on;
    })();
  }
  return reading;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  every = null;
}

// on: the 20 s touch runs (10 s while it keeps the page switches); off: it stops
function keep() {
  if (!cache || !cache.on) { stop(); return; }
  const ms = keepOn ? Snap.KEEP_MS : EVERY_MS;
  if (timer && every === ms) return;
  stop();
  every = ms;
  timer = setInterval(() => { flag().catch(() => {}); }, ms);
  if (typeof timer.unref === 'function') timer.unref();
}

/** The switch, never waited for: the cached value; cold or stale, one read starts in the background. */
function onNow(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) flag().catch(() => {});
  return Boolean(cache && cache.on && now - cache.at < 2 * TTL_MS);
}

/** The 20 s touch, by hand (tests). */
const tick = () => flag();

// Every switch getQuiz reads, each through its own getter (its own cache and read). A getter that fails is its own
// business (each fails closed as today); the touch never throws.
const GETTERS = [
  () => require('./web-quiz-fast').storyBoard(),
  () => require('./web-quiz-class-doors-flag').on(),
  () => require('./web-quiz-identity-roster').identityMode(),
  () => require('./web-quiz-hub-flags').flags(),
  () => require('../first-touch/teacher-home.flags').on(),
  () => require('./web-quiz-telemetry').flag(),
  () => require('./web-quiz-ur-polish').flag(),
  () => require('./web-quiz-juice').flag(),
  () => require('./web-quiz-invite-ask').mode(),
  () => require('./web-quiz-link-home').isOn(),
  () => require('./web-quiz-link-known').isOn(),
  () => require('./web-quiz-library-flag').libraryOn(),
  () => require('./story-teacher.service').flagOn(),
  () => require('../../config/web-quiz-brand').resolveBrandKey({ db: supabase }),
];

/** Every page switch's read started together; resolves when all have answered. Never throws. */
function touch() {
  return Promise.all(GETTERS.map((g) => Promise.resolve().then(g).catch(() => null))).then(() => undefined);
}

module.exports = { flag, onNow, touch, tick, stop, KEY, KEEP_KEY, TTL_MS, EVERY_MS, _reset: () => { stop(); cache = null; reading = null; keepOn = false; named = false; Snap.clear(); } };
