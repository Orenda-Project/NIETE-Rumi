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


// ─── Did the grader say the recording stopped before the lesson did? ──────────
//
// There is no token for this state, so the grader invents one or writes prose. The
// prompt documents exactly two note values — `lesson_mismatch` (796 prod sessions,
// used cleanly) and `recording_unusable` (522) — and neither means "it ended early".
// Alongside them prod carries `recording_ends_mid_lesson`, `recording_ends_during_
// group_work` and `transcript_incomplete`: the model minting a name for something we
// never named for it.
//
// The matcher is deliberately narrow. Its job is to find the grader contradicting its
// OWN caveat, so a false positive costs a coach an unnecessary sentence while a loose
// match on `recording_unusable`'s 522 sessions would drown the signal entirely. Prose
// that DENIES truncation ("this is not a … recording-unusable case", "the recording
// covers the full lesson") must not match, and does not: every pattern below requires
// the recording to be said to STOP.
const TRUNCATION_TOKENS = new Set([
  'recording_truncated', 'recording_ends_mid_lesson', 'recording_ends_during_group_work',
  'recording_incomplete', 'transcript_incomplete', 'transcript_truncated',
]);

// "…ends at [15:54] during…", "…ends at [17:37], before…", "…ends at approximately
// 20:42 while students are still working", "the recording is readable but incomplete".
const TRUNCATION_PROSE = [
  /\brecording\b[^.]{0,80}\b(ends|ended|stops|stopped|cuts off|cut off|breaks off)\b/i,
  /\b(recording|transcript)\b[^.]{0,60}\b(is|was)\b[^.]{0,40}\bincomplete\b/i,
  /\b(ends|ended|stops|stopped)\b[^.]{0,60}\b(mid-?lesson|before the (announced|later)|while students)\b/i,
];

/**
 * @param {*} note the grader's `moderators.note`
 * @returns {boolean} true only when the note itself claims the recording ended early.
 */
function claimsTruncation(note) {
  if (typeof note !== 'string') return false;
  const text = note.trim();
  if (!text) return false;
  const token = text.toLowerCase().replace(/[\s-]+/g, '_');
  if (TRUNCATION_TOKENS.has(token)) return true;
  return TRUNCATION_PROSE.some((re) => re.test(text));
}

/**
 * @param {Array<object>} moves     prescribed move list (fidelity-moves-v1 objects, with tags)
 * @param {Array<object>} verdicts  grader output [{move_id, verdict, evidence, ...}]
 * @param {object} [opts]
 * @param {object} [opts.moderators] the grader's own moderators block, so its note can
 *                 be checked against the verdicts it wrote beside it. Omit and the
 *                 returned blob is byte-identical to what it was before this existed.
 * @returns {object} analysis blob (the D20 persist shape)
 */
function scoreFidelity(moves, verdicts, opts = {}) {
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

  // The grader's self-contradiction: its note says the recording stopped before the
  // lesson did, AND it counted at least one move as a miss anyway. The verdict that
  // covers this case already exists — not_adjudicable, "you genuinely cannot tell from
  // this recording" — and the grader applies it correctly on some of these sessions and
  // not others. The gap is determinism, not vocabulary.
  //
  // Asserted here in CODE rather than trusted to the prompt, because a model told to
  // use a verdict complies most of the time. This also turns a population we can only
  // find with a regex over prose into a column we can count.
  //
  // It changes NO credit and NO denominator. The remedy is the coach, who was in the
  // room: her Section B screen says so and her per-move ratings re-run this same scorer.
  const moderators = opts.moderators || null;
  const countedMiss = rows.some((r) => r.counted && r.verdict === 'not_done');
  const truncationInconsistent = !!(moderators && claimsTruncation(moderators.note) && countedMiss);

  const lowConfidence = recordingUnusable || coverage < 0.5 || truncationInconsistent;

  return {
    truncation_inconsistent: truncationInconsistent,
    moderators: truncationInconsistent
      ? { ...moderators, truncation_inconsistent: true }
      : (moderators ? { ...moderators, truncation_inconsistent: false } : null),
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

module.exports = { scoreFidelity, band, CREDIT, FULL_CREDIT, claimsTruncation };
