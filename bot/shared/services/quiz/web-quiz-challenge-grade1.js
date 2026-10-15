'use strict';
/**
 * The Challenge's grade-1 form: number identification ("how many dots?"), form G1, ONE counted stop.
 *
 * Behind `web_quiz_challenge_g1` under `web_quiz_challenge_v2` (and `web_quiz_challenge`), all OFF by default on every
 * tier. Off ⇒ formFor(1) stays null and a grade-1 child is `not_eligible` exactly as today (web-quiz-challenge.js).
 *
 * The stop is the exercise `numbers` (already in the runs table's `exercise` CHECK) served as anchor block G1A of
 * item-bank.v4.json: ten items in a fixed order (3 7 1 9 4 10 2 6 0 8), k dots in a ten-frame and three numeral tiles,
 * one tap each. The same items in both languages (only the voice would follow `lang`); nothing is audio-only, so the
 * payload says `sound_off_safe`. No read, no listen, no bigger, no mic, no typing, no timer shown; no consecutive-error
 * stop (every child sees all ten, so `anchor_exposure_no` means the same for everyone).
 *
 * The run row is inserted at SERVE (status `served`) with `form='G1'`, `anchor_block='G1A'`, `band` NULL, `mode`,
 * `record`, `period_id`, `exposure_no`, `anchor_exposure_no` and `canonical_id`; the submit updates that row to `scored`.
 * The record rule is the Challenge's v2 rule for the A1 warm-up (ITEMS §4, §5.6), applied to G1A:
 *   `web_quiz_challenge_period` ON and a challenge_periods row holds now: one record per canonical child × this stop ×
 *     period, decided at serve (`record` true/false; a served row holds it, finished or not); a replay is `practice`;
 *   otherwise: `record` NULL and `period_id` NULL; a replay after a scored run is `practice` (today's first-attempt rule).
 * `anchor_exposure_no` = 1 + this child's earlier `mode='check'` G1A rows (practice never increments it);
 * `exposure_no` = `meta.anchor_serves_any` = 1 + every earlier G1A row. No challenge_draws row: nothing is drawn (the
 * block is fixed) and that table's `stop` CHECK has no `numbers`. Grade-1 rows are their own statement line (form G1),
 * never pooled with G3/G5.
 *
 * Wired from web-quiz-challenge.js through `withDeps` (its switch reader, its row insert, its error type), so this
 * module never requires that one (no cycle) and the switch cache is the one `__reset` clears.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');

const FORM = '1';
const EXERCISE = 'numbers';
const BLOCK = 'G1A';
const V2_FLAG_KEY = 'web_quiz_challenge_v2';
const G1_FLAG_KEY = 'web_quiz_challenge_g1';
const PERIOD_FLAG_KEY = 'web_quiz_challenge_period';
const ITEMS_FLAG_KEY = 'web_quiz_challenge_items';
const TABLE = 'web_quiz_challenge_runs';
const PER_ITEM_S = 10;
const MAX_MS = 10 * 60 * 1000;
// The copy deck's keys (COPY.md jg.g1.*); their strings are not in ux-strings yet, so the page resolves them itself.
const COPY_KEYS = Object.freeze({ title: 'jg.g1.title', say: 'jg.g1.say' });

const isMissingTable = (e) => !!e && (e.code === '42P01' || /does not exist|schema cache/i.test(String(e.message || '')));
const helpedCol = (v) => (v === true ? 'helped' : v === false ? 'self' : 'not_asked');
// how the child came (the run row's `via`): a hub token, or a quiz session (the scorecard's card)
const VIA = { hub: 'hub', quiz: 'quiz_card' };
const ROW_COLS = 'id, student_id, exercise, status, mode, period_id, anchor_block, record, created_at';

/**
 * "How many?" from the phone's taps [{i, pick, ms, first_tap_ms}] against the served items ({n} each): a pick equal to
 * n within PER_ITEM_S is right; no tap, a late tap or another numeral is wrong. No stop. The per-item rows (numbers
 * only) keep the timings for the row; nothing in them is shown to the child.
 */
