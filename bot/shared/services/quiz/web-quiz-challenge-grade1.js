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
 * `exposure_no` = `meta.anchor_serves_any` = 1 + every earlier G1A row. Every serve logs its challenge_draws row as
 * the A1 warm-up does (ITEMS §1.5: `stop='numbers'`, `fixed_grade_band='G1'`, `band_reason='anchor'`, `p=1`,
 * `served_id='G1A'`); the run row carries `draw_seed` and `meta.draw`. A serve whose row is not stored is refused
 * (503 unavailable): a counted run never exists only in this process. At the first counted play the year's fixed
 * grade is written (child_identity); `class_id` is the active enrolment's; a finished first exposure in a class lights
 * the class light. Rows, the pick, the fixed grade, periods and the record rule are all the draw module's
 * (web-quiz-challenge-draw.js): one implementation. Grade-1 rows are their own statement line (form G1), never pooled.
 *
 * Wired from web-quiz-challenge.js through `withDeps` (its switch reader, its row insert, its error type), so this
 * module never requires that one (no cycle) and the switch cache is the one `__reset` clears. This module logs no
 * ch_open / ch_start: the base's menu() and exercise() emit them (one writer per event); exercise() here returns the
 * ch_start fields for that call site.
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
// The Challenge v2 rules (periods, record at serve, exposure counts) are the draw module's; required on use.
const Draw = () => require('./web-quiz-challenge-draw');

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

/**
 * The record rule at serve (the draw module's, as for the A1 warm-up), from this child's rows: `mode`, `record`,
 * `exposure_no` (= anchorServesAny: every earlier G1A serve, as the draw PR writes for an anchor block),
 * `anchor_exposure_no` (= anchorExposureNo: earlier `mode='check'` G1A rows; practice never increments it).
 * With a period: a record row of this stop in the period (any status) holds the record. Without: record NULL and a
 * scored run makes the next one practice (today's first-attempt rule, as the draw PR does).
 */
function recordAtServe(rows, periodId, { askedMode = null, notHomeAttempt = () => false } = {}) {
  const D = Draw();
  // without a period: a scored run that was the child's own attempt (a round turn or a practice play is not: notHomeAttempt)
  const counted = periodId
    ? D.countedThisPeriod(rows, EXERCISE, periodId)
    : (rows || []).some((r) => r.exercise === EXERCISE && r.status === 'scored' && !notHomeAttempt(r));
  // the caller's mode, as the v2 serve takes it: 'class_round' (the teacher's round) or 'practice'; else practice when counted
  const mode = askedMode === 'class_round' ? 'class_round' : (askedMode === 'practice' || counted ? 'practice' : 'check');
  const exposureNo = D.anchorServesAny(rows, BLOCK);
  return {
    mode,
    // an anchor block is met again every counted Trail, so the first-exposure condition does not apply (as for A1)
    record: periodId ? D.recordAtServe({ mode, outcome: 'served', countedThisPeriod: counted, exposureNo, anchor: true }) : null,
    exposure_no: exposureNo,
    anchor_exposure_no: D.anchorExposureNo(rows, BLOCK),
  };
}

