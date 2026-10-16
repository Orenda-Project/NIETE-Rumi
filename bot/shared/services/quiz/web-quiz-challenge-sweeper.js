'use strict';
/**
 * The Challenge's housekeeping, run from the worker's hourly Challenge tick (sqs-worker.js scheduleChallengeVoiceSweep,
 * main-queue replicas). Two switches, each OFF by default and effective only with `web_quiz_challenge` on:
 *
 *   web_quiz_challenge_sweeper     (read-side) the stuck-run sweep, every tick:
 *                                  - a run left in 'scoring' more than 10 minutes becomes 'failed' with meta.fail_reason
 *                                    (stt_timeout | llm_timeout | page_gone | store_failed | unknown) and one
 *                                    web_quiz.ch_swept{run, age_min, reason, w:'s'}; a v2 row (mode set) also logs
 *                                    web_quiz.m_lost{reason:'swept'} when web_quiz_events_v2 is on
 *                                  - each swept run goes to the rung job (web-quiz-rungs.js onRecordFinal, when
 *                                    present): a failed record row can light a rung
 *                                  - a 'served' run never played for 24 hours becomes 'abandoned' (a count only)
 *                                  and, in the daily job, yesterday's reply-cap counts kept from Redis (the counters
 *                                  live 24 h) and, on Mondays, the weekly health numbers for the week just ended
 *                                  (web-quiz-strip.js)
 *   web_quiz_challenge_audio_purge (read-side) a DESIGNED OPTION, kept OFF: the operator's decision is to keep every
 *                                  kept reading until the operator says otherwise; this switch must stay off. When on:
 *                                  each kept reading past its audio_keep_until is deleted from R2 and its row stops
 *                                  pointing at it (forgetAudioKey); one web_quiz.ch_audio_purged{n, oldest_age_d,
 *                                  reason:'age', w:'s'} a day, also when n is 0 (it proves the purge ran)
 *
 * The daily job runs once per PKT day across every replica. The binding expiry (web-quiz-bind-expiry.js
 * expireBindings, when present) runs UNCONDITIONALLY: retention is a promise that outlives every switch, so it runs
 * on a tier where web_quiz_phone_bind was on and is later off, and with every switch off (the job then claims the
 * day and runs the expiry only). With every switch off and the expiry module absent, nothing happens at all.
 * The other parts each have their own switch:
 *   - the purge (web_quiz_challenge_audio_purge, off);
 *   - the daily reply-cap snapshot and, on Mondays, the weekly numbers (web_quiz_challenge_sweeper);
 *   - the class sample windows (web-quiz-sample-window.js daily({ now }), when present; it ships with the class
 *     round and carries its own switches): the job only schedules it, like the calibration;
 *   - on the first PKT day of a month, web-quiz-challenge-calibration.js runMonthly({ period_id: the month just
 *     ended, now }), when present: the job only schedules it; the calibration carries its own switches;
 *   - every day, the rung job's settleDeferred({ now }) (web-quiz-rungs.js, when present), only with the rung switch
 *     on (web_quiz_challenge_rungs under web_quiz_challenge_v2); absent or without that export, nothing and no log.
 *
 * Every write to a run's meta goes through the Challenge's compare-and-set (updateRunMeta): a scorer that lands its
 * result while the sweeper looks at the row wins, and the sweeper leaves the row alone. A row is never touched unless
 * it is still 'scoring'. Each tick is bounded (MAX_PER_TICK per kind); the rest wait for the next tick.
 *
 * The once-a-day claim is a row in web_quiz_strip_weekly (line 'daily_job', cell = the PKT day, the table's primary
 * key makes a second claim fail), so it holds across processes and restarts. Never throws.
 */
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const PARENT_KEY = 'web_quiz_challenge';
const SWEEPER_KEY = 'web_quiz_challenge_sweeper';
const PURGE_KEY = 'web_quiz_challenge_audio_purge';
// m_lost is a v2 event: only with web_quiz_events_v2 on (itself under web_quiz_hub), EVENTS §0.6.
const EVENTS_V2_KEY = 'web_quiz_events_v2';
const HUB_KEY = 'web_quiz_hub';
// The rung job's daily settle runs only with its switch on (web_quiz_challenge_rungs under web_quiz_challenge_v2).
const CHALLENGE_V2_KEY = 'web_quiz_challenge_v2';
const RUNGS_KEY = 'web_quiz_challenge_rungs';
const TABLE = 'web_quiz_challenge_runs';
const STRIP_TABLE = 'web_quiz_strip_weekly';
const STUCK_MS = 10 * 60 * 1000;
const { SERVED_MS } = require('./web-quiz-challenge-served-window');   // the serve's re-serve window too
const DAY_MS = 24 * 60 * 60 * 1000;
const PKT_MS = 5 * 60 * 60 * 1000;
const MAX_PER_TICK = 200;
const FAIL_REASONS = new Set(['stt_timeout', 'llm_timeout', 'page_gone', 'store_failed', 'unknown']);
// The columns the m_lost builder reads (a v2 row's), beside the ones the sweep needs.
const STUCK_COLS = 'id, student_id, exercise, grade, lang, status, created_at, meta, mode, form, band, record, canonical_id';

