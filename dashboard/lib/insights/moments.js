'use strict';
/**
 * Stage 3, moments and the chapter strip (NIGHTLY_JOB §4 stage 3; DESIGN §5, the M rule). Pure functions over the
 * in-memory fact (its allow-list `allowed.lp` / `allowed.fico`) and its coachip_session_signals rows. Rows carry
 * seconds, ids and verdicts only: never step text, a quote or a gloss.
 */
const C = require('./constants');

const MOVE_ID = /^m\d{1,2}$/;
const PHASE = /^[a-z_]+$/;
const DONE_LIKE = [...C.DONE_OR_PARTIAL_VERDICTS];
const EXECUTED_LIKE = [...C.DONE_VERDICTS];

// The phase(s) each fidelity W is cut on (crosswalk.json primary rows, `phase:` ids; W-IP-HOME is independent practice).
const W_PHASES = Object.freeze({
  'W-IP': ['independent'], 'W-IP-TIME': ['independent'], 'W-IP-NOPLAN': ['independent'], 'W-IP-HOME': ['independent'],
  'W-IP-PARTIAL': ['independent'],
  'W-GP': ['guided'], 'W-GP-TIME': ['guided'], 'W-GP-NOPLAN': ['guided'],
  'W-EXIT': ['exit'], 'W-EXIT-TIME': ['exit'], 'W-EXIT-NOPLAN': ['exit'],
  'W-WARM': ['warm_up', 'hook', 'recall'],
  'W-PEER': ['peer_review'],
  'W-EXPLAIN': ['explain'],
});

// The indicator each FICO W reads, per instrument (crosswalk.json primary rows).
const W_INDICATORS = Object.freeze({
  'W-Q': { fico_v3: 'C1', fico_v4: 'C1' },
  'W-FB': { fico_v3: 'C3', fico_v4: 'C3' },
  'W-REASON': { fico_v3: 'D2', fico_v4: 'D2' },
  'W-TRANS': { fico_v3: 'B2', fico_v4: 'B2' },
  'W-OBJ': { fico_v3: 'B1', fico_v4: 'B1' },
  'W-GROUP': { fico17: 'C7' },
});

const lpMoves = (fact) => (fact && fact.allowed && fact.allowed.lp && Array.isArray(fact.allowed.lp.moves) ? fact.allowed.lp.moves : []);
const okMoveId = (id) => (typeof id === 'string' && MOVE_ID.test(id) ? id : null);
const okPhase = (p) => (typeof p === 'string' && PHASE.test(p) ? p : null);
const isStamped = (fact) => fact.is_stamped !== false && !(fact.allowed && fact.allowed.lp && fact.allowed.lp.recording && fact.allowed.lp.recording.noTimestamps);

/** Every stamp in the recording, ascending (moves only; an indicator stamp is not a chapter boundary). */
function stampsOf(fact) {
  return lpMoves(fact).map((m) => m.stampS).filter((s) => s != null).sort((a, b) => a - b);
}

/** The next stamp after `from`, else ends_at, else the audio end; null when none lies after `from`. */
function endAfter(fact, from, stamps) {
  const next = stamps.find((s) => s > from);
  if (next != null) return next;
  if (fact.ends_at_s != null && fact.ends_at_s > from) return fact.ends_at_s;
  if (fact.audio_s != null && fact.audio_s > from) return fact.audio_s;
  return null;
}

function collapse(verdict) {
  if (verdict === 'executed' || verdict === 'partial' || verdict === 'not_done' || verdict === 'not_adjudicable') return verdict;
  if (typeof verdict === 'string' && verdict.startsWith('substituted')) return 'substituted';
  return 'not_adjudicable';
}

/** coachip_session_steps rows: one per plan move in order, with its collapsed verdict and seconds. */
function buildSessionSteps(fact) {
  const moves = lpMoves(fact).filter((m) => okMoveId(m.moveId) && okPhase(m.phase));
  if (!moves.length) return [];
  const stamps = stampsOf(fact);
  let lastDoneIdx = -1;
  moves.forEach((m, i) => { if (DONE_LIKE.includes(m.verdict)) lastDoneIdx = i; });
  const ranOut = fact.is_ran_out_of_time === true;
  const seen = new Set();
  const rows = [];
  moves.forEach((m, i) => {
    if (seen.has(m.moveId)) return;
    seen.add(m.moveId);
    let verdict = collapse(m.verdict);
    if (verdict === 'not_done' && ranOut) {
      const after = m.stampS != null && fact.last_done_s != null ? m.stampS > fact.last_done_s : i > lastDoneIdx;
      if (after) verdict = 'not_reached';
    }
    let from = m.stampS != null ? m.stampS : null;
    let to = from != null ? endAfter(fact, from, stamps) : null;
    if (to == null) { from = null; to = null; }
    rows.push({ fact_id: fact.id, ordinal: rows.length + 1, move_id: m.moveId, phase: m.phase, verdict, is_counted: m.counted === true, from_s: from, to_s: to });
  });
  return rows;
}

