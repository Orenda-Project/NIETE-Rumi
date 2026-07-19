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

async function startFromAudio(user, from, audioId, sessionId, audioDurationSeconds = null) {
  const lang = observeLang(user);
  const S = observeStrings(lang);

  const { data: session, error } = await supabase
    .from('coaching_sessions')
    .insert({
      user_id: user.id,                       // row owner = observer until teacher identified (D5)
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
    logToFile('❌ observe: failed to create observation session', { userId: user.id, error: error && error.message });
    await WhatsAppService.sendMessage(from, S.no_account);
    return null;
  }

  const CoachingJobQueueService = require('../coaching/coaching-job-queue.service');
  await CoachingJobQueueService.queueTranscription(session.id, { from, audioId });
  await ObserveState.setState(user.id, 'analyzing', { sessionId: session.id });
  await WhatsAppService.sendMessage(from, S.audio_received);

  logToFile('🔭 observe: observation capture started', {
    coachingSessionId: session.id, observerId: user.id, audioId,
  });
  return session;
}

module.exports = { startFromAudio };
