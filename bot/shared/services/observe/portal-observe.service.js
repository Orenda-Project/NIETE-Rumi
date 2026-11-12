'use strict';
/**
 * bd-5rz1v.6 — a coach's /observe observation, run from the PORTAL.
 *
 * The operator: "The coaches … can /observe the teacher as well … The flow should
 * be complete from the portal. The coach should get the draft report, edit it the
 * same way they can edit stuff on whatsapp bot, and then send that report to the
 * teacher." So every coach step of /observe is reachable here, each through the
 * function WhatsApp already uses — nothing is re-implemented:
 *
 *   start         the row observe-capture.startFromAudio writes: the teacher bound
 *                 through LeaderSource.resolveTeacher + resolveBoundTeacherUserId,
 *                 the coach as observer_user_id, transcription queued, the matching
 *                 schedule retired. Her plan and the board photos come with it, in
 *                 the shape the WhatsApp gates write them.
 *   draft         ObserveDraft.buildScreenPrefill (what the MEWAKA Flow pre-fills)
 *                 and ObserveDraft.applyObserverEdits (what its submit applies).
 *   talk          ObserveDebrief.buildDebriefGuide (the guide startDebrief builds),
 *                 and a portal recording attached with freshRecordingPatch (the
 *                 voice note's reset) for processDebriefRecording to coach.
 *   report        processTeacherReport's preview and deliver phases, queued with
 *                 channel 'portal' — the teacher still gets her report on WhatsApp.
 *
 * What is NOT done, by design: no capture ack, no "who did you observe?", no
 * /observe2 link, no photo/plan gates, no MEWAKA Flow, no Redis chat state — none
 * of it is sent to WhatsApp, and the worker steps say nothing to the coach there
 * either (they read isPortalSession / the talk's and the send's channel).
 *
 * IDENTITY. `userId` is the coach the portal read from ITS session. Only an
 * observation she observed is reachable; anything else answers not_found, the
 * same as one that does not exist. bd-15y1pc / bd-gie5ep: that is hers from
 * either side — one she captured on WhatsApp she reads AND carries on here.
 * When the portal takes a step of one, a WhatsApp chat still waiting on THAT
 * step of THAT observation is released (releaseWhatsAppStep), so an old button
 * or a stray voice note cannot take it a second time.
 */

const crypto = require('crypto');
const PortalCoaching = require('../coaching/portal-coaching.service');
const { stepOfRow } = require('./portal-observe-step');

const { isOwnPortalKey, isPortalSession, libraryPick, checkUploaded, extOf, KINDS, MAX_PHOTOS } = PortalCoaching;

// observe-gate's LEADER_ROLES — who may run /observe.
const LEADER_ROLES = ['school_leader', 'supervisor', 'coach', 'principal', 'aeo'];

// The draft can be edited until the report is out — after that the teacher has read it.
const EDITABLE_STATUSES = ['awaiting_observer_review', 'observer_review_complete'];
// bd-15y1pc — her answers exist from the draft on, and stay readable once the observation is done.
const READABLE_STATUSES = [...EDITABLE_STATUSES, 'completed'];
const REPORT_OUT = ['sent', 'awaiting_teacher_tap', 'operator_review'];

// The keys the MEWAKA Flow submits (observe-mewaka-endpoint bufferEdits), and a
// generous cap on any one answer (the Flow's TextArea allows 600).
const EDIT_KEY_RX = /^(r|ev|imp|fid)_[A-Za-z0-9_]+$/;
// bd-ra8xu.40 — and on a FICO17 v6 visit, the v6 review Flow's own keys too: why_<code> (a room level's reason),
// chg_<C|D|F> (why one of Rumi's levels was changed), d2_children / d2_quiet_later (D2's counts). A V3 save never
// carries them (byte-identical to before).
const V6_EDIT_KEY_RX = /^(r|ev|imp|fid|why|chg|d2)_[A-Za-z0-9_]+$/;
const EDIT_VALUE_CAP = 2000;

// The coach's list: what she started in the portal in the last fortnight.
const LIST_WINDOW_DAYS = 14;
const LIST_LIMIT = 30;

function withDefaults(deps = {}) {
  const lazy = {
    supabase: () => require('../../config/supabase'),
    r2: () => require('../../storage/r2'),
    queue: () => require('../coaching/coaching-job-queue.service'),
    leaderSource: () => require('./assignment/leader-source'),
    resolveOwner: () => require('./observe-capture.service').resolveBoundTeacherUserId,
    schedule: () => require('./observe-schedule.service'),
    library: () => require('../coaching/portal-lesson-plan-library.service'),
    draft: () => require('./observe-draft.service'),
    pack: () => require('./observe-framework').getObservePack,
    languageFor: () => require('./observe-language').languageFor,
    debrief: () => require('./observe-debrief.service'),
    send: () => require('./observe-send.service'),
    roster: () => require('./observe-roster'),
    people: () => require('./observe-people'),
    state: () => require('./observe-state.service'),
    // bd-ra8xu.40 — the rubric a visit is stamped with at start, decided exactly as observe-capture decides it.
    rubric: () => ({
      decideV6: require('./observe-fico17-v6').decideVisitFramework,
      fdeOn: require('./obs612/visit').asksClass,
      createLessonForm: require('./observe2/field-form.store').createLessonForm,
    }),
    log: () => require('../../utils/logger').logToFile,
    now: () => () => new Date(),
    newId: () => () => crypto.randomUUID(),
  };
  const d = {};
  for (const [name, load] of Object.entries(lazy)) {
    Object.defineProperty(d, name, {
      enumerable: true,
      get: () => (deps[name] !== undefined ? deps[name] : load()),
    });
  }
  return d;
}

const notFound = () => ({ status: 'not_found' });
const notReady = (reason) => ({ status: 'not_ready', reason });

