'use strict';
/**
 * Stage 4, the code legs (NIGHTLY_JOB §4 stage 4): minutes over plan for W-IP-TIME, the one check-signal evaluator
 * for the library's signal shapes (LIBRARY_RULES §6), and the check strip (coachip_step_checks). Pure; never reads
 * analysis_data.uptake (the fact carries only allow-list output).
 */
const C = require('./constants');
const { phaseOutcome } = require('./predicates');
const { W_PHASES } = require('./moments');

const lpMoves = (fact) => (fact && fact.allowed && fact.allowed.lp && Array.isArray(fact.allowed.lp.moves) ? fact.allowed.lp.moves : null);

/** Minutes the lesson ran over its plan by the end of teaching: last explain/guided stamp − prescribed minutes to that move. */
function minutesOverPlan(fact) {
  const moves = lpMoves(fact);
  if (!moves) return null;
  let idx = -1;
  moves.forEach((m, i) => { if ((m.phase === 'explain' || m.phase === 'guided') && m.stampS != null) idx = i; });
  if (idx < 0) return null;
  let prescribed = null;
  for (let i = 0; i <= idx; i += 1) {
    const p = moves[i].tot ? moves[i].tot.prescribedMinutes : null;
    if (p != null) prescribed = (prescribed || 0) + p;
  }
  if (prescribed == null) return null;
  return moves[idx].stampS / 60 - prescribed;
}

/** The rollup's stat_* for W-IP-TIME: the median over lessons with a value, 1 dp, with its base; null with none. */
function statForIpTime(hitFacts) {
  const vals = (hitFacts || []).map(minutesOverPlan).filter((v) => v != null).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  return { stat_kind: 'median', stat_unit: 'min', stat_value: Math.round(median * 10) / 10, stat_base: vals.length };
}

function compare(op, actual, value) {
  switch (op) {
    case '>=': return actual >= value;
    case '<=': return actual <= value;
    case '==': return actual === value;
    case 'in': return Array.isArray(value) && value.includes(actual);
    default: return null;
  }
}

// "Partial" = the phase moved from not_done to partial: a counted partial move and no done move.
function partialOnly(moves, phases) {
  if (!moves || !phases) return false;
  const o = phaseOutcome(moves, phases);
  return o.graded && o.partial && !o.done;
}

function indicatorScore(fact, id) {
  const domains = fact.allowed && fact.allowed.fico ? fact.allowed.fico.domains : null;
  if (!domains || !id || id === '-') return null;
  for (const key of Object.keys(domains)) {
    const ind = domains[key].indicators.find((i) => i.id === id);
    if (ind) return ind.applicable === false ? null : ind.score;
  }
  return null;
}

/**
 * One later recording against a step's check signal → 'hit' | 'partial' | 'miss', or null when this recording's
 * instrument cannot judge it. evalW(wId, fact) → {in_denominator, hit} is the signal stage's own predicate.
 */
