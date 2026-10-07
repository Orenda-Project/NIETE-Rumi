'use strict';
/**
 * The read-aloud's daily cap. A scored read-aloud spends one STT call and one listening call (measured
 * ≈ USD 0.006–0.022 a reading); "Which is bigger?" costs nothing and is never capped.
 *
 *   app_settings `web_quiz_challenge_daily_reads`  read-alouds per Pakistan day, whole environment;
 *                                                  default DEFAULT_DAILY_READS (≈ USD 10 a day at $0.021)
 *
 * Absent or a failed read = the default; cached 60 s, like web_quiz_audio_daily_cap (web-quiz-audio-store.js).
 * Today's count = rows of web_quiz_challenge_runs with exercise 'read' since Pakistan midnight (every reading that
 * reached scoring), plus the readings this process started since that count. At the cap the Challenge offers
 * "Which is bigger?" only and a read already open gets "enough for today"; logged once per day per process.
 * A failed count lets the reading through (logged): the setting read still bounds a normal day.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const KEY = 'web_quiz_challenge_daily_reads';
const DEFAULT_DAILY_READS = 500;
const CACHE_MS = 60 * 1000;
const PK_OFFSET_MS = 5 * 3600 * 1000;

let capCache = null;   // { at, cap }
let count = null;      // { day, at, n }
let started = 0;       // readings this process started since the last count
let loggedDay = null;

const pkDay = (now) => new Date(now + PK_OFFSET_MS).toISOString().slice(0, 10);
const pkMidnightIso = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - PK_OFFSET_MS).toISOString();

function parseCap(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  const n = Number(v);
  return v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_READS;
}

async function dailyCap(now = Date.now()) {
  if (capCache && now - capCache.at < CACHE_MS) return capCache.cap;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    capCache = { at: now, cap: parseCap(data && data.key === KEY ? data.value : undefined) };
    return capCache.cap;
  } catch (e) {
    logToFile('⚠️ web quiz challenge: daily-reads setting unreadable — default', { error: String(e.message || e).slice(0, 120) });
    return DEFAULT_DAILY_READS;
  }
}

async function readsToday(now = Date.now()) {
  const day = pkDay(now);
  if (!(count && count.day === day && now - count.at < CACHE_MS)) {
    const { count: n, error } = await supabase.from('web_quiz_challenge_runs').select('id', { count: 'exact', head: true })
      .eq('exercise', 'read').gte('created_at', pkMidnightIso(day));
    if (error) throw new Error(error.message || 'count failed');
    count = { day, at: now, n: Number(n) || 0 };
    started = 0;
  }
  return count.n + started;
}

/** May a read-aloud start now? Never throws. */
async function readOpen(now = Date.now()) {
  const cap = await dailyCap(now);
  let n;
  try {
    n = await readsToday(now);
  } catch (e) {
    logToFile('⚠️ web quiz challenge: daily read count failed — allowed', { error: String(e.message || e).slice(0, 120) });
    return true;
  }
  if (n < cap) return true;
  const day = pkDay(now);
  if (loggedDay !== day) {
    loggedDay = day;
    logEvent('web_quiz.ch_read_capped', { day, cap, readsToday: n });
  }
  return false;
}

/** A reading is about to be scored here: count it before the next count of the table sees it. */
function noteStarted() {
  started += 1;
}

function _reset() { capCache = null; count = null; started = 0; loggedDay = null; }

module.exports = { readOpen, dailyCap, readsToday, noteStarted, KEY, DEFAULT_DAILY_READS, _reset };
