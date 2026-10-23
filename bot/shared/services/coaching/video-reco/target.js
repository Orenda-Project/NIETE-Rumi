'use strict';
/**
 * What a recommended clip is for (bd-gzfdu9, SPEC v1.3 §3.2 step 4). Pure.
 *
 * ONE place, in order: a plan-phase step → its teaching moves; else the report's next step (nextStep.target);
 * else the commitment card's indicator when it carries one; else, when the card is the LLM card with action
 * text and no indicator (v10 groups A/B and undrawn schools, 92% of prod reports), the card TEXT itself
 * ('card_text': no indicator filter, the text is the signal). The scorer's focus is never a target on its own.
 *
 * At the top rung retrieval stays on the step indicator (the ladder's "show" rung) and stepAtTop is stored;
 * there is no forced differ. Prod analyses (and the eval corpus) use the 37-id scheme, whose ids overlap
 * FICO v4's with other meanings (37-B7 = use of the plan, v4-B7 = closure): on that scheme a chapter tagged
 * with the stored id (fico_main37) is matched natively first; only then the crosswalk — `exact`, else the
 * `approx` ids that suit the lesson's subject. A v4 analysis never reads the crosswalk.
 */
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

// v4 Section F rows are subject-specific (fico-framework.js): an approx alias to one survives only for its subject.
const SUBJECT_ROWS = Object.freeze({
  F4: ['maths'], F5: ['maths'], F6: ['science'], F7: ['science'], F8: ['urdu', 'english'], F9: ['urdu', 'english'], F10: ['urdu', 'english'],
});

function rowsOf(analysis) {
  const out = [];
  const domains = analysis && analysis.domains && typeof analysis.domains === 'object' ? analysis.domains : {};
  for (const d of Object.values(domains)) {
    const inds = d && Array.isArray(d.indicators) ? d.indicators : [];
    const max = Number(d && d.domain_max);
    // The rung ceiling = domain_max over the SCORED rows: not-applicable rows carry no points (red-team 19:40Z).
    const n = inds.filter((r) => r && scored(r)).length;
    const top = Number.isFinite(max) && max > 0 && n ? max / n : null;
    for (const r of inds) if (r && r.id) out.push({ r, top });
  }
  return out;
}

function scored(r) {
  return r.applicable !== false && r.score !== null && r.score !== undefined && Number.isFinite(Number(r.score));
}