function isTrue(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { /* plain string */ } }
  return x === true || (typeof x === 'string' && x.trim().toLowerCase() === 'true');
}

/** The switches, read fresh (the tick is hourly); a failed read is every switch off. */
async function switches() {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value')
      .in('key', [PARENT_KEY, SWEEPER_KEY, PURGE_KEY, EVENTS_V2_KEY, HUB_KEY, CHALLENGE_V2_KEY, RUNGS_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, isTrue(r.value)]));
    const parent = !!by[PARENT_KEY];
    return {
      sweeper: parent && !!by[SWEEPER_KEY],
      purge: parent && !!by[PURGE_KEY],
      eventsV2: !!by[HUB_KEY] && !!by[EVENTS_V2_KEY],
      rungs: parent && !!by[CHALLENGE_V2_KEY] && !!by[RUNGS_KEY],
    };
  } catch (e) {
    logToFile('⚠️ web quiz challenge housekeeping: settings lookup failed — off', { error: String(e && e.message || e).slice(0, 120) });
    return { sweeper: false, purge: false, eventsV2: false, rungs: false };
  }
}

/** A module that may not be deployed yet (another change ships it): the module, or null. */
function optional(name) {
  try { return require(name); } catch (_) { return null; }
}

const pktDay = (now) => new Date(now + PKT_MS).toISOString().slice(0, 10);

/** Why a stuck run failed, from what its row says; else 'unknown'. */
function failReasonOf(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  if (FAIL_REASONS.has(m.fail_reason)) return m.fail_reason;
  if (FAIL_REASONS.has(m.reason)) return m.reason;
  // minted for a live reading or a listen run, and the page never came back with it
  if (m.phase === 'live' || m.phase === 'listen') return 'page_gone';
  return 'unknown';
}

function emitLost(row, ageMin) {
  const ME = optional('./web-quiz-measure-events');
  if (!ME || typeof ME.mLost !== 'function') return;
  try {
    logEvent('web_quiz.m_lost', ME.mLost(row, { reason: 'swept', ageMin }));
  } catch (e) {
    logError('web_quiz.ch_swept_lost_failed', { run: row.id, error: String(e && e.message || e).slice(0, 80) });
  }
}

// A swept run is a final (failed) record row, and a failed record row can light a rung: hand it to the rung job
// (web-quiz-rungs.js, shipped by another change; absent → nothing). Guarded: the rung job never stops the sweep.
async function rungFinal(id) {
  const R = optional('./web-quiz-rungs');
  if (!R || typeof R.onRecordFinal !== 'function') return;
  try {
    await R.onRecordFinal(id);
  } catch (e) {
    logError('web_quiz.ch_swept_rung_failed', { run: id, error: String(e && e.message || e).slice(0, 80) });
  }
}

/**
 * The stuck-run sweep (web_quiz_challenge_sweeper; off ⇒ returns without a query to the runs table).
 * Returns { swept, abandoned } (or { off: true }).
 */
async function sweepStuck({ now = Date.now(), max = MAX_PER_TICK, flags = null } = {}) {
  const f = flags || await switches();
  if (!f.sweeper) return { off: true, swept: 0, abandoned: 0 };
  const out = { swept: 0, abandoned: 0 };
  const Ch = require('./web-quiz-challenge');

  const { data: stuck, error } = await supabase.from(TABLE).select(STUCK_COLS)
    .eq('status', 'scoring').lt('created_at', new Date(now - STUCK_MS).toISOString())
    .order('created_at', { ascending: true }).limit(max);
  if (error) logError('web_quiz.ch_sweep_read_failed', { code: error.code || null, error: String(error.message || error).slice(0, 120) });
  for (const row of stuck || []) {
    const reason = failReasonOf(row.meta);
    const ageMin = Math.floor((now - Date.parse(row.created_at)) / 60000);
    // Built from a fresh read; lands only if meta is still what was read. A row no longer scoring is left as it is.
    const written = await Ch.updateRunMeta(row.id, (cur) => (cur.status === 'scoring'
      ? { status: 'failed', meta: { ...(cur.meta || {}), fail_reason: reason, swept_at: new Date(now).toISOString() } }
      : { meta: cur.meta }));
    if (!written || written.status !== 'failed' || !written.meta || written.meta.swept_at !== new Date(now).toISOString()) continue;
    out.swept += 1;
    logEvent('web_quiz.ch_swept', { run: row.id, age_min: ageMin, reason, w: 's' });
    if (row.mode && f.eventsV2) emitLost({ ...row, ...written }, ageMin);
    await rungFinal(row.id);
  }

  // served, never played: closed after 24 h. The status guard is the compare-and-set (meta is not written).
  const { data: served, error: sErr } = await supabase.from(TABLE).select('id')
    .eq('status', 'served').lt('created_at', new Date(now - SERVED_MS).toISOString())
    .order('created_at', { ascending: true }).limit(max);
  if (sErr) logError('web_quiz.ch_sweep_read_failed', { code: sErr.code || null, error: String(sErr.message || sErr).slice(0, 120) });
  for (const row of served || []) {
    const { data, error: uErr } = await supabase.from(TABLE).update({ status: 'abandoned' }).eq('id', row.id).eq('status', 'served').select('id');
    if (!uErr && data && data.length) out.abandoned += 1;
  }
  if (out.swept || out.abandoned) logToFile('🧹 Challenge stuck runs swept', out);
  return out;
}

