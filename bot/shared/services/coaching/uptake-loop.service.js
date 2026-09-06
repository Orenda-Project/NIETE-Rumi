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
  // Section B — the SEVEN GENERIC indicators, countable only when Section B is
  // in PROXY mode (see sectionBIsProxy). B3 has no entry on purpose: its rung-2
  // bar is "EVERY activity serves the objective", a universal rather than a
  // count, and a >= comparison against it would pass vacuously.
  B1: { objective_stated: 1, objective_referred_back: 1 },
  B2: { spoken_transitions: 2 },
  B4: { named_prior_concepts_recalled: 2 },
  B5: { developed_connections: 1 },
  B6: { distinct_tasks_or_supports: 2 },
  B7: { closure_moves_that_check_learning: 1 },
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

/**
 * Applicable AND scored in this very lesson. A carried B target additionally
 * dies the moment she attaches a plan: Section B flips to fidelity-derived and
 * that indicator stops driving anything, so the loop bridges (attempt frozen)
 * exactly as it does for a subject-gated F row in the wrong subject.
 */
function applicableToday(analysis, indicatorId) {
  const row = findRow(analysis, indicatorId);
  if (!row || row.applicable === false || row.score === null || row.score === undefined) return false;
  if (String(indicatorId || '')[0] === 'B' && !sectionBIsProxy(analysis)) return false;
  return true;
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

// ─── The fidelity half of Section B: coaching the PLAN PHASE ──────────
//
// When a plan resolved to graded moves, the seven B indicators are vestigial
// and what actually moves Section B is executed÷prescribed. The carryable unit
// there is the move's `phase` — `move_id` is per-plan, `phase` recurs in every
// plan — so the loop coaches the phase she repeatedly fails to execute, and
// grades uptake straight off the NEXT lesson's own move verdicts. No model call.
//
// This is not the C1 treadmill: across 46 prod teachers with 3+ graded lessons
// the worst phase is teacher-specific (warm_up 28%, hook 20%, independent 11%,
// exit 11%, announce 9%, spread over nine phases). But 18 of those 46 miss
// EVERY phase, and for them "the worst" carries no information — so they get
// the phase that is CHEAPEST to adopt instead.

const FULL_CREDIT_VERDICTS = new Set(['executed', 'substituted_equivalent', 'substituted_better']);

// Cheapest to adopt first: say one sentence < ask one question < one closing
// check < one connection < restructure class time.
const PHASE_ADOPTION_COST = ['announce', 'recall', 'warm_up', 'exit', 'hook', 'explain',
  'peer_review', 'grouping', 'guided', 'independent', 'homework'];

const PHASE_LABEL = {
  announce: 'Saying the objective', recall: 'Recalling last time', warm_up: 'The warm-up',
  exit: 'The closing check', hook: 'The hook', explain: 'The explanation',
  guided: 'Guided practice', independent: 'Independent practice', homework: 'Setting homework',
  peer_review: 'Peer review', grouping: 'Grouping by level',
};
const phaseLabel = (ph) => PHASE_LABEL[ph] || String(ph || '').replace(/_/g, ' ');

/** The graded, adjudicable moves of one lesson — [] when she brought no usable plan. */
function gradedMoves(lpFidelity) {
  if (!lpFidelity || lpFidelity.status !== 'ok' || !Array.isArray(lpFidelity.moves)) return [];
  return lpFidelity.moves.filter((m) => m && m.counted && m.verdict !== 'not_adjudicable');
}

/**
 * The phase to coach, from her recent graded lessons (newest last or first —
 * order does not matter). Null when no phase shows a real pattern.
 *
 * @param {Array<{lp_fidelity:object}>} history
 */
function choosePhaseTarget(history) {
  const lessons = (Array.isArray(history) ? history : [])
    .map((h) => gradedMoves(h && h.lp_fidelity))
    .filter((mv) => mv.length);
  if (lessons.length < 2) return null;

  const stat = {};   // phase -> { prescribed, missed }
  for (const moves of lessons) {
    const seen = new Set();
    for (const m of moves) {
      const ph = m.phase;
      if (!ph || seen.has(ph)) continue;
      seen.add(ph);
      const all = moves.filter((x) => x.phase === ph);
      const missed = all.some((x) => !FULL_CREDIT_VERDICTS.has(x.verdict));
      const st = stat[ph] || (stat[ph] = { prescribed: 0, missed: 0 });
      st.prescribed += 1;
      if (missed) st.missed += 1;
    }
  }
  const rate = (st) => st.missed / st.prescribed;
  const eligible = Object.entries(stat)
    .filter(([, st]) => st.prescribed >= 2 && rate(st) >= 0.5);
  if (!eligible.length) return null;

  // Does she reliably execute anything? If so the failure is discriminating and
  // the most-prescribed repeated miss is the honest target. If she misses
  // everything, "worst" is arbitrary — give her the cheapest one to adopt.
  const discriminates = Object.values(stat).some((st) => st.prescribed >= 2 && rate(st) <= 0.34);
  const cost = (ph) => {
    const i = PHASE_ADOPTION_COST.indexOf(ph);
    return i === -1 ? PHASE_ADOPTION_COST.length : i;
  };
  eligible.sort((a, b) => (discriminates
    ? (b[1].prescribed - a[1].prescribed) || (cost(a[0]) - cost(b[0]))
    : (cost(a[0]) - cost(b[0])) || (b[1].prescribed - a[1].prescribed)));
  const phase = eligible[0][0];
  return { kind: 'phase', phase, name: phaseLabel(phase) };
}

/**
 * Did she execute the target phase in THIS lesson? Straight off the grader's
 * own verdicts — no tally to parse, no model to trust.
 */
function derivePhaseUptake(lpFidelity, phase) {
  const usable = lpFidelity && lpFidelity.status === 'ok' && Array.isArray(lpFidelity.moves);
  if (!usable) return 'not_applicable';                       // no plan resolved → bridge
  const raw = lpFidelity.moves.filter((m) => m && m.phase === phase);
  if (!raw.length) return 'not_applicable';                   // this plan does not ask for it
  const mine = raw.filter((m) => m.counted && m.verdict !== 'not_adjudicable');
  // Prescribed, but every instance was unjudgeable (a garbled stretch of tape):
  // that is our blind spot, never her failure.
  if (!mine.length) return 'unknown';
  const done = mine.filter((m) => FULL_CREDIT_VERDICTS.has(m.verdict)).length;
  if (done === mine.length) return 'achieved';
  if (done > 0 || mine.some((m) => m.verdict === 'partial')) return 'partial';
  return 'not_seen';
}

/** Is this target — either kind — measurable in this lesson? */
function targetApplicable(analysis, target) {
  if (!target) return false;
  if (target.kind === 'phase') {
    return derivePhaseUptake(analysis && analysis.lp_fidelity, target.phase) !== 'not_applicable';
  }
  return applicableToday(analysis, target.indicator);
}

/**
 * Which of the two Section B measurements this lesson used.
 *
 * DERIVED — a lesson plan resolved to graded moves, so applyLpFidelity replaced
 * domain_score with executed÷prescribed and stamped `fidelity_derived`. It does
 * NOT touch indicators[], so the seven B scores still sit there driving nothing
 * and shown to nobody: coaching one of them would move her score by zero.
 *
 * PROXY — no moves resolved (45% of prod sessions), so computeScores summed the
 * seven and they ARE the section. They are stable, generic teacher behaviours,
 * and each maps onto a plan phase the fidelity grader scores (B1→announce,
 * B4→recall, B5→hook, B6→grouping, B7→exit) — so the habit built here is the
 * one that lifts fidelity once she does attach a plan.
 */
function sectionBIsProxy(analysis) {
  const b = ((analysis && analysis.domains) || {}).lesson_plan_fidelity;
  return !(b && b.fidelity_derived === true);
}

/**
 * Is this indicator a legitimate loop target IN THIS LESSON? C/D/F always;
 * a B row only while Section B is the proxy; nothing without a COUNT bar
 * (which excludes B3 and any id the rubric does not define).
 */
function isLoopTarget(analysis, indicatorId) {
  const id = String(indicatorId || '');
  if (!countBarFor(id)) return false;
  if (id[0] === 'B') return sectionBIsProxy(analysis);
  return isLoopSection(id);
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
  // An OPEN target is sticky wherever it is still measurable today — including
  // a B row on a teacher who usually attaches plans. Only NEW choices consult
  // the history below.
  if (prior && prior.target_status === 'open' && prior.target
      && (prior.target.kind === 'phase'
        ? targetApplicable(analysis, prior.target)
        : (prior.target.indicator && applicableToday(analysis, prior.target.indicator)
           && isLoopTarget(analysis, prior.target.indicator)))) {
    return { ...prior.target, carried: true };
  }
  // A fresh PHASE target, when the caller found a repeated miss worth coaching.
  if (opts.phaseTarget && targetApplicable(analysis, opts.phaseTarget)) {
    return { ...opts.phaseTarget, carried: false };
  }
  // If her recent lessons all came with a plan, a fresh B target would spend
  // most of its life bridged — prefer C/D/F, which are measured either way.
  const recent = Array.isArray(opts.recentModes) ? opts.recentModes : [];
  const preferNonB = recent.length >= 2 && recent.every((m) => m === 'derived');
  const eligible = (id) => isLoopTarget(analysis, id) && !(preferNonB && String(id)[0] === 'B');

  const fa = resolveTarget(analysis);
  const faId = fa && eligible(fa.indicator) && fa.rung < top && !avoid.has(fa.indicator) ? fa.indicator : null;
  const asTarget = (x) => ({ indicator: x.indicator, domain: x.domain, name: x.name, carried: false });

  const cands = [];
  for (const [domainKey, d] of Object.entries((analysis && analysis.domains) || {})) {
    for (const ind of (d && Array.isArray(d.indicators) ? d.indicators : [])) {
      if (!ind || !eligible(ind.id) || !applicableToday(analysis, ind.id)) continue;
      const rung = Number(ind.score);
      if (!Number.isFinite(rung) || rung >= top) continue;
      cands.push({ indicator: String(ind.id), domain: domainKey, name: indicatorName(analysis, domainKey, ind.id), rung, carried: false });
    }
  }
  if (!cands.length) return null;

  // The scorer's own pick wins outright — it chose the lowest applicable rung
  // with the most quotable evidence, and discarding that is what started this
  // work. ONE exception: a Section B pick that merely TIES with the lowest
  // C/D/F row (see the section rank below for why).
  if (faId) {
    if (String(faId)[0] !== 'B') return asTarget(fa);
    const lowestCDF = cands.filter((c) => String(c.indicator)[0] !== 'B')
      .reduce((m, c) => Math.min(m, c.rung), Infinity);
    if (fa.rung < lowestCDF) return asTarget(fa);
  }

  // Order: lowest rung → C/D/F before B → the scorer's own pick → rubric order.
  //
  // The section rank is load-bearing, not cosmetic. B6 (differentiation) sits at
  // the floor for nearly every teacher: on the real staging fixture it TIED with
  // the lowest C/D/F row in 16 of 21 sessions and won outright only 4 times, yet
  // it took 62% of all targets purely because B sorts first — the C1 treadmill
  // re-forming on the B side. And a B target is only measurable while Section B
  // is the proxy, so it bridges the moment she attaches a plan, where C/D/F are
  // measured either way. On equal evidence, carry the durable one. A B row that
  // is STRICTLY her lowest still wins, which is the case worth having.
  const sectionRank = (id) => (String(id)[0] === 'B' ? 1 : 0);
  const sorted = cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.rung - b.c.rung)
      || (sectionRank(a.c.indicator) - sectionRank(b.c.indicator))
      || ((a.c.indicator === faId ? 0 : 1) - (b.c.indicator === faId ? 0 : 1))
      || (a.i - b.i))
    .map((x) => x.c);
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
  if (!prior || !prior.target) return 'no_prior';
  if (prior.target.kind === 'phase') {
    return derivePhaseUptake(analysis && analysis.lp_fidelity, prior.target.phase);
  }
  if (!prior.target.indicator) return 'no_prior';
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
function nextTarget(prior, uptakeStatus, analysis, opts = {}) {
  const recentModes = Array.isArray(opts.recentModes) ? opts.recentModes : undefined;
  const fresh = (reason, extra = {}) => {
    const target = chooseTarget(analysis, null, {
      ...(extra.avoid ? { avoid: extra.avoid } : {}),
      ...(recentModes ? { recentModes } : {}),
      ...(opts.phaseTarget ? { phaseTarget: opts.phaseTarget } : {}),
    });
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
  const st = state && state.target ? state.target : null;
  const target = st
    ? (st.kind === 'phase'
      ? { kind: 'phase', phase: st.phase, name: st.name }
      : { indicator: st.indicator, domain: st.domain, name: st.name })
    : null;
  const bar = target ? (target.kind === 'phase' ? { phase_moves_executed: 1 } : countBarFor(target.indicator)) : null;
  const spec = c.action_spec && typeof c.action_spec === 'object' ? { ...c.action_spec } : {};
  if (target && (!spec.count_target || typeof spec.count_target !== 'object')) spec.count_target = bar;
  if (target && target.kind === 'phase' && !c.action) {
    c.action = `Next class, do the ${String(target.name).toLowerCase()} step your lesson plan asks for.`;
  }
  if (target && target.kind !== 'phase' && !c.action) {
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
      rung: target.kind === 'phase' ? null : rungOf(analysis, target.indicator),
      count: sameTargetAsPrior && uptake && uptake.count && typeof uptake.count === 'object' ? { ...uptake.count } : null,
    } : null,
    lineage,
    uptake: prior && prior.target ? {
      status: uptakeStatus || 'unknown',
      target: prior.target.kind === 'phase' ? prior.target.phase : prior.target.indicator,
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
  countBarFor, describeCount, isLoopSection, isLoopTarget, sectionBIsProxy, rubricAsk,
  choosePhaseTarget, derivePhaseUptake, targetApplicable, gradedMoves, phaseLabel,
  PHASE_ADOPTION_COST, PHASE_LABEL,
  LADDER, MAX_ATTEMPTS, CLOSE_AFTER, COUNT_BARS, LOOP_VERSION,
};
