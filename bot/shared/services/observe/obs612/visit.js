'use strict';

/**
 * bd-pni007 — an FDE (obs612) coach visit, from the coach's side: ask the lesson's class (and, for grades 6-12, its
 * subject), stamp the visit with the rubric that class gets, and open FDE's form. The same rule in both coach tools
 * (operator 11 Nov ~18:05: "No difference on observe vs observe2"):
 *
 *   /observe   Start in the visit planner (flow-response.handler) → class → subject → the capture prompt. The
 *              recording makes the session (observe-capture); a grade 6-12 lesson gets its own form row, stamped,
 *              and the FDE form is sent at once: no model scores it, so there is nothing to wait for.
 *   /observe2  the period (observe2/start.js) → class → subject → the FDE form (grades 6-12) or the FICO live
 *              form (grades 1-5), on the visit's own observation_field_forms row.
 *
 * A grade 1-5 lesson stays on FICO; the coach's naming it decides the FICO grade gate (bd-ra8xu.42) instead of the
 * teacher's profile. Self-recordings (the DC) never come here.
 *
 * Runs only while app_settings.obs612_coach is on for the coach (coaching/obs612-switch.js). Off: asksClass is
 * false, every caller takes its old path, and nothing here runs.
 *
 * The FDE form of a visit is ONE observation_field_forms row: rubric_version = the obs612 id ('obs612-msci-v1' …),
 * visit_context.{grade, subject, sheet, via}. The Flow token is `<coachUserId>:obs612:<formId>`.
 */

const crypto = require('crypto');
const supabase = require('../../../config/supabase');
const WhatsAppService = require('../../whatsapp.service');
const ObserveState = require('../observe-state.service');
const O = require('../../coaching/frameworks/obs612');
const { obs612Strings } = require('./strings');
const { observeLang } = require('../observe-strings');
const { logToFile } = require('../../../utils/logger');

const FLOW_ID_ENV = 'OBS612_FLOW_ID';
const TOKEN_MARKER = 'obs612';
const formToken = (coachUserId, formId) => `${coachUserId}:${TOKEN_MARKER}:${formId}`;

// List reply ids. kind 'o' = /observe (ref: a nonce kept in the observe state), 'f' = /observe2 (ref: the form id).
//   o612:g:<kind>:<ref>:<p|6..12>             the class ('p' = grades 1-5)
//   o612:s:<kind>:<ref>:<6..12>:<subject>     the subject
const TAP_RX = /^o612:(g|s):([of]):([A-Za-z0-9-]{1,64}):(p|[0-9]{1,2})(?::([a-z_]{1,20}))?$/;
const isLessonTap = (id) => String(id || '').startsWith('o612:');

const S = (user) => obs612Strings(observeLang(user || {}));
const cp = (s) => [...String(s || '')];
const cap = (s, n) => cp(s).slice(0, n).join('');

/** Is this an FDE form (an observation_field_forms row stamped with an obs612 id)? */
function isObs612Form(form) {
  return Boolean(form) && O.isObs612Id(form.rubric_version);
}

/** Does this coach get the class question? (the switch). Never throws: false on any failure. */
async function asksClass(user) {
  if (!user || !user.id) return false;
  try {
    return await require('../../coaching/obs612-switch').isOn({ userId: user.id, region: user.region });
  } catch (_) {
    return false;
  }
}

/**
 * The lesson the coach named: { primary: true } for grades 1-5, or
 * { primary: false, grade, subject, rubricId, tool, sheet } for grades 6-12.
 */
function lessonFrom(grade, subject) {
  const g = O.normGrade(grade);
  if (g === null || g <= O.PRIMARY_MAX_GRADE) return { primary: true, grade: null, subject: null };
  const t = O.toolFor(g, subject);
  return { primary: false, grade: g, subject: O.normSubject(subject), rubricId: t.rubricId, tool: t.tool, sheet: t.sheet };
}

function parseTap(id) {
  const m = TAP_RX.exec(String(id || ''));
  if (!m) return null;
  const [, step, kind, ref, gradeRaw, subject] = m;
  if (step === 'g') {
    if (gradeRaw === 'p') return { step, kind, ref, primary: true };
    const g = O.normGrade(gradeRaw);
    if (g === null || g <= O.PRIMARY_MAX_GRADE) return null;
    return { step, kind, ref, grade: g };
  }
  const g = O.normGrade(gradeRaw);
  if (g === null || g <= O.PRIMARY_MAX_GRADE || !O.normSubject(subject)) return null;
  return { step, kind, ref, grade: g, subject };
}

// ── the two questions ─────────────────────────────────────────────────────────

