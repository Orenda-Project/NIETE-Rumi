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
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_page_warm';
const TTL_MS = 30 * 1000;
const EVERY_MS = 20 * 1000;
let cache = null; // { at, on }
let reading = null;
let timer = null;

/** The switch, read now (a read already on its way is shared). Never throws. */
function flag() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        cache = { at: Date.now(), on: Boolean(data) && data.value === true };
      } catch (err) {
        logToFile('⚠️ web quiz page warm: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
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
}

// on: the 20 s touch runs; off: it stops
function keep() {
  if (!cache || !cache.on) { stop(); return; }
  if (timer) return;
  timer = setInterval(() => { flag().catch(() => {}); }, EVERY_MS);
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

module.exports = { flag, onNow, touch, tick, stop, KEY, TTL_MS, EVERY_MS, _reset: () => { stop(); cache = null; reading = null; } };
