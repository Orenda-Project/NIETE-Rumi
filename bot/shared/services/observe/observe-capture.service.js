/**
 * FEAT-053 bd-16 — start a leader observation from an inbound audio.
 *
 * Called by voice-message.handler.js when a school_leader in the
 * observe awaiting_audio state sends any audio (D14: no 10-minute
 * threshold — the FO already declared intent by typing /observe).
 *
 * Creates the coaching_sessions row with the observer split
 * (observation_type='leader_observation', observer_user_id) at status
 * 'confirmed' (no Yes/No confirm step — the analysis claim CAS accepts
 * 'confirmed'), queues transcription, and sets the analyzing state.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const ObserveState = require('./observe-state.service');
const { observeStrings, observeLang } = require('./observe-strings');
const { logToFile } = require('../../utils/logger');

/**
 * bd-2432 (port of main-bot FEAT-116) — resolve the visit-picker's bound
 * teacher to a users.id so the session row is owned by the TEACHER (her trend
 * keys correctly from day one) while the coach stays observer_user_id.
 * Prefer the bound user_id; else look up by phone; else create a minimal
 * teacher row. ANY failure → null (observer stays owner — never dead-end).
 */
async function resolveBoundTeacherUserId(boundTeacher) {
  try {
    if (!boundTeacher) return null;
    if (boundTeacher.user_id) return boundTeacher.user_id;
    const phone = boundTeacher.phone_e164;
    if (!phone) return null;
    const { data: existing } = await supabase
      .from('users').select('id').eq('phone_number', phone).limit(1);
    if (existing && existing[0]) return existing[0].id;
    const name = (boundTeacher.teacher_name || '').trim();
    const { data: created, error } = await supabase
      .from('users')
      .insert({
        phone_number: phone,
        name: name ? name.split(/\s+/)[0] : null,
        name: name || null,
        role: 'teacher',
        preferred_language: boundTeacher.preferred_language || 'en',
        source: 'observe_visit_bind',
      })
      .select()
      .single();
    if (error || !created) return null;
    return created.id;
  } catch (_) {
    return null;
  }
}

/**
 * The teacher an /observe2 form was started for, in the shape a visit-picker bind leaves in the observe
 * state, for a capture that arrives after that state is gone (it lives 2 h and every capture clears it).
 */
function boundTeacherFromForm(form) {
  if (!form || !form.teacher_user_id) return null;
  const vc = form.visit_context || {};
  return {
    user_id: form.teacher_user_id,
    teacher_ext_id: vc.teacher_ext_id || null,
    teacher_name: vc.teacher_name || null,
    school_ext_id: vc.school_ext_id || '',
  };
}

/**
 * @param {object} [opts]
 * @param {object} [opts.observe2Form] the /observe2 form the audio router found waiting for this
 *   recording (observation_field_forms row); it is linked, and its teacher owns the observation when
 *   the observe state no longer says who it is.
 */
