'use strict';
/**
 * One tick of the nightly answer-key review flag. The worker calls run() every hour
 * (workers/quiz-key-review-schedule.js); almost every tick ends at once ("off" or "not_due").
 *
 * WHAT IT CATCHES. An item that at least MIN_ANSWERS children answered, where ONE wrong option drew at least
 * MIN_SHARE of the answers. Read by hand in Nov 2026, about one such item in five had a wrong key or no right
 * option (a cow keyed "Bhaoo, Bhaoo"); the rest were real misconceptions. Either way a person should look, so the
 * item goes to the review queue (quiz_item_reviews) and the job never decides a key itself.
 *
 * The key is the grader's key (web-quiz-items keyFor: the web item's key when the item has one, else the row's
 * correct_option), and answers count by the stored option slot, never by the position a child saw. Multi-answer
 * and ordered items are skipped: "one wrong option" is not defined for them.
 *
 * In order, each step a way out (the pattern of ab-tracker-rollup.service.js):
 *   1. The read replica (config/supabase-replica-only.js). None configured on this tier → off.
 *   2. The server must say it is a replica (rpc db_is_replica) — the FIRST call, before any other read.
 *   3. app_settings quiz_key_review_job, read on the replica: true (02:00 PKT) or
 *      {"at":"HH:MM","min_answers":20,"min_share":0.6,"recent_days":3}. No row, a malformed value or a failed read → off.
 *   4. Due from that time for DUE_WINDOW_MIN minutes; one worker per tick (claimTick), once per Pakistan date (marker).
 *   5. The answer counts (rpc quiz_key_answer_counts) for items answered in the last recent_days — on the replica.
 *   6. Writes on the PRIMARY, to quiz_item_reviews only: a new suspect is inserted 'open'; an open one has its counts
 *      refreshed; a reviewed one (any other status) is left exactly as the reviewer left it, except last_seen_on.
 *   7. A completed run with recent_days > WIDE_DAYS (the first night's backlog) narrows its own switch row back to
 *      NARROW_TO days on the PRIMARY, compare-and-set on the exact value it read (narrowSwitch), so the return to the
 *      nightly window needs no person. An operator's change made meanwhile is kept; `true` is left alone.
 * Logged with a correlation id: counts only (quiz_keys.flagged), with by_source: per source (transcript, lp, bank, story,
 * other) the count among n_total and among n_new, from ONE extra replica read for the suspects only (sourceOf); null when
 * that read fails, and the run goes on. Never throws.
 */
const { logToFile } = require('../../utils/logger');
const { logEvent, generateCorrelationId, runWithCorrelation } = require('../../utils/structured-logger');
const { pktDate, pktHour, pktMinute } = require('../nudges/pkt-time');

const SWITCH_KEY = 'quiz_key_review_job';
const TICK_KEY = 'quiz_key_review:v1:tick';
const markerKey = (date) => `quiz_key_review:v1:run:${date}`;
const MARKER_TTL_SECONDS = 36 * 60 * 60;
const TABLE = 'quiz_item_reviews';
const REASON = 'dominant_wrong_option';
/** Every reason the queue holds. 'blind_solve' rows come from a reviewed SQL fill (a blind solve of bank items), never from this job. */
const REASONS = Object.freeze([REASON, 'blind_solve']);
const DEFAULTS = Object.freeze({ at: 2 * 60, min_answers: 20, min_share: 0.6, recent_days: 3 });
const DUE_WINDOW_MIN = 90;
/** A window wider than this is a one-night backlog read; the job then narrows itself to NARROW_TO. */
const WIDE_DAYS = 7;
const NARROW_TO = 3;
const CHUNK = 200;
/** Queue states that still keep an item out of new uses (class-link's recall round reads these). */
const HELD = ['open', 'key_wrong', 'ambiguous'];
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** by_source's buckets. A bank item (external_id gen:/leg:) is 'bank' whatever its quiz; else the quiz's quiz_source. */
const SOURCES = Object.freeze(['transcript', 'lp', 'bank', 'story', 'other']);
const LP_SOURCES = new Set(['lp_v8', 'lp612', 'lesson_plan']);

