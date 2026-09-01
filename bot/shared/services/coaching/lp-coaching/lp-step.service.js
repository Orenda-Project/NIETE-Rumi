'use strict';
/**
 * bd-5azz0 — one shared "land on the lesson-plan step" implementation.
 *
 * Every finish-photos path must end HERE, not at queueAnalysis: the photo-max
 * branches (image webhook Phase 3 + document-as-photo capture) used to jump
 * straight to analysis, so the coach was never asked for the lesson plan and
 * the FICO LP-fidelity section scored on nothing (Toseef, 25-Aug 2026: four
 * 3-photo sessions, zero LP asks, Section B zero). The same module re-prompts
 * when a leader types text while a session waits at awaiting_lesson_plan.
 *
 * Semantics follow the photo_no_/photo_done_ handlers (bd-3ipd2 / bd-9hzdn.3):
 *  - conversation_state is MERGED, never replaced (held photos survive);
 *  - the recent-LP menu belongs to the session OWNER (the observed teacher in
 *    /observe), the language to the TAPPER (the coach);
 *  - list-vs-buttons routing goes through sendLpPrompt (bd-lqpog).
 *
 * Load (pre-merge Class R): two single-row reads + one single-row keyed update
 * per call, fired only on photo-completion / LP-step events — no scans, no fat
 * columns.
 */

const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');

async function _recentLpsFor(ownerUserId) {
  try {
    const { isFidelityEnabled } = require('../fidelity/fidelity-orchestrator');
    if (!isFidelityEnabled() || !ownerUserId) return [];
    const { getRecentFidelityLps } = require('./recent-fidelity-lps.service');
    return await getRecentFidelityLps(ownerUserId);
  } catch (e) {
    logToFile('[lp-fidelity] recent LP fetch failed (Yes/No fallback)', { error: e.message });
    return [];
  }
}

/**
 * Move the session to the lesson-plan step and send the LP selection prompt.
 * Idempotent: safe to call on a session already at awaiting_lesson_plan (the
 * text re-prompt path does exactly that).
 *
 * @param {{ sessionId: string, from: string, tapperUserId: string }} args
 * @returns {Promise<boolean>} true when the prompt went out AND the session was
 *   moved to the lesson-plan step; false when the prompt could not be delivered
 *   (the session is deliberately left where it was).
 */
async function advanceToLessonPlanStep({ sessionId, from, tapperUserId }) {
  const WhatsAppService = require('../../whatsapp.service');
  const { buildLPSelectionList } = require('./lp-selection-list.service');
  const { sendLpPrompt } = require('./send-lp-prompt');

  const { data: session } = await supabase
    .from('coaching_sessions')
    .select('conversation_state, user_id, observation_type')
    .eq('id', sessionId)
    .maybeSingle();

  const { data: userRow } = await supabase
    .from('users')
    .select('preferred_language, region')
    .eq('id', tapperUserId)
    .maybeSingle();
  const lang = (userRow && userRow.preferred_language) || 'en';

  const recents = await _recentLpsFor((session && session.user_id) || tapperUserId);
  const lpPrompt = buildLPSelectionList(sessionId, recents, lang, userRow && userRow.region,
    { isObservation: !!(session && session.observation_type === 'leader_observation') });

  // bd-zrlcp — send FIRST, commit only if the prompt actually went out.
  // sendLpPrompt returns false when the payload was refused (WhatsApp caps an
  // interactive list at 10 rows and our send helper returns false rather than
  // throwing). Committing first parked sessions at a step the user was never
  // shown, and nothing sweeps that status.
  const sent = await sendLpPrompt(WhatsAppService, from, lpPrompt);
  if (!sent) {
    logToFile('⚠️ LP prompt could not be delivered — session left in place', { sessionId, tapperUserId });
    return false;
  }

  await supabase
    .from('coaching_sessions')
    .update({
      conversation_state: {
        ...((session && session.conversation_state) || {}),
        current_state: 'AWAITING_LESSON_PLAN',
      },
      status: 'awaiting_lesson_plan',
    })
    .eq('id', sessionId);

  logToFile('📄 LP step (re)prompted', { sessionId, tapperUserId });
  return true;
}

/**
 * Text-message hook (leaders): if a session this user owns or observes sits at
 * awaiting_lesson_plan and was touched recently, re-send the LP prompt instead
 * of letting the text fall to generic AI chat. The recency guard keeps a
 * days-old wedged row from hijacking normal conversation.
 *
 * @returns {Promise<boolean>} true when the text was consumed (re-prompted)
 */
const LP_REPROMPT_WINDOW_MS = 3 * 60 * 60 * 1000;

async function resendLpPromptIfWaiting(user, from) {
  if (!user || !user.id) return false;
  const { data: lpSession } = await supabase
    .from('coaching_sessions')
    .select('id, updated_at')
    .or(`user_id.eq.${user.id},observer_user_id.eq.${user.id}`)
    .eq('status', 'awaiting_lesson_plan')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lpSession) return false;
  const touched = Date.parse(lpSession.updated_at || '');
  if (Number.isNaN(touched) || Date.now() - touched > LP_REPROMPT_WINDOW_MS) return false;
  await advanceToLessonPlanStep({ sessionId: lpSession.id, from, tapperUserId: user.id });
  return true;
}

module.exports = { advanceToLessonPlanStep, resendLpPromptIfWaiting, LP_REPROMPT_WINDOW_MS };
