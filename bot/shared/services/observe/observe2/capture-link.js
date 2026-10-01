'use strict';

/**
 * /observe2 — a classroom recording joins the coach's open field form.
 *
 * The link is found in the database, not in the Redis observe state: that state is rewritten by
 * other /observe steps during a lesson, and the record is the thing that lasts. The newest form of
 * this coach that has no recording yet, started within the link window, is the one. If the capture
 * knows the observed teacher and the form names a different one, it is not linked: better a
 * classic /observe than a recording filed against the wrong teacher's record.
 */

const Store = require('./field-form.store');
const { observe2Strings } = require('./strings');
const { observeLang } = require('../observe-strings');
const { logToFile } = require('../../../utils/logger');

/**
 * @returns {Promise<null | {form: object, ack: string}>} null → not an /observe2 recording.
 */
async function linkRecording(user, session, boundTeacher) {
  const found = await Store.findOpenFormForCapture(user.id);
  if (!found.ok || !found.form) return null;
  const form = found.form;
  const boundId = boundTeacher && boundTeacher.user_id;
  if (boundId && form.teacher_user_id && boundId !== form.teacher_user_id) {
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

module.exports = { linkRecording };