async function loadCoach(d, userId) {
  const { data } = await d.supabase
    .from('users')
    .select('id, phone_number, role, name, preferred_language, region')
    .eq('id', userId)
    .maybeSingle();
  return data || null;
}

/**
 * bd-15y1pc — her observation, from either side: she observed it, whether she
 * captured it on WhatsApp or in the portal. What the page READS comes through
 * here; null for every other case alike.
 */
async function loadMine(d, userId, coachingSessionId) {
  if (!userId || !coachingSessionId) return null;
  const { data: row } = await d.supabase
    .from('coaching_sessions')
    .select('*')
    .eq('id', coachingSessionId)
    .maybeSingle();
  if (!row || row.observation_type !== 'leader_observation') return null;
  if (row.observer_user_id !== userId) return null;
  return row;
}

// bd-gie5ep — the WhatsApp chat states each portal step stands in for.
const WHATSAPP_STEP = {
  draft: ['awaiting_form'],
  talk: ['awaiting_debrief_audio'],
  report: ['awaiting_teacher_pick', 'awaiting_teacher_details', 'awaiting_send_confirm'],
};

/**
 * The portal just took `step` of this observation: a WhatsApp chat still waiting
 * on that step of it is released. Only that step, only this observation — a
 * debrief armed on WhatsApp outlives a form edited here, and another
 * observation's state is never touched. Best-effort: the step already happened.
 */
async function releaseWhatsAppStep(d, userId, coachingSessionId, step) {
  try {
    const st = await d.state.getState(userId);
    if (!st || st.sessionId !== coachingSessionId || !WHATSAPP_STEP[step].includes(st.state)) return;
    await d.state.clearState(userId);
    d.log('🖥️ portal observe: the portal took this step — WhatsApp chat released', { coachingSessionId, step, state: st.state });
  } catch (err) {
    d.log('⚠️ portal observe: WhatsApp chat state not released (non-blocking)', { coachingSessionId, step, error: err && err.message }, 'warn');
  }
}

const debriefOf = (row) => ((row && row.analysis_data) || {}).observer_debrief || {};
const deliveryOf = (row) => ((row && row.analysis_data) || {}).teacher_delivery || {};
// bd-fmf24g.66 — what became of the plan attached to this observation, as the observation page shows it.
// HER OWN FILE is the one under lesson_plans/<id>/: her portal upload (portal_<id>.<ext>), or the copy the
// extraction worker re-saves under the detected type (<sessionId>_lesson_plan.<ext>). Any other plan on the
// row is the library's (a linked asset, or a written 6-12 lesson's PDF). The state comes from the
// extraction status: nothing read yet / read / not a lesson plan or unreadable. Real fields only.
const OWN_PLAN_KEY_RX = /^lesson_plans\/[^/]+\/[^/]+$/;
function planOf(row) {
  const key = String((row && row.lesson_plan_r2_key) || '');
  const format = (row && row.lesson_plan_format) || null;
  if (OWN_PLAN_KEY_RX.test(key)) {
    const status = row.lesson_plan_extraction_status || null;
    let state = 'reading';
    if (status === 'completed') state = 'read';
    else if (['not_lesson_plan', 'failed', 'failed_bad_format'].includes(status)) state = 'unreadable';
    const topic = state === 'read' && row.lesson_plan_structured && row.lesson_plan_structured.topic;
    return { source: 'own', format, state, topic: topic || null };
  }
  if (row && (row.has_lesson_plan || key)) return { source: 'library', format, state: null, topic: null };
  return { source: 'none', format: null, state: null, topic: null };
}
const nonce = (seed) => crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 16);

async function resolveTeacherSafely(d, userId, teacherExtId, schoolExtId) {
  try {
    return await d.leaderSource.resolveTeacher(userId, teacherExtId, schoolExtId);
  } catch (err) {
    d.log('❌ portal observe: resolveTeacher failed', { userId, teacherExtId, error: err && err.message }, 'error');
    return null;
  }
}

// ── the rubric a visit is stamped with (bd-ra8xu.40) ─────────────────────────

/**
 * The lesson the coach named on the portal, as obs612/visit.js lessonFrom reads a WhatsApp tap: { primary: true } for
 * grades 1-5, or the grade 6-12 lesson with its FDE tool. undefined when none was sent; null when what was sent is not
 * a class (refused).
 */
function lessonOfArg(lesson) {
  if (lesson === undefined || lesson === null) return undefined;
  if (typeof lesson !== 'object') return null;
  if (lesson.primary === true) return { primary: true, grade: null, subject: null };
  const O = require('../coaching/frameworks/obs612');
  const g = O.normGrade(lesson.grade);
  if (g === null || g <= O.PRIMARY_MAX_GRADE) return null;
  // bd-ra8xu.40 (operator, 12 Nov ~11:00): grades 9-12 stay on FICO, like grades 1-5: no subject, no FDE tool.
  if (!O.isFdeGrade(g)) return { primary: true, grade: g, subject: null };
  if (!O.normSubject(lesson.subject)) return null;
  // obs612/visit.js lessonFrom, from the pure rubric module (visit.js loads the database client at require time).
  const t = O.toolFor(g, lesson.subject);
  if (!t) return null;
  return { primary: false, grade: g, subject: O.normSubject(lesson.subject), rubricId: t.rubricId, tool: t.tool, sheet: t.sheet };
}

/**
 * observe-capture.startFromAudio's decision, for a portal start: grades 6-12 named with the obs612 switch on → FDE's
 * tool; otherwise FICO17 v6 when the coach switch says so (the named grades 1-5 answer, else the teacher's profile,
 * decides the grades 1-5 gate); otherwise nothing (today's rubric). Never throws: any failure is today's path.
 * @returns {Promise<{v6Stamp: string|null, fdeLesson: object|null}>}
 */
