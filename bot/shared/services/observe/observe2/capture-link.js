'use strict';

/**
 * /observe2 — a classroom recording joins the coach's open field form.
 *
 * The link is found in the database, not in the Redis observe state: that state is rewritten by
 * other /observe steps during a lesson, and the record is the thing that lasts. Which form:
 *   - the one the audio router found waiting for this recording (ctx.form), or
 *   - the one the /observe2 Start marked in the observe state (ctx.formId), or
 *   - with neither, the coach's newest form that has no recording yet, started within the link window
 *     (an /observe2 Start whose form id never reached the state; a state armed before Starts said
 *     where they came from; the "whose recording?" pick).
 * A recording armed by a Start from /observe's own planner (ctx.origin 'observe') never joins an
 * /observe2 form: the coach chose the classic flow for it. If the capture knows the observed teacher and the form
 * names a different one, it is not linked either: better a classic /observe than a recording filed
 * against the wrong teacher's record.
 *
 * A recording later refused as a duplicate (the worker's audio check) gives the form back
 * (releaseRefusedRecording), so the form waits for the right recording again.
 *
 * Record first, fill the form afterwards (pilot sheet R19): a recording that came with no form waiting
 * is held with a form made for it at capture (observe2/hold.js); the link here acknowledges it as
 * saved, and the "who did you observe?" answer names its teacher (nameTeacherForRecording).
 */

const Store = require('./field-form.store');
const { observe2Strings } = require('./strings');
const { observeLang } = require('../observe-strings');
const { logToFile } = require('../../../utils/logger');

const minutesOf = (seconds) => (Number(seconds) > 0 ? Math.round(Number(seconds) / 60) : null);

async function candidateForm(user, ctx) {
  if (ctx.form) return ctx.form;
  if (ctx.formId) {
    const got = await Store.getForm(ctx.formId);
    const form = got.ok ? got.form : null;
    if (form && form.observer_user_id === user.id && !form.coaching_session_id) return form;
    return null;
  }
  if (ctx.origin === 'observe') return null;
  const found = await Store.findOpenFormForCapture(user.id);
  return found.ok ? found.form : null;
}

function differentTeacher(form, boundTeacher) {
  if (!boundTeacher) return false;
  if (boundTeacher.user_id && form.teacher_user_id && boundTeacher.user_id !== form.teacher_user_id) return true;
  const formExt = form.visit_context && form.visit_context.teacher_ext_id;
  return Boolean(boundTeacher.teacher_ext_id && formExt && String(boundTeacher.teacher_ext_id) !== String(formExt));
}

/**
 * @param {object} [ctx] { form, formId, classicStart } — see the header.
 * @returns {Promise<null | {form: object, ack: string}>} null → not an /observe2 recording.
 */
async function linkRecording(user, session, boundTeacher, ctx = {}) {
  const form = await candidateForm(user, ctx || {});
  if (!form) return null;
  if (differentTeacher(form, boundTeacher)) {
    logToFile('[observe2] recording is for another teacher than the open form; not linked', {
      userId: user.id, formId: form.id, sessionId: session.id,
    }, 'warn');
    return null;
  }
  const linked = await Store.linkSession(form.id, session.id);
  if (!linked.ok) return null;
  logToFile('[observe2] recording linked to the field form', {
    userId: user.id, formId: form.id, sessionId: session.id, sealed: Boolean(form.sealed_at),
  });
  const S = observe2Strings(observeLang(user));
  if (Store.isHeld(form)) {
    return { form, held: true, ack: S.held_saved(minutesOf(session.audio_duration_seconds)) };
  }
  return { form, ack: S.recording_received(Boolean(form.sealed_at)) };
}

/**
 * "Who did you observe?" answered for a recording linked to an /observe2 form that names no teacher
 * (a held recording, or a Start whose bind failed): the form names the teacher, and the teacher owns
 * the observation, as a bind at Start would have made it. Those are where the check, the plan list
 * and the report read the teacher from. The first answer stands. Never throws.
 * @param {object} teacher a roster row ({user_id?, phone_e164?, teacher_ext_id, teacher_name, school_ext_id?})
 */
async function nameTeacherForRecording(user, sessionId, teacher) {
  try {
    if (!user || !sessionId || !teacher) return { named: false };
    const got = await Store.findBySession(sessionId);
    const form = got.ok ? got.form : null;
    if (!form || form.observer_user_id !== user.id || form.teacher_user_id) return { named: false };
    const { resolveBoundTeacherUserId } = require('../bound-teacher');
    const teacherUserId = await resolveBoundTeacherUserId(teacher);
    if (!teacherUserId) return { named: false };
    const patch = {};
    if (teacher.teacher_ext_id) patch.teacher_ext_id = String(teacher.teacher_ext_id);
    if (teacher.school_ext_id) patch.school_ext_id = String(teacher.school_ext_id);
    const named = await Store.nameTeacher(form, teacherUserId, patch);
    if (!named.ok) return { named: false };
    const supabase = require('../../../config/supabase');
    const { error } = await supabase.from('coaching_sessions')
      .update({ user_id: teacherUserId, updated_at: new Date().toISOString() })
      .eq('id', sessionId).eq('observer_user_id', user.id).eq('user_id', user.id);
    if (error) logToFile('[observe2] teacher named on the form, but the observation\'s owner was not set', { sessionId, error: error.message }, 'error');
    logToFile('[observe2] teacher named after the recording', { userId: user.id, formId: form.id, sessionId, held: Store.isHeld(form) });
    return { named: true, formId: form.id };
  } catch (err) {
    logToFile('[observe2] naming the teacher after the recording failed', { sessionId, error: err.message }, 'error');
    return { named: false };
  }
}

/**
 * A recording refused as already analysed: the form it was linked to waits for a recording again.
 * @returns {Promise<{released:boolean, formId:string|null}>}
 */
async function releaseRefusedRecording(sessionId, now = Date.now()) {
  const out = await Store.unlinkSession(sessionId);
  // A held form was made for this one recording and takes no other (findOpenFormForCapture skips it):
  // saying it waits would be untrue. The recording it repeats is already a visit of its own.
  if (out.ok && out.formId && out.held) {
    logToFile('[observe2] held recording refused as already analysed; its form is left empty', { sessionId, formId: out.formId });
    return { released: false, formId: out.formId };
  }
  // Only a form still inside the link window can take the next recording; past it, saying it waits
  // would send the coach's next recording somewhere it cannot arrive.
  const open = out.createdAt && now - Date.parse(out.createdAt) < Store.LINK_WINDOW_HOURS * 3600 * 1000;
  if (out.ok && out.formId && !open) {
    logToFile('[observe2] duplicate recording refused; its form is past the link window', { sessionId, formId: out.formId });
    return { released: false, formId: out.formId };
  }
  if (out.ok && out.formId) {
    logToFile('[observe2] duplicate recording refused: the form waits for a recording again', { sessionId, formId: out.formId });
    return { released: true, formId: out.formId };
  }
  return { released: false, formId: null };
}

module.exports = { linkRecording, releaseRefusedRecording, nameTeacherForRecording };
