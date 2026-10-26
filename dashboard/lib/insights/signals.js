'use strict';
/**
 * Stage 2, signals (NIGHTLY_JOB §4 stage 2; FICO_CROSSWALK §0 rules 1-2, §2). One coachip_session_signals row per
 * (countable fact, seeded non-S7 W) whose primary crosswalk row reads the fact's instrument. The hit rules are code in
 * EVALUATORS, keyed by W id then source; the crosswalk strings are only checked against them in a test, never parsed.
 * Detector Ws are written by the model stage and egra Ws by the result cells, so neither has an evaluator here.
 */
const C = require('./constants');
const { phaseOutcome } = require('./predicates');

const WARM = ['warm_up', 'hook', 'recall'];

const countable = (f) => !!f && f.status === 'ok' && !f.is_duplicate && !f.is_unusable && !f.is_mismatch;
const isTrue = (v) => v === true;

/** The stamp of the first counted move (plan order) in the phases that carries one, optionally of given verdicts. */
function firstStamp(moves, phases, verdicts = null) {
  for (const m of moves) {
    if (!m.counted || !phases.includes(m.phase) || m.stampS == null) continue;
    if (verdicts && !verdicts.includes(m.verdict)) continue;
    return m.stampS;
  }
  return null;
}

/** A phase W: rule 2's denominator on `denomPhases`, the hit from `hit(ctx)`. */
function phaseW(phases, hit, opts = {}) {
  const denomPhases = opts.denomPhases || phases;
  return (fact) => {
    const moves = fact.allowed.lp.moves || [];
    const out = (p) => phaseOutcome(moves, p);
    const own = out(denomPhases);
    const ctx = { fact, moves, own, out };
    const isHit = own.graded && hit(ctx);
    return { in: own.graded, hit: isHit, value: null, stamp: firstStamp(moves, denomPhases, opts.stampVerdicts || null) };
  };
}

const skippedOwn = ({ own }) => own.skipped;
const tailWithin = (f) => f.audio_s != null && f.last_stamp_s != null && f.audio_s - f.last_stamp_s <= C.MARGIN_TAIL_S;
const gapAtLeast = (f) => f.audio_s != null && f.last_done_s != null && f.audio_s - f.last_done_s >= C.MARGIN_NOPLAN_EXIT_S;

const LP = {
  'W-IP': phaseW(['independent'], skippedOwn),
  // Sub-rows share W-IP's denominator; an unknown split (null) is in the denominator and not a hit.
  'W-IP-TIME': phaseW(['independent'], ({ own, fact }) => own.skipped && isTrue(fact.is_ran_out_of_time)),
  'W-IP-NOPLAN': phaseW(['independent'], ({ own, fact }) => own.skipped && isTrue(fact.is_time_remained)),
  'W-IP-HOME': phaseW(['independent'], ({ own, fact }) => own.skipped && isTrue(fact.is_sent_home)),
  'W-IP-PARTIAL': phaseW(['independent'], ({ own }) => !own.skipped && own.partial, { stampVerdicts: ['partial'] }),
  'W-GP': phaseW(['guided'], skippedOwn),
  'W-GP-TIME': phaseW(['guided'], ({ own, out, fact }) => own.skipped && out('independent').skipped && isTrue(fact.is_ran_out_of_time)),
  'W-GP-NOPLAN': phaseW(['guided'], ({ own, out, fact }) => own.skipped
    && (out('independent').done || out('exit').done || isTrue(fact.is_time_remained))),
  'W-EXIT': phaseW(['exit'], skippedOwn),
  'W-EXIT-TIME': phaseW(['exit'], ({ own, fact }) => own.skipped && (isTrue(fact.is_short_of_audio) || tailWithin(fact))),
  'W-EXIT-NOPLAN': phaseW(['exit'], ({ own, fact }) => own.skipped && gapAtLeast(fact)),
  'W-WARM': phaseW(WARM, skippedOwn),
  'W-PEER': phaseW(['peer_review'], skippedOwn),
  'W-EXPLAIN': phaseW(['explain'], skippedOwn),
};