async function decideStamp(d, coach, teacherUserId, lesson) {
  let fdeOn = false;
  try { fdeOn = !!(await d.rubric.fdeOn(coach)); } catch (_) { fdeOn = false; }
  const named = fdeOn && lesson ? lesson : null;
  if (named && !named.primary) return { v6Stamp: null, fdeLesson: named };
  let v6Stamp = null;
  try {
    v6Stamp = (await d.rubric.decideV6({
      userId: coach.id,
      region: coach.region,
      teacherUserId,
      ...(named && named.primary ? { lessonIsPrimary: true } : {}),
    })) || null;
  } catch (_) { v6Stamp = null; }
  return { v6Stamp, fdeLesson: null };
}

/**
 * A grade 6-12 portal visit: its FDE form row (the coach fills it on the portal), then the session's stamp, before
 * transcription is queued so the step after it finds the stamp (obs612/visit.afterTranscription). No WhatsApp form is
 * sent. A form that cannot be made leaves the session unstamped: the visit goes on as today's /observe.
 */
async function startFdeVisit(d, { userId, session, ownerUserId, teacher, schoolExtId, lesson }) {
  const made = await d.rubric.createLessonForm({
    observerUserId: userId,
    teacherUserId: ownerUserId,
    sessionId: session.id,
    rubricVersion: lesson.rubricId,
    visitContext: {
      grade: lesson.grade,
      subject: lesson.subject,
      sheet: lesson.sheet,
      via: 'observe',
      channel: 'portal',
      ...(teacher && teacher.teacher_ext_id != null ? { teacher_ext_id: String(teacher.teacher_ext_id) } : {}),
      ...(schoolExtId ? { school_ext_id: String(schoolExtId) } : {}),
      ...(teacher && teacher.teacher_name ? { teacher_name: teacher.teacher_name } : {}),
    },
  });
  if (!made || !made.ok || !made.form) {
    d.log('❌ portal observe: the FDE form row was not made — the visit goes on as /observe', { coachingSessionId: session.id }, 'error');
    return false;
  }
  const { error } = await d.supabase.from('coaching_sessions')
    .update({ framework: lesson.rubricId, framework_selection_reason: 'obs612_lesson' })
    .eq('id', session.id);
  if (error) {
    d.log('❌ portal observe: the FDE stamp was not written', { coachingSessionId: session.id, formId: made.form.id, error: error.message }, 'error');
    return false;
  }
  d.log('🔭 portal observe: FDE visit stamped, form made', { coachingSessionId: session.id, formId: made.form.id, rubricId: lesson.rubricId });
  return true;
}

/**
 * Whether Check and send asks the lesson's class (and, for grades 6-12, its subject): the obs612 switch for this coach,
 * as WhatsApp's visit planner asks it after Start. The words are the portal's; this gives the keys.
 */
async function lessonQuestion({ userId }, deps) {
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  const d = withDefaults(deps);
  const coach = await loadCoach(d, userId);
  if (!coach || !LEADER_ROLES.includes(coach.role)) return { status: 'ok', ask: false };
  let ask = false;
  try { ask = !!(await d.rubric.fdeOn(coach)); } catch (_) { ask = false; }
  if (!ask) return { status: 'ok', ask: false };
  const O = require('../coaching/frameworks/obs612');
  return {
    status: 'ok',
    ask: true,
    grades: O.GRADES.filter((g) => g > O.PRIMARY_MAX_GRADE),
    // bd-ra8xu.40: only FDE's grades (6-8) ask the subject; grades 9-12 are FICO lessons.
    subjectGrades: O.FDE_GRADES.slice(),
    subjects: O.SUBJECTS.map((x) => x.key),
  };
}

// ── start ───────────────────────────────────────────────────────────────────

/**
 * @param {{userId, teacherExtId, schoolExtId?, key, lessonPlanKey?, lessonPlan?, photoKeys?}} args
 *   teacherExtId — the teacher's ext id in her patch (the phone, as on the visit Flow).
 * @returns {{status:'ok', coachingSessionId} | {status:'invalid', reason} | {status:'queue_failed', coachingSessionId}}
 */
