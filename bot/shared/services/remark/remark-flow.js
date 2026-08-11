/**
 * bd-2531 — the /remark rubric walk, as a PURE state machine.
 *
 * 5 screens (one indicator each, full anchors, tap 1-4) → comment (text or
 * voice, optional) → review → submit. Design spec §5, Layout B.
 *
 * ── There is no session ────────────────────────────────────────────────────
 * `nextStep()` is a pure function of (teachers, derived progress). It asks
 * "given what is already written down, where is she?" — never "what did she do
 * last?". The score rows ARE the state, exactly as in remark-cycle.repository's
 * deriveProgress().
 *
 * Consequences, all of them good:
 *   * interruption is the normal case — no expiry, no cleanup, no timeout;
 *   * she can switch devices mid-rubric;
 *   * a crashed process loses nothing;
 *   * this flow does NOT mirror the attendance state machine, so it cannot
 *     inherit whatever shape the parallel attendance rewrite settles on.
 *
 * The handler is a thin shell: resolve progress → nextStep() → render → persist
 * the one row her reply produced → repeat.
 */

const { INDICATOR_COUNT } = require('./remark-rubric');

const STEP = Object.freeze({
  NO_TEACHERS: 'no_teachers',        // her school has no teachers on record
  PICK_TEACHER: 'pick_teacher',      // choose who to evaluate
  SCORE_INDICATOR: 'score_indicator', // one of the 5 screens
  COMMENT: 'comment',                // text or voice, optional
  REVIEW: 'review',                  // 5 scores + comment, then submit
  ALL_DONE: 'all_done',              // every teacher submitted this cycle
});

// Eastern-Arabic + Arabic-Indic digits, so an Urdu principal can tap her own
// numerals. Same reasoning as the narrative scrubber: Urdu output is not ASCII.
const DIGIT_MAP = {
  '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9,
  '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9,
};

function normaliseDigits(s) {
  return String(s == null ? '' : s).replace(/[٠-٩۰-۹]/g, (d) => String(DIGIT_MAP[d]));
}

/**
 * A rubric answer: 1..4 only. Returns null for anything else so the caller can
 * re-prompt rather than store a wrong score.
 */
function parseScoreReply(reply) {
  const m = normaliseDigits(reply).trim().match(/^([1-9][0-9]*)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 4 ? n : null;
}

/**
 * A 1-based pick from the rendered roster. Tolerates "2." / "2 pls" — a
 * principal typing on a phone adds punctuation, and that is not an error.
 */
function parseTeacherPick(reply, teachers) {
  if (!Array.isArray(teachers) || teachers.length === 0) return null;
  const m = normaliseDigits(reply).trim().match(/^([0-9]+)/);
  if (!m) return null;
  const i = Number(m[1]);
  if (!Number.isInteger(i) || i < 1 || i > teachers.length) return null;
  return teachers[i - 1];
}

/**
 * Where is this principal right now?
 *
 * Priority order matters:
 *   1. no teachers at all             → say so
 *   2. a teacher already IN PROGRESS  → finish her first
 *   3. teachers left to start         → pick one
 *   4. everyone submitted             → done
 *
 * (2) before (3) is deliberate: otherwise a principal accumulates five
 * half-finished rubrics and none of them ever submit.
 *
 * @param {{teachers: Array<object>, progress: Object}} input
 *   progress is remark-cycle.repository :: deriveProgress() output
 */
function nextStep({ teachers, progress = {} }) {
  if (!Array.isArray(teachers) || teachers.length === 0) {
    return { step: STEP.NO_TEACHERS };
  }

  // 2 — finish what she started.
  for (const t of teachers) {
    const p = progress[t.id];
    if (!p || p.state !== 'in_progress') continue;

    if (p.resumeAt) {
      // Resume at the first UNANSWERED ordinal (deriveProgress computes the gap,
      // not max+1) so a skipped indicator is filled rather than silently left.
      return { step: STEP.SCORE_INDICATOR, teacher: t, ordinal: p.resumeAt, remarkId: p.remarkId };
    }
    // All 5 answered. Comment is OPTIONAL (spec §10) — offer it once, then
    // review whether she wrote one or skipped it.
    if (!p.hasComment && !p.commentSkipped) {
      return { step: STEP.COMMENT, teacher: t, remarkId: p.remarkId };
    }
    return { step: STEP.REVIEW, teacher: t, remarkId: p.remarkId };
  }

  // 3 — anyone not yet submitted.
  const remaining = teachers.filter((t) => (progress[t.id] || {}).state !== 'done');
  if (remaining.length > 0) {
    return { step: STEP.PICK_TEACHER, remaining };
  }

  // 4 — the whole school is done for this cycle.
  return { step: STEP.ALL_DONE };
}

/**
 * Is this rubric whole? Submit is blocked otherwise (spec §10: all 5 required).
 * Mirrors remark-rubric :: isComplete, expressed over the derived progress so
 * the flow does not need the raw rows.
 */
function canSubmit(p) {
  return !!p && p.state === 'in_progress' && (p.answered || 0) === INDICATOR_COUNT;
}

module.exports = {
  STEP,
  nextStep,
  canSubmit,
  parseScoreReply,
  parseTeacherPick,
  normaliseDigits,
};