/** The job's settings, or null (off). The 90-minute window must end by midnight. */
function parseSwitch(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return null; } }
  if (v === true) return { ...DEFAULTS };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = { ...DEFAULTS };
  if (v.at !== undefined) {
    const m = typeof v.at === 'string' && HHMM.exec(v.at);
    if (!m) return null;
    out.at = Number(m[1]) * 60 + Number(m[2]);
  }
  if (Number.isInteger(v.min_answers) && v.min_answers >= 5) out.min_answers = v.min_answers;
  if (typeof v.min_share === 'number' && v.min_share > 0.3 && v.min_share <= 1) out.min_share = v.min_share;
  if (Number.isInteger(v.recent_days) && v.recent_days >= 1 && v.recent_days <= 120) out.recent_days = v.recent_days;
  return out.at + DUE_WINDOW_MIN > 24 * 60 ? null : out;
}

/** → { cfg, raw } (raw = the stored value exactly as read, for the compare-and-set), or null (off). */
async function readSwitch(db) {
  try {
    const { data, error } = await db.from('app_settings').select('value').eq('key', SWITCH_KEY).maybeSingle();
    const cfg = error || !data ? null : parseSwitch(data.value);
    return cfg ? { cfg, raw: data.value } : null;
  } catch (_) {
    return null;
  }
}

/**
 * After a completed run with recent_days > WIDE_DAYS: the switch row goes back to the same value with recent_days
 * NARROW_TO, as one compare-and-set on the PRIMARY:
 *   UPDATE app_settings SET value = <narrowed> WHERE key = SWITCH_KEY AND value = <the exact value read>
 * (app_settings.value is jsonb; PostgREST compares the filter's JSON text as jsonb). A value an operator changed since
 * the read matches nothing and is kept; a value that is not an object (`true`) is left alone; a value stored as JSON
 * text is written back as text. Never throws: a failed write is logged and the wide window simply runs again the next
 * night (the queue only adds ids it has no row for).
 * @returns {Promise<boolean>} whether the row was narrowed
 */
