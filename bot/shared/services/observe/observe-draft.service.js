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

// bd-2369: the clamp MUST follow the active pack's scale, not a hardcoded 0-3.
// MEWAKA/HOTS are 0-3; FICO is 1-4. The old `Math.min(3, …)` silently turned
// every FICO "4 · Highly Effective" — machine-scored OR observer-picked — into
// a 3, corrupting the officer's rating on save. Derive bounds from the option
// ids so mewaka/hots stay byte-identical (min 0, max 3) and FICO gets 1-4.
const scaleBounds = () => {
  const ids = scaleOptions().map(o => Number(o.id)).filter(Number.isFinite);
  return { min: Math.min(...ids), max: Math.max(...ids) };
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
// bd-9hzdn (observe parity) — compact, English, code-point-capped summary of the
// MEASURED fidelity analysis for the review Flow's Section B screen. Fidelity
// evolved from the B1-B10 proxy to per-move executed÷prescribed verdicts (D20/D27);
// the coach reviewing the form must see THAT analysis, not just the old matrix.
const FIDELITY_SUMMARY_CAP = 3800; // TextBody limit is 4096; leave headroom
const FIDELITY_GLYPH = {
  executed: '✓', substituted_equivalent: '✓', substituted_better: '✓＋',
  partial: '◐', not_done: '✗', not_adjudicable: '–',
};

function composeFidelitySummary(lp) {
  if (!lp || lp.status !== 'ok' || lp.fidelity_pct == null) return null;
  const bandLabel = lp.band ? ` (${String(lp.band)})` : '';
  const lines = [
    `Measured LP fidelity: ${lp.fidelity_pct}%${bandLabel} · ${lp.prescribed_count ?? (lp.moves || []).filter(m => m.counted).length} moves prescribed`,
  ];
  for (const m of (lp.moves || [])) {
    const glyph = FIDELITY_GLYPH[m.verdict] || '·';
    const text = [...String(m.text || '')].slice(0, 70).join('');
    lines.push(`${glyph} ${text}`);
  }
  if (lp.narrative) lines.push('', [...String(lp.narrative)].slice(0, 400).join(''));
  const out = lines.join('\n');
  return [...out].slice(0, FIDELITY_SUMMARY_CAP).join('');
}

// bd-5n1a2 — per-move presentation for the v3 Flow asset. One block per
// prescribed move: the plan's move, what the recording showed, and the EXACT
// credit the fidelity scorer gave. Labels mirror fidelity-scorer.js's credit
// map (D4/D5): executed/substituted → 1.0, partial → 0.5, not_done → 0,
// not_adjudicable excluded from the denominator.
const MAX_MOVE_SLOTS = 12;
const MOVE_BLOCK_CAP = 450;        // code points per slot (payload discipline)
const VERDICT_LABEL = {
  executed:               '✓ Executed — full credit',
  substituted_equivalent: '✓ Substituted (equal) — full credit',
  substituted_better:     '✓＋ Substituted (better) — full credit',
  partial:                '◐ Partially done — half credit',
  not_done:               '✗ Not done — no credit',
  not_adjudicable:        '– Not assessable — not counted',
};
const PHASE_LABEL = {
  warm_up: 'Warm-up', introduction: 'Introduction', direct_instruction: 'Direct instruction',
  guided_practice: 'Guided practice', independent_practice: 'Independent practice',
  assessment: 'Assessment', closure: 'Closure', homework: 'Homework',
};

// Word-boundary clip: never cuts mid-word (the operator's exact complaint,
// 2026-08-21 — "the form truncates text"). Falls back to a hard cut only when
// there is no space in the tail 40% of the allowance.
function clipWords(s, n) {
  const a = [...String(s == null ? '' : s)];
  if (a.length <= n) return a.join('');
  const cut = a.slice(0, n - 1).join('');
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s،,;:·]+$/, '') + '…';
}

function composeMoveBlocks(lp) {
  if (!lp || lp.status !== 'ok' || lp.fidelity_pct == null) return null;
  const all = Array.isArray(lp.moves) ? lp.moves : [];
  if (!all.length) return null;

  const bandLabel = lp.band ? ` (${String(lp.band).toUpperCase()})` : '';
  const counted = lp.prescribed_count ?? all.filter(m => m.counted).length;
  const header = [
    `Measured lesson-plan fidelity: ${lp.fidelity_pct}%${bandLabel} · ${counted} counted moves`,
    'Score = credit earned ÷ prescribed moves. ✓ full credit · ◐ half · ✗ none · – not counted.',
    'Section B\'s score IS this measurement — the B1–B10 ratings below inform coaching but do not change it.',
  ].join('\n');

  const overflow = all.length > MAX_MOVE_SLOTS;
  const shown = overflow ? all.slice(0, MAX_MOVE_SLOTS - 1) : all;
  const moves = shown.map((m, i) => {
    const phase = PHASE_LABEL[m.phase] || '';
    const verdict = VERDICT_LABEL[m.verdict] || `· ${String(m.verdict || 'ungraded')}`;
    const seen = String(m.evidence || m.rationale || '').trim();
    const lines = [
      `${i + 1}/${all.length}${phase ? ` · ${phase}` : ''} — ${verdict}`,
      `Plan: ${clipWords(m.text, 180)}`,
    ];
    if (seen) lines.push(`Seen: ${clipWords(seen, 200)}`);
    return clipWords(lines.join('\n'), MOVE_BLOCK_CAP);
  });
  if (overflow) {
    moves.push(`…and ${all.length - (MAX_MOVE_SLOTS - 1)} more moves — the full detail is in the report.`);
  }
  return { header, moves };
}