async function startPortalObservation({
  userId, teacherExtId, schoolExtId = null, key, lessonPlanKey = null, lessonPlan: picked = null, photoKeys = [],
  lesson: lessonArg = undefined,
}, deps) {
  const photos = Array.isArray(photoKeys) ? photoKeys.filter(Boolean) : [];
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  if (!teacherExtId || typeof teacherExtId !== 'string') return { status: 'invalid', reason: 'no_teacher' };
  // bd-ra8xu.40: the class the coach named on Check and send (asked only while the obs612 switch is on for her).
  const lesson = lessonOfArg(lessonArg);
  if (lesson === null) return { status: 'invalid', reason: 'bad_lesson' };

  // Every key must be this coach's own upload, of the right kind.
  if (!isOwnPortalKey(userId, key, 'audio')) return { status: 'invalid', reason: 'not_your_upload' };
  if (lessonPlanKey && !isOwnPortalKey(userId, lessonPlanKey, 'lesson_plan')) return { status: 'invalid', reason: 'not_your_upload' };
  if (photos.length > MAX_PHOTOS) return { status: 'invalid', reason: 'too_many_photos' };
  if (photos.some((k) => !isOwnPortalKey(userId, k, 'photo'))) return { status: 'invalid', reason: 'not_your_upload' };
  const { pick, bad } = libraryPick(picked);
  if (bad) return { status: 'invalid', reason: 'bad_lesson_plan' };
  if (pick && lessonPlanKey) return { status: 'invalid', reason: 'two_lesson_plans' };

  const d = withDefaults(deps);
  const coach = await loadCoach(d, userId);
  if (!coach || !LEADER_ROLES.includes(coach.role)) return { status: 'invalid', reason: 'not_a_leader' };

  const missing = await checkUploaded(d, [
    { key, kind: 'audio' },
    ...(lessonPlanKey ? [{ key: lessonPlanKey, kind: 'lesson_plan' }] : []),
    ...photos.map((k) => ({ key: k, kind: 'photo' })),
  ]);
  if (missing) return missing;

  // A retried Send (the network dropped after the bot answered) must not start
  // a second observation of the same recording.
  const audioUrl = d.r2.buildR2PublicUrl(key);
  const { data: already } = await d.supabase
    .from('coaching_sessions')
    .select('id')
    .eq('observer_user_id', userId)
    .eq('audio_url', audioUrl)
    .limit(1)
    .maybeSingle();
  if (already && already.id) return { status: 'ok', coachingSessionId: already.id };

  // The visit Flow's bind (observe-visit-flow bindAndStart): the teacher must be
  // in HER patch, and her school rides along to retire the schedule.
  const teacher = await resolveTeacherSafely(d, userId, teacherExtId, schoolExtId);
  if (!teacher) return { status: 'invalid', reason: 'not_your_teacher' };
  const boundTeacher = { ...teacher, school_ext_id: String(schoolExtId || '') };
  const ownerUserId = await d.resolveOwner(boundTeacher);
  // WhatsApp falls back to the coach as owner; a portal observation is always
  // of a named teacher, so a failure here is an answer, not an unbound row.
  if (!ownerUserId) return { status: 'invalid', reason: 'teacher_unavailable' };

  // Her plan: a library pick resolves for the TEACHER (her downloaded version).
  let libraryAsset = null;
  let libraryPdfKey = null;
  if (pick && pick.segmentId) {
    const render = await d.library.readyRender(pick);
    if (!render) return { status: 'invalid', reason: 'plan_not_ready' };
    libraryPdfKey = render.r2Key;
  } else if (pick) {
    libraryAsset = await d.library.resolveAsset({ userId: ownerUserId, ...pick });
    if (!libraryAsset) return { status: 'invalid', reason: 'plan_not_found' };
  }

  // bd-ra8xu.40: the visit's rubric, decided ONCE here as observe-capture decides it on WhatsApp.
  const { v6Stamp, fdeLesson } = await decideStamp(d, coach, ownerUserId, lesson);

  const startedAt = d.now().toISOString();
  const planKey = lessonPlanKey || libraryPdfKey;
  // Field for field what lesson-plan-processor writes (handleLessonPlanUpload,
  // or the "No" tap) — as the teacher's portal upload does.
  const lessonPlanFields = planKey
    ? {
      has_lesson_plan: true,
      lesson_plan_url: d.r2.buildR2PublicUrl(planKey),
      lesson_plan_r2_key: planKey,
      lesson_plan_format: extOf(planKey).slice(1),
      lesson_plan_extraction_status: 'pending',
      lesson_plan_extraction_error: null,
    }
    : { has_lesson_plan: false, lesson_plan_link_method: 'none' };
  // The record appendClassroomPhoto writes, on the column and its mirror.
  const classroomPhotos = photos.map((k) => ({ url: d.r2.buildR2PublicUrl(k), uploaded_at: startedAt }));

  const { data: session, error } = await d.supabase
    .from('coaching_sessions')
    .insert({
      // observe-capture.startFromAudio's row, field for field:
      user_id: ownerUserId,                 // the bound teacher
      session_id: null,                     // no chat session
      audio_id: null,                       // no WhatsApp media id — the audio is in R2
      audio_url: audioUrl,
      audio_duration_seconds: null,         // transcription measures it (ffprobe)
      status: 'confirmed',                  // the coach declared intent by sending it
      observation_type: 'leader_observation',
      observer_user_id: userId,
      debrief_status: 'pending',
      ...lessonPlanFields,
      ...(classroomPhotos.length
        ? { classroom_photos: classroomPhotos, conversation_state: { classroom_photos: classroomPhotos } }
        : {}),
      // FICO17 v6 (the coach switch): stamped on the row itself, before transcription is queued.
      ...(v6Stamp ? { framework: v6Stamp, framework_selection_reason: 'coach_rubric_switch' } : {}),
      created_at: startedAt,
    })
    .select()
    .single();
  if (error || !session) throw new Error(`portal observe insert failed: ${error && error.message}`);

  if (libraryAsset) {
    try {
      await d.library.link(session.id, libraryAsset.assetId);
    } catch (linkError) {
      d.log('❌ portal observe: library plan could not be linked — analysing without it', {
        coachingSessionId: session.id, assetId: libraryAsset.assetId, error: linkError && linkError.message,
      }, 'error');
    }
  }

  // FDE (grades 6-12): its form row, then the stamp — before transcription is queued.
  if (fdeLesson) {
    try {
      await startFdeVisit(d, { userId, session, ownerUserId, teacher, schoolExtId, lesson: fdeLesson });
    } catch (err) {
      d.log('❌ portal observe: the FDE visit did not start (goes on as /observe)', { coachingSessionId: session.id, error: err && err.message }, 'error');
    }
  }

  try {
    // `from` is the COACH: every message the pipeline might still send for an
    // observation goes to her, never the observed teacher.
    await d.queue.queueTranscription(session.id, { from: coach.phone_number });
  } catch (queueError) {
    await d.supabase
      .from('coaching_sessions')
      .update({ status: 'failed', failed_step: 'queue', error_message: String(queueError.message || queueError) })
      .eq('id', session.id);
    return { status: 'queue_failed', coachingSessionId: session.id };
  }

  // The observation started — the teacher leaves "My schedule" (as startFromAudio does).
  try {
    await d.schedule.markDone(userId, teacher.teacher_ext_id, boundTeacher.school_ext_id || null, session.id);
  } catch (err) {
    d.log('⚠️ portal observe: schedule markDone failed (non-blocking)', { userId, error: err && err.message });
  }

  d.log('🔭 portal observe: observation started from the portal', {
    coachingSessionId: session.id, observerId: userId, teacherUserId: ownerUserId,
    hasLessonPlan: !!planKey || !!libraryAsset, photos: classroomPhotos.length,
    rubric: (fdeLesson && fdeLesson.rubricId) || v6Stamp || null,
  });
  return { status: 'ok', coachingSessionId: session.id };
}

