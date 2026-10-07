'use strict';
/**
 * The read-aloud's daily spend cap. A scored read-aloud spends one STT call and one listening call (measured
 * ≈ USD 0.006–0.022 a run), and its cost is stored on the run (web_quiz_challenge_runs.meta.cost_usd). Today's
 * (UTC) spend is the sum over today's read runs, a run with no cost yet (still scoring, or failed before its calls
 * were counted) at EST_RUN_USD. When it reaches the cap, the Challenge offers "Which is bigger?" only until
 * midnight UTC; logged once per day per process (web_quiz.ch_read_capped).
 *
 * Cap: WEB_QUIZ_CHALLENGE_DAILY_USD (per environment), default USD 10; 0 turns the read-aloud off. "Which is
 * bigger?" costs nothing and is never capped. The per-child limit (10 readings a day) is separate.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const DEFAULT_CAP_USD = 10;
const EST_RUN_USD = 0.025;
const TTL_MS = 60 * 1000;

let cache = null;     // { day, at, spent }
let started = 0;      // readings this process started since the last read of the table, at EST_RUN_USD each
let loggedDay = null;

function capUsd(env = process.env) {
  const raw = String(env.WEB_QUIZ_CHALLENGE_DAILY_USD == null ? '' : env.WEB_QUIZ_CHALLENGE_DAILY_USD).trim();
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) && n >= 0 ? n : DEFAULT_CAP_USD;
}

const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
const round = (x) => Math.round(x * 1e4) / 1e4;

async function spentToday(now = Date.now()) {
  const day = dayOf(now);
  if (!(cache && cache.day === day && now - cache.at < TTL_MS)) {
    const { data, error } = await supabase.from('web_quiz_challenge_runs').select('id, status, meta, created_at')
      .eq('exercise', 'read').gte('created_at', `${day}T00:00:00.000Z`);
    if (error) {
      // Keep what is known (today's last read, or nothing) plus this process's own readings.
      logToFile('⚠️ web quiz challenge: spend read failed', { error: String(error.message || '').slice(0, 120) });
      if (!(cache && cache.day === day)) cache = { day, at: now, spent: 0 };
    } else {
      const spent = (data || []).reduce((a, r) => {
        const c = Number(r && r.meta && r.meta.cost_usd);
        return a + (c > 0 ? c : EST_RUN_USD);
      }, 0);
      cache = { day, at: now, spent };
      started = 0;
    }
  }
  return round(cache.spent + started * EST_RUN_USD);
}

/** May a read-aloud start now? Never throws. */
async function readOpen(now = Date.now()) {
  const cap = capUsd();
  let spent;
  try { spent = await spentToday(now); } catch (e) { spent = 0; }
  if (spent < cap) return true;
  const day = dayOf(now);
  if (loggedDay !== day) {
    loggedDay = day;
    logEvent('web_quiz.ch_read_capped', { day, spentUsd: spent, capUsd: cap });
  }
  return false;
}

/** A reading is about to be scored here: count it before its cost is stored. */
function noteStarted() {
  started += 1;
}

function _reset() { cache = null; started = 0; loggedDay = null; }

module.exports = { readOpen, spentToday, noteStarted, capUsd, DEFAULT_CAP_USD, EST_RUN_USD, _reset };