function baseRow(fact, wId, kind) {
  return {
    fact_id: fact.id, session_id: fact.session_id, w_id: wId, kind, move_id: null, phase: null, from_s: 0, to_s: 0,
    moment_s: null, confidence: 'none', credit: null, gloss_en: null, gloss_ur: null, gloss_status: 'pending',
    gloss_model_run_id: null, clip_r2_key: null, clip_status: 'pending',
  };
}

/** A window from `from`: to the next stamp / ends_at, capped at from + 90 s, always above from. */
function windowFrom(fact, from, stamps) {
  const end = endAfter(fact, from, stamps);
  const to = end == null ? from + C.MOMENT_MAX_S : Math.min(end, from + C.MOMENT_MAX_S);
  return { from_s: from, to_s: to };
}

function noStamp(row, fact) {
  const audio = fact.audio_s != null && fact.audio_s > 0 ? Math.floor(fact.audio_s) : C.MOMENT_MAX_S;
  return { ...row, from_s: 0, to_s: Math.max(1, Math.min(C.MOMENT_MAX_S, audio)), moment_s: null, confidence: 'none', gloss_status: 'not_applicable' };
}

function indicatorStamp(fact, wId) {
  const id = (W_INDICATORS[wId] || {})[fact.instrument];
  const domains = fact.allowed && fact.allowed.fico ? fact.allowed.fico.domains : null;
  if (!id || !domains) return null;
  for (const key of Object.keys(domains)) {
    const ind = domains[key].indicators.find((i) => i.id === id);
    if (ind) return ind.timestampS;
  }
  return null;
}

function ficoMissing(fact, sig) {
  const row = { ...baseRow(fact, sig.w_id, 'missing'), gloss_status: 'not_evaluated' };
  const ts = sig.stamp_s != null ? sig.stamp_s : indicatorStamp(fact, sig.w_id);
  if (ts == null) return noStamp(row, fact);
  const from = Math.max(0, ts - C.FICO_MOMENT_LEAD_S);
  return { ...row, from_s: from, to_s: from + C.FICO_MOMENT_LEN_S, moment_s: ts, confidence: 'high' };
}

function lpMissing(fact, wId, stamps) {
  const phases = W_PHASES[wId];
  const inPhase = lpMoves(fact).filter((m) => m.counted && phases.includes(m.phase));
  const row = baseRow(fact, wId, 'missing');
  // A partial move that fired the W (W-IP-PARTIAL): its own stamp, high.
  if (wId === 'W-IP-PARTIAL') {
    const target = inPhase.find((m) => m.verdict === 'partial' && m.stampS != null) || inPhase.find((m) => m.verdict === 'partial');
    const r = { ...row, move_id: target ? okMoveId(target.moveId) : null, phase: okPhase(phases[0]), credit: target ? target.credit : null };
    if (!target || target.stampS == null || !isStamped(fact)) return noStamp(r, fact);
    return { ...r, ...windowFrom(fact, target.stampS, stamps), moment_s: target.stampS, confidence: 'high' };
  }
  // A skipped move: from where the step belonged ("the practice should have started here"), medium: the stamp of the
  // last executed, substituted or partial move before it in plan order, else the last stamp before it, else 0.
  const skipped = inPhase.find((m) => m.verdict === C.NOT_DONE) || inPhase[0];
  const r = { ...row, move_id: skipped ? okMoveId(skipped.moveId) : null, phase: okPhase(skipped ? skipped.phase : phases[0]),
    credit: skipped && skipped.credit != null ? skipped.credit : null };
  if (!skipped || !isStamped(fact)) return noStamp(r, fact);
  const all = lpMoves(fact);
  const before = all.slice(0, all.indexOf(skipped)).filter((m) => m.stampS != null);
  const doneBefore = before.filter((m) => DONE_LIKE.includes(m.verdict));
  const anchor = doneBefore.length ? doneBefore[doneBefore.length - 1] : before[before.length - 1];
  const from = anchor ? anchor.stampS : 0;
  return { ...r, ...windowFrom(fact, from, stamps), moment_s: from, confidence: 'medium' };
}

