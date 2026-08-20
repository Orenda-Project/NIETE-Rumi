'use strict';
/**
 * Deterministic fidelity scorer (LP Fidelity — FICO Section B).
 *
 * The LLM grader (fidelity-analyzer) only JUDGES each move (verdict + evidence). ALL arithmetic and
 * denominator logic lives HERE, in code, so the rubric can't drift (decision D6). Given the prescribed
 * moves (with their deterministic tags) and the grader's per-move verdicts, compute the fidelity number
 * plus the analysis blob we persist (decision D20).
 *
 * Ported 1:1 from the offline-validated reference `eval/scorer.py`
 * (LP Fidelity Measurement - Aug 2026, Evals 5 & 6). See EVALS_AND_DECISIONS D4/D5/D11/D19/D22/D23.
 *
 * Denominator rules (D5, D11):
 *   - Core denominator = must_happen moves + adaptive_set members that applied + optional moves she
 *     actually ATTEMPTED — all filtered to adjudicable.
 *   - not_adjudicable verdicts are dropped from the denominator (reported "not assessed"), never a miss.
 *   - optional_extension not attempted → excluded, no penalty; if attempted → a strength AND an
 *     "enrichment uptake" side number, kept OUT of the core ratio so it can't drag it down.
 *   - choose_one / per_group is ONE move in the denominator (any one option = full credit).
 *
 * Credit map (D4/D5): executed/substituted_equivalent/substituted_better → 1.0 · partial → 0.5 ·
 *   not_done → 0.0 · not_adjudicable → excluded.
 */

const FULL_CREDIT = new Set(['executed', 'substituted_equivalent', 'substituted_better']);
const CREDIT = {
  executed: 1.0, substituted_equivalent: 1.0, substituted_better: 1.0,
  partial: 0.5, not_done: 0.0,
  // not_adjudicable has no credit key on purpose → excluded from the denominator.
};

// Field-standard bands (D16): >=80 high / 50-79 partial / <50 low. Kept swappable so P4.1 can adopt
// whatever bands the ICT team signs off. Report BANDS to humans, not the raw % (D23 — temp-0 wobble).
function band(pct) {
  if (pct == null) return null;
  if (pct >= 80) return 'high';
  if (pct >= 50) return 'partial';
  return 'low';
}

const round = (n, d = 2) => {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
};

/**
 * @param {Array<object>} moves     prescribed move list (fidelity-moves-v1 objects, with tags)
 * @param {Array<object>} verdicts  grader output [{move_id, verdict, evidence, ...}]
 * @returns {object} analysis blob (the D20 persist shape)
 */
function scoreFidelity(moves, verdicts) {
  const vmap = {};
  for (const v of verdicts || []) vmap[v.move_id] = v;

  let coreNum = 0;      // sum of credit over core denominator
  let coreDen = 0;      // count of core denominator moves
  const rows = [];      // per-move detail for the persisted analysis + report
  const notAssessed = []; // not_adjudicable move_ids (reported, not scored)
  const enrichment = [];  // optional moves she attempted (strengths / uptake side-number)
  const strengths = [];   // substituted_better moves
  let timeOnTask = null;

  for (const m of moves || []) {
    const mid = m.move_id;
    const v = vmap[mid] || { verdict: 'not_done' };
    const verdict = v.verdict || 'not_done';
    const bucket = m.bucket || 'must_happen';
    const adjudicable = m.adjudicable !== false; // default true

    const row = {
      move_id: mid, phase: m.phase, bucket,
      selection: m.selection || 'none', text: m.text,
      verdict, evidence: v.evidence || '',
      evidence_translation: v.evidence_translation || '',
      rationale: v.rationale || '', counted: false, credit: null,
    };

    // time-on-task passthrough (from the grader, on the flagged move) — best-effort, never gates (D22)
    if (m.track_time_on_task) {
      timeOnTask = {
        move_id: mid, assigned: v.assigned ?? null,
        worked_minutes: v.worked_minutes ?? null,
        prescribed_minutes: m.prescribed_minutes ?? null,
        on_task_band: v.on_task_band ?? null,
      };
      row.time_on_task = timeOnTask;
    }

    if (verdict === 'substituted_better') {
      strengths.push({ move_id: mid, text: m.text, evidence: v.evidence || '' });
    }

    // --- denominator routing ---
    if (!adjudicable || verdict === 'not_adjudicable') {
      notAssessed.push(mid);
      rows.push(row);
      continue;
    }

    if (bucket === 'optional_extension') {
      if (CREDIT[verdict] > 0) {
        enrichment.push({ move_id: mid, text: m.text, verdict, evidence: v.evidence || '' });
      }
      rows.push(row);
      continue;
    }

    // must_happen or an applicable adaptive_set member → core denominator
    const credit = CREDIT[verdict] || 0;
    coreNum += credit;
    coreDen += 1;
    row.counted = true;
    row.credit = credit;
    rows.push(row);
  }

  const pct = coreDen ? round((100 * coreNum) / coreDen, 1) : null;
  // coverage = how much of the intended-scorable set we could actually adjudicate. A % from only a
  // fraction of the moves is low-confidence (e.g. a partly-garbled or truncated recording).
  const mustIntended = (moves || []).filter(
    (m) => (m.bucket || 'must_happen') !== 'optional_extension' && m.adjudicable !== false
  ).length;
  const coverage = mustIntended ? round(coreDen / mustIntended, 2) : 0.0;
  const recordingUnusable = coreDen === 0 && mustIntended > 0;
  const lowConfidence = recordingUnusable || coverage < 0.5;

  return {
    fidelity_pct: coreDen === 0 ? null : pct,
    band: coreDen ? band(pct) : null,
    executed_credit: round(coreNum, 2),
    prescribed_count: coreDen,
    intended_scorable: mustIntended,
    coverage,
    low_confidence: lowConfidence,
    recording_unusable: recordingUnusable,
    not_assessed: notAssessed,
    enrichment_uptake: enrichment,
    strengths,
    time_on_task: timeOnTask,
    moves: rows,
  };
}

module.exports = { scoreFidelity, band, CREDIT, FULL_CREDIT };
