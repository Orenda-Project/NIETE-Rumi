'use strict';
/**
 * The rung job: a child's Reading (R1–R5) and Numbers (N1–N5) lamps, set by the server from the Challenge's record
 * rows only, under the rule badges-v1. Switch: app_settings `web_quiz_challenge_rungs` (OFF by default; effective
 * only with `web_quiz_challenge_v2` and its parent `web_quiz_challenge` on). Its event `web_quiz.lamp_lit` also needs
 * `web_quiz_events_v2` (under `web_quiz_hub`).
 *
 *   eligible(row)      a record row: mode 'check', record true, a final status (scored | failed; a swept row is
 *                      failed), a canonical child and a period. Practice (Story Time and a teacher's device play as
 *                      practice), a class round, a replay (record false), served / abandoned / scoring rows never count.
 *   computeRung(ladder, rows, ctx)
 *                      PURE: the highest rung met on the ladder from the eligible rows given (all periods). Rungs
 *                      chain (R k needs R k-1) and one row may light several. Grade band from the fixed grade's form
 *                      (G3 = grades 2–3, G5 = grades 4–5, G1 = grade 1: N1 only, no Reading rung). ok_5s is read by
 *                      no rule.
 *   onRecordFinal(row | id)
 *                      called where a run is stored as scored or failed: reads that child's record rows on the
 *                      ladder (every period) and the child's current rung, and only when the computed rung is higher
 *                      appends ONE child_rungs row (rule_v badges-v1, stop = the run's exercise, the row's period,
 *                      the row) — never an update or a delete. The unique index (canonical_id, ladder, stop,
 *                      period_id) holds it to one change per child × ladder × stop × period (a listen and a read in
 *                      one month each move the Reading lamp once): a refused insert is "already set on this stop this
 *                      period" and logs no event. lamp_lit
 *                      only after the insert landed. Never throws: any failure is logged and returns null.
 */
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const Flags = require('./web-quiz-hub-flags');
const K = require('./web-quiz-kid');
const { compOf } = require('./web-quiz-measure-events');
const { isLine1OrZero } = require('./web-quiz-challenge-draw');

const RULE_V = 'badges-v1';
const RUNS = 'web_quiz_challenge_runs';
const LAMPS = 'child_rungs';
const FINAL = ['scored', 'failed'];
const LADDER_OF = { read: 'reading', listen: 'reading', missing: 'numbers', bigger: 'numbers' };
// child_rungs.stop's CHECK (web_quiz_child_rungs_once.sql); any other exercise is stored as NULL.
const STOPS = new Set(Object.keys(LADDER_OF));
const ROW_COLS = 'id, canonical_id, exercise, status, mode, record, period_id, form, grade, lang, band, wcpm, score, passage_id, anchor_block, meta, scored_at, created_at';
// A scored reading whose questions are still being answered waits this long before its rung is computed without them.
const SETTLE_MS = 30 * 60 * 1000;
const nul = (v) => (v === undefined ? null : v);

/** A record row with a final status, of a known child and period. */
const implausible = (row) => !!(row && row.meta && row.meta.quality === 'implausible');  // (the quality floors): earns nothing
function eligible(row) {
  return !!row && row.mode === 'check' && row.record === true && FINAL.includes(row.status) && !implausible(row)
    && !!row.canonical_id && !!row.period_id;
}

/** The ladder a row feeds: read / listen → reading; the warm-up (missing) / bigger, or a grade-1 anchor → numbers. */
function ladderOf(row) {
  if (!row) return null;
  return LADDER_OF[row.exercise] || (row.anchor_block === 'G1A' ? 'numbers' : null);
}