function evaluateCheckSignal(signal, fact, evalW) {
  if (!signal || typeof signal.signal_id !== 'string' || /uptake/.test(signal.signal_id)) return null;
  const id = signal.signal_id;
  const op = signal.comparison;

  // A W id: the job recomputes that W's per-session predicate; `absent` = the W did not fire.
  if (/^W-[A-Z0-9-]+$/.test(id)) {
    if (op !== 'absent') return null;
    const r = evalW(id, fact);
    if (!r || !r.in_denominator) return null;
    if (r.hit) return 'miss';
    return partialOnly(lpMoves(fact), W_PHASES[id]) ? 'partial' : 'hit';
  }

  // A move predicate: lp_fidelity.<phase>.verdict | worked_ratio.
  let m = /^lp_fidelity\.([a-z_]+)\.(verdict|worked_ratio)$/.exec(id);
  if (m) {
    const moves = lpMoves(fact);
    if (!moves) return null;
    const phase = m[1];
    const counted = moves.filter((x) => x.counted && x.phase === phase);
    if (!phaseOutcome(moves, phase).graded) return null;
    const progress = partialOnly(moves, phase);
    if (m[2] === 'verdict') {
      const met = counted.some((x) => x.verdict !== 'partial' && compare(op, x.verdict, signal.value));
      if (met) return 'hit';
      return progress ? 'partial' : 'miss';
    }
    let worked = null; let prescribed = null;
    for (const x of counted) {
      if (!x.tot || x.tot.workedMinutes == null || x.tot.prescribedMinutes == null) continue;
      worked = (worked || 0) + x.tot.workedMinutes;
      prescribed = (prescribed || 0) + x.tot.prescribedMinutes;
    }
    if (worked == null || !prescribed) return null;
    if (compare(op, worked / prescribed, signal.value)) return 'hit';
    return progress ? 'partial' : 'miss';
  }

  // The phonics detector: detector.F8.<field>, from the fact's in-memory detector result (an array counts its items).
  m = /^detector\.F8\.([a-z_]+)$/.exec(id);
  if (m) {
    const det = fact.detector;
    if (!det || !Object.prototype.hasOwnProperty.call(det, m[1])) return null;
    const v = Array.isArray(det[m[1]]) ? det[m[1]].length : det[m[1]];
    if (v == null) return null;
    const ok = compare(op, v, signal.value);
    return ok == null ? null : ok ? 'hit' : 'miss';
  }

  // An indicator: fico.<v3 id>|<v4 id>.score, read on the recording's own instrument.
  m = /^fico\.([A-Z0-9-]+)\|([A-Z0-9-]+)\.score$/.exec(id);
  if (m) {
    const want = fact.instrument === 'fico_v3' ? m[1] : fact.instrument === 'fico_v4' ? m[2] : null;
    const score = want ? indicatorScore(fact, want) : null;
    if (score == null) return null;
    const ok = compare(op, score, signal.value);
    return ok == null ? null : ok ? 'hit' : 'miss';
  }
  return null;
}

const countable = (f) => f && f.status === 'ok' && !f.is_duplicate && !f.is_unusable && !f.is_mismatch;

function interventionMap(interventions) {
  const map = new Map();
  const list = Array.isArray(interventions) ? interventions : Object.values(interventions || {});
  for (const i of list) if (i && i.id) map.set(i.id, i);
  return map;
}

/**
 * coachip_step_checks rows for every open step: the teacher's next graded recordings after set_at and within 14 days,
 * up to 3, each judged on the step's I signal. Recordings the instrument cannot judge are passed over. Steps carry
 * the in-memory teacher_key (resolved from code_id by the job); a step without one gets an empty strip.
 * Returns { rows, summaries: [{step_id, hits, n, worked, to_come}] }.
 */
function checkStrips({ openSteps, factsByTeacherKey, interventions, evalW, jobRunId }) {
  const lib = interventionMap(interventions);
  const byKey = factsByTeacherKey instanceof Map ? factsByTeacherKey : new Map(Object.entries(factsByTeacherKey || {}));
  const rows = [];
  const summaries = [];
  for (const step of openSteps || []) {
    if (!step || step.status !== 'open') continue;
    const iv = lib.get(step.i_id);
    const signal = iv && iv.check_it_worked ? iv.check_it_worked.signal : null;
    const setAt = new Date(step.set_at).getTime();
    const until = setAt + C.CHECK_DAYS * 86400000;
    const facts = (step.teacher_key && byKey.get(step.teacher_key)) || [];
    const candidates = facts
      .filter((f) => countable(f) && f.recorded_at)
      .map((f) => ({ f, t: new Date(f.recorded_at).getTime() }))
      .filter(({ t }) => t > setAt && t <= until)
      .sort((a, b) => a.t - b.t || (a.f.session_id < b.f.session_id ? -1 : 1));
    const done = new Set();
    const strip = [];
    for (const { f } of candidates) {
      if (strip.length >= C.CHECK_RECORDINGS || !signal) break;
      if (done.has(f.session_id)) continue;
      const hit = evaluateCheckSignal(signal, f, evalW);
      if (hit == null) continue;
      done.add(f.session_id);
      strip.push({ step_id: step.id, session_id: f.session_id, seq: strip.length + 1, hit, recorded_at: f.recorded_at, job_run_id: jobRunId });
    }
    rows.push(...strip);
    const hits = strip.filter((r) => r.hit === 'hit').length;
    summaries.push({ step_id: step.id, hits, n: strip.length, worked: hits >= C.CHECK_HITS_TO_WORK, to_come: Math.max(0, C.CHECK_RECORDINGS - strip.length) });
  }
  return { rows, summaries };
}

module.exports = { minutesOverPlan, statForIpTime, evaluateCheckSignal, checkStrips };
