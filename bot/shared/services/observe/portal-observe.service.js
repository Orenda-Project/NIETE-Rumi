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
 * observation she observed AND started in the portal is reachable; anything
 * else answers not_found, the same as one that does not exist.
 */

const crypto = require('crypto');
const PortalCoaching = require('../coaching/portal-coaching.service');
const { stepOfRow } = require('./portal-observe-step');

const { isOwnPortalKey, isPortalSession, libraryPick, checkUploaded, extOf, KINDS, MAX_PHOTOS } = PortalCoaching;

// observe-gate's LEADER_ROLES — who may run /observe.
const LEADER_ROLES = ['school_leader', 'supervisor', 'coach', 'principal', 'aeo'];

// The draft can be edited until the report is out — after that the teacher has read it.
const EDITABLE_STATUSES = ['awaiting_observer_review', 'observer_review_complete'];
const REPORT_OUT = ['sent', 'awaiting_teacher_tap', 'operator_review'];

// The keys the MEWAKA Flow submits (observe-mewaka-endpoint bufferEdits), and a
// generous cap on any one answer (the Flow's TextArea allows 600).
const EDIT_KEY_RX = /^(r|ev|imp|fid)_[A-Za-z0-9_]+$/;
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
    .select('id, phone_number, role, name, preferred_language')
    .eq('id', userId)
    .maybeSingle();
  return data || null;
}

/** Her observation, started in the portal — or null, for every other case alike. */
async function loadOwn(d, userId, coachingSessionId) {
  if (!userId || !coachingSessionId) return null;
  const { data: row } = await d.supabase
    .from('coaching_sessions')
    .select('*')
    .eq('id', coachingSessionId)
    .maybeSingle();
  if (!row || row.observation_type !== 'leader_observation') return null;
  if (row.observer_user_id !== userId || !isPortalSession(row)) return null;
  return row;
}

const debriefOf = (row) => ((row && row.analysis_data) || {}).observer_debrief || {};
const deliveryOf = (row) => ((row && row.analysis_data) || {}).teacher_delivery || {};
const nonce = (seed) => crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 16);

async function resolveTeacherSafely(d, userId, teacherExtId, schoolExtId) {
  try {
    return await d.leaderSource.resolveTeacher(userId, teacherExtId, schoolExtId);
  } catch (err) {
    d.log('❌ portal observe: resolveTeacher failed', { userId, teacherExtId, error: err && err.message }, 'error');
    return null;
  }
}

// ── start ───────────────────────────────────────────────────────────────────

/**
 * @param {{userId, teacherExtId, schoolExtId?, key, lessonPlanKey?, lessonPlan?, photoKeys?}} args
 *   teacherExtId — the teacher's ext id in her patch (the phone, as on the visit Flow).
 * @returns {{status:'ok', coachingSessionId} | {status:'invalid', reason} | {status:'queue_failed', coachingSessionId}}
 */