/** HER recent plans — the WhatsApp "Recent Lesson Plans" list, for the teacher being observed. */
async function teacherRecentPlans({ userId, teacherExtId, schoolExtId = null }, deps) {
  if (!userId || !teacherExtId) return { status: 'invalid', reason: 'no_teacher' };
  const d = withDefaults(deps);
  const teacher = await resolveTeacherSafely(d, userId, teacherExtId, schoolExtId);
  if (!teacher) return { status: 'invalid', reason: 'not_your_teacher' };
  if (!teacher.user_id) return { status: 'ok', plans: [] };
  return PortalCoaching.recentLessonPlans({ userId: teacher.user_id }, { library: d.library });
}

// ── what the portal shows ──────────────────────────────────────────────────

/** The coach's portal observations, newest first, each with its step. */
async function listPortalObservations({ userId }, deps) {
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  const d = withDefaults(deps);
  const since = new Date(d.now().getTime() - LIST_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: rows } = await d.supabase
    .from('coaching_sessions')
    .select('id, status, debrief_status, created_at, audio_url, user_id, duplicate_of_session_id, '
      + 'delivery:analysis_data->teacher_delivery, talk:analysis_data->observer_debrief, users(name)')
    .eq('observer_user_id', userId)
    .eq('observation_type', 'leader_observation')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  const observations = (rows || []).filter(isPortalSession).map((r) => {
    const delivery = r.delivery || {};
    const talk = r.talk || {};
    const { step, problem } = stepOfRow({
      ...r, analysis_data: { teacher_delivery: delivery, observer_debrief: { ...talk, transcript: undefined } },
    });
    return {
      id: r.id,
      createdAt: r.created_at,
      teacherName: (r.users && r.users.name) || delivery.teacher_name || null,
      step,
      problem: problem || null,
    };
  });
  return { status: 'ok', observations };
}

/**
 * bd-ewbzns.4.3 — a rubric-key win named in BOTH languages (observe-strings coach_rubric_names), so the page shows it in
 * its own language; null for a free-text behaviour (the older judge), which the page shows as written.
 */
function winNames(behaviour) {
  const { observeStrings } = require('./observe-strings');
  const { winName } = require('./observe-coach-rubric');
  const en = winName(behaviour, observeStrings('en'));
  if (en === behaviour) return null;
  return { en, ur: winName(behaviour, observeStrings('ur')) };
}

function shapeFeedback(fb) {
  if (!fb) return null;
  const { isHarmfulDebrief } = require('./observe-coach-feedback');
  const harmful = !!(fb.rubric && isHarmfulDebrief(fb.rubric));
  return {
    harmful,
    praise_line: fb.praise_line || null,
    wins: Array.isArray(fb.wins) ? fb.wins.map((w) => ({ behaviour: w.behaviour, evidence: w.evidence, name: winNames(w.behaviour) })) : [],
    try: fb.try ? { move: fb.try.move, evidence: fb.try.evidence, instead: fb.try.instead || null } : null,
    reflection_question: fb.reflection_question || null,
    concern: fb.concern
      ? { what_happened: fb.concern.what_happened, why_it_matters: fb.concern.why_it_matters, instead: fb.concern.instead }
      : null,
  };
}

/**
 * One observation, as its page shows it — hers from either side (bd-15y1pc).
 * `portal` says whether the portal can also take it through its steps.
 */
async function observationView({ userId, coachingSessionId }, deps) {
  const d = withDefaults(deps);
  const row = await loadMine(d, userId, coachingSessionId);
  if (!row) return notFound();
  const ad = row.analysis_data || {};
  const od = debriefOf(row);
  const td = deliveryOf(row);
  const { step, problem, preparing } = stepOfRow(row);

  let teacher = null;
  try {
    const t = await d.people.teacherOf(row);
    if (t) teacher = { name: t.name || null, phone: t.phone || null };
  } catch (_) { /* the page names her from the delivery when it can */ }

  let imageUrl = null;
  if (td.report_key) {
    try {
      imageUrl = await d.r2.getPresignedUrl(d.r2.buildR2PublicUrl(td.report_key), 900, { disposition: 'inline' });
    } catch (_) { imageUrl = null; }
  }

  return {
    status: 'ok',
    id: row.id,
    createdAt: row.created_at,
    sessionStatus: row.status,
    step,
    problem: problem || null,
    preparing: !!preparing,
    portal: isPortalSession(row),
    // bd-ra8xu.40 — the rubric this visit was scored with (framework + version only), in very small type.
    rubric: require('../coaching/rubric-label').rubricLabelOf({ session: row }),
    teacher,
    lesson: { topic: ad.topic || null, subject: ad.subject || null, hasLessonPlan: !!row.has_lesson_plan },
    lessonPlan: planOf(row),
    draft: { edited: !!ad.observer_edit_summary, summary: ad.observer_edit_summary || null },
    talk: {
      guide: od.guide_snapshot || null,
      recordedAt: od.recorded_at || null,
      feedback: shapeFeedback(od.feedback),
    },
    report: {
      status: td.status || null,
      teacherName: td.teacher_name || null,
      teacherPhone: td.teacher_phone || null,
      caption: td.caption || null,
      companionText: td.companion_text || null,
      imageUrl,
      sentAt: td.sent_at || null,
      templateSentAt: td.template_sent_at || null,
    },
  };
}

// ── the draft ──────────────────────────────────────────────────────────────

