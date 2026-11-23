'use strict';

/**
 * Queue #184 — a FICO 6-12 (FICO-S v1.1) HITL visit goes to the Digital Coach, as a FICO17 v6 HITL visit does (operator
 * 19 Nov ~11:20: "yes, all HITL go to DC ... Starred indicators are the one that do not get sent to DC and are
 * mandatorily filled by the HITL"). Behind app_settings.fico_s_dc (coaching/fico-s-switch.js dcForVisit), OFF by
 * default; decided ONCE, when the visit starts, and stamped on coaching_sessions.framework_selection_reason = REASON.
 *
 * The visit, start to end (the v6 path wherever there is one):
 *   start        obs612/visit.startObserveVisit (WhatsApp) / portal-observe.startFdeVisit (portal): framework
 *                'fico_s_v1_1', reason REASON, the FICO 6-12 form row made but NOT sent yet (the capture ack goes out).
 *   transcribed  obs612/visit.afterTranscription lets it through: the photo and plan steps (WhatsApp, when
 *                OBSERVE_CAPTURE_GATES_ENABLED) or the portal's attachments, then the analysis job, exactly as v6.
 *   analysis     analysis-processor runs frameworks/fico-s-framework.js (same model and settings as v6; the photos and
 *                the plan go with the transcript); starred indicators are never asked.
 *   ready        onAnalysisReady (here): Rumi's levels and evidence pre-fill the form's draft (never over anything the
 *                observer already wrote), Rumi's reply is kept on the form row (answers.fico_s_dc) for the review's
 *                checks and the record, the visit moves to 'obs612_form', and the form goes to the observer (WhatsApp)
 *                or waits in the portal.
 *   review       the FICO 6-12 form (obs612/fico-s-flow.js): every level and evidence box as before; a level changed
 *                from Rumi's needs a reason (20+ characters), as v6; a starred indicator is marked ★ and is the
 *                observer's alone.
 *   submit       obs612/record.buildFicoS stamps each level set_by 'coach' | 'rumi' with Rumi's level beside it.
 */

const S = require('../../coaching/frameworks/fico-s');
const { logToFile } = require('../../../utils/logger');

const REASON = 'fico_s_dc';
const FORMS = 'observation_field_forms';
const SESSIONS = 'coaching_sessions';

const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/** Is this session a FICO 6-12 visit (any version: v1.1 or v1.2) stamped for the Digital Coach at its start? */
function isDcVisit(session) {
  return Boolean(session) && S.isFicoSId(session.framework) && session.framework_selection_reason === REASON;
}

/** Rumi's reply kept on the form row (answers.fico_s_dc), or null on a visit Rumi did not pre-fill. */
function dcOf(form) {
  const dc = form && form.answers && form.answers.fico_s_dc;
  return dc && dc.levels ? dc : null;
}

/**
 * Rumi's level for one indicator as the form stores levels ('1'..'4' | 'NA'), or null (couldn't tell, none, starred).
 * `rubric`: the form's version (an N/A the form's version does not offer is no level: a v1.1 form never gets C3 N/A).
 */
function rumiLevelOf(dc, code, rubric = S.RUBRIC_KEY) {
  if (!dc || !dc.levels || S.isStarred(code)) return null;
  const row = dc.levels[code];
  if (!row) return null;
  if (row.result === 'NA') return S.naCodes(rubric).includes(code) ? 'NA' : null;
  const n = S.normLevel(row.result, code, rubric);
  return typeof n === 'number' ? String(n) : null;
}

/**
 * The form's draft with Rumi's pre-fill under it (pure). For every non-starred indicator Rumi set: the level and the
 * Evidence box, only where the observer has not written one. Returns { draft, dc } where dc is what the form row keeps.
 */
function prefillDraft(draft, analysis, { now = Date.now(), rubric = S.RUBRIC_KEY } = {}) {
  const fw = require('../../coaching/frameworks/fico-s-framework');
  const out = { ...(draft || {}) };
  const levels = {};
  const src = (analysis && analysis.levels) || {};
  for (const code of S.DC_CODES) {
    const row = src[code];
    if (!row) continue;
    levels[code] = { result: row.result === undefined ? null : row.result, because: String(row.because || ''), evidence: Array.isArray(row.evidence) ? row.evidence : [] };
    const lv = rumiLevelOf({ levels }, code, rubric);
    if (lv !== null && !has(out[code])) out[code] = lv;
    const ev = fw.prefillEvidence(row);
    if (ev && !has(out[`ev_${code}`])) out[`ev_${code}`] = ev;
  }
  const dc = {
    prompt_version: (analysis && analysis.prompt_version) || fw.promptVersion,
    prefilled_at: new Date(now).toISOString(),
    levels,
    ...(analysis && analysis.dc_scores ? { scores: analysis.dc_scores } : {}),
  };
  return { draft: out, dc };
}