function buildScreenPrefill(analysis, domainKey) {
  const { domains } = { domains: getObservePack().domains };
  const spec = domains[domainKey];
  const stored = ((analysis || {}).domains || {})[domainKey] || {};
  const byId = {};
  (stored.indicators || []).forEach(ind => { byId[ind.id] = ind; });

  const { min: SMIN, max: SMAX } = scaleBounds();
  const data = { scale: scaleOptions() };

  // Section B: attach the measured-fidelity analysis WHEN the published Flow
  // declares the keys (env flipped together with the Flow republish — serving
  // undeclared keys to the old asset would fail Meta's schema validation).
  // The gate is VALUE-aware because published Flows are immutable and the env
  // flip can't be atomic with the deploy (bd-5n1a2):
  //   'true'  → the v2 asset's single fidelity_summary blob
  //   'moves' → the v3 asset's per-move slots (scorer-faithful presentation)
  const fidelityMode = process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
  if (domainKey === 'lesson_plan_fidelity' && fidelityMode === 'true') {
    const summary = composeFidelitySummary((analysis || {}).lp_fidelity);
    data.has_fidelity = !!summary;
    data.fidelity_summary = summary || '';
  }
  if (domainKey === 'lesson_plan_fidelity' && fidelityMode === 'moves') {
    const blocks = composeMoveBlocks((analysis || {}).lp_fidelity);
    data.has_fidelity = !!blocks;
    data.fid_header = blocks ? blocks.header : '';
    for (let k = 1; k <= MAX_MOVE_SLOTS; k++) {
      const mv = blocks && blocks.moves[k - 1];
      data[`mv_${k}`] = mv || '';
      data[`mv_${k}_v`] = !!mv;
    }
  }
  spec.indicators.forEach(specInd => {
    const f = fid(specInd.id);
    const ind = byId[specInd.id] || {};
    const score = Number.isFinite(Number(ind.score)) && ind.score !== null && ind.score !== undefined
      ? Math.max(SMIN, Math.min(SMAX, Number(ind.score))) : SMIN;
    data[`s_${f}`] = String(score);
    // bd-2369: the form shows the ≤500-char evidence_summary (the whole gist,
    // fits Meta's 600-char TextArea); the FULL evidence stays in analysis_data
    // and flows to the teacher's report. evidence_sw keeps MEWAKA/TZ unchanged.
    // bd-5n1a2: clip at a word boundary — a mid-word cut reads as a bug.
    data[`e_${f}`] = clipWords(String(ind.evidence_summary || ind.evidence_sw || ind.evidence || ''), PREFILL_TEXT_CAP);
    data[`i_${f}`] = clipWords(String(ind.improvement_sw || ind.improvement || ''), PREFILL_TEXT_CAP);
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
  const { min: SMIN, max: SMAX } = scaleBounds(); // bd-2369: 1-4 for FICO, 0-3 for mewaka/hots
  const v1ById = {};
  Object.values((v1 || {}).domains || {}).forEach(d =>
    (d.indicators || []).forEach(ind => { v1ById[ind.id] = ind; }));

  Object.values(v2.domains || {}).forEach(d => {
    (d.indicators || []).forEach(ind => {
      const f = fid(ind.id);
      const orig = v1ById[ind.id] || {};
      if (edits[`r_${f}`] !== undefined && edits[`r_${f}`] !== null && edits[`r_${f}`] !== '') {
        const newScore = Math.max(SMIN, Math.min(SMAX, parseInt(edits[`r_${f}`], 10) || SMIN));
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
  reapplyFidelitySectionB(v2, sessionId);

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

/**
 * bd-9hzdn.5 (observe parity, D27): Section B is MEASURED lesson-plan fidelity
 * (executed÷prescribed), not observer opinion — computeScores re-sums it from the
 * editable B indicators, clobbering the fidelity-derived domain_score. Re-apply
 * the measurement so it survives observer edits. Self-guarding: only fires for
 * FICO analyses that carry a usable lp_fidelity blob; never throws.
 */
function reapplyFidelitySectionB(v2, sessionId) {
  try {
    const ficoFramework = require('../coaching/frameworks/fico-framework');
    if (v2 && v2.framework === 'fico' && v2.lp_fidelity && typeof ficoFramework.applyLpFidelity === 'function') {
      ficoFramework.applyLpFidelity(v2, v2.lp_fidelity);
    }
  } catch (fidErr) {
    logToFile('⚠️ observe: re-applying fidelity Section B failed (proxy stands)', { sessionId, error: fidErr.message });
  }
  return v2;
}

module.exports = {
  onAnalysisReady, buildScreenPrefill, applyObserverEdits, reapplyFidelitySectionB,
  composeFidelitySummary, composeMoveBlocks, clipWords, MAX_MOVE_SLOTS, SCALE_OPTIONS_BY_LANG,
};