function scoreNumberId(items, taps) {
  const byI = new Map();
  for (const t of Array.isArray(taps) ? taps.slice(0, 50) : []) {
    const i = Number(t && t.i);
    if (Number.isInteger(i) && i >= 0 && i < items.length && !byI.has(i)) byI.set(i, t);
  }
  const num = (v) => (v != null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(MAX_MS, Math.round(Number(v))) : null);
  const rows = items.map((it, i) => {
    const t = byI.get(i);
    const pick = t && Number.isInteger(Number(t.pick)) ? Number(t.pick) : null;
    const ms = t ? num(t.ms) : null;
    const ok = t ? (pick === it.n && ms != null && ms <= PER_ITEM_S * 1000) : null;
    return { i: i + 1, item_id: it.item_id || null, pick, ok, ms, first_tap_ms: t ? num(t.first_tap_ms) : null };
  });
  return { score: { correct: rows.filter((r) => r.ok === true).length, n: items.length, stopped: false }, rows };
}

/** The period whose [starts_at, ends_at) holds `now`, from challenge_periods rows; null when none does. */
function periodIdFor(now, periods) {
  const hit = (periods || []).find((p) => Date.parse(p.starts_at) <= now && now < Date.parse(p.ends_at));
  return hit ? hit.period_id : null;
}

/**
 * The record rule at serve, from this child's earlier `numbers` rows: `mode`, `record`, `exposure_no`,
 * `anchor_exposure_no`. With a period: a record row of the period (any status) holds it. Without: record NULL and a
 * scored run makes the next one practice.
 */
function recordAtServe(rows, periodId) {
  const mine = (rows || []).filter((r) => r.exercise === EXERCISE);
  const own = mine.filter((r) => r.anchor_block === BLOCK);
  const counted = periodId
    ? mine.some((r) => r.period_id === periodId && r.record === true)
    : mine.some((r) => r.status === 'scored');
  const mode = counted ? 'practice' : 'check';
  return {
    mode,
    record: periodId ? mode === 'check' : null,
    exposure_no: own.length + 1,
    anchor_exposure_no: own.filter((r) => r.mode === 'check').length + 1,
  };
}