async function narrowSwitch(writer, raw) {
  const asText = typeof raw === 'string';
  let v = raw;
  if (asText) { try { v = JSON.parse(raw); } catch (_) { return false; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const next = { ...v, recent_days: NARROW_TO };
  try {
    const { data, error } = await writer().from('app_settings')
      .update({ value: asText ? JSON.stringify(next) : next })
      .eq('key', SWITCH_KEY)
      .eq('value', JSON.stringify(raw))
      .select('key');
    if (error) throw new Error(error.message || 'app_settings update failed');
    return Array.isArray(data) && data.length === 1;
  } catch (err) {
    logToFile('⚠️ Answer-key review: the wide window could not narrow itself — the same window runs again next night', { error: err && err.message }, 'warn');
    return false;
  }
}

/**
 * The verdict for one item's answer counts: the queue row's numbers, or null when it is not a suspect.
 * @param {Object} row {question_id, correct_option, option_a..d, media, counts: {A: n, ...}, answers_n}
 */
function suspectOf(row, cfg) {
  const { keyFor } = require('./web-quiz-items');
  const key = String(keyFor(row) || '').trim().toUpperCase();
  if (!/^[A-D]$/.test(key)) return null;
  const counts = row.counts || {};
  const n = Object.values(counts).reduce((s, v) => s + (Number(v) || 0), 0);
  if (n < cfg.min_answers) return null;
  let top = null;
  for (const [opt, v] of Object.entries(counts)) {
    const o = String(opt).toUpperCase();
    if (o === key) continue;
    if (!top || Number(v) > top.n) top = { opt: o, n: Number(v) || 0 };
  }
  if (!top || top.n / n < cfg.min_share) return null;
  return {
    question_id: row.question_id, key_at_flag: key, top_wrong_option: top.opt,
    answers_n: n, top_wrong_n: top.n, right_n: Number(counts[key]) || 0,
  };
}

/** The question ids among `ids` the queue still holds (not reviewed, or reviewed as a wrong key / ambiguous). */
async function heldQuestionIds(db, ids) {
  const held = new Set();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from(TABLE).select('question_id, status').in('question_id', ids.slice(i, i + CHUNK));
    if (error) throw new Error(error.message || 'quiz_item_reviews read failed');
    for (const r of data || []) if (HELD.includes(r.status)) held.add(r.question_id);
  }
  return held;
}

/** The by_source bucket of one item: {external_id, quizzes: {quiz_source}} as the replica read returns it (or undefined). */
function sourceOf(row) {
  const ext = String((row && row.external_id) || '');
  if (ext.startsWith('gen:') || ext.startsWith('leg:')) return 'bank';
  const quiz = row && (Array.isArray(row.quizzes) ? row.quizzes[0] : row.quizzes);
  const src = quiz && quiz.quiz_source;
  if (src === 'transcript') return 'transcript';
  if (LP_SOURCES.has(src)) return 'lp';
  if (src === 'story') return 'story';
  return 'other';
}

/**
 * by_source for the run: per bucket, how many of the suspects (n_total) and of the new ones (n_new). ONE replica read,
 * for the suspects only, along quiz_questions.quiz_id → quizzes (in CHUNKs; a night has a few dozen suspects). An item
 * the read does not return counts as 'other'. Returns null when the read fails (logged); never throws.
 */
async function bySource(reader, suspects, freshIds) {
  const out = Object.fromEntries(SOURCES.map((k) => [k, { n_total: 0, n_new: 0 }]));
  if (!suspects.length) return out;
  try {
    const rowOf = new Map();
    const ids = suspects.map((s) => s.question_id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await reader.from('quiz_questions').select('id, external_id, quizzes(quiz_source)').in('id', ids.slice(i, i + CHUNK));
      if (error) throw new Error(error.message || 'quiz_questions read failed');
      for (const r of data || []) rowOf.set(r.id, r);
    }
    for (const s of suspects) {
      const b = out[sourceOf(rowOf.get(s.question_id))];
      b.n_total += 1;
      if (freshIds.has(s.question_id)) b.n_new += 1;
    }
    return out;
  } catch (err) {
    logToFile('⚠️ Answer-key review: suspects\' sources unreadable — by_source null, the run goes on', { error: err && err.message }, 'warn');
    return null;
  }
}

/** Reads the counts (replica), then writes the queue (primary). Returns the counts, with by_source. */
async function flag({ reader, writer, cfg, today }) {
  const { data, error } = await reader.rpc('quiz_key_answer_counts', { p_min_answers: cfg.min_answers, p_recent_days: cfg.recent_days });
  if (error) throw new Error(error.message || 'quiz_key_answer_counts failed');
  const suspects = (data || []).map((r) => suspectOf(r, cfg)).filter(Boolean);
  const counts = { scanned: (data || []).length, n_total: suspects.length, n_new: 0, n_open_refreshed: 0, n_reviewed_skipped: 0 };
  if (!suspects.length) return { ...counts, by_source: await bySource(reader, suspects, new Set()) };
  const db = writer();
  const existing = new Map();
  const ids = suspects.map((s) => s.question_id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data: rows, error: e } = await db.from(TABLE).select('question_id, status').eq('reason', REASON).in('question_id', ids.slice(i, i + CHUNK));
    if (e) throw new Error(e.message || 'quiz_item_reviews read failed');
    for (const r of rows || []) existing.set(r.question_id, r.status);
  }
  const fresh = suspects.filter((s) => !existing.has(s.question_id))
    .map((s) => ({ ...s, reason: REASON, first_flagged_on: today, last_seen_on: today }));
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const { error: e } = await db.from(TABLE).insert(fresh.slice(i, i + CHUNK));
    if (e) throw new Error(e.message || 'quiz_item_reviews insert failed');
  }
  counts.n_new = fresh.length;
  for (const s of suspects) {
    const status = existing.get(s.question_id);
    if (status === undefined) continue;
    // A reviewer's verdict and the numbers they judged stay as they were; only "still seen" moves.
    const patch = status === 'open'
      ? { answers_n: s.answers_n, top_wrong_n: s.top_wrong_n, right_n: s.right_n, top_wrong_option: s.top_wrong_option, key_at_flag: s.key_at_flag, last_seen_on: today }
      : { last_seen_on: today };
    const { error: e } = await db.from(TABLE).update(patch).eq('question_id', s.question_id).eq('reason', REASON);
    if (e) throw new Error(e.message || 'quiz_item_reviews update failed');
    if (status === 'open') counts.n_open_refreshed += 1; else counts.n_reviewed_skipped += 1;
  }
  counts.by_source = await bySource(reader, suspects, new Set(fresh.map((f) => f.question_id)));
  return counts;
}

