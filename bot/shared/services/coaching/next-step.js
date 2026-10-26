/**
 * The ONE next step a coaching report is about (bd-v0toag.1.5).
 *
 * The narrative's horizon, the commitment card ("try this") and the stored
 * focus_area must name the same indicator. They used to be chosen in three
 * places: the hero pinned the horizon to the loop target or the validated
 * focus_area, the card fell back to the weakest row on its own when that did
 * not resolve, and focus_area stayed whatever the scorer wrote. The live
 * 7 Oct report named three different things.
 *
 * selectNextStep is called ONCE per report; every surface reads its target.
 * Pure: no I/O. The stored-focus write lives in next-step-store.js.
 */

const { resolveTarget, resolveIndicator } = require('./target-resolver');
const { findWeakestIndicator, NOT_AN_ASK } = require('./coaching-card/prioritized-action.service');

/**
 * Which indicator this card is about. With the loop on, the sticky loop
 * target (validated against THIS analysis) — except on a bridge lesson, where
 * the target does not apply and the card coaches this lesson's own indicator.
 * Without the loop, the scorer's validated focus_area.
 */
function cardTarget(analysis, loop) {
  const ask = (t) => (t && NOT_AN_ASK.has(String(t.indicator)) ? null : t);
  // A loop target that is not an ask (bd-v0toag.100.10) gives way to the scorer's focus, as an invalid one does.
  return ask(pickTarget(analysis, loop)) || ask(resolveTarget(analysis));
}

function pickTarget(analysis, loop) {
  const st = loop && loop.state && loop.state.target;
  if (st && !loop.state.bridge) {
    // A PHASE target is coached as the plan step, not as a rubric indicator.
    // `try` carries what THIS lesson's plan actually asked for, so the ask can
    // show her the step she skipped before asking for it next time.
    if (st.kind === 'phase') {
      const moves = ((analysis && analysis.lp_fidelity && analysis.lp_fidelity.moves) || [])
        .filter((m) => m && m.phase === st.phase);
      const missed = moves.find((m) => m.verdict === 'not_done' || m.verdict === 'partial') || moves[0];
      return {
        kind: 'phase', phase: st.phase, name: st.name,
        try: (missed && String(missed.text || '').trim()) || '',
        rationale: '', title: st.name, count: null, levels: null,
      };
    }
    if (st.indicator) {
      const t = resolveIndicator(analysis, st.indicator);
      if (t) return t;
    }
  }
  return resolveTarget(analysis);
}

function scorerId(analysis) {
  const fa = analysis && analysis.focus_area;
  return fa && typeof fa === 'object' ? String(fa.indicator || '').trim() : '';
}

/**
 * @returns {{target: object|null, fallback: boolean, reason: string|null, scorerIndicator: string|null}}
 *   fallback=true when neither the loop nor the scorer's focus_area gave a valid
 *   target and the weakest scored row was taken instead (the same row the
 *   rule-based card always picked) — or nothing at all was available.
 */
function selectNextStep(analysis, loop = null) {
  const id = scorerId(analysis) || null;
  const target = cardTarget(analysis, loop);
  if (target) return { target, fallback: false, reason: null, scorerIndicator: id };
  const weakest = analysis ? findWeakestIndicator(analysis) : null;
  const picked = weakest && weakest.id ? resolveIndicator(analysis, weakest.id) : null;
  return { target: picked, fallback: true, reason: id ? 'focus_area_invalid' : 'no_focus_area', scorerIndicator: id };
}

/**
 * The analysis_data keys that make the stored focus the selected step, or null
 * when it already is (or the step has no indicator: a plan phase, or none).
 * The scorer's own pick is kept beside it as focus_area_scorer — the first one,
 * never an already-rewritten focus.
 */
function focusPatch(analysis, target) {
  if (!target || !target.indicator || !analysis) return null;
  if (scorerId(analysis) === String(target.indicator)) return null;
  return {
    focus_area: {
      domain: target.domain,
      indicator: target.indicator,
      title: target.title || target.name,
      rationale: target.rationale || '',
      try_this_tomorrow: target.try || '',
      selected_by: 'next_step',
    },
    focus_area_scorer: analysis.focus_area_scorer || analysis.focus_area || null,
  };
}

module.exports = { selectNextStep, focusPatch, cardTarget };
