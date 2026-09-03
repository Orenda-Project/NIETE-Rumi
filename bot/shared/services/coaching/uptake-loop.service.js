/**
 * The feedback-uptake loop, as pure functions. No I/O — callers load the prior
 * record and persist the result.
 *
 * ONE target, chosen once, carried forward, COUNTED next time, and re-angled
 * until it lands — never a mark.
 *
 * Decisions this module encodes (operator, 3 Sep 2026):
 *   - uptake is graded OUTSIDE the total: nothing here touches a score;
 *   - a target closes after TWO consecutive achieved lessons — one lucky lesson
 *     is not mastery, and two costs days rather than weeks;
 *   - after FOUR attempts without uptake the teacher is handed to a human coach
 *     (surfaced in the /observe Support Brief and debrief guide) while the
 *     self-serve coaching continues;
 *   - targets come from sections C, D and F only. Section B is measured per
 *     lesson plan by the fidelity engine and changes with every plan, so "the
 *     same target next lesson" has no meaning there;
 *   - the verdict is COMPUTED from the model's tally against the rubric's own
 *     COUNT bar; it is never read from the model as a judgement.
 *
 * The angle ladder answers "it must not all sound the same": the same target,
 * a different shape each attempt — tell → cue → show → shrink → hand_over.
 */

const { resolveTarget } = require('./target-resolver');
const fico = require('./frameworks/fico-framework');

const LADDER = ['tell', 'cue', 'show', 'shrink', 'hand_over'];
const MAX_ATTEMPTS = 4;
const CLOSE_AFTER = 2;
const LOOP_SECTIONS = new Set(['C', 'D', 'F']);
const LOOP_VERSION = 1;

/**
 * The rung-2 bar of every loop-eligible indicator, as countable units. These
 * are the rubric's own "2 = …" descriptors (FICO v4) made structured, so the
 * scoring prompt can ask for a tally per unit and the verdict can compare it.
 * Keys double as the tally keys the model fills in `uptake.count`.
 */
const COUNT_BARS = {
  C1: { open_questions: 3, followups_on_a_student_answer: 1 },
  C2: { different_representation_reexplanations: 1 },
  C3: { specific_feedback_moves: 3, next_step_feedback: 1 },
  C4: { student_choice_or_unprompted_reasoning: 1 },
  D1: { distinct_student_phrasings: 2 },
  D2: { student_responses_with_a_reason: 1 },
  D3: { student_content_questions: 1 },
  D4: { student_connections_outside_lesson: 1 },
  D5: { late_responses_longer_or_richer: 1 },
  F1: { why_explanations: 1 },
  F2: { key_terms_explained: 2 },
  F3: { misconceptions_named: 1 },
  F4: { reasoning_presses: 1 },
  F5: { nonroutine_problems_with_think_time: 1 },
  F6: { inquiry_openings_before_explanation: 1 },
  F7: { student_science_ideas_in_own_words: 1 },
  F8: { phonics_stages_heard: 3 },
  F9: { strategy_steps_present: 2 },
  F10: { explicit_reading_writing_links: 1 },
};

function countBarFor(indicatorId) {
  const bar = COUNT_BARS[String(indicatorId || '')];
  return bar ? { ...bar } : null;
}

function scaleMax() {
  return fico.getScoringConstants().scaleMax;
}

function findRow(analysis, indicatorId) {
  for (const d of Object.values((analysis && analysis.domains) || {})) {
    const row = (d && Array.isArray(d.indicators) ? d.indicators : []).find((i) => i && String(i.id) === String(indicatorId));
    if (row) return row;
  }
  return null;
}

/** Applicable AND scored in this very lesson. */
function applicableToday(analysis, indicatorId) {
  const row = findRow(analysis, indicatorId);
  return !!row && row.applicable !== false && row.score !== null && row.score !== undefined;
}

/** The indicator's rung in this lesson, or null. */
function rungOf(analysis, indicatorId) {
  const row = findRow(analysis, indicatorId);
  if (!row || row.score === null || row.score === undefined) return null;
  const n = Number(row.score);
  return Number.isFinite(n) ? n : null;
}

function isLoopSection(indicatorId) {
  return LOOP_SECTIONS.has(String(indicatorId || '')[0]);
}

function indicatorName(analysis, domainKey, id) {
  const row = findRow(analysis, id);
  if (row && row.name) return row.name;
  const domains = fico.getScoringConstants().domains || {};
  const spec = ((domains[domainKey] || {}).indicators || []).find((d) => d.id === id);
  return (spec && spec.name) || id;
}

/**
 * Which indicator this lesson's coaching is about.
 *
 *  1. An OPEN prior target that is applicable today is sticky (the loop's whole
 *     point is that the target survives the lesson).
 *  2. Else the scorer's validated focus_area, when it is a C/D/F indicator with
 *     room to grow.
 *  3. Else the lowest applicable C/D/F rung below the top (ties: rubric order).
 *  Null when every eligible indicator is already at the top rung.
 *
 * @param {object} analysis
 * @param {object|null} prior - the prior action record (loadPriorAction)
 * @param {object} [opts] - { avoid: [indicator ids to skip when another candidate exists] }
 */