function withDeps({ settingOn, insertRun, fail, bank }) {
  const on = async () => (await settingOn(V2_FLAG_KEY)) && (await settingOn(G1_FLAG_KEY));
  const items = () => bank().anchorBlock(BLOCK).map((i) => ({ item_id: i.item_id, n: i.n, layout: i.layout, tiles: i.tiles.slice() }));
  const MEM = new Map();   // runId → { status } for a run whose row could not be stored (the table not migrated yet)

  let periodMissLogged = null;
  async function periodId(now) {
    if (!(await settingOn(PERIOD_FLAG_KEY))) return null;
    const { data, error } = await supabase.from('challenge_periods').select('period_id, starts_at, ends_at');
    const id = error ? null : periodIdFor(now, data || []);
    // no period holds now: the period rule's OFF path; said once per process per PKT day
    const day = new Date(now + 5 * 3600 * 1000).toISOString().slice(0, 10);
    if (!id && periodMissLogged !== day) {
      periodMissLogged = day;
      logError('web_quiz.ch_period_missing', { day, form: 'G1', missing: isMissingTable(error) });
    }
    return id;
  }

  // The canonical child's `numbers` rows: by canonical_id, and by the raw student id for rows written before it.
  async function childRows(canonicalId, studentId) {
    const ids = [...new Set([canonicalId, studentId].filter(Boolean).map(String))];
    const [a, b] = await Promise.all([
      supabase.from(TABLE).select(ROW_COLS).eq('canonical_id', canonicalId).eq('exercise', EXERCISE).limit(5000),
      supabase.from(TABLE).select(ROW_COLS).in('student_id', ids).eq('exercise', EXERCISE).limit(5000),
    ]);
    const err = a.error || b.error;
    if (err) logError('web_quiz.ch_rows_read_failed', { form: 'G1', missing: isMissingTable(err), code: err.code || null });
    const byId = new Map();
    for (const r of [...(a.data || []), ...(b.data || [])]) byId.set(r.id, r);
    return [...byId.values()].sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')));
  }

  // The fixed grade's source (child_identity when it is deployed); the form itself is who()'s, from the visit's grade.
  async function fixedGradeSrc(canonicalId) {
    const { data, error } = await supabase.from('child_identity').select('canonical_id, fixed_grade').eq('canonical_id', canonicalId).maybeSingle();
    if (!error && data && Number(data.fixed_grade) === 1) return 'child_identity';
    return error && isMissingTable(error) ? 'visit_grade_no_table' : 'visit_grade';
  }

  async function canonicalOf(studentId) {
    try { return await require('./web-quiz-identity-roster').canonicalStudentId(studentId); } catch (_) { return studentId; }
  }

  // The identity pick fields come from the identity module when it is deployed; until then NULL, and the row says so.
  async function pickOf({ sessionId = null, canonicalId = null, device = null } = {}) {
    const none = { cols: { id_src: null, id_confidence: null, homonym_in_list: null }, src: 'absent' };
    let mod = null;
    try { mod = require('./web-quiz-bind-page'); } catch (_) { mod = null; }
    if (!mod || typeof mod.pickFor !== 'function') return none;
    try {
      const p = await mod.pickFor({ sessionId, canonicalId, device });
      if (!p || typeof p !== 'object') return none;
      return { cols: { id_src: p.id_src == null ? null : p.id_src, id_confidence: p.id_confidence == null ? null : p.id_confidence,
        homonym_in_list: typeof p.homonym_in_list === 'boolean' ? p.homonym_in_list : null }, src: 'pick' };
    } catch (e) {
      logError('web_quiz.ch_pick_read_failed', { error: String(e && e.message || e).slice(0, 120) });
      return { ...none, src: 'failed' };
    }
  }

  /** The G1 child's menu: the one stop, done once this period's (or, period rule off, the) record row is final. */
  async function menu(w) {
    const now = Date.now();
    const pid = await periodId(now);
    const rows = await childRows(await canonicalOf(w.studentId), w.studentId);
    // with a period: this period's record row is final; without: a scored run (today's first-attempt rule)
    const done = pid
      ? rows.some((r) => r.period_id === pid && r.record === true && (r.status === 'scored' || r.status === 'failed'))
      : rows.some((r) => r.status === 'scored');
    logEvent('web_quiz.ch_open', { via: w.via, grade: w.grade });
    return {
      form: 'G1',
      lang: w.lang,
      exercises: [{ id: EXERCISE, copy_keys: COPY_KEYS, mins: 2, done, last: null, anchor_block: BLOCK }],
      record: true,
      period_id: pid,
      rt: await require('./web-quiz-telemetry').flag(),
    };
  }

  /** Serve the G1A block: insert the run row (served), decide mode and record now, mint the run token. */
  async function exercise(w, ex, { device = null } = {}) {
    if (w.form !== FORM || ex !== EXERCISE) fail(404, 'not_found');
    const now = Date.now();
    const Bank = bank();
    const served = items();
    const pid = await periodId(now);
    const canonicalId = await canonicalOf(w.studentId);
    const rec = recordAtServe(await childRows(canonicalId, w.studentId), pid);
    const pick = await pickOf({ sessionId: w.sessionId || null, canonicalId, device });
    const gradeSrc = await fixedGradeSrc(canonicalId);
    const via = VIA[w.via] || w.via || null;
    const runId = crypto.randomUUID();
    const ct = T.signChallenge({ studentId: w.studentId, ex: EXERCISE, runId });
    const at = new Date(now).toISOString();
    const row = {
      id: runId, student_id: w.studentId, exercise: EXERCISE, grade: w.grade, lang: w.lang, status: 'served', created_at: at,
      started_at: at, bank_version: Bank.versionV4, set: 'A', form: 'G1', passage_id: null, item_set_id: null,
      mode: rec.mode, period_id: pid, exposure_no: rec.exposure_no, band: null, anchor_block: BLOCK,
      anchor_exposure_no: rec.anchor_exposure_no, draw_seed: null, canonical_id: canonicalId, ...pick.cols,
      via, share_code_id: w.shareCodeId || null, record: rec.record,
      meta: { fixed_band: 'G1', grade_fixed_src: gradeSrc, grade_source: w.gradeSource || null, test: !!w.test, pick_src: pick.src,
        anchor_serves_any: rec.exposure_no, items: served.map((i) => i.item_id) },
    };
    const stored = await insertRun(row);
    if (stored !== 'stored') MEM.set(runId, { status: 'open', row });
    logEvent('web_quiz.ch_start', {
      step: EXERCISE, grade: w.grade, run: runId, w: 's', mode: rec.mode, period_id: pid, form: 'G1', band: null, rung: null, item_set_id: null,
      exposure_no: rec.exposure_no, anchor_exposure_no: rec.anchor_exposure_no, anchor_serves_any: rec.exposure_no, anchor_block: BLOCK, record: rec.record, via,
    });
    return {
      ex: EXERCISE, form: 'G1', lang: w.lang, ct, copy_keys: COPY_KEYS,
      items: served, anchor_block: BLOCK, stop_after: 0, per_item_s: PER_ITEM_S, show_timer: false, sound_off_safe: true,
      mode: rec.mode, record: rec.record, period_id: pid, passage_id: null, item_set_id: null, exposure_no: rec.exposure_no, band: null,
      anchor_exposure_no: rec.anchor_exposure_no, draw: null,
    };
  }

  /** A run token for this stop, verified, or null (every other token takes today's path). */
  function challengeOf(ct) {
    const c = T.verify(ct, 'c');
    return c && c.ex === EXERCISE && c.r && c.sid ? c : null;
  }

  /** Score the taps against the served block and move the served row to scored (once). */
  async function submit(c, body = {}) {
    if (!(await on())) fail(403, 'not_eligible');
    const { data: row, error } = await supabase.from(TABLE).select('id, status, meta').eq('id', c.r).maybeSingle();
    const mem = MEM.get(c.r);
    if (error && !isMissingTable(error)) fail(502, 'db_unavailable');
    if (!row && !mem) fail(404, 'not_found');
    if ((row && row.status !== 'served') || (mem && mem.status !== 'open')) fail(409, 'already_done');
    const { score, rows } = scoreNumberId(items(), body.taps);
    const meta = { ...((row && row.meta) || (mem && mem.row.meta) || {}), ms: Number(body.ms) || null,
      ...((await settingOn(ITEMS_FLAG_KEY)) ? { items: rows } : {}) };
    const at = new Date(Date.now()).toISOString();
    const patch = { status: 'scored', score, scored_at: at, helped: helpedCol(body.helped), meta };
    if (row) {
      const { data: hit, error: upErr } = await supabase.from(TABLE).update(patch).eq('id', c.r).eq('status', 'served').select('id');
      if (upErr) logError('web_quiz.challenge_store_failed', { runId: c.r, missingTable: isMissingTable(upErr), error: String(upErr.message || '').slice(0, 200) });
      else if (!hit || !hit.length) fail(409, 'already_done');
    } else {
      MEM.set(c.r, { status: 'done', row: { ...mem.row, ...patch } });
    }
    logEvent('web_quiz.ch_done', { step: EXERCISE, count: score.correct, n: score.n, stopped: false, run: c.r });
    return { score };
  }

  function reset() { MEM.clear(); periodMissLogged = null; }

  return { on, menu, exercise, submit, challengeOf, reset, FORM, EXERCISE, BLOCK };
}

module.exports = {
  withDeps, scoreNumberId, periodIdFor, recordAtServe,
  FORM, EXERCISE, BLOCK, V2_FLAG_KEY, G1_FLAG_KEY, PERIOD_FLAG_KEY, PER_ITEM_S, COPY_KEYS,
};