async function startFromAudio(user, from, audioId, sessionId, audioDurationSeconds = null, opts = {}) {
  const lang = observeLang(user);
  const S = observeStrings(lang);

  // bd-2432: the visit picker binds a teacher BEFORE the recording. When bound,
  // the teacher owns the row; the observer split below is unchanged either way.
  let ownerUserId = user.id;
  let boundTeacher = null;
  let st = null;
  try {
    st = await ObserveState.getState(user.id);
  } catch (_) { /* unbound capture — today's behavior */ }
  const observe2Form = (opts && opts.observe2Form) || null;
  try {
    const picked = (st && st.boundTeacher) || boundTeacherFromForm(observe2Form);
    if (picked) {
      boundTeacher = picked;
      const teacherId = await resolveBoundTeacherUserId(picked);
      if (teacherId) ownerUserId = teacherId;
    }
  } catch (_) { /* unbound capture — today's behavior */ }

  const { data: session, error } = await supabase
    .from('coaching_sessions')
    .insert({
      user_id: ownerUserId,                   // bound teacher when picked via the visit Flow; else observer (D5)
      session_id: sessionId,
      audio_id: audioId,
      audio_duration_seconds: audioDurationSeconds,
      status: 'confirmed',                    // skips the teacher confirm step
      observation_type: 'leader_observation',
      observer_user_id: user.id,
      debrief_status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !session) {
    // bd-2136: this is a DB write failure, NOT a missing account. Reporting it
    // as no_account ("I couldn't find your account") hid a missing-column error
    // and sent testers chasing registration for hours. Say what actually failed.
    logToFile('❌ observe: failed to create observation session', {
      userId: user.id, sessionId, audioId, error: error && error.message,
    });
    await WhatsAppService.sendMessage(from, S.capture_failed || S.no_account);
    return null;
  }

  // /observe2: the recording joins the coach's open field form BEFORE transcription is queued, so
  // the step after transcription finds the link. Never lets a failure cost the capture.
  let observe2 = null;
  try {
    observe2 = await require('./observe2/capture-link').linkRecording(user, session, boundTeacher, {
      form: observe2Form,
      formId: st && st.observe2FormId,
      // A Start from /observe's own planner arms the state without the /observe2 marker: that
      // recording is a classic observation and never joins an /observe2 form.
      classicStart: Boolean(st && st.state === 'awaiting_audio' && !st.observe2FormId),
    });
  } catch (err) {
    logToFile('❌ observe2: linking the recording failed (capture goes on as /observe)', {
      userId: user.id, sessionId: session.id, error: err.message,
    }, 'error');
  }

  const CoachingJobQueueService = require('../coaching/coaching-job-queue.service');
  await CoachingJobQueueService.queueTranscription(session.id, { from, audioId });

  // bd-2445: the observation started — retire the matching upcoming schedule
  // (the teacher leaves "My schedule"). markDone is tolerant; a lifecycle
  // failure must never block the capture.
  if (boundTeacher && boundTeacher.teacher_ext_id) {
    try {
      const ScheduleStore = require('./observe-schedule.service');
      await ScheduleStore.markDone(user.id, boundTeacher.teacher_ext_id, boundTeacher.school_ext_id || null, session.id);
    } catch (err) {
      logToFile('⚠️ observe: schedule markDone failed (non-blocking)', { userId: user.id, error: err.message });
    }
  }

  // bd-tju8f: FREE the slot — the pipeline lives on the DB row, not in Redis.
  // Keeping 'analyzing' here is what made recording #2 unbindable (the slot was
  // occupied, the router saw no armed state, and the audio leaked into teacher
  // coaching — 4 coaches on 24 Aug). The next recording now gets the binding
  // prompt, which is the multi-flight entry point.
  await ObserveState.clearState(user.id);
  // The ack carries a way out. /observe used to be the only door, so the
  // declaration of intent was the confirm and a second one looked redundant;
  // a recording can now also arrive through the binding picker and the menu,
  // and a coach who sent the wrong one had nothing to tap.
  //
  // This is NOT a gate on the work — transcription is queued twenty lines
  // above, so it saves the wrong report reaching a teacher, not the compute.
  // Do not "optimise" it by moving the queue call without deciding that every
  // observation should wait on a human tap first.
  await WhatsAppService.sendInteractiveButtons(from, {
    body: observe2 ? observe2.ack : `${S.audio_received}\n\n${S.capture_next_hint || ''}`.trim(),
    buttons: [
      { id: `observe_ok_${session.id}`, title: S.btn_ok_wait.slice(0, 20) },
      { id: `observe_cancel_${session.id}`, title: S.btn_cancel_obs.slice(0, 20) },
    ],
  });

  // bd-2668: an UNBOUND capture records no teacher, so the pending-debrief list
  // can only show a date and the portal shows "Unassigned" (66 of 85 live
  // observations). Ask who was observed — after the state is already 'analyzing'
  // and the ack is sent, so analysis proceeds regardless and ignoring the
  // question leaves today's behaviour byte-for-byte. Never let it throw: a
  // missing name must never cost a coach her recording.
  // /observe2 asks too when its form names no teacher (the bind at Start failed): without it the
  // observation has no teacher to send the report to (Riffat, 4 Oct).
  if (!boundTeacher && !(observe2 && observe2.form && observe2.form.teacher_user_id)) {
    try {
      const ObserveWho = require('./observe-who.service');
      await ObserveWho.maybeAskObservedTeacher(user, from, session.id);
    } catch (err) {
      logToFile('⚠️ observe: who-ask failed (non-blocking)', { userId: user.id, error: err.message });
    }
  }

  logToFile('🔭 observe: observation capture started', {
    coachingSessionId: session.id, observerId: user.id, audioId,
  });
  return session;
}

module.exports = { startFromAudio, resolveBoundTeacherUserId, boundTeacherFromForm };
