/**
 * FEAT-053 bd-16/bd-19 — leader-observation draft lifecycle.
 *
 * onAnalysisReady : freeze v1 (autofill_analysis_data), arm awaiting_form
 *                   state, send the pre-filled MEWAKA Flow to the observer.
 * buildScreenPrefill : analysis_data → one domain screen's ${data.*} bindings.
 * applyObserverEdits : merge the leader's Flow edits into analysis_data (v2),
 *                   re-run computeScores, stamp observer_edit_summary
 *                   (the v1→v2 diff is FEAT-053's annotation dataset).
 *
 * Observe-ness is derived from the SESSION ROW (observation_type), never from
 * queue payloads — SQS payload loss is a known bug class (bd-1525).
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const ObserveState = require('./observe-state.service');
const { observeStrings, observeLang } = require('./observe-strings');
const { getObservePack } = require('./observe-framework');   // FEAT-093 bd-52 — market rubric by config
const { logToFile } = require('../../utils/logger');

// D15 — full text stays in analysis_data regardless of what the form shows.
// bd-2217: was 300, which visibly cut every Evidence note mid-sentence (Warda +
// Mubashar, ICT, 2026-07-21). The Flow's TextArea declares no max-chars, so
// Meta's 600 default applies — 300 was throwing away half the allowance and,
// worse, the evidence is the whole point of the review step: a leader can't
// judge a score from a truncated quote. Prefill is served per SCREEN (one
// domain, max 10 indicators), so 26 × 2 × 600 is never in a single payload.
const PREFILL_TEXT_CAP = 600;

// bd-60: the published Flow binds its score options to ${data.scale} at
// runtime, so these labels MUST follow the pack — the sw hardcode was
// serving Kiswahili 0-3 labels inside Pakistan's Urdu HOTS form. Keep the
// hots strings byte-identical to scripts/generate-observe-flow-json.js.
const SCALE_OPTIONS_BY_LANG = {
  sw: [
    { id: '0', title: '0 · Haikuonekana kabisa' },
    { id: '1', title: '1 · Mara chache' },
    { id: '2', title: '2 · Vya kutosha' },
    { id: '3', title: '3 · Sana' },
  ],
  ur: [
    { id: '0', title: '0 · نظر نہیں آیا · Absent' },
    { id: '1', title: '1 · کبھی کبھار · Rare' },
    { id: '2', title: '2 · کافی · Enough' },
    { id: '3', title: '3 · بھرپور · Strong' },
  ],
};
const scaleOptions = () => {
  const pack = getObservePack();
  // FEAT-102: a pack may carry its OWN scale (FICO is 1-4, not the lang-keyed
  // 0-3). Prefer it; fall back to the lang map for mewaka/hots.
  return pack.scaleOptions || SCALE_OPTIONS_BY_LANG[pack.lang] || SCALE_OPTIONS_BY_LANG.sw;
};

// bd-59: HOTS indicator ids are NUMBERS (7); mewaka's are strings ("C3.7").
// String() first, or every non-mewaka pack crashes on .replace.
const fid = (id) => String(id).replace(/\./g, '_');

async function loadSession(sessionId) {
  const { data: session, error } = await supabase
    .from('coaching_sessions')
    .select('*, users!inner(phone_number, first_name, preferred_language)')
    .eq('id', sessionId)
    .single();
  if (error || !session) {
    throw new Error(`observe: session ${sessionId} not found (${error && error.message})`);
  }
  return session;
}

/**
 * @param {object} analysis  MEWAKA-shaped analysis_data
 * @param {string} domainKey e.g. 'introduction'
 * @returns {object} ${data.*} bindings for that domain's Flow screen
 */
function buildScreenPrefill(analysis, domainKey) {
  const { domains } = { domains: getObservePack().domains };
  const spec = domains[domainKey];
  const stored = ((analysis || {}).domains || {})[domainKey] || {};
  const byId = {};
  (stored.indicators || []).forEach(ind => { byId[ind.id] = ind; });

  const data = { scale: scaleOptions() };
  spec.indicators.forEach(specInd => {
    const f = fid(specInd.id);
    const ind = byId[specInd.id] || {};
    const score = Number.isFinite(Number(ind.score)) && ind.score !== null && ind.score !== undefined
      ? Math.max(0, Math.min(3, Number(ind.score))) : 0;
    data[`s_${f}`] = String(score);
    data[`e_${f}`] = String(ind.evidence_sw || ind.evidence || '').slice(0, PREFILL_TEXT_CAP);
    data[`i_${f}`] = String(ind.improvement_sw || ind.improvement || '').slice(0, PREFILL_TEXT_CAP);
  });
  return data;
}

/**
 * Analysis finished for a leader observation: freeze v1 once, flip status,
 * arm the observer's form state, send the editable pre-filled Flow.
 */