/**
 * Each section of the review form, with exactly what the MEWAKA Flow pre-fills
 * on its screen (buildScreenPrefill) — so the portal shows the coach the same
 * ratings, notes and lesson-plan moves, and submits the same keys.
 *
 * bd-15y1pc: her answers can be READ from either side, and after the report is
 * out; `editable` says whether they can still be changed (before the teacher
 * has the report).
 */
async function getDraft({ userId, coachingSessionId }, deps) {
  const d = withDefaults(deps);
  const row = await loadMine(d, userId, coachingSessionId);
  if (!row) return notFound();
  const fde = require('./obs612/portal'); // bd-ra8xu.40 — an FDE (obs612) visit: FDE's form, its own module
  if (fde.isFdeSession(row)) return fde.portalDraft({ userId, row });
  if (!READABLE_STATUSES.includes(row.status)) return notReady('not_ready');
  const editable = EDITABLE_STATUSES.includes(row.status) && !REPORT_OUT.includes(deliveryOf(row).status);

  const pack = d.pack();
  const lang = await d.languageFor('coach', row);
  const fid = d.draft.fid || ((id) => String(id).replace(/\./g, '_'));
  // bd-ra8xu.40 — the rubric this visit was scored with, in very small type on the page (framework + version only).
  const rubric = require('../coaching/rubric-label').rubricLabelOf({ session: row });
  // bd-ra8xu.40 — a FICO17 v6 visit is reviewed on the v6 Flow's screens, not V3's.
  if (require('./observe-fico17-v6').visitFramework(row)) {
    const b = draftSection(d, pack, 'lesson_plan_fidelity', row, lang, fid);
    return {
      status: 'ok',
      kind: 'fico17_v6',
      rubric,
      minReason: require('../coaching/frameworks/fico17-v6').JUSTIFICATION_MIN,
      scale: [],
      fidelityScale: d.draft.FIDELITY_VERDICT_OPTIONS || [],
      sections: [...(b ? [b.section] : []), ...v6Sections(row.analysis_data || {})],
      saved: row.status === 'observer_review_complete',
      editable,
    };
  }
  let scale = pack.scaleOptions || null;
  const sections = pack.domainOrder.map((domainKey) => {
    const out = draftSection(d, pack, domainKey, row, lang, fid);
    if (!out) return null;
    if (!scale && out.scale) scale = out.scale;
    return out.section;
  }).filter(Boolean);

  return {
    status: 'ok',
    rubric,
    scale: scale || [],
    fidelityScale: d.draft.FIDELITY_VERDICT_OPTIONS || [],
    sections,
    saved: row.status === 'observer_review_complete',
    editable,
  };
}

/**
 * One section of the review form with exactly what its Flow screen pre-fills (buildScreenPrefill), as the portal shows
 * it. @returns {{section: object, scale: (Array|null)}|null}  null when the pack has no such section.
 */
function draftSection(d, pack, domainKey, row, lang, fid) {
  const spec = pack.domains[domainKey];
  if (!spec) return null;
  const prefill = d.draft.buildScreenPrefill(row.analysis_data, domainKey, lang) || {};
  const scale = prefill.scale || null;
  const head = { key: domainKey, letter: spec.key, title: spec.title };
  if (Object.prototype.hasOwnProperty.call(prefill, 'fr_1')) {
    // The editable Section B (OBSERVE_FICO_FLOW_HAS_FIDELITY=editable): per move.
    const moves = [];
    for (let k = 1; k <= (d.draft.MAX_MOVE_SLOTS || 0); k += 1) {
      if (prefill[`mv_${k}_v`]) {
        moves.push({ k, plan: prefill[`mv_${k}`], verdict: prefill[`fr_${k}`], evidence: prefill[`fe_${k}`] });
      }
    }
    return { scale, section: { ...head, kind: 'moves', header: prefill.fid_header || '', fallback: prefill.fid_fallback || '', moves } };
  }
  // Read-only lines the Flow shows above the indicators on this screen, if any.
  const notes = [];
  if (prefill.has_fidelity && prefill.fidelity_summary) notes.push(prefill.fidelity_summary);
  if (prefill.has_fidelity && prefill.fid_header) {
    notes.push(prefill.fid_header);
    for (let k = 1; k <= (d.draft.MAX_MOVE_SLOTS || 0); k += 1) if (prefill[`mv_${k}_v`]) notes.push(prefill[`mv_${k}`]);
  }
  return {
    scale,
    section: {
      ...head,
      kind: 'indicators',
      notes,
      indicators: spec.indicators.map((ind) => {
        const f = fid(ind.id);
        return {
          id: ind.id, field: f, name: ind.name,
          rating: prefill[`s_${f}`], evidence: prefill[`e_${f}`], improvement: prefill[`i_${f}`],
        };
      }),
    },
  };
}

// ── a FICO17 v6 visit's review (bd-ra8xu.40) ───────────────────────────────

/**
 * The coach's saved review as the v6 Flow's edit keys, so a saved visit re-opens on HER answers (her levels, reasons,
 * D2 counts, change reasons, and the evidence as she submitted it), never Rumi's. null before the first save.
 */
function savedV6Edits(analysis) {
  const review = analysis && analysis.fico17_v6_review;
  if (!review || !review.levels) return null;
  const v6 = require('../coaching/frameworks/fico17-v6');
  const e = {};
  for (const code of v6.CODES) {
    const lv = review.levels[code] || {};
    if (lv.level !== null && lv.level !== undefined) e[`r_${code}`] = String(lv.level);
    if (v6.isCombined(code)) {
      e[`why_${code}`] = lv.because || '';
      continue;
    }
    const dom = ((analysis.domains || {})[v6.DOMAIN_OF[code]] || {}).indicators || [];
    const row = dom.find((i) => i && i.id === code) || {};
    // applyReview moved Rumi's text to rumi_evidence and left the coach's on the row (bd-ra8xu.46).
    if (row.rumi_evidence !== undefined && typeof row.evidence === 'string') e[`ev_${code}`] = row.evidence;
    if (typeof row.improvement_sw === 'string') e[`imp_${code}`] = row.improvement_sw;
  }
  for (const l of ['C', 'D', 'F']) e[`chg_${l}`] = (review.change_reasons || {})[l] || '';
  const counts = review.d2_counts || null;
  e.d2_children = counts ? String(counts.children) : '';
  e.d2_quiet_later = counts ? String(counts.quiet_later) : '';
  return e;
}