function chooseTarget(analysis, prior, opts = {}) {
  const avoid = new Set(opts.avoid || []);
  const top = scaleMax();
  if (prior && prior.target_status === 'open' && prior.target && prior.target.indicator
      && applicableToday(analysis, prior.target.indicator) && isLoopSection(prior.target.indicator)) {
    return { ...prior.target, carried: true };
  }
  const fa = resolveTarget(analysis);
  if (fa && isLoopSection(fa.indicator) && fa.rung < top && !avoid.has(fa.indicator)) {
    return { indicator: fa.indicator, domain: fa.domain, name: fa.name, carried: false };
  }
  const cands = [];
  for (const [domainKey, d] of Object.entries((analysis && analysis.domains) || {})) {
    for (const ind of (d && Array.isArray(d.indicators) ? d.indicators : [])) {
      if (!ind || !isLoopSection(ind.id) || !applicableToday(analysis, ind.id)) continue;
      const rung = Number(ind.score);
      if (!Number.isFinite(rung) || rung >= top) continue;
      cands.push({ indicator: String(ind.id), domain: domainKey, name: indicatorName(analysis, domainKey, ind.id), rung, carried: false });
    }
  }
  if (!cands.length) return null;
  // stable sort: lowest rung first, rubric order preserved among equals
  const sorted = cands.map((c, i) => ({ c, i })).sort((a, b) => (a.c.rung - b.c.rung) || (a.i - b.i)).map((x) => x.c);
  const pick = sorted.find((c) => !avoid.has(c.indicator)) || sorted[0];
  const { rung, ...target } = pick;
  return target;
}

/**
 * The verdict on the PRIOR action, computed from this lesson's tally.
 *   no_prior        - nothing to grade
 *   not_applicable  - the target's subject is not this lesson's
 *   achieved        - the rubric's top rung today, or every bar key met
 *   partial         - some unit rose against the baseline, bar not met
 *   not_seen        - nothing moved
 *   unknown         - no usable tally (our parse failure — never a punishment)
 */
function deriveUptakeStatus(uptake, prior, analysis) {
  if (!prior || !prior.target || !prior.target.indicator) return 'no_prior';
  const id = prior.target.indicator;
  if (!applicableToday(analysis, id)) return 'not_applicable';
  if (rungOf(analysis, id) >= scaleMax()) return 'achieved';
  const want = prior.action_spec && prior.action_spec.count_target;
  const got = uptake && uptake.count;
  if (!want || typeof want !== 'object' || !got || typeof got !== 'object') return 'unknown';
  const keys = Object.keys(want);
  if (!keys.length || !keys.every((k) => Number.isFinite(Number(got[k])))) return 'unknown';
  if (keys.every((k) => Number(got[k]) >= Number(want[k]))) return 'achieved';
  const base = (prior.baseline && prior.baseline.count) || {};
  if (keys.some((k) => Number(got[k]) > Number(base[k] || 0))) return 'partial';
  return 'not_seen';
}

/**
 * The next loop state from the prior record and this lesson's verdict.
 * Deterministic for the same inputs, so a report re-run writes the same record.
 */
function nextTarget(prior, uptakeStatus, analysis) {
  const fresh = (reason, extra = {}) => {
    const target = chooseTarget(analysis, null, extra.avoid ? { avoid: extra.avoid } : {});
    return {
      target,
      attempt: target ? 1 : 0,
      angle: 'tell',
      achieved_streak: 0,
      target_status: target ? 'open' : 'none',
      reason: target ? reason : 'no_candidate',
      ...(extra.closed ? { closed: extra.closed } : {}),
    };
  };
  if (!prior || prior.target_status !== 'open' || !prior.target || uptakeStatus === 'no_prior') {
    return fresh('no_open_target');
  }
  const attempt = Number(prior.attempt) || 1;
  const streak = Number(prior.achieved_streak) || 0;
  const handedOver = !!prior.hand_over || attempt > MAX_ATTEMPTS;
  const keep = (extra) => ({
    target: prior.target, attempt, angle: prior.angle || LADDER[Math.min(attempt, LADDER.length) - 1],
    achieved_streak: streak, target_status: 'open', ...(handedOver ? { hand_over: true } : {}), ...extra,
  });
  if (uptakeStatus === 'not_applicable') return keep({ bridge: true, reason: 'target_not_applicable_today' });
  if (uptakeStatus === 'unknown') return keep({ reason: 'uptake_unknown' });
  if (uptakeStatus === 'achieved') {
    if (streak + 1 >= CLOSE_AFTER) {
      return fresh('closed_after_two', { closed: prior.target, avoid: [prior.target.indicator] });
    }
    return keep({ achieved_streak: streak + 1, reason: 'once_more' });
  }
  // partial / not_seen → same target, the next rung of the ladder
  const next = attempt + 1;
  if (next > MAX_ATTEMPTS) {
    return { target: prior.target, attempt: next, angle: 'hand_over', achieved_streak: 0, target_status: 'open', hand_over: true, reason: 'max_attempts' };
  }
  return { target: prior.target, attempt: next, angle: LADDER[next - 1], achieved_streak: 0, target_status: 'open', reason: 'next_angle' };
}

