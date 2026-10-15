'use strict';
/**
 * The Challenge's housekeeping, run from the worker's hourly Challenge tick (sqs-worker.js scheduleChallengeVoiceSweep,
 * main-queue replicas). Two switches, each OFF by default and effective only with `web_quiz_challenge` on:
 *
 *   web_quiz_challenge_sweeper     (read-side) the stuck-run sweep, every tick:
 *                                  - a run left in 'scoring' more than 10 minutes becomes 'failed' with meta.fail_reason
 *                                    (stt_timeout | llm_timeout | page_gone | store_failed | unknown) and one
 *                                    web_quiz.ch_swept{run, age_min, reason}; a v2 row (mode set) also logs
 *                                    web_quiz.m_lost{reason:'swept'} when web_quiz_events_v2 is on
 *                                  - a 'served' run never played for 24 hours becomes 'abandoned' (a count only)
 *                                  and, on Mondays, the weekly health numbers for the week just ended (web-quiz-strip.js)
 *   web_quiz_challenge_audio_purge (read-side) a DESIGNED OPTION, kept OFF: the operator's decision is to keep every
 *                                  kept reading until the operator says otherwise; this switch must stay off. When on:
 *                                  each kept reading past its audio_keep_until is deleted from R2 and its row stops
 *                                  pointing at it (forgetAudioKey); one web_quiz.ch_audio_purged{n, oldest_age_d,
 *                                  reason:'age'} a day, also when n is 0 (it proves the purge ran)
 *
 * The daily job runs once per PKT day across every replica when EITHER switch above is on. Inside it, each part has
 * its own switch: the purge (web_quiz_challenge_audio_purge), the phone-binding expiry (web-quiz-bind-expiry.js
 * expireBindings, when present) only with web_quiz_phone_bind on (under web_quiz_identity_canon), and the Monday
 * weekly numbers (web_quiz_challenge_sweeper).
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
// The binding expiry belongs to the phone binding: only with web_quiz_phone_bind on (its parent web_quiz_identity_canon).
const BIND_KEY = 'web_quiz_phone_bind';
const IDENTITY_KEY = 'web_quiz_identity_canon';
const TABLE = 'web_quiz_challenge_runs';
const STRIP_TABLE = 'web_quiz_strip_weekly';
const STUCK_MS = 10 * 60 * 1000;
const SERVED_MS = 24 * 60 * 60 * 1000;
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
      .in('key', [PARENT_KEY, SWEEPER_KEY, PURGE_KEY, EVENTS_V2_KEY, HUB_KEY, BIND_KEY, IDENTITY_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, isTrue(r.value)]));
    const parent = !!by[PARENT_KEY];
    return {
      sweeper: parent && !!by[SWEEPER_KEY],
      purge: parent && !!by[PURGE_KEY],
      eventsV2: !!by[HUB_KEY] && !!by[EVENTS_V2_KEY],
      phoneBind: !!by[IDENTITY_KEY] && !!by[BIND_KEY],
    };
  } catch (e) {
    logToFile('⚠️ web quiz challenge housekeeping: settings lookup failed — off', { error: String(e && e.message || e).slice(0, 120) });
    return { sweeper: false, purge: false, eventsV2: false, phoneBind: false };
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
    logEvent('web_quiz.ch_swept', { run: row.id, age_min: ageMin, reason });
    if (row.mode && f.eventsV2) emitLost({ ...row, ...written }, ageMin);
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

/**
 * The daily job. Off (both the sweeper and the purge switch) ⇒ nothing at all. Otherwise, once per PKT day:
 * the purge and its one event (purge switch only), the binding expiry (web_quiz_phone_bind only), and on a Monday
 * (PKT) the weekly numbers for the week just ended (sweeper switch only).
 */
async function dailyJob({ now = Date.now(), max = MAX_PER_TICK, flags = null } = {}) {
  const f = flags || await switches();
  if (!f.purge && !f.sweeper) return { ran: false, reason: 'off' };
  const claim = await claimDay(now);
  if (!claim.ok) return { ran: false, reason: claim.reason };
  const out = { ran: true, day: claim.day, purged: null, bindings: false, strip: null };

  if (f.purge) {
    const p = await purgeKept(now, max);
    out.purged = p.n;
    logEvent('web_quiz.ch_audio_purged', { n: p.n, oldest_age_d: p.oldest_age_d, reason: 'age' });
    await supabase.from(STRIP_TABLE).update({ value: p.n, n: p.n }).eq('week', claim.week).eq('line', 'daily_job').eq('cell', claim.day);
  }

  if (f.phoneBind) {
    const Bind = optional('./web-quiz-bind-expiry');
    if (Bind && typeof Bind.expireBindings === 'function') {
      try { await Bind.expireBindings(new Date(now)); out.bindings = true; } catch (e) {
        logError('web_quiz.ch_daily_bind_expiry_failed', { error: String(e && e.message || e).slice(0, 80) });
      }
    } else {
      logToFile('Challenge daily job: binding expiry not available, skipped', { day: claim.day });
    }
  }

  // Monday (PKT): last week's numbers. Read-side, under the sweeper switch (one switch fewer).
  if (f.sweeper && new Date(now + PKT_MS).getUTCDay() === 1) {
    const Strip = require('./web-quiz-strip');
    const week = Strip.isoWeekOf(now - 7 * DAY_MS);
    try { out.strip = await Strip.weeklyStrip({ week, now }); } catch (e) {
      logError('web_quiz.strip_failed', { week, error: String(e && e.message || e).slice(0, 120) });
    }
  }
  return out;
}

/** One housekeeping tick (the worker's hourly Challenge tick). Never throws. */
async function tick({ now = Date.now() } = {}) {
  try {
    const flags = await switches();
    if (!flags.sweeper && !flags.purge) return { off: true };
    const sweep = await sweepStuck({ now, flags });
    const daily = await dailyJob({ now, flags });
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
