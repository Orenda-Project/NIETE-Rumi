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
 * Runs only while app_settings.obs612_coach is on for the coach (coaching/obs612-switch.js), and never for a GB
 * visit (bd-hk2jm3: FDE is ICT's; coaching/fde-region.js). Off: asksClass is false, every caller takes its old path,
 * and nothing here runs.
 *
 * The FDE form of a visit is ONE observation_field_forms row: rubric_version = the obs612 id ('obs612-msci-v1' …),
 * visit_context.{grade, subject, sheet, via}. The Flow token is `<coachUserId>:obs612:<formId>`.
 *
 * bd-31ziu8 — FICO-S v1.1 (operator 18 Nov: ICT grades 6-12 on FICO-S, grades 1-5 on FICO17 v6). With fico_s_coach on
 * for the observer (coaching/fico-s-switch.js) on an ICT visit, the class is asked as above and every grade 6-12 lesson
 * (any subject) is stamped 'fico_s_v1_1' instead of an FDE tool or FICO: the same form row, the same token, its own
 * Flow (FICO_S_FLOW_ID, obs612/fico-s-flow.js). It wins over obs612_coach; grades 1-5 are untouched.
 */

const crypto = require('crypto');
const supabase = require('../../../config/supabase');
const WhatsAppService = require('../../whatsapp.service');
const ObserveState = require('../observe-state.service');
const FicoS = require('../../coaching/frameworks/fico-s');
const O = require('../../coaching/frameworks/obs612');
const { obs612Strings } = require('./strings');
const { observeLang } = require('../observe-strings');
const { logToFile } = require('../../../utils/logger');

const FLOW_ID_ENV = 'OBS612_FLOW_ID';
const FICO_S_FLOW_ID_ENV = 'FICO_S_FLOW_ID';
const TOKEN_MARKER = 'obs612';
// bd-31ziu8: a FICO-S form's token ends ':fs', so the shared endpoint knows the FICO-S Flow is asking (even for a form
// it refuses), while ':obs612:' still marks the completion for flow-type-detector.
const formToken = (coachUserId, formId, tool = null) => `${coachUserId}:${TOKEN_MARKER}:${formId}${tool === 'ficos' ? ':fs' : ''}`;

// List reply ids. kind 'o' = /observe (ref: a nonce kept in the observe state), 'f' = /observe2 (ref: the form id).
//   o612:g:<kind>:<ref>:<p|6..12>             the class ('p' = grades 1-5)
//   o612:s:<kind>:<ref>:<6..12>:<subject>     the subject
const TAP_RX = /^o612:(g|s):([of]):([A-Za-z0-9-]{1,64}):(p|[0-9]{1,2})(?::([a-z_]{1,20}))?$/;
const isLessonTap = (id) => String(id || '').startsWith('o612:');

const S = (user, opts) => obs612Strings(observeLang(user || {}), opts);
const ficoSSwitch = () => require('../../coaching/fico-s-switch');
const cp = (s) => [...String(s || '')];
const cap = (s, n) => cp(s).slice(0, n).join('');

/** Is this an FDE form (an observation_field_forms row stamped with an obs612 id)? */
function isObs612Form(form) {
  return Boolean(form) && O.isObs612Id(form.rubric_version);
}

/**
 * Does this coach get the class question? The switch, and never for a GB visit (bd-hk2jm3, operator 17 Nov: FDE's
 * grade 6-8 tools are ICT's only; GB stays on FICO, v6 for HITL). `visit` names what is known of the visit: the
 * observed teacher's users.id and the school the coach picked (school_ext_id); without them her own school decides,
 * never her profile region (coaching/fde-region.js visitPlace). Never throws: false on any failure.
 * @param {object} user  the coach's (or principal's) users row
 * @param {{teacherUserId?: string|null, schoolExtId?: string|null}} [visit]
 */
async function asksClass(user, visit = {}) {
  if (!user || !user.id) return false;
  try {
    // bd-dsu5mq.2 (operator 26 Nov ~21:40): the VISIT'S SCHOOL decides ICT vs GB, never the observer's profile
    // users.region. The switches are looked up for who she is at where the visit is (coaching/fde-region.js).
    const FR = require('../../coaching/fde-region');
    const place = await FR.visitPlace({ observer: user, ...(visit || {}) });
    if (place.side === 'gb' || place.side === 'error') return false;
    const who = FR.switchWho(user, place); // bd-9bppaz: user.role passes through, so "role:principal" needs no read
    // bd-31ziu8: FICO-S's switch asks the class too (its grades 6-12 lessons are named the same way).
    return (await require('../../coaching/obs612-switch').isOn(who)) || (await ficoSSwitch().isOn(who));
  } catch (_) {
    return false;
  }
}

/**
 * The lesson the coach named: { primary: true } for a FICO lesson, or
 * { primary: false, grade, subject, rubricId, tool, sheet } for a grade 6-12 form lesson.
 * `ficoS` (bd-31ziu8): FICO-S is on for this visit, so every grade 6-12 lesson is a FICO-S lesson.
 */
function lessonFrom(grade, subject, { ficoS = false } = {}) {
  const g = O.normGrade(grade);
  if (g === null || g <= O.PRIMARY_MAX_GRADE) return { primary: true, grade: null, subject: null };
  const t = O.toolFor(g, subject, { ficoS });
  // bd-ra8xu.40 (operator, 12 Nov ~11:00): without FICO-S, grades 9-12 stay on FICO, as grades 1-5 (`primary` means a
  // FICO-grade lesson; its grade is kept so /observe2 can record the band).
  if (!t) return { primary: true, grade: g, subject: null };
  return { primary: false, grade: g, subject: O.normSubject(subject), rubricId: t.rubricId, tool: t.tool, sheet: t.sheet };
}

function parseTap(id) {
  const m = TAP_RX.exec(String(id || ''));
  if (!m) return null;
  const [, step, kind, ref, gradeRaw, subject] = m;
  if (step === 'g') {
    if (gradeRaw === 'p') return { step, kind, ref, primary: true };
    const g = O.normGrade(gradeRaw);
    if (g === null) return null;
    // bd-ra8xu.50: the "Plan my visit" Flow names the primary grade itself (1-5); a FICO lesson, its grade kept.
    if (g <= O.PRIMARY_MAX_GRADE) return { step, kind, ref, primary: true, grade: g };
    // bd-ra8xu.40: grades 9-12 are FICO lessons: no subject is asked.
    if (!O.isFdeGrade(g)) return { step, kind, ref, primary: true, grade: g };
    return { step, kind, ref, grade: g };
  }
  const g = O.normGrade(gradeRaw);
  if (g === null || g <= O.PRIMARY_MAX_GRADE || !O.normSubject(subject)) return null;
  return { step, kind, ref, grade: g, subject };
}

// ── the two questions ─────────────────────────────────────────────────────────

async function askClass(user, to, { kind, ref, teacherName = null, ficoS = false }) {
  const s = S(user, { ficoS });
  // bd-ra8xu.50 (operator 13 Nov): class → grade → subject on three Flow screens ("Plan my visit", lesson-flow.js)
  // once that Flow is published here; until then (or if it will not send), the two chat lists below.
  const flowId = process.env.OBS612_LESSON_FLOW_ID;
  if (flowId && user && user.id) {
    const sent = await WhatsAppService.sendFlow(to, {
      flowId,
      body: cap(s.lf_body(teacherName), 1024),
      buttonText: cap(s.lf_cta, 20),
      flowToken: require('./lesson-flow').lessonToken(user.id, kind, ref),
    });
    if (sent) return sent;
    logToFile('❌ obs612: the class Flow did not send — chat lists instead', { kind, ref }, 'error');
  }
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
async function askForObserve(user, to, { teacherName = null, visit = null } = {}) {
  try {
    const st = await ObserveState.getState(user.id);
    if (!st || st.state !== 'awaiting_audio') return false;
    const nonce = crypto.randomBytes(6).toString('hex');
    const { state, ...data } = st;
    // bd-31ziu8: the visit (teacher, school) is kept so the tap decides FICO-S on the visit's region, not the coach's.
    const v = visit && typeof visit === 'object'
      ? { teacherUserId: visit.teacherUserId || null, schoolExtId: visit.schoolExtId || null } : null;
    await ObserveState.setState(user.id, state, { ...data, obs612Ask: nonce, obs612Teacher: teacherName || null, obs612Visit: v });
    const ficoS = await ficoSSwitch().forVisit(user, v || {});
    return await askClass(user, to, { kind: 'o', ref: nonce, teacherName, ficoS });
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
  const s = S(user, { ficoS: lesson.tool === 'ficos' });
  const subjectLabel = s.subjects[lesson.subject] || '';
  const line = subjectLabel ? s.lesson_line(lesson.grade, subjectLabel) : s.grade_row(lesson.grade);
  return WhatsAppService.sendMessage(to, `🎙️ ${line}\n\n${s.fde_record_hint(lesson.tool)}\n\n${visitSendAsDocument(lang)}`);
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
  if (l.primary) return { primary: true, grade: O.normGrade(l.grade), subject: null };
  // bd-31ziu8: a FICO-S lesson stays one (observe-capture still checks the visit is ICT's before stamping it).
  if (l.tool === 'ficos' || O.isFicoS(l.rubricId)) return lessonFrom(l.grade, l.subject, { ficoS: true });
  // Re-read under today's rule (bd-ra8xu.40: a grade 9-12 lesson named before 12 Nov is a FICO lesson now).
  return lessonFrom(l.grade, l.subject);
}

/**
 * At capture, for a grade 6-12 /observe lesson: the session is stamped with the rubric id (so the analysis, the
 * watchdog and every FICO reader leave it alone) and gets its FDE form row, linked. Then the FDE form is sent.
 * @returns {Promise<{ok: boolean, form?: object}>}
 */
async function startObserveVisit({ user, from, session, ownerUserId, boundTeacher, lesson }) {
  // Queue #184: a FICO 6-12 visit whose observer has fico_s_dc on goes to the Digital Coach (obs612/fico-s-dc.js):
  // stamped so, its form made now and sent pre-filled once Rumi has listened to the recording.
  let dc = false;
  if (lesson.tool === 'ficos') {
    try {
      dc = await ficoSSwitch().dcForVisit(user, {
        teacherUserId: ownerUserId && ownerUserId !== user.id ? ownerUserId : null,
        ...(boundTeacher && boundTeacher.school_ext_id ? { schoolExtId: String(boundTeacher.school_ext_id) } : {}),
      });
    } catch (_) { dc = false; }
  }
  const reason = dc ? require('./fico-s-dc').REASON : lesson.tool === 'ficos' ? 'fico_s_lesson' : 'obs612_lesson';
  const { error: stampErr } = await supabase.from('coaching_sessions')
    .update({ framework: lesson.rubricId, framework_selection_reason: reason })
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
    logToFile('❌ obs612: the form row was not made for a stamped /observe visit', { sessionId: session.id, rubricId: lesson.rubricId }, 'error');
    await WhatsAppService.sendMessage(from, S(user, { ficoS: lesson.tool === 'ficos' }).form_failed);
    return { ok: false };
  }
  session.framework_selection_reason = reason;
  logToFile('🔭 obs612: /observe visit stamped, FDE form made', { sessionId: session.id, formId: created.form.id, rubricId: lesson.rubricId, dc });
  // The Digital Coach's visit: the form waits for Rumi's pre-fill; the capture's own ack goes out meanwhile.
  if (dc) return { ok: true, form: created.form, dc: true };
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
  return isObs612Form(form) || vc.grade_band === 'primary' || vc.grade_band === 'high';
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
    // bd-ra8xu.40: a grade 9-12 lesson is FICO too; its band and grade are kept ('primary' alone for grades 1-5).
    const band = lesson.grade && lesson.grade > O.PRIMARY_MAX_GRADE ? { grade_band: 'high', grade: lesson.grade } : { grade_band: 'primary' };
    const set = await Store.setLesson(form, { rubricVersion, visitContextPatch: { ...band, shadow_v6: shadow || undefined } });
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
/**
 * bd-31ziu8 — does this tap's visit get FICO-S? The observer's fico_s_coach switch and the visit's region (ICT only):
 * /observe reads the visit kept in the observe state at the question, /observe2 the form's teacher and school. Never
 * throws: false on any failure.
 */
async function ficoSForTap(user, t) {
  try {
    let visit = {};
    if (t.kind === 'o') {
      const st = await ObserveState.getState(user.id);
      visit = (st && st.obs612Visit) || {};
    } else {
      const got = await require('../observe2/field-form.store').getForm(t.ref);
      const form = got && got.ok ? got.form : null;
      const vc = (form && form.visit_context) || {};
      visit = { teacherUserId: (form && form.teacher_user_id) || null, schoolExtId: vc.school_ext_id || null };
    }
    return await ficoSSwitch().forVisit(user, visit);
  } catch (_) {
    return false;
  }
}

async function handleTap(user, from, id) {
  if (!isLessonTap(id)) return false;
  const t = parseTap(id);
  if (!t || !user) {
    logToFile('⚠️ obs612: lesson tap not understood', { id, hasUser: Boolean(user) }, 'warn');
    if (user) await WhatsAppService.sendMessage(from, S(user).gone);
    return true;
  }
  try {
    // bd-31ziu8: with FICO-S on, a grade 6-12 class is a FICO-S lesson; its subject is asked for the record.
    const named = t.grade && t.grade > O.PRIMARY_MAX_GRADE;
    const ficoS = named ? await ficoSForTap(user, t) : false;
    if (t.step === 'g' && (!t.primary || (ficoS && O.isFicoSGrade(t.grade)))) {
      await askSubject(user, from, { kind: t.kind, ref: t.ref, grade: t.grade });
      return true;
    }
    const lesson = t.step === 'g' && t.primary
      ? { primary: true, grade: t.grade || null, subject: null }
      : lessonFrom(t.grade, t.subject, { ficoS });
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
async function sendForm(user, to, form, { live = false, prefilled = false } = {}) {
  const vc = (form && form.visit_context) || {};
  const tool = O.toolOf(form && form.rubric_version);
  // bd-31ziu8: a FICO-S form is its own Flow (obs612/fico-s-flow.js), on the same endpoint and token.
  const ficoS = tool === 'ficos';
  const s = S(user, { ficoS });
  const envName = ficoS ? FICO_S_FLOW_ID_ENV : FLOW_ID_ENV;
  // Read by name (flow-config-conformance greps for each *_FLOW_ID the bot reads).
  const flowId = ficoS ? process.env.FICO_S_FLOW_ID : process.env.OBS612_FLOW_ID;
  if (!flowId) {
    logToFile(`❌ obs612: ${envName} is unset — the form cannot be sent`, { formId: form && form.id, tool }, 'error');
    await WhatsAppService.sendMessage(to, s.form_not_ready);
    return false;
  }
  const subjectLabel = s.subjects[vc.subject] || '';
  // Queue #184: a FICO 6-12 form the Digital Coach pre-filled says so, and names the starred indicator(s).
  // Seven indicators are starred (19 Nov): their codes, not their names, keep the body short.
  const starred = () => FicoS.STARRED_CODES.slice(); // each language's line isolates the codes itself
  const body = prefilled && ficoS && s.form_body_dc ? s.form_body_dc(vc.grade, subjectLabel, starred())
    : (live ? s.form_body_live : s.form_body)(vc.grade, subjectLabel, tool);
  const sent = await WhatsAppService.sendFlow(to, {
    flowId,
    body: cap(body, 1024),
    buttonText: cap(s.form_cta, 20),
    flowToken: formToken(user.id, form.id, tool),
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
    // Queue #184: a FICO 6-12 visit for the Digital Coach goes on as a FICO17 v6 HITL visit does (photo and plan steps,
    // then the analysis); its form is pre-filled when the analysis lands (obs612/fico-s-dc.js onAnalysisReady).
    if (require('./fico-s-dc').isDcVisit(session)) {
      logToFile('🔭 obs612: FICO 6-12 visit for the Digital Coach — on to the analysis, as v6', { sessionId });
      return { handled: false, dc: true };
    }
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
  FICO_S_FLOW_ID_ENV,
  ficoSForTap,
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
