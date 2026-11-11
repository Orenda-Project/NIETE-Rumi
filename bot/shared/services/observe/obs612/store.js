'use strict';

/**
 * bd-pni007 — the FDE (obs612) form's reads and writes: its observation_field_forms row (one per visit, made and
 * stamped by /observe or /observe2) and, at Submit, the visit's coaching_sessions row.
 *
 * The rules that matter live here, not in the endpoint:
 * - The draft is answers.obs612 (flat keys, see record.js), written only while the form is unsealed
 *   (sealed_at IS NULL on every write; a database trigger also refuses changes to a sealed row's answers).
 * - Submit writes the session first (merged onto the linked row, guarded like /observe2's hand-off: never over a
 *   cancelled or abandoned visit; or a new leader_observation row when the visit has none), then seals the form in
 *   ONE update (answers, sealed_at, checked_at, final_levels, and the new session's id) guarded by
 *   sealed_at IS NULL, so a second Submit seals nothing. A session made for a Submit that then could not seal is
 *   removed, so a retry never leaves two.
 * Every Supabase error is logged at 'error' and returned, never swallowed as "no row".
 */

const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');
const { TERMINAL_IN_FILTER, isTerminalStatus } = require('../../coaching/session-terminal');

const TABLE = 'observation_field_forms';
const SESSIONS = 'coaching_sessions';

function fail(where, error, extra) {
  const message = error && (error.message || String(error));
  logToFile(`[obs612] ${where} failed`, { ...extra, error: message }, 'error');
  return { ok: false, error: message };
}

/** The flat draft the Flow saved (answers.obs612), or {}. */
function draftOf(form) {
  const d = form && form.answers && form.answers.obs612;
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}

async function getForm(id) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) return fail('getForm', error, { id });
  return { ok: true, form: data || null };
}

/** Names for Section 1 of the English & Urdu tool (coach and teacher), in one read. */
async function getPeople(ids) {
  const want = [...new Set((ids || []).filter(Boolean))];
  if (!want.length) return { ok: true, people: [] };
  const { data, error } = await supabase.from('users').select('id, name, school_name').in('id', want);
  if (error) return fail('getPeople', error, { ids: want });
  return { ok: true, people: data || [] };
}

/** Replace the draft with `draft` (the caller merged it), keeping every other key of answers. Unsealed only. */
async function saveDraft(form, draft) {
  if (!form) return { ok: false, error: 'no form' };
  if (form.sealed_at) return { ok: false, sealed: true };
  const { data, error } = await supabase.from(TABLE)
    .update({ answers: { ...(form.answers || {}), obs612: draft } })
    .eq('id', form.id).is('sealed_at', null).select('*');
  if (error) return fail('saveDraft', error, { id: form.id });
  if (!(data || []).length) return { ok: false, sealed: true };
  return { ok: true, form: data[0] };
}

// An FDE visit has no FICO debrief: the coach's summary (observe/obs612/summary.js, sent on Submit) is its talk guide.
// So the visit is debriefed when it is submitted, and waits under the 📨 send-reports list (observe-debrief
// listUnsentReports: debrief done + review complete) until the coach sends the report, as the summary's "Later" says.
const DEBRIEF_DONE = 'done';

// The visit's existing session takes the analysis, merged over what it holds.
async function writeLinkedSession(form, sessionId, analysis) {
  const { data: row, error } = await supabase.from(SESSIONS).select('id, status, analysis_data').eq('id', sessionId).maybeSingle();
  if (error) return fail('submit: read the session', error, { formId: form.id, sessionId });
  if (!row) {
    logToFile('[obs612] submit: the linked session does not exist', { formId: form.id, sessionId }, 'error');
    return { ok: false, error: 'session missing' };
  }
  if (isTerminalStatus(row.status)) return { ok: false, closed: true };
  const { data, error: upErr } = await supabase.from(SESSIONS)
    .update({ analysis_data: { ...(row.analysis_data || {}), ...analysis }, status: 'observer_review_complete', debrief_status: DEBRIEF_DONE, framework: analysis.framework })
    .eq('id', sessionId).not('status', 'in', TERMINAL_IN_FILTER).select('id');
  if (upErr) return fail('submit: write the session', upErr, { formId: form.id, sessionId });
  if (!(data || []).length) return { ok: false, closed: true };
  return { ok: true };
}

// An /observe2 visit with no recording: its own leader_observation row, as observe-capture makes one.
async function createSession(form, analysis, at) {
  const { data, error } = await supabase.from(SESSIONS)
    .insert({
      user_id: form.teacher_user_id || form.observer_user_id,
      observer_user_id: form.observer_user_id,
      observation_type: 'leader_observation',
      status: 'observer_review_complete',
      debrief_status: DEBRIEF_DONE,
      framework: analysis.framework,
      framework_selection_reason: 'obs612_lesson',
      analysis_data: analysis,
      created_at: at,
    })
    .select('id')
    .single();
  if (error || !data) return fail('submit: create the session', error || new Error('no row'), { formId: form.id });
  return { ok: true, sessionId: data.id };
}

async function dropSession(sessionId, formId) {
  const { error } = await supabase.from(SESSIONS).delete().eq('id', sessionId);
  if (error) return fail('submit: remove the unused session', error, { formId, sessionId });
  logToFile('[obs612] submit: removed the session made for a Submit that did not seal', { formId, sessionId }, 'warn');
  return { ok: true };
}

/**
 * Submit a complete form: the session, then the seal.
 * @param {object} form       the form row as read (unsealed)
 * @param {object} draft      the final flat draft
 * @param {object} analysis   record.buildAnalysis(form, draft)
 * @returns {Promise<{ok:true, form, sessionId, created} | {ok:false, alreadySealed?, closed?, error?}>}
 */
async function submit(form, draft, analysis, { now = Date.now() } = {}) {
  if (!form) return { ok: false, error: 'no form' };
  if (form.sealed_at) return { ok: false, alreadySealed: true, form };
  const at = new Date(now).toISOString();

  let sessionId = form.coaching_session_id || null;
  let created = false;
  if (sessionId) {
    const linked = await writeLinkedSession(form, sessionId, analysis);
    if (!linked.ok) return linked;
  } else {
    const made = await createSession(form, analysis, at);
    if (!made.ok) return made;
    sessionId = made.sessionId;
    created = true;
  }

  const patch = {
    answers: { ...(form.answers || {}), obs612: draft },
    sealed_at: at,
    checked_at: at,
    final_levels: analysis.obs612.result,
    ...(created ? { coaching_session_id: sessionId } : {}),
  };
  let q = supabase.from(TABLE).update(patch).eq('id', form.id).is('sealed_at', null);
  if (created) q = q.is('coaching_session_id', null);
  const { data, error } = await q.select('*');
  if (error || !(data || []).length) {
    if (created) await dropSession(sessionId, form.id);
    if (error) return fail('submit: seal', error, { formId: form.id, sessionId });
    const again = await getForm(form.id);
    if (again.ok && again.form && again.form.sealed_at) return { ok: false, alreadySealed: true, form: again.form };
    logToFile('[obs612] submit: the form changed while it was being sealed', { formId: form.id, sessionId }, 'error');
    return { ok: false, error: 'not sealed' };
  }
  logToFile('[obs612] form submitted', { formId: form.id, sessionId, created, rubric: analysis.framework });
  return { ok: true, form: data[0], sessionId, created };
}

module.exports = { TABLE, draftOf, getForm, getPeople, saveDraft, submit };