async function askClass(user, to, { kind, ref, teacherName = null }) {
  const s = S(user);
  const rows = [
    { id: `o612:g:${kind}:${ref}:p`, title: cap(s.grade_primary, 24), description: cap(s.grade_primary_desc, 72) },
    ...O.GRADES.filter((g) => g > O.PRIMARY_MAX_GRADE).map((g) => ({ id: `o612:g:${kind}:${ref}:${g}`, title: cap(s.grade_row(g), 24) })),
  ];
  const sent = await WhatsAppService.sendInteractiveMessage(to, {
    body: { text: s.class_body(teacherName) },
    action: { button: cap(s.class_button, 20), sections: [{ title: cap(s.class_section, 24), rows }] },
  });
  if (!sent) logToFile('❌ obs612: the class question did not send', { userId: user && user.id, kind, ref }, 'error');
  return sent;
}

async function askSubject(user, to, { kind, ref, grade }) {
  const s = S(user);
  const rows = O.SUBJECTS.map((sub) => ({
    id: `o612:s:${kind}:${ref}:${grade}:${sub.key}`,
    title: cap(s.subjects[sub.key] || sub.label, 24),
    ...(sub.key === 'science' ? { description: cap(s.science_desc, 72) } : {}),
  }));
  const sent = await WhatsAppService.sendInteractiveMessage(to, {
    body: { text: s.subject_body(grade) },
    action: { button: cap(s.subject_button, 20), sections: [{ title: cap(s.subject_section, 24), rows }] },
  });
  if (!sent) logToFile('❌ obs612: the subject question did not send', { userId: user && user.id, kind, ref, grade }, 'error');
  return sent;
}

// ── /observe: the class before the recording ──────────────────────────────────

/**
 * After Start in /observe's planner (the teacher is bound, the state is awaiting_audio): ask the class instead of
 * sending the capture prompt. The question carries a nonce kept in the observe state, so a tap from an older visit
 * finds nothing. @returns {Promise<boolean>} asked (false → the caller sends today's capture prompt).
 */
async function askForObserve(user, to, { teacherName = null } = {}) {
  try {
    const st = await ObserveState.getState(user.id);
    if (!st || st.state !== 'awaiting_audio') return false;
    const nonce = crypto.randomBytes(6).toString('hex');
    const { state, ...data } = st;
    await ObserveState.setState(user.id, state, { ...data, obs612Ask: nonce, obs612Teacher: teacherName || null });
    return await askClass(user, to, { kind: 'o', ref: nonce, teacherName });
  } catch (err) {
    logToFile('❌ obs612: asking the class in /observe failed — capture prompt instead', { userId: user && user.id, error: err.message }, 'error');
    return false;
  }
}

/** The capture prompt once the class is known: today's for grades 1-5, the FDE line for grades 6-12. */
async function sendObserveCapturePrompt(user, to, lesson, teacherName) {
  const lang = observeLang(user || {});
  const { buildVisitCapturePrompt, visitSendAsDocument } = require('../observe-strings');
  if (lesson.primary) {
    const { getObservePack } = require('../observe-framework');
    const framework = ((getObservePack().key) || 'fico').toUpperCase();
    return WhatsAppService.sendMessage(to, buildVisitCapturePrompt(lang, { teacherName, framework }));
  }
  const s = S(user);
  const subjectLabel = s.subjects[lesson.subject] || '';
  return WhatsAppService.sendMessage(to, `🎙️ ${s.lesson_line(lesson.grade, subjectLabel)}\n\n${s.fde_record_hint(lesson.tool)}\n\n${visitSendAsDocument(lang)}`);
}

async function finishObserve(user, from, ref, lesson) {
  const st = await ObserveState.getState(user.id);
  if (!st || st.state !== 'awaiting_audio' || st.obs612Ask !== ref) {
    await WhatsAppService.sendMessage(from, S(user).gone);
    return;
  }
  const { state, ...data } = st;
  await ObserveState.setState(user.id, state, { ...data, obs612Lesson: lesson });
  logToFile('🔭 obs612: /observe lesson named', { userId: user.id, primary: lesson.primary, rubricId: lesson.rubricId || null });
  await sendObserveCapturePrompt(user, from, lesson, st.obs612Teacher || null);
}

/**
 * At capture (observe-capture.startFromAudio): the lesson this recording's visit named, read from the observe
 * state, or null (the switch was off at Start, the class was never answered, or the state is gone: today's path).
 */
function lessonOfState(st) {
  const l = st && st.obs612Lesson;
  if (!l || typeof l !== 'object') return null;
  if (l.primary) return { primary: true, grade: null, subject: null };
  const again = lessonFrom(l.grade, l.subject);
  return again.primary ? null : again;
}

