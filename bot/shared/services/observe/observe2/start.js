'use strict';

/**
 * /observe2 — from the command to the live form in the coach's hands.
 *
 *   /observe2 → the /observe visit planner, opened with the token <userId>:observe2-visit
 *   → Start (flow-response.handler binds the teacher exactly as /observe does, so the recording
 *     still attaches to the right teacher) → afterStart: a record in observation_field_forms, then
 *     "How long is this period?" (30 / 35 / 40 minutes)
 *   → handlePeriodButton: the period is saved and the live form is sent, token
 *     <userId>:observe2-form:<recordId>, with the three before-the-lesson steps.
 *
 * The visit endpoint reads the coach from the part of the token before the first colon, so the
 * marker costs it nothing; the marker is what tells the Start completion this is /observe2.
 */

const WhatsAppService = require('../../whatsapp.service');
const ObserveState = require('../observe-state.service');
const Store = require('./field-form.store');
const { evaluateObserve2Trigger } = require('./gate');
const { observe2Strings } = require('./strings');
const { observeLang } = require('../observe-strings');
const { getObserveArm } = require('../observe-gate');
const { logToFile } = require('../../../utils/logger');

const VISIT_MARKER = 'observe2-visit';
const PERIODS = [30, 35, 40];
const PERIOD_BUTTON_RX = /^obs2_period:([A-Za-z0-9-]{1,64}):(\d{1,3})$/;

const visitToken = (userId) => `${userId}:${VISIT_MARKER}`;
const formToken = (userId, formId) => `${userId}:observe2-form:${formId}`;
const isObserve2VisitToken = (token) => String(token || '').endsWith(`:${VISIT_MARKER}`);

function stringsFor(user) {
  return observe2Strings(observeLang(user || {}));
}

/**
 * @returns {Promise<boolean>} handled? false → not /observe2 here; the message falls through.
 */
async function handleObserve2Command(user, from, messageBody) {
  const verdict = evaluateObserve2Trigger({ messageBody, user });
  if (!verdict.match) return false;
  const S = stringsFor(user);
  logToFile('🔭 /observe2 command', { userId: user && user.id, action: verdict.action });

  if (verdict.action === 'deny_no_user') {
    await WhatsAppService.sendMessage(from, S.deny_no_user);
    return true;
  }
  if (verdict.action === 'deny_role') {
    await WhatsAppService.sendMessage(from, S.deny_role);
    return true;
  }

  const sent = await WhatsAppService.sendFlow(from, {
    flowId: process.env.OBSERVE_VISIT_FLOW_ID,
    body: S.visit_body,
    buttonText: S.visit_cta,
    flowToken: visitToken(user.id),
  });
  if (!sent) {
    logToFile('❌ /observe2: the visit planner did not send', { userId: user.id }, 'error');
    await WhatsAppService.sendMessage(from, S.launch_failed);
    return true;
  }
  await ObserveState.setState(user.id, 'awaiting_pick', { arm: getObserveArm(user) });
  return true;
}

/**
 * After Start in an /observe2 planner: the teacher is bound (the recording will attach to them);
 * create the record and ask the period.
 */