/** The fixed grade band: the form the fixed grade chose (G1 / G3 / G5), else the row's grade. */
function gradeBandOf(row = {}) {
  if (row.form === 'G1') return 'G1';
  if (row.form === 'G3') return 'G2-3';
  if (row.form === 'G5') return 'G4-5';
  const g = Number(row.grade);
  if (g === 1) return 'G1';
  if (g === 2 || g === 3) return 'G2-3';
  if (g === 4 || g === 5) return 'G4-5';
  return null;
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────────
/** Past line 1: a scored reading with words (wcpm > 0) that is not a line-1 stop by the draw's own rule. */
const pastLine1 = (r) => r.exercise === 'read' && r.status === 'scored' && Number(r.wcpm) > 0 && !isLine1OrZero(r);
/** Asked ≥ 2 and right ≥ 2 (a row with fewer questions delivered simply waits). */
const understood = (r) => {
  const c = compOf(r.meta && r.meta.comp);
  return !!c && c.comp_n >= 2 && c.comp_ok >= 2;
};
const bandIs = (r, test) => r.band != null && Number.isFinite(Number(r.band)) && test(Number(r.band));

function readingMet(rows, gb) {
  const reads = rows.filter(pastLine1);
  const short = gb === 'G4-5' ? (r) => bandIs(r, (b) => b <= 2) : (r) => bandIs(r, (b) => b === 1);
  const shortU = gb === 'G4-5' ? (r) => bandIs(r, (b) => b === 2) : short;
  const longer = gb === 'G4-5' ? (r) => bandIs(r, (b) => b === 3) : (r) => bandIs(r, (b) => b === 2);
  return [
    rows.length > 0,                                         // R1: any read or listen record row, any outcome
    reads.some(short),                                       // R2
    reads.some((r) => shortU(r) && understood(r)),           // R3
    reads.some(longer),                                      // R4
    reads.some((r) => longer(r) && understood(r)),           // R5
  ];
}

// ── Numbers ──────────────────────────────────────────────────────────────────────────────────────────
/** Items i in [from, to] answered right on a row (meta.items[].ok; ok_5s is never read). */
const rightIn = (r, from, to) => ((r.meta && Array.isArray(r.meta.items)) ? r.meta.items : [])
  .filter((it) => it && Number(it.i) >= from && Number(it.i) <= to && it.ok === true).length;
const isAnchor = (r) => r.anchor_block === 'A1' && r.status === 'scored';

function numbersMet(rows) {
  const anchors = rows.filter(isAnchor);
 // (the quality floors): a scripted fast 10/10 (meta.quality rapid_perfect) never lights N3–N5; N1–N2 read it as any row
  const believed = anchors.filter((r) => !(r.meta && r.meta.quality === 'rapid_perfect'));
  const biggers = rows.filter((r) => r.exercise === 'bigger' && r.status === 'scored');
  const anyAnchorRight = anchors.some((r) => rightIn(r, 1, 10) >= 1);
  return [
    rows.length > 0,                                                                       // N1
    (biggers.some((r) => rightIn(r, 1, 6) >= 5) && anyAnchorRight) || anchors.some((r) => rightIn(r, 1, 6) >= 3), // N2
    believed.some((r) => rightIn(r, 1, 6) >= 5),                                           // N3
    believed.some((r) => rightIn(r, 1, 6) >= 5 && rightIn(r, 7, 10) >= 3),                 // N4 (one row)
    believed.some((r) => rightIn(r, 1, 10) === 10),                                        // N5 (one row)
  ];
}

/**
 * PURE. The highest rung (0–5) met on `ladder` from `rows` under badges-v1. Rows that are not eligible record rows
 * are ignored, whatever else they say. ctx.form / ctx.grade name the fixed grade; else the newest row's.
 */
function computeRung(ladder, rows = [], ctx = {}) {
  const mine = (Array.isArray(rows) ? rows : []).filter((r) => eligible(r) && ladderOf(r) === ladder);
  if (!mine.length) return 0;
  const gb = gradeBandOf(ctx.form || ctx.grade ? ctx : mine[mine.length - 1]);
  if (gb === 'G1') return ladder === 'numbers' ? 1 : 0;
  if (ladder === 'reading' && !gb) return 1;
  const met = ladder === 'reading' ? readingMet(mine, gb) : numbersMet(mine);
  let k = 0;
  while (k < met.length && met[k]) k += 1;                   // rungs chain: never skip one
  return k;
}

// ── the job ──────────────────────────────────────────────────────────────────────────────────────────
const ageMs = (row, now) => now - Date.parse(row.scored_at || row.created_at || 0);

/**
 * A scored record reading past line 1 whose reached questions are not all answered yet, younger than SETTLE_MS: its
 * R3 / R5 live on this same row, so the rung waits for the answers (the answer hook calls the job again) or for
 * settleDeferred. Any other row: not waiting.
 */
async function waiting(row, now, questionsLeft) {
  if (typeof questionsLeft !== 'function') return false;
  if (row.exercise !== 'read' || row.status !== 'scored' || !pastLine1(row) || ageMs(row, now) >= SETTLE_MS) return false;
  return (await questionsLeft(row)) > 0;
}

/**
 * opts.questionsLeft(row) → how many of a scored reading's questions the child can still answer (the Challenge passes
 * its readQuestionsLeft; given here, not required, so the two modules never require each other). opts.settle false:
 * the window is ignored (settleDeferred).
 */
async function onRecordFinal(input, { now = Date.now(), settle = true, questionsLeft = null } = {}) {
  try {
    if (!(await Flags.rungsOn())) return null;
    const id = typeof input === 'string' ? input : input && input.id;
    let row = input && typeof input === 'object' && 'mode' in input ? input : null;
    if (!row) {
      if (!id) return null;
      const { data, error } = await supabase.from(RUNS).select(ROW_COLS).eq('id', id).maybeSingle();
      if (error) throw new Error(`run read failed: ${error.message || error.code}`);
      row = data;
    }
    if (!eligible(row)) return null;
    const ladder = ladderOf(row);
    if (!ladder) return null;
    if (settle && (await waiting(row, now, questionsLeft))) return { deferred: true };

    const { data: rows, error: rErr } = await supabase.from(RUNS).select(ROW_COLS)
      .eq('canonical_id', row.canonical_id).eq('mode', 'check').eq('record', true).in('status', FINAL)
      .order('created_at', { ascending: true }).limit(5000);
    if (rErr) throw new Error(`record rows read failed: ${rErr.message || rErr.code}`);
    const all = (rows || []).some((r) => r.id === row.id) ? rows : [...(rows || []), row];
    const computed = computeRung(ladder, all, { form: row.form, grade: row.grade });

    const { data: lamps, error: lErr } = await supabase.from(LAMPS).select('rung')
      .eq('canonical_id', row.canonical_id).eq('ladder', ladder).order('rung', { ascending: false }).limit(1);
    if (lErr) throw new Error(`lamps read failed: ${lErr.message || lErr.code}`);
    const current = lamps && lamps[0] ? Number(lamps[0].rung) || 0 : 0;
    if (computed <= current) return null;                    // up only

    const { error: iErr } = await supabase.from(LAMPS).insert({
      canonical_id: row.canonical_id, ladder, rung: computed, rule_v: RULE_V, stop: STOPS.has(row.exercise) ? row.exercise : null,
      period_id: row.period_id, row_id: row.id,
    });
    if (iErr) {
      if (iErr.code === '23505') {                           // already set on this stop this period
        logToFile('ℹ️ web quiz rungs: lamp already set on this stop this period', { ladder, stop: row.exercise, period_id: row.period_id });
      } else {
        logError('web_quiz.rung_write_failed', { code: iErr.code || null, error: String(iErr.message || '').slice(0, 120) });
      }
      return null;
    }

    if (await Flags.eventsV2On()) {
      logEvent('web_quiz.lamp_lit', K.envelope({
        kid: K.kid(row.canonical_id), ladder, rung: computed, rule_v: RULE_V, band: nul(row.band),
        fixed_band: gradeBandOf(row), period_id: row.period_id,
      }));
    }
    return { ladder, rung: computed, from: current };
  } catch (e) {
    logToFile('⚠️ web quiz rungs: lamp not set', { error: String((e && e.message) || e).slice(0, 120) });
    return null;
  }
}

/**
 * The daily settle (called by the sweeper's daily job): this period's scored record readings older than SETTLE_MS
 * with no Reading lamp row on the read stop this period are computed now, the window ignored (questions never
 * answered ⇒ R3 / R5 not evaluated; R1 / R2 / R4 as usual). Switch off ⇒ no query. Never throws.
 */
async function settleDeferred({ now = Date.now() } = {}) {
  try {
    if (!(await Flags.rungsOn())) return { checked: 0, settled: 0 };
    const D = require('./web-quiz-challenge-draw');
    const periodId = D.periodIdFor(new Date(now), await D.periods());
    if (!periodId) return { checked: 0, settled: 0 };
    const { data: rows, error } = await supabase.from(RUNS).select(ROW_COLS)
      .eq('exercise', 'read').eq('mode', 'check').eq('record', true).eq('status', 'scored').eq('period_id', periodId)
      .order('created_at', { ascending: true }).limit(5000);
    if (error) throw new Error(`record readings read failed: ${error.message || error.code}`);
    const due = (rows || []).filter((r) => ageMs(r, now) >= SETTLE_MS);
    if (!due.length) return { checked: 0, settled: 0 };
    const { data: lamps, error: lErr } = await supabase.from(LAMPS).select('canonical_id')
      .eq('ladder', 'reading').eq('stop', 'read').eq('period_id', periodId);
    if (lErr) throw new Error(`lamps read failed: ${lErr.message || lErr.code}`);
    const lit = new Set((lamps || []).map((l) => l.canonical_id));
    let settled = 0;
    for (const row of due) {
      if (lit.has(row.canonical_id)) continue;
      const out = await onRecordFinal(row, { now, settle: false });
      if (out && out.rung) { settled += 1; lit.add(row.canonical_id); }
    }
    return { checked: due.length, settled };
  } catch (e) {
    logToFile('⚠️ web quiz rungs: settle not run', { error: String((e && e.message) || e).slice(0, 120) });
    return { checked: 0, settled: 0 };
  }
}

module.exports = { computeRung, eligible, onRecordFinal, settleDeferred, ladderOf, gradeBandOf, RULE_V, SETTLE_MS };