/**
 * Is a changed level explained? (pure) The observer's level differs from Rumi's and the reason is under 20 characters
 * → false. No Rumi level (none, couldn't tell, starred) or the same level → true.
 */
function changeExplained(dc, code, draft, rubric = S.RUBRIC_KEY) {
  const rumi = rumiLevelOf(dc, code, rubric);
  if (rumi === null) return true;
  const mine = (draft || {})[code];
  if (!has(mine) || String(mine) === rumi) return true;
  return S.isEvidence((draft || {})[`chg_${code}`]);
}

/** The visit's lesson as the observer named it (the form's visit_context): { grade, subject } or nulls. */
async function lessonOf(sessionId) {
  try {
    const got = await require('../observe2/field-form.store').findBySession(sessionId);
    const vc = (got.ok && got.form && got.form.visit_context) || {};
    return { grade: vc.grade || null, subject: vc.subject || null };
  } catch (_) {
    return { grade: null, subject: null };
  }
}

/**
 * The analysis landed (analysis-processor → observe-draft.onAnalysisReady): pre-fill the form, open the review, send
 * the form (WhatsApp) or leave it for the portal. Never throws. @returns {Promise<{ok: boolean, sent?: boolean, why?: string}>}
 */
async function onAnalysisReady(session, { from = null, deps = {} } = {}) {
  const supabase = deps.supabase || require('../../../config/supabase');
  const sessionId = session && session.id;
  try {
    const got = await require('../observe2/field-form.store').findBySession(sessionId);
    const form = got.ok ? got.form : null;
    if (!form) {
      logToFile('❌ fico-s dc: analysis ready but the visit has no FICO 6-12 form row', { sessionId }, 'error');
      return { ok: false, why: 'no form' };
    }
    const { draft, dc } = prefillDraft(((form.answers || {}).obs612) || {}, session.analysis_data || {}, { rubric: form.rubric_version });
    let current = form;
    if (!form.sealed_at) {
      const answers = { ...(form.answers || {}), obs612: draft, fico_s_dc: dc };
      const { data, error } = await supabase.from(FORMS).update({ answers }).eq('id', form.id).is('sealed_at', null).select('*');
      if (error) logToFile('❌ fico-s dc: the pre-fill was not saved — the form opens as the observer left it', { sessionId, formId: form.id, error: error.message }, 'error');
      else if ((data || [])[0]) current = data[0];
    }
    const { TERMINAL_IN_FILTER } = require('../../coaching/session-terminal');
    const patch = {
      status: form.sealed_at ? 'observer_review_complete' : 'obs612_form',
      ...(session.autofill_analysis_data ? {} : { autofill_analysis_data: session.analysis_data || null }),
    };
    const { data: armed } = await supabase.from(SESSIONS).update(patch).eq('id', sessionId).not('status', 'in', TERMINAL_IN_FILTER).select('id');
    if (Array.isArray(armed) && armed.length === 0) {
      logToFile('🚫 fico-s dc: the visit ended while Rumi listened — nothing sent', { sessionId });
      return { ok: false, why: 'terminal' };
    }
    logToFile('🔭 fico-s dc: Rumi pre-filled the FICO 6-12 form', {
      sessionId, formId: form.id, prefilled: Object.keys(dc.levels).length, sealed: Boolean(form.sealed_at), prompt_version: dc.prompt_version,
    });
    if (form.sealed_at) return { ok: true, sent: false, why: 'already submitted' };
    if (require('../../coaching/portal-coaching.service').isPortalSession(session)) return { ok: true, sent: false, why: 'portal' };
    const { data: observer } = await supabase.from('users').select('id, phone_number, preferred_language, region, role')
      .eq('id', form.observer_user_id).maybeSingle();
    const to = (observer && observer.phone_number) || from;
    if (!observer || !to) {
      logToFile('❌ fico-s dc: no observer to send the pre-filled form to', { sessionId, formId: form.id }, 'error');
      return { ok: false, why: 'no observer' };
    }
    const sent = await require('./visit').sendForm(observer, to, current, { prefilled: true });
    return { ok: true, sent: Boolean(sent) };
  } catch (err) {
    logToFile('❌ fico-s dc: the pre-filled form step failed', { sessionId, error: err.message }, 'error');
    return { ok: false, why: 'error' };
  }
}

module.exports = { REASON, isDcVisit, dcOf, rumiLevelOf, prefillDraft, changeExplained, lessonOf, onAnalysisReady };
