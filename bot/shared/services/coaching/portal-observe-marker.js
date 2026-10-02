'use strict';
/**
 * Is a coaching session a coach's PORTAL observation? For the failure paths that
 * hold only an id: one narrow read (two scalar columns, never analysis_data),
 * and any failure answers false — so a lookup problem can only ever mean the
 * coach is told on WhatsApp as before, never that a teacher is left unnotified.
 */
const { isPortalObservation } = require('./portal-coaching.service');

async function isPortalObservationId(supabase, coachingSessionId) {
  if (!coachingSessionId) return false;
  try {
    const { data } = await supabase
      .from('coaching_sessions')
      .select('observation_type, audio_url')
      .eq('id', coachingSessionId)
      .maybeSingle();
    return isPortalObservation(data);
  } catch (_) {
    return false;
  }
}

module.exports = { isPortalObservationId };