async function afterStart({ user, phoneNumber, boundTeacher, schoolExtId, teacherExtId }) {
  const S = stringsFor(user);
  const teacher = boundTeacher || null;
  const visitContext = {};
  // The planner's pick is kept even when the bind could not resolve it, so the record still says who
  // was observed (and a classic recording for another teacher is never linked to it).
  const pickedExt = teacher && teacher.teacher_ext_id != null ? teacher.teacher_ext_id : teacherExtId;
  if (pickedExt != null && pickedExt !== '') visitContext.teacher_ext_id = String(pickedExt);
  const school = schoolExtId != null && schoolExtId !== '' ? schoolExtId : teacher && teacher.school_ext_id;
  if (school != null && school !== '') visitContext.school_ext_id = String(school);

  const created = await Store.createForm({
    observerUserId: user.id,
    teacherUserId: (teacher && teacher.user_id) || null,
    visitContext,
  });
  if (!created.ok || !created.form) {
    await WhatsAppService.sendMessage(phoneNumber, S.record_failed);
    return { ok: false };
  }

  const formId = created.form.id;
  logToFile('🔭 /observe2: record created, asking the period', { userId: user.id, formId, teacherBound: Boolean(teacher) });
  await markStateWithForm(user.id, formId);
  const asked = await WhatsAppService.sendInteractiveButtons(phoneNumber, {
    body: S.period_body(teacher && teacher.teacher_name),
    buttons: PERIODS.map((m) => ({ id: `obs2_period:${formId}:${m}`, title: S.period_button(m) })),
  });
  if (!asked) {
    logToFile('❌ /observe2: the period buttons did not send', { userId: user.id, formId }, 'error');
    await WhatsAppService.sendMessage(phoneNumber, S.period_failed);
    return { ok: false, formId };
  }
  return { ok: true, formId };
}

/**
 * The bind left the observe state armed (awaiting_audio, origin 'observe2', the teacher). Name this
 * record in it, so the recording that follows joins exactly this form. If the write fails, the capture
 * still links the coach's newest waiting form (the state says origin 'observe2'); logged at error.
 */
async function markStateWithForm(userId, formId) {
  try {
    const st = await ObserveState.getState(userId);
    const { state, ...data } = st || {};
    await ObserveState.setState(userId, state || 'awaiting_audio', { ...data, observe2FormId: formId });
  } catch (err) {
    logToFile('❌ /observe2: the observe state was not marked with the record', { userId, formId, error: err.message }, 'error');
  }
}

function parsePeriodButton(buttonId) {
  const m = PERIOD_BUTTON_RX.exec(String(buttonId || ''));
  if (!m) return null;
  const minutes = Number(m[2]);
  if (!PERIODS.includes(minutes)) return null;
  return { formId: m[1], minutes };
}

async function sendLiveForm(user, from, formId, minutes) {
  const S = stringsFor(user);
  const sent = await WhatsAppService.sendFlow(from, {
    flowId: process.env.OBSERVE2_FIELD_FORM_FLOW_ID,
    body: S.form_body(minutes),
    buttonText: S.form_cta,
    flowToken: formToken(user.id, formId),
  });
  if (!sent) {
    logToFile('❌ /observe2: the live form did not send', { userId: user.id, formId }, 'error');
    await WhatsAppService.sendMessage(from, S.form_failed);
  }
  return sent;
}

/**
 * "30 / 35 / 40 minutes" → save the period, send the live form. Tapping another period later
 * (before the seal) changes it and re-sends the same form.
 * @returns {Promise<boolean>} false when the id is not a period button.
 */
async function handlePeriodButton(user, from, buttonId) {
  const parsed = parsePeriodButton(buttonId);
  if (!parsed || !user) return false;
  const S = stringsFor(user);

  const got = await Store.getForm(parsed.formId);
  if (!got.ok) {
    await WhatsAppService.sendMessage(from, S.try_again);
    return true;
  }
  const form = got.form;
  if (!form || form.observer_user_id !== user.id || form.sealed_at) {
    logToFile('⚠️ /observe2: period tap on a form that is not open for this coach', {
      userId: user.id, formId: parsed.formId, found: Boolean(form), sealed: Boolean(form && form.sealed_at),
    }, 'warn');
    await WhatsAppService.sendMessage(from, S.form_gone);
    return true;
  }

  const set = await Store.setPeriod(form.id, parsed.minutes);
  if (!set.ok) {
    await WhatsAppService.sendMessage(from, S.try_again);
    return true;
  }
  await sendLiveForm(user, from, form.id, parsed.minutes);
  return true;
}

module.exports = {
  PERIODS,
  VISIT_MARKER,
  visitToken,
  formToken,
  isObserve2VisitToken,
  parsePeriodButton,
  handleObserve2Command,
  afterStart,
  handlePeriodButton,
  sendLiveForm,
};