/**
 * The v6 review's C/D/F sections, from the very prefill the v6 Flow serves (observe-fico17-v6.buildScreenPrefill):
 *   one of Rumi's 11 (kind 'dc')    Rumi's level pre-filled (and kept as `rumi`, ringed on the page), Rumi's evidence
 *                                   and "to improve" editable, 1-4 + N/A + Couldn't tell;
 *   one of the six (kind 'combined') blank until the coach sets it from the room, the definition and Rumi's evidence
 *                                   above it (read only), a reason; D2 also its two counts;
 *   the section's change reason     required when one of Rumi's levels on it is changed.
 */
function v6Sections(analysis) {
  const O = require('./observe-fico17-v6');
  const v6 = require('../coaching/frameworks/fico17-v6');
  const edits = savedV6Edits(analysis);
  const opts = (code) => O.optionsFor(code).map((o) => ({ id: o.id, title: o.title, description: o.description || '' }));
  return Object.values(v6.SECTIONS).map((sec) => {
    const p = O.buildScreenPrefill(analysis, sec.key, { edits });
    return {
      key: sec.domain,
      letter: sec.key,
      title: sec.name,
      kind: 'v6',
      indicators: sec.codes.map((code) => {
        const base = { id: code, field: code, name: v6.indicator(code).name, options: opts(code) };
        if (v6.isCombined(code)) {
          return {
            ...base,
            kind: 'combined',
            body: p[`cb_${code}`] || '',
            rating: (edits && edits[`r_${code}`]) || '',
            why: p[`w_${code}`] || '',
            ...(code === 'D2' ? { d2: { children: (edits && edits.d2_children) || '', quietLater: (edits && edits.d2_quiet_later) || '' } } : {}),
          };
        }
        const rumi = O.rumiLevel(analysis, code);
        return {
          ...base,
          kind: 'dc',
          rumi: rumi === null ? null : String(rumi),
          rating: p[`s_${code}`],
          evidence: p[`e_${code}`] || '',
          improvement: p[`i_${code}`] || '',
        };
      }),
      changeReason: p[`wc_${sec.key}`] || '',
    };
  });
}

/** The v6 Flow's refusals for the whole review (every C/D/F screen), as { field: message }; {} when it may be saved. */
function v6Refusals(analysis, edits, S) {
  const O = require('./observe-fico17-v6');
  return O.LETTERS.reduce((all, l) => ({ ...all, ...O.validateScreen(`DOMAIN_${l}`, edits, analysis, S) }), {});
}

/** Apply her edits — the MEWAKA Flow's keys, through the MEWAKA Flow's save. */
async function saveDraft({ userId, coachingSessionId, edits, submit = false }, deps) {
  const d = withDefaults(deps);
  const row = await loadMine(d, userId, coachingSessionId);
  if (!row) return notFound();
  const fde = require('./obs612/portal'); // bd-ra8xu.40 — an FDE (obs612) visit: save / Submit FDE's form, no WhatsApp
  if (fde.isFdeSession(row)) return fde.portalSave({ userId, row, edits, submit: submit === true });
  if (!EDITABLE_STATUSES.includes(row.status)) return notReady('not_ready');
  if (REPORT_OUT.includes(deliveryOf(row).status)) return notReady('report_sent');

  const isV6 = !!require('./observe-fico17-v6').visitFramework(row);
  const keyRx = isV6 ? V6_EDIT_KEY_RX : EDIT_KEY_RX;
  const clean = {};
  for (const [k, v] of Object.entries(edits && typeof edits === 'object' ? edits : {})) {
    if (keyRx.test(k) && typeof v === 'string') clean[k] = v.slice(0, EDIT_VALUE_CAP);
  }
  if (isV6) {
    // bd-ra8xu.40 — the v6 Flow refuses a screen until its rules hold; the portal sends every screen at once, so the
    // whole review is checked here, the reasons in the coach's language, and nothing is saved until it passes.
    const O = require('./observe-fico17-v6');
    const lang = await d.languageFor('coach', row);
    const errors = v6Refusals(row.analysis_data || {}, clean, O.messages(lang));
    if (Object.keys(errors).length) return { status: 'invalid', reason: 'v6_review', errors };
  }
  const summary = await d.draft.applyObserverEdits(coachingSessionId, clean);
  if (summary && summary.refused) return { status: 'not_ready', reason: 'terminal' };
  await releaseWhatsAppStep(d, userId, coachingSessionId, 'draft');
  return { status: 'ok', summary };
}

// ── the talk with the teacher ──────────────────────────────────────────────

const TALK_STATUS = 'observer_review_complete';

/** The guide startDebrief would send — built once, kept on the row. */
async function talkGuide({ userId, coachingSessionId }, deps) {
  const d = withDefaults(deps);
  const row = await loadMine(d, userId, coachingSessionId);
  if (!row) return notFound();
  if (row.status !== TALK_STATUS && row.status !== 'completed') return notReady('draft_not_saved');
  const od = debriefOf(row);
  if (od.guide_snapshot) return { status: 'ok', guide: od.guide_snapshot };
  if (row.debrief_status === 'done') return { status: 'ok', guide: null };

  const coach = await loadCoach(d, userId);
  const { observeLang } = require('./observe-strings');
  const guide = await d.debrief.buildDebriefGuide(row, observeLang(coach || {}));
  await d.debrief.mergeObserverDebrief(coachingSessionId, { guide_snapshot: guide });
  return { status: 'ok', guide };
}

