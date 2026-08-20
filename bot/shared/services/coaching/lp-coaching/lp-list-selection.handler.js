'use strict';
/**
 * Route an LP-selection LIST tap to the linker and continue the coaching flow
 * (bd-wa5io).
 *
 * The LP-selection menu's row ids are emitted by lp-selection-list.service.js:
 *   lp_select_{assetId}_{sessionId}  — link a recent corpus LP (fidelity ref)
 *   lp_upload_{sessionId}            — teacher will send her own document
 *   lp_none_{sessionId}              — continue without an LP
 *
 * The linker (handleLPSelection) does the DB linking; this handler owns the
 * CONTINUATION the buttons path got from handleLessonPlanResponse and the list
 * path never had — tell the teacher what happens next, and queue the analysis
 * where the flow proceeds. Without it a tap updated nothing and the session
 * hung at awaiting_lesson_plan.
 */
const { logToFile } = require('../../../utils/logger');

const LP_ID_RE = /^lp_(select|upload|none)_/;

// sessionId is always the LAST underscore-separated UUID; asset ids can contain
// underscores in principle, so take the trailing 36-char UUID.
function sessionIdFrom(listId) {
  const m = listId.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1] : null;
}

async function handleLpListSelection(listId, from, deps = {}) {
  if (!LP_ID_RE.test(listId || '')) return false;

  const linker = deps.linker || require('./lp-coaching-linker.service');
  const sendMessage = deps.sendMessage
    || ((to, text) => require('../../whatsapp.service').sendMessage(to, text));
  const queueAnalysis = deps.queueAnalysis
    || ((sid, payload) => require('../coaching-job-queue.service').queueAnalysis(sid, payload));
  const resolveLanguage = deps.resolveLanguage
    || (async (sid) => {
      try {
        const supabase = require('../../../config/supabase');
        const { data } = await supabase
          .from('coaching_sessions')
          .select('observation_type, observer_user_id, users:users(preferred_language)')
          .eq('id', sid)
          .maybeSingle();
        // bd-9hzdn.3: in a leader observation the COACH is the one tapping —
        // reply in the observer's language, not the observed teacher's.
        if (data && data.observation_type === 'leader_observation' && data.observer_user_id) {
          const { data: obs } = await supabase
            .from('users')
            .select('preferred_language')
            .eq('id', data.observer_user_id)
            .maybeSingle();
          if (obs && obs.preferred_language) return obs.preferred_language;
        }
        return (data && data.users && data.users.preferred_language) || 'en';
      } catch (_) { return 'en'; }
    });
  const { getCoachingMessage } = deps.messages || require('../../../config/coaching-messages');

  const sessionId = sessionIdFrom(listId);
  if (!sessionId) {
    logToFile('[lp-list] tap had no session id — ignoring', { listId });
    return false;
  }
  const lang = await resolveLanguage(sessionId);

  let result = null;
  try {
    result = await linker.handleLPSelection(sessionId, listId);
  } catch (err) {
    // NEVER leave the teacher silent: degrade to the no-LP path so the flow finishes.
    logToFile('[lp-list] linker failed — degrading to no-LP continuation', { listId, error: err.message });
    await sendMessage(from, getCoachingMessage('lessonPlan_skip', lang));
    await queueAnalysis(sessionId, { from });
    return true;
  }

  if (result && result.awaiting_upload) {
    // "Upload new": ask for the document; the document handler continues the flow.
    await sendMessage(from, getCoachingMessage('lessonPlan_request', lang));
    return true;
  }

  if (result && result.lesson_plan_link_method === 'selected_recent') {
    await sendMessage(from, getCoachingMessage('lessonPlan_linked', lang));
    await queueAnalysis(sessionId, { from });
    return true;
  }

  // none (or an unresolvable selection that fell back to none)
  await sendMessage(from, getCoachingMessage('lessonPlan_skip', lang));
  await queueAnalysis(sessionId, { from });
  return true;
}

module.exports = { handleLpListSelection, sessionIdFrom };