async function tick({ now, redis, reader, writer }) {
  if (!reader) return { outcome: 'off', reason: 'no_replica' };
  const { checkReplica } = require('../../config/supabase-replica-only');
  const check = await checkReplica(reader);
  if (!check.ok) {
    logToFile('⚠️ Answer-key review: refused — not reading a replica; nothing read or written', { reason: check.reason }, 'warn');
    return { outcome: 'refused', reason: check.reason };
  }
  const sw = await readSwitch(reader);
  if (sw === null) return { outcome: 'off', reason: 'switch_off' };
  const { cfg } = sw;
  const minute = pktHour(now) * 60 + pktMinute(now);
  if (minute < cfg.at || minute >= cfg.at + DUE_WINDOW_MIN) return { outcome: 'not_due' };

  const { claimTick } = require('../monitoring/quiz-funnel-watch.service');
  const claim = await claimTick(redis, { tickMin: 60 }, TICK_KEY);
  if (claim !== 'owner') return { outcome: 'skipped', reason: claim };
  const today = pktDate(now);
  if (await redis.get(markerKey(today))) return { outcome: 'done_already' };

  const started = Date.now();
  const counts = await flag({ reader, writer, cfg, today });
  await redis.set(markerKey(today), now.toISOString(), MARKER_TTL_SECONDS);
  const ms = Date.now() - started;
  const narrowed = cfg.recent_days > WIDE_DAYS ? await narrowSwitch(writer, sw.raw) : false;
  const summary = { outcome: 'ran', run_date: today, ...counts, narrowed, ms };
  logEvent('quiz_keys.flagged', summary);
  return summary;
}

/**
 * @param {{ now?: Date, redis?: object, reader?: object|null, writer?: () => object }} deps all injectable; reader
 *   defaults to the replica client (null when none is configured), writer to a loader of the primary client (called
 *   only after the replica check and the switch: for a suspect, or to narrow a wide window).
 */
async function run(deps = {}) {
  const {
    now = new Date(),
    redis = require('../cache/railway-redis.service'),
    reader = require('../../config/supabase-replica-only').replicaClient(),
    writer = () => require('../../config/supabase'),
  } = deps;
  return runWithCorrelation(generateCorrelationId(), async () => {
    try {
      return await tick({ now, redis, reader, writer });
    } catch (err) {
      logToFile('❌ Answer-key review: the nightly flag stopped', { error: err && err.message }, 'error');
      return { outcome: 'error' };
    }
  });
}

module.exports = { run, parseSwitch, suspectOf, sourceOf, heldQuestionIds, SWITCH_KEY, TICK_KEY, TABLE, REASON, REASONS, DEFAULTS, HELD, DUE_WINDOW_MIN, WIDE_DAYS, NARROW_TO, SOURCES };