/** Token-overlap guard (Jaccard > threshold): two actions for one target must not read the same. */
function tooSimilar(a, b, threshold = 0.5) {
  const tok = (s) => new Set(String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2));
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter) > threshold;
}

/**
 * The record written to prioritized_action: the card as sent, plus the loop
 * state, the baseline for the NEXT verdict, the lineage, and this lesson's
 * verdict on the PRIOR action. teacher_response fields are never set here —
 * the button handler merges those later.
 */
function buildRecord(state, { prior = null, analysis = null, card = null, instrument = 'self', uptake = null, uptakeStatus = null } = {}) {
  const c = { ...(card || {}) };
  delete c.teacher_response;
  delete c.responded_at;
  const target = state && state.target ? { indicator: state.target.indicator, domain: state.target.domain, name: state.target.name } : null;
  const bar = target ? countBarFor(target.indicator) : null;
  const spec = c.action_spec && typeof c.action_spec === 'object' ? { ...c.action_spec } : {};
  if (target && (!spec.count_target || typeof spec.count_target !== 'object')) spec.count_target = bar;
  if (target && !c.action) {
    // No card (the /observe write): the ask is the scorer's own move when it
    // is about this very target, else the rubric's rung-2 descriptor.
    const fa = analysis && analysis.focus_area;
    const scorerMove = fa && String(fa.indicator || '') === target.indicator && typeof fa.try_this_tomorrow === 'string'
      ? fa.try_this_tomorrow.trim() : '';
    c.action = scorerMove || rubricAsk(target.indicator);
  }
  if (!spec.move && c.action) spec.move = c.action;
  const sameTargetAsPrior = !!(prior && prior.target && target && prior.target.indicator === target.indicator);
  const lineage = [...((prior && Array.isArray(prior.lineage)) ? prior.lineage : []), ...(prior && prior.session_id ? [prior.session_id] : [])].slice(-12);
  return {
    ...c,
    framework: 'fico',
    loop_version: LOOP_VERSION,
    instrument,
    target,
    action_spec: target ? spec : (c.action_spec || null),
    attempt: state ? state.attempt : 0,
    angle: state ? state.angle : 'tell',
    achieved_streak: state ? state.achieved_streak : 0,
    target_status: state ? state.target_status : 'none',
    reason: state ? state.reason : 'no_state',
    ...(state && state.hand_over ? { hand_over: true } : {}),
    ...(state && state.bridge ? { bridge: true } : {}),
    ...(state && state.closed ? { closed: state.closed } : {}),
    baseline: target ? {
      rung: rungOf(analysis, target.indicator),
      count: sameTargetAsPrior && uptake && uptake.count && typeof uptake.count === 'object' ? { ...uptake.count } : null,
    } : null,
    lineage,
    uptake: prior && prior.target ? {
      status: uptakeStatus || 'unknown',
      target: prior.target.indicator,
      count: uptake && uptake.count && typeof uptake.count === 'object' ? { ...uptake.count } : null,
      evidence: uptake && typeof uptake.evidence === 'string' ? uptake.evidence.slice(0, 600) : '',
      moment: uptake && typeof uptake.moment === 'string' ? uptake.moment.slice(0, 120) : '',
    } : null,
  };
}

/**
 * The rubric's own rung-2 descriptor for an indicator, as a plain ask
 * ("THREE OR MORE open-ended questions AND at least one follow-up…"), with the
 * scorer-facing tail ("Quote each…", "Name the…") removed. Used when a record
 * must carry an ask but no card was generated (the /observe write), so the
 * next lesson's PRIOR ACTION block never quotes an empty string.
 */
function rubricAsk(indicatorId) {
  const domains = fico.getScoringConstants().domains || {};
  for (const d of Object.values(domains)) {
    const spec = (d.indicators || []).find((i) => i.id === indicatorId);
    if (!spec || !spec.levels || !spec.levels[2]) continue;
    const sentences = String(spec.levels[2]).split(/(?<=\.)\s+/);
    const kept = sentences.filter((s) => !/^(Quote|Name|Say|State)\b/i.test(s.trim()));
    return (kept.length ? kept : sentences).join(' ').trim();
  }
  return '';
}

/** "open_questions ≥ 3, followups_on_a_student_answer ≥ 1" — for prompts and logs. */
function describeCount(obj) {
  if (!obj || typeof obj !== 'object') return 'not recorded';
  const parts = Object.entries(obj).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`);
  return parts.length ? parts.join(', ') : 'not recorded';
}

module.exports = {
  chooseTarget, nextTarget, tooSimilar, applicableToday, rungOf, deriveUptakeStatus, buildRecord,
  countBarFor, describeCount, isLoopSection, rubricAsk,
  LADDER, MAX_ATTEMPTS, CLOSE_AFTER, COUNT_BARS, LOOP_VERSION,
};