/** Claim today (PKT) for the daily job, once across every process: true when this call won the claim. */
async function claimDay(now) {
  const day = pktDay(now);
  const week = require('./web-quiz-strip').isoWeekOf(now);
  const { error } = await supabase.from(STRIP_TABLE).insert({ week, line: 'daily_job', cell: day, value: null, n: null });
  if (!error) return { ok: true, week, day };
  if (error.code !== '23505') logError('web_quiz.ch_daily_claim_failed', { code: error.code || null, error: String(error.message || error).slice(0, 120) });
  return { ok: false, week, day, reason: error.code === '23505' ? 'already_ran_today' : 'claim_failed' };
}

/** Delete the kept readings past their keep date; returns { n, oldest_age_d }. */
async function purgeKept(now, max) {
  const Ch = require('./web-quiz-challenge');
  const r2 = require('../../storage/r2');
  const out = { n: 0, oldest_age_d: null };
  // Only rows with a keep date (kept_ok, by the table's CHECK) and a reading still named: kept_no / not_asked rows
  // have neither and are never read here, so R2 is never asked about them.
  const { data, error } = await supabase.from(TABLE).select('id, meta, scored_at, audio_keep_until')
    .not('audio_keep_until', 'is', null).lt('audio_keep_until', new Date(now).toISOString())
    .not('meta->>audio_key', 'is', null)
    .order('audio_keep_until', { ascending: true }).limit(max);
  if (error) {
    logError('web_quiz.ch_audio_purge_read_failed', { code: error.code || null, error: String(error.message || error).slice(0, 120) });
    return out;
  }
  for (const row of data || []) {
    const key = row.meta && row.meta.audio_key;
    if (!Ch.isKeptKey(key)) continue;   // never outside this env's kept prefix
    let gone = false;
    try { gone = await r2.deleteKey(key, { bucket: Ch.childVoiceBucket() }); } catch (_) { gone = false; }
    if (!gone) {
      logError('web_quiz.ch_voice_not_deleted', { reason: 'purge_delete_failed' });
      continue;
    }
    await Ch.forgetAudioKey(row.id, key, { now });
    out.n += 1;
    const since = Date.parse(row.scored_at || '') || (Date.parse(row.audio_keep_until) - 90 * DAY_MS);
    const age = Math.floor((now - since) / DAY_MS);
    if (Number.isFinite(age) && (out.oldest_age_d == null || age > out.oldest_age_d)) out.oldest_age_d = age;
  }
  return out;
}

const errText = (e) => String(e && e.message || e).slice(0, 120);