/**
 * At capture, for a grade 6-12 /observe lesson: the session is stamped with the rubric id (so the analysis, the
 * watchdog and every FICO reader leave it alone) and gets its FDE form row, linked. Then the FDE form is sent.
 * @returns {Promise<{ok: boolean, form?: object}>}
 */
async function startObserveVisit({ user, from, session, ownerUserId, boundTeacher, lesson }) {
  const { error: stampErr } = await supabase.from('coaching_sessions')
    .update({ framework: lesson.rubricId, framework_selection_reason: 'obs612_lesson' })
    .eq('id', session.id);
  if (stampErr) {
    logToFile('❌ obs612: the session was not stamped — this visit goes on as /observe', { sessionId: session.id, error: stampErr.message }, 'error');
    return { ok: false };
  }
  session.framework = lesson.rubricId;
  const created = await require('../observe2/field-form.store').createLessonForm({
    observerUserId: user.id,
    teacherUserId: ownerUserId && ownerUserId !== user.id ? ownerUserId : null,
    sessionId: session.id,
    rubricVersion: lesson.rubricId,
    visitContext: {
      grade: lesson.grade,
      subject: lesson.subject,
      sheet: lesson.sheet,
      via: 'observe',
      ...(boundTeacher && boundTeacher.teacher_ext_id != null ? { teacher_ext_id: String(boundTeacher.teacher_ext_id) } : {}),
      ...(boundTeacher && boundTeacher.school_ext_id ? { school_ext_id: String(boundTeacher.school_ext_id) } : {}),
      ...(boundTeacher && boundTeacher.teacher_name ? { teacher_name: boundTeacher.teacher_name } : {}),
    },
  });
  if (!created.ok || !created.form) {
    logToFile('❌ obs612: the FDE form row was not made for a stamped /observe visit', { sessionId: session.id }, 'error');
    await WhatsAppService.sendMessage(from, S(user).form_failed);
    return { ok: false };
  }
  logToFile('🔭 obs612: /observe visit stamped, FDE form made', { sessionId: session.id, formId: created.form.id, rubricId: lesson.rubricId });
  await sendForm(user, from, created.form);
  return { ok: true, form: created.form };
}

// ── /observe2: the class after the period ─────────────────────────────────────

/**
 * The FICO stamp for an /observe2 visit whose class the coach named grades 1-5. sandbox and staging have
 * observe2/rubric.visitRubric ({rubricVersion, shadow}); main still has the older rubricForNewVisit (the stamp alone,
 * no shadow visits). Both take lessonIsPrimary.
 */
async function ficoStampFor(who) {
  const R = require('../observe2/rubric');
  if (typeof R.visitRubric === 'function') return R.visitRubric(who);
  return { rubricVersion: await R.rubricForNewVisit(who), shadow: false };
}

/** Has this /observe2 form had its lesson named? */
function lessonNamed(form) {
  const vc = (form && form.visit_context) || {};
  return isObs612Form(form) || vc.grade_band === 'primary';
}

async function finishObserve2(user, from, formId, lesson) {
  const Store = require('../observe2/field-form.store');
  const got = await Store.getForm(formId);
  const form = got.ok ? got.form : null;
  if (!got.ok) { await WhatsAppService.sendMessage(from, S(user).try_again); return; }
  if (!form || form.observer_user_id !== user.id || form.sealed_at) {
    await WhatsAppService.sendMessage(from, S(user).gone);
    return;
  }
  const Start = require('../observe2/start');
  if (lesson.primary) {
    // Grades 1-5: FICO, as today; the coach naming the class decides the grades 1-5 gate (not the profile).
    const { rubricVersion, shadow } = await ficoStampFor({
      observerUserId: user.id, region: user.region, teacherUserId: form.teacher_user_id, lessonIsPrimary: true,
    });
    const set = await Store.setLesson(form, { rubricVersion, visitContextPatch: { grade_band: 'primary', shadow_v6: shadow || undefined } });
    if (!set.ok) { await WhatsAppService.sendMessage(from, S(user).try_again); return; }
    logToFile('🔭 obs612: /observe2 lesson is grades 1-5 — FICO form', { userId: user.id, formId, rubricVersion });
    await Start.sendLiveForm(user, from, form.id, form.period_minutes, { afterLesson: Boolean(form.coaching_session_id) });
    return;
  }
  const set = await Store.setLesson(form, {
    rubricVersion: lesson.rubricId,
    visitContextPatch: { grade: lesson.grade, subject: lesson.subject, sheet: lesson.sheet, via: 'observe2', shadow_v6: undefined },
  });
  if (!set.ok || !set.form) { await WhatsAppService.sendMessage(from, S(user).try_again); return; }
  logToFile('🔭 obs612: /observe2 visit stamped', { userId: user.id, formId, rubricId: lesson.rubricId });
  await sendForm(user, from, set.form, { live: !set.form.coaching_session_id });
}

