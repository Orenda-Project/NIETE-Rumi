'use strict';
/**
 * The Challenge's measurement events (events v2, app_settings `web_quiz_events_v2` under `web_quiz_hub`), built
 * from what is stored, so Axiom alone can count each measurement per distinct child (kid, web-quiz-kid.js):
 *
 *   web_quiz.m_result  one per scored run of a v2 row (mode set): who (kid), which form / band / passage or item set,
 *                      how it was counted (mode, record, period, exposure), how the child was identified, whether
 *                      helped, the numbers (ok_n / n, wcpm for a reading) and comprehension as comp_ok / comp_n
 *                      only: the option a child picked, the order shown and the question ids stay on the row.
 *   web_quiz.m_lost    one per failed (or swept) run of a v2 row: the denominator of lost readings.
 *
 * Also the v2 additions to two existing server events (each added only with the switch on; off ⇒ today's payload):
 *   ch_start  gains the envelope (w:'s', ev_v, kid_v, kid) and, when the run has them, its v2 fields
 *   hub_open  gains the envelope and dk (the phone's key); kid only on the copy with a picked child
 *
 * The builders are pure apart from the key (and its once-a-day missing-key event). Callers check the switch.
 */
const { logEvent } = require('../../utils/structured-logger');
const K = require('./web-quiz-kid');

const LOST_REASONS = new Set(['failed', 'swept']);
const nul = (v) => (v === undefined ? null : v);

/** The fixed reporting band of a run: G1 for the grade-1 form, G23 for grades 2-3 (G3), G45 for 4-5 (G5). */
function fixedBand(row = {}) {
  if (row.form === 'G1') return 'G1';
  const g = Number(row.grade);
  if (g === 2 || g === 3) return 'G23';
  if (g === 4 || g === 5) return 'G45';
  if (row.form === 'G3') return 'G23';
  if (row.form === 'G5') return 'G45';
  return null;
}

/** comp_ok / comp_n from meta.comp, either today's tally {asked, correct, a} or the per-question array. */
function compOf(comp) {
  if (Array.isArray(comp)) {
    const asked = comp.filter((q) => q && typeof q === 'object');
    return asked.length ? { comp_ok: asked.filter((q) => q.ok === true || q.ok === 1).length, comp_n: asked.length } : null;
  }
  if (comp && typeof comp === 'object' && Number.isFinite(Number(comp.asked)) && Number(comp.asked) > 0) {
    return { comp_ok: Number(comp.correct) || 0, comp_n: Number(comp.asked) };
  }
  return null;
}

const childOf = (row) => row.canonical_id || row.student_id || null;
const unitOf = (row) => (row.item_set_id ? { item_set_id: row.item_set_id } : { passage_id: nul(row.passage_id) });

/** The m_result event for a stored, scored v2 run row. ctx.rung: the child's rung on that ladder at serve. */
function mResult(row, ctx = {}) {
  const m = row.meta || {};
  const s = row.score || {};
  const comp = compOf(m.comp);
  const n = s.n != null ? s.n : s.attempted;
  return K.envelope({
    run: row.id,
    kid: K.kid(childOf(row)),
    form: nul(row.form), band: nul(row.band), fixed_band: fixedBand(row), rung: nul(ctx.rung),
    exercise: row.exercise, lang: nul(row.lang), fixed_grade: nul(row.grade),
    mode: row.mode, record: nul(row.record), period_id: nul(row.period_id), exposure_no: nul(row.exposure_no),
    anchor_exposure_no: nul(row.anchor_exposure_no), anchor_block: nul(row.anchor_block),
    ...unitOf(row),
    id_src: nul(row.id_src), id_confidence: nul(row.id_confidence), homonym_in_list: nul(row.homonym_in_list),
    via: nul(row.via), helped: nul(row.helped), sitting: nul(m.sitting),
    ok_n: Number.isFinite(Number(s.correct)) ? Number(s.correct) : null,
    n: Number.isFinite(Number(n)) ? Number(n) : null,
    ...(row.exercise === 'read' && row.wcpm != null && Number.isFinite(Number(row.wcpm)) ? { wcpm: Number(row.wcpm) } : {}),
    ...(comp || {}),
    stopped: Boolean(s.stopped),
    quality: typeof m.quality === 'string' ? m.quality : (m.too_fast ? 'too_fast' : 'ok'),
  });
}

/** The m_lost event for a failed (reason 'failed') or swept (reason 'swept', with ageMin) v2 run row. */
function mLost(row, { reason = 'failed', ageMin = null, rung = null } = {}) {
  return K.envelope({
    run: row.id,
    kid: K.kid(childOf(row)),
    exercise: row.exercise, band: nul(row.band), fixed_band: fixedBand(row), rung: nul(rung), lang: nul(row.lang),
    form: nul(row.form), mode: row.mode, record: nul(row.record),
    reason: LOST_REASONS.has(reason) ? reason : 'failed',
    ...(ageMin != null && Number.isFinite(Number(ageMin)) ? { age_min: Math.round(Number(ageMin)) } : {}),
  });
}

/**
 * Logs m_result (status scored) or m_lost (status failed) for a v2 row (mode set); anything else logs nothing.
 * Returns the event name logged, or null. The caller has checked web_quiz_events_v2.
 */
function emitOutcome(row, ctx = {}) {
  if (!row || !row.mode) return null;
  if (row.status === 'scored') {
    logEvent('web_quiz.m_result', mResult(row, ctx));
    return 'web_quiz.m_result';
  }
  if (row.status === 'failed') {
    logEvent('web_quiz.m_lost', mLost(row, ctx));
    return 'web_quiz.m_lost';
  }
  return null;
}

/** ch_start's server copy with v2 on: today's fields, the envelope, and the run's v2 fields when it has them. */
function chStart(base, run = {}, studentId = null) {
  const r = run || {};
  const v2 = r.mode ? {
    mode: r.mode, period_id: nul(r.period_id), form: nul(r.form), band: nul(r.band), rung: nul(r.rung),
    ...unitOf(r), exposure_no: nul(r.exposure_no),
    ...(r.anchor_exposure_no != null ? { anchor_exposure_no: r.anchor_exposure_no } : {}),
    ...(r.anchor_block != null ? { anchor_block: r.anchor_block } : {}),
    record: nul(r.record), via: nul(r.via),
  } : {};
  return K.envelope({ ...base, kid: K.kid(r.canonical_id || studentId), ...v2 });
}

/** hub_open with v2 on: today's fields, the envelope, dk; kid only when a child is picked. */
function hubOpen(base, { studentId = null, device = null } = {}) {
  return K.envelope({ ...base, kid: studentId ? K.kid(studentId) : null, dk: K.dk(device) });
}

module.exports = { mResult, mLost, emitOutcome, chStart, hubOpen, fixedBand, compOf };
