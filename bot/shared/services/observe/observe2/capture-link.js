'use strict';

/**
 * /observe2 — a classroom recording joins the coach's open field form.
 *
 * The link is found in the database, not in the Redis observe state: that state is rewritten by
 * other /observe steps during a lesson, and the record is the thing that lasts. Which form:
 *   - the one the audio router found waiting for this recording (ctx.form), or
 *   - the one the /observe2 Start marked in the observe state (ctx.formId), or
 *   - with neither, the coach's newest form that has no recording yet, started within the link window.
 * A recording started from /observe's own planner (ctx.classicStart) never joins an /observe2 form:
 * the coach chose the classic flow for it. If the capture knows the observed teacher and the form
 * names a different one, it is not linked either: better a classic /observe than a recording filed
 * against the wrong teacher's record.
 *
 * A recording later refused as a duplicate (the worker's audio check) gives the form back
 * (releaseRefusedRecording), so the form waits for the right recording again.
 */

const Store = require('./field-form.store');
const { observe2Strings } = require('./strings');
const { observeLang } = require('../observe-strings');
const { logToFile } = require('../../../utils/logger');

async function candidateForm(user, ctx) {
  if (ctx.form) return ctx.form;
  if (ctx.formId) {
    const got = await Store.getForm(ctx.formId);
    const form = got.ok ? got.form : null;
    if (form && form.observer_user_id === user.id && !form.coaching_session_id) return form;
    return null;
  }
  if (ctx.classicStart) return null;
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
  return { form, ack: S.recording_received(Boolean(form.sealed_at)) };
}

/**
 * A recording refused as already analysed: the form it was linked to waits for a recording again.
 * @returns {Promise<{released:boolean, formId:string|null}>}
 */
async function releaseRefusedRecording(sessionId) {
  const out = await Store.unlinkSession(sessionId);
  if (out.ok && out.formId) {
    logToFile('[observe2] duplicate recording refused: the form waits for a recording again', { sessionId, formId: out.formId });
    return { released: true, formId: out.formId };
  }
  return { released: false, formId: null };
}

module.exports = { linkRecording, releaseRefusedRecording };