// ── the taps ──────────────────────────────────────────────────────────────────

/**
 * A class or subject tap (list reply id 'o612:…'). @returns {Promise<boolean>} handled.
 */
async function handleTap(user, from, id) {
  if (!isLessonTap(id)) return false;
  const t = parseTap(id);
  if (!t || !user) {
    logToFile('⚠️ obs612: lesson tap not understood', { id, hasUser: Boolean(user) }, 'warn');
    if (user) await WhatsAppService.sendMessage(from, S(user).gone);
    return true;
  }
  try {
    if (t.step === 'g' && !t.primary) {
      await askSubject(user, from, { kind: t.kind, ref: t.ref, grade: t.grade });
      return true;
    }
    const lesson = t.primary ? { primary: true, grade: null, subject: null } : lessonFrom(t.grade, t.subject);
    if (t.kind === 'o') await finishObserve(user, from, t.ref, lesson);
    else await finishObserve2(user, from, t.ref, lesson);
  } catch (err) {
    logToFile('❌ obs612: lesson tap failed', { userId: user.id, id, error: err.message }, 'error');
    await WhatsAppService.sendMessage(from, S(user).try_again);
  }
  return true;
}

// ── the FDE form ──────────────────────────────────────────────────────────────

/**
 * Send the FDE form of a visit. `live`: the coach fills it during the lesson (/observe2 before a recording);
 * otherwise after it. Unset OBS612_FLOW_ID: the coach is told, never left waiting (logged at error).
 */
async function sendForm(user, to, form, { live = false } = {}) {
  const s = S(user);
  const vc = (form && form.visit_context) || {};
  const tool = O.toolOf(form && form.rubric_version);
  const flowId = process.env.OBS612_FLOW_ID;
  if (!flowId) {
    logToFile('❌ obs612: OBS612_FLOW_ID is unset — the FDE form cannot be sent', { formId: form && form.id }, 'error');
    await WhatsAppService.sendMessage(to, s.form_not_ready);
    return false;
  }
  const subjectLabel = s.subjects[vc.subject] || '';
  const body = (live ? s.form_body_live : s.form_body)(vc.grade, subjectLabel, tool);
  const sent = await WhatsAppService.sendFlow(to, {
    flowId,
    body: cap(body, 1024),
    buttonText: cap(s.form_cta, 20),
    flowToken: formToken(user.id, form.id),
  });
  if (!sent) {
    logToFile('❌ obs612: the FDE form did not send', { userId: user.id, formId: form.id }, 'error');
    await WhatsAppService.sendMessage(to, s.form_failed);
  }
  return sent;
}

// ── after the recording is transcribed ────────────────────────────────────────

/**
 * Called first in the observe pipeline after transcription (transcription-processor.observePostTranscription).
 * An FDE visit is scored by the coach, so no model reads it: the transcript is kept, and the session is moved out
 * of the processing statuses the watchdog retries ('transcription_complete' would be re-queued for FICO analysis).
 * A form already submitted puts the session back to 'observer_review_complete' (the transcription's own status
 * writes may have overwritten it). Never throws. @returns {Promise<{handled: boolean, action?: string}>}
 */
async function afterTranscription(sessionId, session) {
  try {
    const stamped = session && O.isObs612Id(session.framework);
    const got = await require('../observe2/field-form.store').findBySession(sessionId);
    const form = got.ok ? got.form : null;
    if (!stamped && !isObs612Form(form)) return { handled: false };
    const status = form && form.sealed_at ? 'observer_review_complete' : 'obs612_form';
    const { updateIfNotTerminal } = require('../../coaching/session-terminal');
    await updateIfNotTerminal(sessionId, { status, updated_at: new Date().toISOString() });
    logToFile('🔭 obs612: recording transcribed and kept; no model scoring for an FDE visit', {
      sessionId, formId: form && form.id, status, submitted: Boolean(form && form.sealed_at),
    });
    if (!form) logToFile('❌ obs612: a stamped session has no FDE form row', { sessionId }, 'error');
    return { handled: true, action: status };
  } catch (err) {
    logToFile('❌ obs612: after-transcription step failed', { sessionId, error: err.message }, 'error');
    return { handled: Boolean(session && O.isObs612Id(session.framework)), action: 'error' };
  }
}

module.exports = {
  FLOW_ID_ENV,
  TOKEN_MARKER,
  formToken,
  isLessonTap,
  isObs612Form,
  asksClass,
  lessonFrom,
  parseTap,
  askClass,
  askSubject,
  askForObserve,
  lessonOfState,
  startObserveVisit,
  lessonNamed,
  handleTap,
  sendForm,
  afterTranscription,
};