function findIndicator(fico, id) {
  const domains = (fico && fico.domains) || {};
  for (const key of Object.keys(domains)) {
    const hit = (domains[key].indicators || []).find((i) => i.id === id);
    if (hit) return hit;
  }
  return null;
}

/** A FICO W on one indicator: in the denominator when scored and not marked inapplicable. */
function indicatorW(indicator, rule, test) {
  const fn = (fact) => {
    const ind = findIndicator(fact.allowed.fico, indicator);
    const scored = !!ind && ind.score != null && ind.applicable !== false;
    return { in: scored, hit: scored && test(ind.score), value: scored ? ind.score : null, stamp: ind ? ind.timestampS : null };
  };
  fn.indicator = indicator;
  fn.rule = rule;
  return fn;
}
const v3 = (id) => indicatorW(id, 'score <= 2', (s) => s <= 2);
const v4 = (id) => indicatorW(id, 'score = 0', (s) => s === 0);
const f17 = (id) => indicatorW(id, 'level <= 2', (s) => s <= 2);

const EVALUATORS = Object.freeze({
  ...Object.fromEntries(Object.entries(LP).map(([w, fn]) => [w, { [w === 'W-IP-HOME' ? 'code' : 'lp_fidelity']: fn }])),
  'W-Q': { fico_v3: v3('C1'), fico_v4: v4('C1') },
  'W-FB': { fico_v3: v3('C3'), fico_v4: v4('C3') },
  'W-REASON': { fico_v3: v3('D2'), fico_v4: v4('D2') },
  'W-TRANS': { fico_v3: v3('B2'), fico_v4: v4('B2') },
  'W-OBJ': { fico_v3: v3('B1'), fico_v4: v4('B1') },
  'W-GROUP': { fico17: f17('C7') },
  'W-PHON': { fico_v4: indicatorW('F8', 'score IN (0,1)', (s) => s === 0 || s === 1) },
});

const OTHER_STAGE = Object.freeze({ coachip_detector: 'model_stage', egra: 'result_cells' });

/** How a primary (W, source) is produced: 'evaluator' here, 'model_stage', 'result_cells', or null (a gap). */
function coverageOf(wId, source) {
  if (EVALUATORS[wId] && EVALUATORS[wId][source]) return 'evaluator';
  return OTHER_STAGE[source] || null;
}

/** The sources a fact's instrument can feed: an lp fact also feeds the code legs computed from its fields. */
function sourcesFor(fact) {
  const inst = fact.instrument || (fact.framework_version === 'lp_fidelity' ? 'lp_fidelity' : null);
  if (inst === 'lp_fidelity') return ['lp_fidelity', 'code'];
  return inst ? [inst] : [];
}

function buildSignals(fact, { weaknesses, crosswalk }) {
  if (!countable(fact) || !fact.allowed) return [];
  const sources = sourcesFor(fact);
  if (!sources.length) return [];
  if (sources[0] === 'lp_fidelity' && !fact.allowed.lp) return [];
  if (sources[0] !== 'lp_fidelity' && !fact.allowed.fico) return [];
  const rows = Array.isArray(crosswalk) ? crosswalk : crosswalk.rows;
  const out = [];
  for (const w of weaknesses) {
    if (w.is_s7) continue;
    const primary = rows.find((r) => r.w_id === w.id && r.role === 'primary' && sources.includes(r.source));
    const ev = primary && EVALUATORS[w.id] && EVALUATORS[w.id][primary.source];
    if (!ev) continue;
    const r = ev(fact);
    out.push({
      fact_id: fact.id,
      session_id: fact.session_id,
      w_id: w.id,
      source: primary.source,
      is_in_denominator: r.in,
      is_hit: r.in && r.hit,
      value: r.value,
      stamp_s: r.stamp != null && r.stamp >= 0 ? Math.round(r.stamp) : null,
      model_run_id: null,
      status: 'ok',
    });
  }
  return out;
}

module.exports = { buildSignals, coverageOf, countable, EVALUATORS };