/** Attach the talk she recorded (or chose) in the portal, and queue its coaching. */
async function startTalk({ userId, coachingSessionId, key }, deps) {
  if (!isOwnPortalKey(userId, key, 'audio')) return { status: 'invalid', reason: 'not_your_upload' };
  const d = withDefaults(deps);
  const row = await loadMine(d, userId, coachingSessionId);
  if (!row) return notFound();
  if (row.status !== TALK_STATUS) return notReady('draft_not_saved');
  if (row.debrief_status && row.debrief_status !== 'pending') return notReady('talk_done');

  const missing = await checkUploaded(d, [{ key, kind: 'audio' }]);
  if (missing) return missing;

  const coach = await loadCoach(d, userId);
  const od = debriefOf(row);
  const now = d.now().toISOString();
  await d.debrief.mergeObserverDebrief(coachingSessionId, {
    ...d.debrief.freshRecordingPatch({
      audioId: null,
      audioMime: KINDS.audio.types[extOf(key)] || null,
      guideSnapshot: od.guide_snapshot || null,
      recordedAt: now,
    }),
    audio_r2_key: key,
    too_short_at: null,
    feedback_failed_at: null,
    duplicate_refused_at: null,
  });
  try {
    // Each recording is its own job (the queue dedupes on session + nonce).
    await d.queue.queueObserveDebrief(coachingSessionId, { from: coach && coach.phone_number, dedupNonce: nonce(key) });
  } catch (err) {
    d.log('❌ portal observe: talk could not be queued', { coachingSessionId, error: err && err.message }, 'error');
    await d.debrief.mergeObserverDebrief(coachingSessionId, { failed_at: now });
    return { status: 'queue_failed', coachingSessionId };
  }
  await releaseWhatsAppStep(d, userId, coachingSessionId, 'talk');
  return { status: 'ok' };
}

/** Try a portal talk again after a failed transcription or feedback — the same recording. */
async function retryTalk({ userId, coachingSessionId }, deps) {
  const d = withDefaults(deps);
  const row = await loadMine(d, userId, coachingSessionId);
  if (!row) return notFound();
  const od = debriefOf(row);
  if (row.status !== TALK_STATUS || row.debrief_status === 'done') return notReady('talk_done');
  if (!od.audio_r2_key || od.audio_id || od.too_short_at) return notReady('needs_new_recording');
  if (!od.failed_at && !od.feedback_failed_at) return notReady('not_failed');

  const coach = await loadCoach(d, userId);
  await d.debrief.mergeObserverDebrief(coachingSessionId, {
    failed_at: null, feedback_failed_at: null, transcription_error: null, error_class: null,
  });
  await d.queue.queueObserveDebrief(coachingSessionId, {
    from: coach && coach.phone_number, dedupNonce: nonce(`${od.audio_r2_key}:${d.newId()}`),
  });
  return { status: 'ok' };
}

// ── the report ─────────────────────────────────────────────────────────────

/**
 * startSendFlow's bound branch, minus the chat: the teacher the observation is
 * bound to is the recipient, the roster learns her, and the preview phase is
 * queued — marked as the portal's, so the worker sends the coach nothing.
 */
async function previewReport({ userId, coachingSessionId }, deps) {
  const d = withDefaults(deps);
  const row = await loadMine(d, userId, coachingSessionId);
  if (!row) return notFound();
  if (row.status !== TALK_STATUS || row.debrief_status !== 'done') return notReady('feedback_first');
  if (REPORT_OUT.includes(deliveryOf(row).status)) return notReady('report_sent');

  const { isBound } = d.people;
  const teacher = (!isBound || isBound(row)) ? await d.people.teacherOf(row) : null;
  if (!teacher || !teacher.phone) return { status: 'invalid', reason: 'no_teacher_phone' };

  const coach = await loadCoach(d, userId);
  const picked = { name: teacher.name || '', phone: teacher.phone };
  try {
    await d.roster.upsertTeacher(coach, picked);
  } catch (err) {
    d.log('⚠️ portal observe: roster upsert failed (non-fatal)', { coachingSessionId, error: err && err.message });
  }
  await d.send.mergeTeacherDelivery(coachingSessionId, {
    teacher_name: picked.name, teacher_phone: picked.phone, status: 'previewing', channel: 'portal', send_requested_at: null,
  });
  await d.queue.queueObserveTeacherReport(coachingSessionId, {
    from: coach && coach.phone_number, phase: 'preview', channel: 'portal', dedupNonce: d.newId(),
  });
  await releaseWhatsAppStep(d, userId, coachingSessionId, 'report');
  return { status: 'ok' };
}

/** "Send to <teacher>": the deliver phase, for a preview she has seen. */
async function sendReport({ userId, coachingSessionId }, deps) {
  const d = withDefaults(deps);
  const row = await loadMine(d, userId, coachingSessionId);
  if (!row) return notFound();
  const td = deliveryOf(row);
  if (td.status !== 'awaiting_confirm' || !td.report_key || !td.teacher_phone) return notReady('preview_first');

  const coach = await loadCoach(d, userId);
  await d.send.mergeTeacherDelivery(coachingSessionId, { send_requested_at: d.now().toISOString(), channel: 'portal' });
  await d.queue.queueObserveTeacherReport(coachingSessionId, {
    from: coach && coach.phone_number, phase: 'deliver', channel: 'portal', dedupNonce: d.newId(),
  });
  await releaseWhatsAppStep(d, userId, coachingSessionId, 'report');
  return { status: 'ok' };
}

module.exports = {
  LEADER_ROLES,
  startPortalObservation,
  lessonQuestion,
  teacherRecentPlans,
  listPortalObservations,
  observationView,
  getDraft,
  saveDraft,
  talkGuide,
  startTalk,
  retryTalk,
  previewReport,
  sendReport,
};
