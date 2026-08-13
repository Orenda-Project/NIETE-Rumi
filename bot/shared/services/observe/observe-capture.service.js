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
        first_name: name ? name.split(/\s+/)[0] : null,
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

async function startFromAudio(user, from, audioId, sessionId, audioDurationSeconds = null) {
  const lang = observeLang(user);
  const S = observeStrings(lang);

  // bd-2432: the visit picker binds a teacher BEFORE the recording. When bound,
  // the teacher owns the row; the observer split below is unchanged either way.
  let ownerUserId = user.id;
  let boundTeacher = null;
  try {
    const st = await ObserveState.getState(user.id);
    if (st && st.boundTeacher) {
      boundTeacher = st.boundTeacher;
      const teacherId = await resolveBoundTeacherUserId(st.boundTeacher);
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

  await ObserveState.setState(user.id, 'analyzing', { sessionId: session.id });
  await WhatsAppService.sendMessage(from, S.audio_received);

  // bd-2668: an UNBOUND capture records no teacher, so the pending-debrief list
  // can only show a date and the portal shows "Unassigned" (66 of 85 live
  // observations). Ask who was observed — after the state is already 'analyzing'
  // and the ack is sent, so analysis proceeds regardless and ignoring the
  // question leaves today's behaviour byte-for-byte. Never let it throw: a
  // missing name must never cost a coach her recording.
  if (!boundTeacher) {
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

module.exports = { startFromAudio, resolveBoundTeacherUserId };