function lpGood(fact, wId, stamps) {
  const phases = W_PHASES[wId];
  let best = null;
  for (const m of lpMoves(fact)) {
    if (!m.counted || !phases.includes(m.phase) || !EXECUTED_LIKE.includes(m.verdict) || m.stampS == null) continue;
    if (!best || (m.credit || 0) > (best.credit || 0)) best = m;
  }
  if (!best || !isStamped(fact)) return null;
  return { ...baseRow(fact, wId, 'good'), move_id: okMoveId(best.moveId), phase: okPhase(best.phase), credit: best.credit,
    ...windowFrom(fact, best.stampS, stamps), moment_s: best.stampS, confidence: 'high' };
}

const PHONICS_WS = ['W-PHON', 'W-PHON-NAMES'];
const LETTER_NAME_STAGE = /letter_name|hijje|tor_jor/;

// A phonics moment: the detector's first grounded stage (W-PHON-NAMES: the first letter-name / hijje stage when the
// detector marks one), 45 s, capped by the recording. A hit with no grounded stage plays the opening, confidence none.
function phonicsMoment(fact, wId) {
  const row = { ...baseRow(fact, wId, 'phonics'), gloss_status: 'not_evaluated' };
  const stages = (Array.isArray(fact.detector.stages_heard) ? fact.detector.stages_heard : [])
    .filter((s) => s && Number.isInteger(s.at_s) && s.at_s >= 0)
    .sort((a, b) => a.at_s - b.at_s);
  let stage = stages[0];
  if (wId === 'W-PHON-NAMES') {
    const named = stages.find((s) => s.letter_name === true || (typeof s.stage === 'string' && LETTER_NAME_STAGE.test(s.stage)));
    if (named) stage = named;
  }
  if (!stage) return noStamp(row, fact);
  const from = stage.at_s;
  let to = from + C.FICO_MOMENT_LEN_S;
  if (fact.audio_s != null && fact.audio_s > from) to = Math.min(to, Math.floor(fact.audio_s));
  return { ...row, from_s: from, to_s: to, moment_s: from, confidence: 'high' };
}

/**
 * coachip_moments rows for one fact, with the count of phonics hits skipped for want of a detector result:
 * a `missing` moment per W that fired, a `phonics` moment per detector W that fired, a `good` moment per
 * in-denominator W that did not fire and has an executed move on its phase (the pair pool). Unique per (fact, W, kind).
 * Child-result (egra) Ws get no moment: S7 has none.
 */
function buildMomentsWithStats(fact, signals) {
  const stamps = stampsOf(fact);
  const out = new Map();
  let skippedNoDetector = 0;
  for (const sig of signals || []) {
    if (!sig || (sig.fact_id && sig.fact_id !== fact.id) || !sig.is_in_denominator) continue;
    const w = sig.w_id;
    if (PHONICS_WS.includes(w)) {
      if (!sig.is_hit || out.has(`${w}|phonics`)) continue;
      if (!fact.detector || typeof fact.detector !== 'object') { skippedNoDetector += 1; continue; }
      out.set(`${w}|phonics`, phonicsMoment(fact, w));
      continue;
    }
    if (sig.is_hit) {
      if (out.has(`${w}|missing`)) continue;
      let row = null;
      if (W_PHASES[w]) row = lpMissing(fact, w, stamps);
      else if (W_INDICATORS[w]) row = ficoMissing(fact, sig);
      if (row) out.set(`${w}|missing`, row);
    } else if (W_PHASES[w] && !out.has(`${w}|good`)) {
      const row = lpGood(fact, w, stamps);
      if (row) out.set(`${w}|good`, row);
    }
  }
  return { rows: [...out.values()], skippedNoDetector };
}

/** The rows only (see buildMomentsWithStats). */
function buildMoments(fact, signals) {
  return buildMomentsWithStats(fact, signals).rows;
}

module.exports = { buildSessionSteps, buildMoments, buildMomentsWithStats, W_PHASES, W_INDICATORS };