async function onAnalysisReady(sessionId, from) {
  const session = await loadSession(sessionId);
  const observerId = session.observer_user_id || session.user_id;
  const lang = observeLang(session.users);
  const S = observeStrings(lang);

  const update = { status: 'awaiting_observer_review', debrief_status: session.debrief_status || 'pending' };
  if (!session.autofill_analysis_data) {
    update.autofill_analysis_data = session.analysis_data; // freeze v1 exactly once
  }
  const { error: upErr } = await supabase.from('coaching_sessions').update(update).eq('id', sessionId);
  if (upErr) logToFile('⚠️ observe: failed to persist review status/freeze', { sessionId, error: upErr.message });

  // bd-28 review fix: never clobber a live debrief-recording state (the FO
  // may be mid-debrief for ANOTHER session when this analysis completes).
  // awaiting_form is informational — the Flow endpoint never reads it.
  const currentState = await ObserveState.getState(observerId);
  if (currentState && currentState.state === 'awaiting_debrief_audio') {
    logToFile('🔭 observe: analysis ready but observer is mid-debrief — state left armed', {
      sessionId, debriefSessionId: currentState.sessionId,
    });
  } else {
    await ObserveState.setState(observerId, 'awaiting_form', { sessionId });
  }

  // Read at call time (COMMITMENT_CARD_ENABLED precedent) — per-service env
  // var; constants.js caches env at first import which breaks late-set envs.
  const OBSERVE_MEWAKA_FLOW_ID = process.env.OBSERVE_MEWAKA_FLOW_ID || '';
  if (OBSERVE_MEWAKA_FLOW_ID) {
    await WhatsAppService.sendFlow(from, {
      flowId: OBSERVE_MEWAKA_FLOW_ID,
      flowToken: `${observerId}:${sessionId}`,   // endpoint derives identity from this
      header: S.flow_header,
      body: S.flow_body,
      buttonText: S.flow_button,
    });
    logToFile('🔭 observe: pre-filled MEWAKA flow sent', { sessionId, observerId });
  } else {
    // Pre-publish grace: flow not yet configured on this deployment.
    await WhatsAppService.sendMessage(from, S.flow_fallback);
    logToFile('⚠️ observe: OBSERVE_MEWAKA_FLOW_ID unset — sent text fallback', { sessionId });
  }
}

/**
 * Merge the leader's edits (r_/ev_/imp_ field map from the Flow) into a v2
 * analysis, recompute scores, stamp the annotation summary, persist.
 * v1 (autofill_analysis_data) is never touched here.
 */
async function applyObserverEdits(sessionId, edits) {
  const session = await loadSession(sessionId);
  const v1 = session.autofill_analysis_data || session.analysis_data;
  const v2 = JSON.parse(JSON.stringify(session.analysis_data));

  let rescored = 0;
  let textChanged = 0;
  const v1ById = {};
  Object.values((v1 || {}).domains || {}).forEach(d =>
    (d.indicators || []).forEach(ind => { v1ById[ind.id] = ind; }));

  Object.values(v2.domains || {}).forEach(d => {
    (d.indicators || []).forEach(ind => {
      const f = fid(ind.id);
      const orig = v1ById[ind.id] || {};
      if (edits[`r_${f}`] !== undefined && edits[`r_${f}`] !== null && edits[`r_${f}`] !== '') {
        const newScore = Math.max(0, Math.min(3, parseInt(edits[`r_${f}`], 10) || 0));
        if (newScore !== Number(orig.score)) rescored += 1;
        ind.score = newScore;
      }
      for (const [prefix, field] of [['ev_', 'evidence_sw'], ['imp_', 'improvement_sw']]) {
        const val = edits[`${prefix}${f}`];
        if (typeof val === 'string') {
          const full = String(orig[field] || '');
          const shown = full.slice(0, PREFILL_TEXT_CAP);
          // bd-2218: the leader only ever saw `shown`. Anything past the cap
          // never reached the screen, so writing their edit verbatim deletes
          // text they had no chance to review — and nothing in the Flow hints
          // there was more, so neither they nor the teacher can catch it. An
          // edit may shorten what was reviewed; it must not touch what wasn't.
          const unseen = full.slice(PREFILL_TEXT_CAP);
          if (val !== shown && val !== full) textChanged += 1;
          if (val !== shown) ind[field] = unseen ? `${val}${unseen}` : val;
        }
      }
    });
  });

  getObservePack().computeScores(v2);
  const summary = {
    indicators_rescored: rescored,
    text_fields_changed: textChanged,
    edited_at: new Date().toISOString(),
  };
  v2.observer_edit_summary = summary;

  // bd-28 review fix: this is a wholesale analysis_data write from a read at
  // function entry — re-read observer_debrief at write time so a Flow
  // resubmission can't drop debrief data the worker merged meanwhile.
  const { data: freshRow } = await supabase.from('coaching_sessions')
    .select('analysis_data').eq('id', sessionId).single();
  const freshDebrief = freshRow && freshRow.analysis_data && freshRow.analysis_data.observer_debrief;
  if (freshDebrief) v2.observer_debrief = freshDebrief;

  const { error } = await supabase.from('coaching_sessions')
    .update({ analysis_data: v2, status: 'observer_review_complete' })
    .eq('id', sessionId);
  if (error) throw new Error(`observe: failed to persist v2 edits: ${error.message}`);

  logToFile('📝 observe: observer edits applied (v2)', { sessionId, ...summary });
  return summary;
}

module.exports = { onAnalysisReady, buildScreenPrefill, applyObserverEdits, SCALE_OPTIONS_BY_LANG };