/** The `Quote:` part of a row's evidence (fico-framework.js) — the only scorer text a moment may match (§3.5 [v1.3] d). */
function scorerQuoteOnly(row) {
  if (!row) return '';
  const m = String(row.evidence || '').match(/Quote:\s*["“']?([\s\S]+?)["”']?\s*$/i);
  return m && m[1].trim() ? m[1].trim() : '';
}

/** The scorer's own quote for a row, as the prompt shows it: the `Quote:` part, else evidence_summary. */
function scorerQuote(row) {
  if (!row) return '';
  return scorerQuoteOnly(row) || String(row.evidence_summary || '').trim();
}

function nativeAvailable(catalog, id) {
  for (const m of (catalog && catalog.modules) || []) {
    if (!m) continue;
    for (const s of m.segments || []) {
      // §3.3 candidate rule (shortlist.recommendable), inlined to keep target.js free of the shortlist module.
      if (s && (s.recommendable === true || (m.recommendable !== false && s.recommendable !== false)) && (s.fico_main37 || []).includes(id)) return true;
    }
  }
  return false;
}

// SPEC v1.3b (lead-review 20:16Z): 37-ids no chapter enacts as a classroom move — Use of Taleemabad Lesson Plan,
// Integration of Taleemabad Technology. A catalogue hole, resolved before any route on every source.
// bd-8hhqhf (lead-final §6.5, ruled): B8 Use of Prescribed Resources joins them — its one gold pick was ⛔2.
const NO_MOVE = new Set(['B7', 'B8', 'C10']);

function none(reason, extra = {}) {
  return {
    indicator: null, indicators: [], moves: [], stepIndicator: null, stepAtTop: false, source: null, cardText: null,
    aliasKind: null, native37: false, storedIndicator: null, scheme: null, phase: null, row: null, name: null, none: reason, ...extra,
  };
}

/**
 * @param {object} analysis
 * @param {object} nextStep   selectNextStep(...) (or null)
 * @param {object} card       the commitment card the teacher reads ({indicator?, action, highlights})
 * @param {object} catalog    catalog.fromData(...) / load() — its aliases, and the native 37-id check
 * @param {{subject?:string}} [lesson]  the resolved subject (approx aliases)
 */
function pick(analysis, nextStep, card, catalog, lesson = {}) {
  try {
    const step = nextStep && nextStep.target;
    // /observe2's 17 indicators reuse v4 ids with other meanings (observe2/fico17.js; red-team H13).
    if ((analysis && analysis.observe2) || (step && step.indicator === 'plan')) return none('scheme_observe2');
    const rows = rowsOf(analysis);
    const is37 = (analysis && analysis.indicator_scheme === 'fico_main_37') || rows.some((x) => !V4_IDS.has(String(x.r.id)));
    const scheme = is37 ? 'fico_main_37' : 'fico_v4';

    if (step && step.kind === 'phase') {
      const moves = PHASE_MOVES[step.phase];
      if (!moves) return none('phase', { source: 'phase', phase: step.phase || null, scheme });
      return { ...none(null), moves: [...moves], source: 'phase', phase: step.phase, scheme };
    }

    let raw = null;
    let source = null;
    if (step && step.indicator) { raw = String(step.indicator); source = 'step'; }
    else if (card && card.indicator) { raw = String(card.indicator); source = 'card'; }
    else if (card && String(card.action || '').trim()) {
      const cardText = [card.action, ...(Array.isArray(card.highlights) ? card.highlights : [])].filter(Boolean).join('\n');
      return { ...none(null), source: 'card_text', cardText, scheme };
    }
    if (!raw) return none('no_target');
    // On the 37 scheme only (v4-B7 is closure); an id outside the 26 is a 37-id whatever the analysis says.
    if (NO_MOVE.has(raw) && (is37 || !V4_IDS.has(raw))) {
      return none('hole:no_move', { storedIndicator: raw, scheme: 'fico_main_37', source, aliasKind: 'no_move' });
    }

    const hit = rows.find((x) => String(x.r.id) === raw) || null;
    const top = (hit && hit.top) || (is37 ? 4 : 2);
    const stepAtTop = !!(hit && scored(hit.r) && Number(hit.r.score) >= top);
    const common = { storedIndicator: raw, scheme, source, row: hit ? hit.r : null, stepAtTop, topRung: top };
    const alias = ((catalog && catalog.aliases) || {})[raw];
    // A step the scorer marked not applicable (or left unscored) never takes a tag route: the card's sentence does
    // (the shortlist's step-text route), else none:'unscored_step' (red-team 19:40Z, lead-review 19:41Z).
    if (hit && !scored(hit.r)) return none('unscored_step', { ...common, aliasKind: 'unscored', name: (alias && alias.name) || null });

    if (!is37) {
      return { ...none(null), ...common, indicator: raw, indicators: [raw], stepIndicator: raw };
    }
    if (nativeAvailable(catalog, raw)) {
      return { ...none(null), ...common, indicator: raw, indicators: [raw], stepIndicator: raw, native37: true, aliasKind: 'native37', name: (alias && alias.name) || null };
    }
    const exact = alias && typeof alias === 'object' ? alias.exact : (typeof alias === 'string' ? alias : null);
    if (exact) return { ...none(null), ...common, indicator: exact, indicators: [exact], stepIndicator: exact, aliasKind: 'exact', name: alias.name || null };
    const subject = lesson && lesson.subject ? String(lesson.subject) : null;
    const approx = ((alias && Array.isArray(alias.approx)) ? alias.approx : [])
      .filter((id) => !SUBJECT_ROWS[id] || (subject && SUBJECT_ROWS[id].includes(subject)));
    // Unknown: no native tag, no exact, no approx that suits the subject. The shortlist's step-text route takes it (v1.3 R3).
    const blocked = alias && Array.isArray(alias.approx) && alias.approx.length > 0;
    if (!approx.length) {
      return none('unknown_indicator', { ...common, aliasKind: blocked ? 'subject_blocked' : 'none', name: (alias && alias.name) || null });
    }
    return { ...none(null), ...common, indicator: approx[0], indicators: approx, stepIndicator: approx[0], aliasKind: 'approx', name: (alias && alias.name) || null };
  } catch (e) {
    return none('no_target');
  }
}

module.exports = { pick, scorerQuote, scorerQuoteOnly, PHASE_MOVES, V4_IDS, SUBJECT_ROWS, NO_MOVE };
