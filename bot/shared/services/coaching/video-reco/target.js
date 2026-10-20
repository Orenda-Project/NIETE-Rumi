'use strict';
/**
 * Which indicator (or plan phase) a recommended clip is for (bd-gzfdu9, SPEC §3.2 step 4). Pure.
 *
 * ONE place, in order: a plan-phase step → its teaching moves; else the report's next step
 * (nextStep.target); else the commitment card's own indicator (v10 groups A/B and undrawn schools get
 * target:null and the card picks its area); else the scorer's stored focus (resolveTarget). The
 * scorer's weakest row is never used on its own.
 *
 * A target already at the top rung is not a growth area (the C1 trap, bd-0c01q.1): it is kept as
 * stepIndicator, and retrieval uses the next-lowest applicable row that has quotable evidence, with
 * forcedDiffer=true. Prod analyses (and the eval corpus) carry the 37-id scheme on a 1–3 scale, whose
 * ids overlap FICO v4's with other meanings (37-B7 = use of the plan, v4-B7 = closure): on that scheme
 * EVERY id goes through the crosswalk aliases, and the top rung is 3.
 */
const { resolveTarget } = require('../target-resolver');

const V4_IDS = new Set('B1 B2 B3 B4 B5 B6 B7 C1 C2 C3 C4 D1 D2 D3 D4 D5 F1 F2 F3 F4 F5 F6 F7 F8 F9 F10'.split(' '));

const OPENING = ['activate_prior_knowledge', 'state_objective'];
const PHASE_MOVES = Object.freeze({
  warm_up: OPENING,
  recall: OPENING,
  hook: OPENING,
  announce: OPENING,
  explain: ['gradual_release', 'teaching_aids', 're_explain_differently'],
  guided: ['check_understanding', 'group_work'],
  grouping: ['check_understanding', 'group_work'],
  independent: ['differentiate_tasks'],
  exit: ['closure_check', 'peer_self_assessment'],
  peer_review: ['closure_check', 'peer_self_assessment'],
});

function rowsOf(analysis) {
  const out = [];
  const domains = analysis && analysis.domains && typeof analysis.domains === 'object' ? analysis.domains : {};
  for (const d of Object.values(domains)) {
    for (const r of (d && Array.isArray(d.indicators) ? d.indicators : [])) if (r && r.id) out.push(r);
  }
  return out;
}

function schemeOf(analysis, rows) {
  if (analysis && analysis.indicator_scheme === 'fico_main_37') return { is37: true, top: 3 };
  if (rows.some((r) => !V4_IDS.has(String(r.id)))) return { is37: true, top: 3 };
  return { is37: false, top: 2 };
}

function mapper(is37, aliases) {
  const a = aliases && typeof aliases === 'object' ? aliases : {};
  return (raw) => {
    const id = String(raw || '').trim();
    if (!id) return null;
    if (!is37 && V4_IDS.has(id)) return id;
    return typeof a[id] === 'string' && a[id] ? a[id] : null;
  };
}

function scored(r) {
  return r.applicable !== false && r.score !== null && r.score !== undefined && Number.isFinite(Number(r.score));
}

function quotable(r) {
  return !!(String(r.evidence || '').trim() || String(r.evidence_summary || '').trim());
}

/** Applicable rows below the top rung, lowest score first, ties in analysis order; mapped to v4 ids. */
function weakRows(rows, map, top) {
  return rows
    .map((r, i) => ({ r, i, id: map(r.id) }))
    .filter((x) => x.id && scored(x.r) && Number(x.r.score) < top)
    .sort((a, b) => Number(a.r.score) - Number(b.r.score) || a.i - b.i);
}

function none(reason, extra = {}) {
  return { storedIndicator: null, storedStep: null, scheme: null, indicator: null, moves: [], alsoWeak: [], stepIndicator: null, forcedDiffer: false, source: null, phase: null, row: null, none: reason, ...extra };
}

/**
 * @returns {{indicator:string|null, moves:string[], alsoWeak:string[], stepIndicator:string|null,
 *   forcedDiffer:boolean, source:'step'|'card'|'scorer'|'phase'|null, phase:string|null, row:object|null, none:string|null}}
 */
function pick(analysis, nextStep, card, aliases) {
  try {
    // /observe2's 17 indicators reuse v4 ids with other meanings (observe2/fico17.js; red-team H13).
    if (analysis && (analysis.observe2 || (analysis.focus_area && analysis.focus_area.indicator === 'plan'))) return none('scheme_observe2');
    const rows = rowsOf(analysis);
    const { is37, top } = schemeOf(analysis, rows);
    const map = mapper(is37, aliases);
    const step = nextStep && nextStep.target;

    if (step && step.kind === 'phase') {
      const moves = PHASE_MOVES[step.phase];
      if (!moves) return none('phase', { source: 'phase', phase: step.phase || null });
      return { ...none(null), moves: [...moves], source: 'phase', phase: step.phase, scheme: is37 ? 'fico_main_37' : 'fico_v4' };
    }

    let raw = null;
    let source = null;
    if (step && step.indicator) { raw = step.indicator; source = 'step'; }
    else if (card && card.indicator) { raw = card.indicator; source = 'card'; }
    else {
      const t = resolveTarget(analysis);
      if (t && t.indicator) { raw = t.indicator; source = 'scorer'; }
    }
    if (!raw) return none('no_target');

    const stepIndicator = map(raw);
    if (!stepIndicator) return none('unknown_indicator', { source });

    const weak = weakRows(rows, map, top);
    const own = rows.find((r) => String(r.id) === String(raw)) || null;
    let indicator = stepIndicator;
    let row = own;
    let forcedDiffer = false;
    if (own && scored(own) && Number(own.score) >= top) {
      const next = weak.find((x) => x.id !== stepIndicator && quotable(x.r));
      if (!next) return none('top_rung', { source, stepIndicator });
      indicator = next.id;
      row = next.r;
      forcedDiffer = true;
    }
    const alsoWeak = [];
    for (const x of weak) {
      if (x.id === indicator || alsoWeak.includes(x.id)) continue;
      alsoWeak.push(x.id);
      if (alsoWeak.length === 2) break;
    }
    return {
      storedIndicator: row ? String(row.id) : String(raw), storedStep: String(raw), scheme: is37 ? 'fico_main_37' : 'fico_v4',
      indicator, moves: [], alsoWeak, stepIndicator, forcedDiffer, source, phase: null, row, none: null,
    };
  } catch (e) {
    return none('no_target');
  }
}

module.exports = { pick, PHASE_MOVES, V4_IDS };