async function startPortalObservation({
  userId, teacherExtId, schoolExtId = null, key, lessonPlanKey = null, lessonPlan: picked = null, photoKeys = [],
}, deps) {
  const photos = Array.isArray(photoKeys) ? photoKeys.filter(Boolean) : [];
  if (!userId) return { status: 'invalid', reason: 'no_user' };
  if (!teacherExtId || typeof teacherExtId !== 'string') return { status: 'invalid', reason: 'no_teacher' };

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

function shapeFeedback(fb) {
  if (!fb) return null;
  const { isHarmfulDebrief } = require('./observe-coach-feedback');
  const harmful = !!(fb.rubric && isHarmfulDebrief(fb.rubric));
  return {
    harmful,
    praise_line: fb.praise_line || null,
    wins: Array.isArray(fb.wins) ? fb.wins.map((w) => ({ behaviour: w.behaviour, evidence: w.evidence })) : [],
    try: fb.try ? { move: fb.try.move, evidence: fb.try.evidence, instead: fb.try.instead || null } : null,
    reflection_question: fb.reflection_question || null,
    concern: fb.concern
      ? { what_happened: fb.concern.what_happened, why_it_matters: fb.concern.why_it_matters, instead: fb.concern.instead }
      : null,
  };
}

/** One observation, as its page shows it. */
async function observationView({ userId, coachingSessionId }, deps) {
  const d = withDefaults(deps);
  const row = await loadOwn(d, userId, coachingSessionId);
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
    teacher,
    lesson: { topic: ad.topic || null, subject: ad.subject || null, hasLessonPlan: !!row.has_lesson_plan },
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
 */
async function getDraft({ userId, coachingSessionId }, deps) {
  const d = withDefaults(deps);
  const row = await loadOwn(d, userId, coachingSessionId);
  if (!row) return notFound();
  if (!EDITABLE_STATUSES.includes(row.status)) return notReady('not_ready');
  if (REPORT_OUT.includes(deliveryOf(row).status)) return notReady('report_sent');

  const pack = d.pack();
  const lang = await d.languageFor('coach', row);
  const fid = d.draft.fid || ((id) => String(id).replace(/\./g, '_'));
  let scale = pack.scaleOptions || null;
  const sections = pack.domainOrder.map((domainKey) => {
    const spec = pack.domains[domainKey];
    const prefill = d.draft.buildScreenPrefill(row.analysis_data, domainKey, lang) || {};
    if (!scale && prefill.scale) scale = prefill.scale;
    const head = { key: domainKey, letter: spec.key, title: spec.title };
    if (Object.prototype.hasOwnProperty.call(prefill, 'fr_1')) {
      // The editable Section B (OBSERVE_FICO_FLOW_HAS_FIDELITY=editable): per move.
      const moves = [];
      for (let k = 1; k <= (d.draft.MAX_MOVE_SLOTS || 0); k += 1) {
        if (prefill[`mv_${k}_v`]) {
          moves.push({ k, plan: prefill[`mv_${k}`], verdict: prefill[`fr_${k}`], evidence: prefill[`fe_${k}`] });
        }
      }
      return { ...head, kind: 'moves', header: prefill.fid_header || '', fallback: prefill.fid_fallback || '', moves };
    }
    // Read-only lines the Flow shows above the indicators on this screen, if any.
    const notes = [];
    if (prefill.has_fidelity && prefill.fidelity_summary) notes.push(prefill.fidelity_summary);
    if (prefill.has_fidelity && prefill.fid_header) {
      notes.push(prefill.fid_header);
      for (let k = 1; k <= (d.draft.MAX_MOVE_SLOTS || 0); k += 1) if (prefill[`mv_${k}_v`]) notes.push(prefill[`mv_${k}`]);
    }
    return {
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
    };
  });

  return {
    status: 'ok',
    scale: scale || [],
    fidelityScale: d.draft.FIDELITY_VERDICT_OPTIONS || [],
    sections,
    saved: row.status === 'observer_review_complete',
  };
}

/** Apply her edits — the MEWAKA Flow's keys, through the MEWAKA Flow's save. */
async function saveDraft({ userId, coachingSessionId, edits }, deps) {
  const d = withDefaults(deps);
  const row = await loadOwn(d, userId, coachingSessionId);
  if (!row) return notFound();
  if (!EDITABLE_STATUSES.includes(row.status)) return notReady('not_ready');
  if (REPORT_OUT.includes(deliveryOf(row).status)) return notReady('report_sent');

  const clean = {};
  for (const [k, v] of Object.entries(edits && typeof edits === 'object' ? edits : {})) {
    if (EDIT_KEY_RX.test(k) && typeof v === 'string') clean[k] = v.slice(0, EDIT_VALUE_CAP);
  }
  const summary = await d.draft.applyObserverEdits(coachingSessionId, clean);
  if (summary && summary.refused) return { status: 'not_ready', reason: 'terminal' };
  return { status: 'ok', summary };
}

// ── the talk with the teacher ──────────────────────────────────────────────

const TALK_STATUS = 'observer_review_complete';

/** The guide startDebrief would send — built once, kept on the row. */
async function talkGuide({ userId, coachingSessionId }, deps) {
  const d = withDefaults(deps);
  const row = await loadOwn(d, userId, coachingSessionId);
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
  const row = await loadOwn(d, userId, coachingSessionId);
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
  return { status: 'ok' };
}

/** Try a portal talk again after a failed transcription or feedback — the same recording. */
async function retryTalk({ userId, coachingSessionId }, deps) {
  const d = withDefaults(deps);
  const row = await loadOwn(d, userId, coachingSessionId);
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
  const row = await loadOwn(d, userId, coachingSessionId);
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
  return { status: 'ok' };
}

/** "Send to <teacher>": the deliver phase, for a preview she has seen. */
async function sendReport({ userId, coachingSessionId }, deps) {
  const d = withDefaults(deps);
  const row = await loadOwn(d, userId, coachingSessionId);
  if (!row) return notFound();
  const td = deliveryOf(row);
  if (td.status !== 'awaiting_confirm' || !td.report_key || !td.teacher_phone) return notReady('preview_first');

  const coach = await loadCoach(d, userId);
  await d.send.mergeTeacherDelivery(coachingSessionId, { send_requested_at: d.now().toISOString(), channel: 'portal' });
  await d.queue.queueObserveTeacherReport(coachingSessionId, {
    from: coach && coach.phone_number, phase: 'deliver', channel: 'portal', dedupNonce: d.newId(),
  });
  return { status: 'ok' };
}

module.exports = {
  LEADER_ROLES,
  startPortalObservation,
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