function withDeps({ settingOn, insertRun, fail, bank, viaOf = (v) => v || null, afterFinish = async () => {},
  notHomeAttempt = () => false, classWeekOn = async () => false }) {
  const on = async () => (await settingOn(V2_FLAG_KEY)) && (await settingOn(G1_FLAG_KEY));
  const items = () => bank().anchorBlock(BLOCK).map((i) => ({ item_id: i.item_id, n: i.n, layout: i.layout, tiles: i.tiles.slice() }));

  // The period holding now (challenge_periods via the draw module, 30-s cache); none ⇒ the period rule's OFF path.
  async function periodId(now) {
    if (!(await settingOn(PERIOD_FLAG_KEY))) return null;
    const D = Draw();
    const id = D.periodIdFor(new Date(now), await D.periods());
    if (!id) D.notePeriodMissing(now);
    return id;
  }

  async function canonicalOf(studentId) {
    try { return await require('./web-quiz-identity-roster').canonicalStudentId(studentId); } catch (_) { return studentId; }
  }

  /** The G1 child's menu: the one stop, done once this period's (or, period rule off, the) record row is final. */
  async function menu(w) {
    const now = Date.now();
    const D = Draw();
    const pid = await periodId(now);
    const rows = await D.childRows(await canonicalOf(w.studentId), [w.studentId]);
    // with a period: this period's record row is final (trailState's rule; its STOPS list has no 'numbers', so it is
    // applied to this stop's rows here); without: a scored run that was the child's own attempt (a round turn or a
    // practice play marks nothing done: notHomeAttempt, as the v2 menu)
    const mine = rows.filter((r) => r.exercise === EXERCISE);
    const done = pid
      ? mine.some((r) => r.period_id === pid && r.record === true && (r.status === 'scored' || r.status === 'failed'))
      : mine.some((r) => r.status === 'scored' && !notHomeAttempt(r));
    return {
      form: 'G1',
      lang: w.lang,
      exercises: [{ id: EXERCISE, copy_keys: COPY_KEYS, mins: 2, done, last: null, anchor_block: BLOCK }],
      record: true,
      period_id: pid,
      rt: await require('./web-quiz-telemetry').flag(),
    };
  }

  /**
   * Serve the G1A block: decide mode and record now, insert the run row (served; refused 503 when not stored), log
   * the draw row, write the year's fixed grade at a first counted play, mint the run token. Returns the page payload
   * and the ch_start fields (`startEv`, `run`) for the base exercise()'s one ch_start call site.
   */
  async function exercise(w, ex, { device = null, mode: askedMode = null } = {}) {
    if (w.form !== FORM || ex !== EXERCISE) fail(404, 'not_found');
    const D = Draw();
    const now = Date.now();
    const Bank = bank();
    const served = items();
    const pid = await periodId(now);
    const canonicalId = await canonicalOf(w.studentId);
    const [rows, pick, fixed, classId] = await Promise.all([D.childRows(canonicalId, [w.studentId]),
      D.pickOf({ sessionId: w.sessionId || null, canonicalId, device }), D.fixedGradeOf(canonicalId, w.grade), D.activeClassOf([canonicalId, w.studentId])]);
    const rec = recordAtServe(rows, pid, { askedMode, notHomeAttempt });
    const via = viaOf(w.via);
    // the sampling fields, as the v2 serve decides them (draw module's adminFields, the same class-week switch)
    const admin = await D.adminFields({ mode: rec.mode, via, canonicalId, at: new Date(now), classWeekOn: via === 'class_link' && (await classWeekOn()) });
    const runId = crypto.randomUUID();
    const seed = crypto.randomBytes(16).toString('hex');
    const at = new Date(now).toISOString();
    const drawLog = { draw_id: crypto.randomUUID(), canonical_id: canonicalId, period_id: pid, stop: EXERCISE, lang: w.lang, fixed_grade_band: 'G1',
      drawn_at: at, weights_v: 'w1', open_band: null, band: null, band_reason: 'anchor', eligible: [{ id: BLOCK, w: 1 }], eligible_n: 1,
      ref_eligible: false, p: 1, served_id: BLOCK, outcome: 'served', seed };
    const row = {
      id: runId, student_id: w.studentId, exercise: EXERCISE, grade: w.grade, lang: w.lang, status: 'served', created_at: at,
      started_at: at, bank_version: Bank.versionV4, set: 'A', form: 'G1', passage_id: null, item_set_id: null,
      mode: rec.mode, period_id: pid, exposure_no: rec.exposure_no, band: null, anchor_block: BLOCK,
      anchor_exposure_no: rec.anchor_exposure_no, draw_seed: seed, canonical_id: canonicalId,
      id_src: pick.id_src, id_confidence: pick.id_confidence, homonym_in_list: pick.homonym_in_list,
      via, share_code_id: w.shareCodeId || null, record: rec.record, class_id: classId,
      admin_mode: admin.admin_mode, sample_arm: admin.sample_arm, anchor_serves_any: rec.exposure_no,   // every G1 row is block G1A
      meta: { fixed_band: 'G1', grade_fixed_src: fixed.src, grade_source: w.gradeSource || null, test: !!w.test, pick_src: pick.pick_src,
        anchor_serves_any: rec.exposure_no, admin_mode: admin.admin_mode, sample_arm: admin.sample_arm, items: served.map((i) => i.item_id),
        draw: { draw_id: drawLog.draw_id, outcome: 'served', eligible: drawLog.eligible, eligible_n: 1, ref_eligible: false, p: 1, band_reason: 'anchor', weights_v: 'w1', seed } },
    };
    // ⛔ M5: a counted run exists only as a stored row; never a run kept in this process
    if ((await insertRun(row)) !== 'stored') fail(503, 'unavailable');
    await D.logDraw({ ...drawLog, run_id: runId });
    // IDENTITY §16: the year's fixed grade at the first counted play (the visit's grade; never changed after)
    if (rec.record === true && rec.mode === 'check') await D.writeChildIdentity({ canonicalId, grade: w.grade, gradeSource: w.gradeSource, now: new Date(now) });
    const ct = T.signChallenge({ studentId: w.studentId, ex: EXERCISE, runId });
    const event = { w: 's', mode: rec.mode, period_id: pid, form: 'G1', band: null, rung: null, item_set_id: null,
      exposure_no: rec.exposure_no, anchor_exposure_no: rec.anchor_exposure_no, anchor_serves_any: rec.exposure_no, anchor_block: BLOCK, record: rec.record, via };
    return {
      payload: {
        ex: EXERCISE, form: 'G1', lang: w.lang, ct, copy_keys: COPY_KEYS,
        items: served, anchor_block: BLOCK, stop_after: 0, per_item_s: PER_ITEM_S, show_timer: false, sound_off_safe: true,
        mode: rec.mode, record: rec.record, period_id: pid, passage_id: null, item_set_id: null, exposure_no: rec.exposure_no, band: null,
        anchor_exposure_no: rec.anchor_exposure_no, draw: { outcome: 'served' },
      },
      startEv: { step: EXERCISE, grade: w.grade, run: runId, ...event },
      run: { ...event, canonical_id: canonicalId },
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
    if (error) fail(isMissingTable(error) ? 503 : 502, isMissingTable(error) ? 'unavailable' : 'db_unavailable');
    if (!row) fail(404, 'not_found');
    if (row.status !== 'served') fail(409, 'already_done');
    const { score, rows } = scoreNumberId(items(), body.taps);
    const meta = { ...(row.meta || {}), ms: Number(body.ms) || null, ...((await settingOn(ITEMS_FLAG_KEY)) ? { items: rows } : {}) };
    const at = new Date(Date.now()).toISOString();
    const patch = { status: 'scored', score, scored_at: at, helped: helpedCol(body.helped), meta };
    const { data: hit, error: upErr } = await supabase.from(TABLE).update(patch).eq('id', c.r).eq('status', 'served').select('id');
    if (upErr) {
      logError('web_quiz.challenge_store_failed', { runId: c.r, missingTable: isMissingTable(upErr), error: String(upErr.message || '').slice(0, 200) });
      fail(503, 'unavailable');
    }
    if (!hit || !hit.length) fail(409, 'already_done');
    // as every stop's finish: the measurement outcome (m_result) then the phone bindings (base helpers), then the light
    await afterFinish(c.r, c.sid);
    await lightIfFirst(c.r);
    logEvent('web_quiz.ch_done', { step: EXERCISE, count: score.correct, n: score.n, stopped: false, run: c.r });
    return { score };
  }

  // A finished first exposure in a class lights the class light (the draw module's lightLit). Never throws.
  async function lightIfFirst(id) {
    try {
      const { data, error } = await supabase.from(TABLE).select('id, exercise, status, mode, exposure_no, class_id, anchor_block, canonical_id').eq('id', id).maybeSingle();
      if (!error && data && data.mode != null) Draw().lightLit(data);
    } catch (e) {
      logError('web_quiz.ch_light_failed', { error: String(e && e.message || e).slice(0, 120) });
    }
  }

  function reset() { /* nothing kept in this process */ }

  return { on, menu, exercise, submit, challengeOf, reset, FORM, EXERCISE, BLOCK };
}

module.exports = {
  withDeps, scoreNumberId, recordAtServe,
  FORM, EXERCISE, BLOCK, V2_FLAG_KEY, G1_FLAG_KEY, PERIOD_FLAG_KEY, PER_ITEM_S, COPY_KEYS,
};
