'use strict';
/**
 * bd-tbprit.1 — what a coach sees for each reason a C/D teacher gave for "Not accurate" (v10 coaching test).
 * Pure: the session's analysis_data, her reason codes and the report's own "one thing to try" in; out, the
 * grader's own scores and quotes, each with the second of the recording it starts at. Nothing the grader did
 * not write is filled in: no plan checked is said, never guessed.
 *
 *   score      the lowest applicable indicator scores (the AI's), with their quotes
 *   missed     the plan steps marked not done or partly done; with no plan checked, the low indicators
 *   wont_work  what the report told her to try
 *   unclear    what the report told her to try
 */
const { cleanReasons } = require('./coach-ping-reasons');

// coaching-report-view.js SECTIONS order (fico-framework.js DOMAINS).
const DOMAINS = ['lesson_plan_fidelity', 'high_leverage_practices', 'student_engagement', 'teacher_subject_knowledge'];
const LOW_LIMIT = 5;
const MISSED = new Set(['not_done', 'partial']);

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The first m:ss / mm:ss / h:mm:ss in a grader timestamp or quote, in seconds; null when there is none. */
function secondsOf(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/(?:^|[^\d:])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((p) => p != null).map(Number);
  if (parts.slice(1).some((p) => p > 59)) return null;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

function itemOf(i) {
  const applicable = i.applicable !== false;
  return {
    id: text(i.id) || text(i.code),
    name: text(i.name),
    score: applicable ? num(i.score) : null,
    evidence: text(i.evidence),
    at: applicable ? (secondsOf(i.timestamp) ?? secondsOf(i.evidence)) : null,
    applicable,
  };
}

/** Every section in report order with its indicators. Lesson plan fidelity counts only when a plan was linked. */
function indicatorsOf(a) {
  const domains = a && a.domains;
  if (!domains || typeof domains !== 'object') return [];
  const hasPlan = !!(a.scores && a.scores.has_lesson_plan);
  return DOMAINS.filter((k) => domains[k]).map((k) => {
    const d = domains[k];
    return {
      key: k,
      score: num(d.domain_score),
      max: num(d.domain_max),
      counted: k === 'lesson_plan_fidelity' ? hasPlan : true,
      items: (Array.isArray(d.indicators) ? d.indicators : []).filter(Boolean).map(itemOf),
    };
  });
}

/** The plan steps as the grader judged them, or null when the plan was not checked. */
function movesOf(a) {
  const lp = a && a.lp_fidelity;
  if (!lp || lp.status !== 'ok' || !Array.isArray(lp.moves)) return null;
  return lp.moves.filter(Boolean).map((m) => ({
    id: text(m.move_id),
    text: text(m.text),
    phase: text(m.phase),
    mustHappen: m.bucket === 'must_happen',
    verdict: text(m.verdict),
    evidence: text(m.evidence),
    translation: text(m.evidence_translation),
    why: text(m.rationale),
    at: secondsOf(m.evidence),
  }));
}

function lowest(a) {
  return indicatorsOf(a).flatMap((s) => s.items)
    .filter((i) => i.applicable && i.score != null && i.score <= 2)
    .sort((x, y) => x.score - y.score)
    .slice(0, LOW_LIMIT);
}

/** One block per known reason, in the design order. `thing` is the report's one thing to try, or null. */
function evidenceFor(a, reasons, thing) {
  const t = thing || null;
  return cleanReasons(reasons || []).map((code) => {
    if (code === 'score') return { code, items: lowest(a) };
    if (code === 'missed') {
      const moves = movesOf(a);
      if (!moves) return { code, noPlan: true, moves: [], items: lowest(a) };
      return { code, noPlan: false, moves: moves.filter((m) => MISSED.has(m.verdict)), items: [] };
    }
    return { code, thing: t };
  });
}

module.exports = { secondsOf, indicatorsOf, movesOf, evidenceFor };