/** On the first PKT day of a month: the month just ended (YYYY-MM); else null. */
function monthJustEnded(now) {
  const d = pktDay(now);
  if (d.slice(8) !== '01') return null;
  const y = Number(d.slice(0, 4)); const m = Number(d.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * The daily job, once per PKT day. The binding expiry runs whatever the switches say (when its module is present);
 * every other part only under its own switch (the module header). Every switch off and no expiry module ⇒ nothing.
 */
async function dailyJob({ now = Date.now(), max = MAX_PER_TICK, flags = null } = {}) {
  const f = flags || await switches();
  const Bind = optional('./web-quiz-bind-expiry');
  const hasExpiry = !!Bind && typeof Bind.expireBindings === 'function';
  const anyOn = !!(f.purge || f.sweeper);
  // The first PKT day of a month: the calibration of the month just ended is scheduled whatever our switches say
  // (the call is ours; the calibration job's own switches decide whether it runs).
  const period = monthJustEnded(now);
  const Cal = period ? optional('./web-quiz-challenge-calibration') : null;
  const hasCal = !!Cal && typeof Cal.runMonthly === 'function';
  // The rung job's deferred settle (web-quiz-rungs.js settleDeferred, when present): once per daily run, and only with
  // the rung switch on (off ⇒ no day claimed for it, nothing written). Absent ⇒ nothing, no log.
  const Rungs = f.rungs ? optional('./web-quiz-rungs') : null;
  const hasSettle = !!Rungs && typeof Rungs.settleDeferred === 'function';
  // The class sample windows (web-quiz-sample-window.js daily, shipped with the class round): scheduled here, its own
  // switches decide. Absent ⇒ nothing, no log.
  const Win = optional('./web-quiz-sample-window');
  // Its own switches off ⇒ not scheduled at all (no day claimed for it, nothing written).
  const hasWin = !!Win && typeof Win.daily === 'function' && typeof Win.switchesOn === 'function' && await Win.switchesOn();
  if (!anyOn && !hasExpiry && !hasCal && !hasSettle && !hasWin) return { ran: false, reason: 'off' };
  const claim = await claimDay(now);
  if (!claim.ok) return { ran: false, reason: claim.reason };
  const out = { ran: true, day: claim.day, purged: null, bindings: false, strip: null, replyCap: null, windows: null, calibration: null, settled: null };

  // Retention outlives every switch: the expiry runs whenever its module is deployed.
  if (hasExpiry) {
    try { await Bind.expireBindings(new Date(now)); out.bindings = true; } catch (e) {
      logError('web_quiz.ch_daily_bind_expiry_failed', { error: String(e && e.message || e).slice(0, 80) });
    }
  } else {
    logToFile('Challenge daily job: binding expiry not available, skipped', { day: claim.day });
  }
  if (hasCal) {
    try { out.calibration = await Cal.runMonthly({ period_id: period, now: new Date(now) }); } catch (e) {
      logError('web_quiz.ch_calibration_call_failed', { period_id: period, error: errText(e) });
    }
  }
  if (hasWin) {
    try { out.windows = await Win.daily({ now }); } catch (e) {
      logError('web_quiz.ch_sample_window_failed', { error: errText(e) });
    }
  }
  if (hasSettle) {
    try { out.settled = await Rungs.settleDeferred({ now }); } catch (e) {
      logError('web_quiz.ch_rung_settle_failed', { error: errText(e) });
    }
  }
  if (!anyOn) return out;

  if (f.purge) {
    const p = await purgeKept(now, max);
    out.purged = p.n;
    logEvent('web_quiz.ch_audio_purged', { n: p.n, oldest_age_d: p.oldest_age_d, reason: 'age', w: 's' });
    await supabase.from(STRIP_TABLE).update({ value: p.n, n: p.n }).eq('week', claim.week).eq('line', 'daily_job').eq('cell', claim.day);
  }

  // Every day (sweeper switch): yesterday's (PKT) reply-cap counts, before the 24-h Redis counters expire.
  // On a Monday this runs first, so the weekly numbers below include Sunday.
  if (f.sweeper) {
    try { out.replyCap = await require('./web-quiz-strip').replyCapSnapshot({ now }); } catch (e) {
      logError('web_quiz.strip_reply_cap_failed', { error: errText(e) });
    }
  }

  // Monday (PKT): last week's numbers. Read-side, under the sweeper switch (one switch fewer).
  if (f.sweeper && new Date(now + PKT_MS).getUTCDay() === 1) {
    const Strip = require('./web-quiz-strip');
    const week = Strip.isoWeekOf(now - 7 * DAY_MS);
    try { out.strip = await Strip.weeklyStrip({ week, now }); } catch (e) {
      logError('web_quiz.strip_failed', { week, error: errText(e) });
    }
  }
  return out;
}

/** One housekeeping tick (the worker's hourly Challenge tick): the sweep under its switch, then the daily job. Never throws. */
async function tick({ now = Date.now() } = {}) {
  try {
    const flags = await switches();
    const sweep = flags.sweeper ? await sweepStuck({ now, flags }) : null;
    const daily = await dailyJob({ now, flags });
    if (!sweep && !daily.ran && daily.reason === 'off') return { off: true };
    return { sweep, daily };
  } catch (e) {
    logToFile('Error in challenge housekeeping tick (non-fatal)', { error: String(e && e.message || e).slice(0, 120) });
    return { error: true };
  }
}

module.exports = {
  tick, sweepStuck, dailyJob, switches, failReasonOf, pktDay,
  FAIL_REASONS, SWEEPER_KEY, PURGE_KEY, STUCK_MS, SERVED_MS, MAX_PER_TICK,
  __reset: () => {},
};
