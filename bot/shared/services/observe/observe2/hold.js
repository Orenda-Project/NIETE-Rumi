'use strict';

/**
 * /observe2 — record first, fill the form afterwards (pilot sheet R19).
 *
 * Coaches with back-to-back observations record each lesson first and fill the forms later. A
 * lesson-length recording that arrives with nothing armed and no form waiting, from a coach whose
 * latest observation was an /observe2 one, is HELD: a field form is made for it at capture
 * (visit_context.recorded_first, the period from the recording's length), and the normal capture links
 * it, acknowledges it as saved with "Fill the form", and asks who was observed. The visit lives in the
 * database from the first second; moments, the seal, the check and the debrief then run as for any
 * recording that came before the seal.
 *
 * Its own module, required only by the audio router: the capture and the park it calls must never
 * come back here (tests/setup/circular-deps.test.js).
 */

const Store = require('./field-form.store');
const { isFeatureRunnable } = require('../../../config/feature-availability');
const { logToFile } = require('../../../utils/logger');

// period_minutes is the lesson's length (the column takes 20-90). For a held recording the lesson is
// the recording, so its halfway minute is the recording's.
const periodFor = (seconds) => {
  const m = Number(seconds) > 0 ? Math.round(Number(seconds) / 60) : null;
  return m == null ? null : Math.min(90, Math.max(20, m));
};

/**
 * Was this coach's latest observation an /observe2 one? Their newest form is newer than their newest
 * (not cancelled) leader observation, or that observation is linked to a form. Follows the command
 * the coach last chose; a coach who tried /observe2 once and went back to /observe stays classic.
 * Any failed read answers false: today's routing, never a guess.
 */
async function prefersObserve2(userId) {
  try {
    if (!isFeatureRunnable('observe2')) return false;
    const latest = await Store.latestFormOf(userId);
    if (!latest.ok || !latest.form) return false;
    const supabase = require('../../../config/supabase');
    const { data, error } = await supabase.from('coaching_sessions')
      .select('id, created_at')
      .eq('observer_user_id', userId)
      .eq('observation_type', 'leader_observation')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      logToFile('[observe2] the coach\'s latest observation could not be read (routing as /observe)', { userId, error: error.message }, 'error');
      return false;
    }
    const session = (data || [])[0];
    if (!session || String(session.created_at) <= String(latest.form.created_at)) return true;
    const linked = await Store.findBySession(session.id, 'id');
    return Boolean(linked.ok && linked.form);
  } catch (err) {
    logToFile('[observe2] could not tell which flow the coach uses (routing as /observe)', { userId, error: err.message }, 'error');
    return false;
  }
}

/**
 * Hold a recording that came with no form waiting: its own form, made now and linked by the capture.
 * The capture then acknowledges it (held_saved, with "Fill the form") and asks who was observed.
 * @returns {Promise<null | {action:'held', formId, sessionId} | {action:'dupe', sessionId}>}
 *   null → nothing was held (the form could not be made); the caller parks the recording as today.
 */
async function holdRecording(user, from, { audioId, sessionId = null, durationSeconds = null, sha256 = null } = {}) {
  const Binding = require('../observe-binding.service');
  const dupe = await Binding.answerIfDuplicate(user, from, sha256);
  if (dupe) return dupe;

  const created = await Store.createForm({
    observerUserId: user.id,
    teacherUserId: null,
    visitContext: { recorded_first: true, recorded_at: new Date().toISOString() },
  });
  if (!created.ok || !created.form) return null;
  const form = created.form;
  const period = periodFor(durationSeconds);
  if (period) {
    const set = await Store.setPeriod(form.id, period);
    if (set.ok) form.period_minutes = period;
  }

  const ObserveCapture = require('../observe-capture.service');
  const session = await ObserveCapture.startFromAudio(user, from, audioId, sessionId, durationSeconds || null, { observe2Form: form });
  if (!session) {
    // The capture already told the coach it failed; the empty held form takes no other recording.
    logToFile('❌ observe2: held form made, but the recording was not captured', { userId: user.id, formId: form.id }, 'error');
    return { action: 'held', formId: form.id, sessionId: null };
  }
  await Binding.rememberRecording(user.id, sha256, { sessionId: session.id });
  logToFile('🔭 observe2: recording held for its form (record first)', {
    userId: user.id, formId: form.id, sessionId: session.id, durationSeconds, period,
  });
  return { action: 'held', formId: form.id, sessionId: session.id };
}

module.exports = { prefersObserve2, holdRecording };
