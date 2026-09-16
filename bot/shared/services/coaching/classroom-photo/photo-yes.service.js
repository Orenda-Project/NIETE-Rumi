'use strict';
/**
 * bd-n9832 — the photo question's "Yes" (`photo_yes_`).
 *
 * The photo gate offers "Yes" / "No". #1008 routed **No** (and Done) through
 * the guarded `advanceToLessonPlanStep`, but "Yes" kept its own inline copy of
 * the read, the write and the send inside whatsapp-bot.js — and that copy never
 * read `status`. So on staging (16 Sep 2026, observation d628d9e3) the coach
 * cancelled the observation at 01:31:46Z, tapped the gate's still-live "Yes" at
 * 01:36:33Z, and the row went `cancelled` -> `awaiting_classroom_photo`: the
 * observation came back into her worklist as "Complete the form — 1 to finish".
 * Her "No" tap on the very same message had correctly refused.
 *
 * The tap lives here rather than in the webhook for the same two reasons
 * add-another.service does: the write goes through ONE terminal-guarded owner,
 * and the body can be executed by a test — a branch inside a 2,700-line express
 * entry point is reachable only by driving a real webhook.
 *
 * Load: one keyed single-row read, one keyed single-row predicated update, one
 * language read per tap. No scans.
 */

const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');
const { resolveUx, clampLanguage } = require('../../../config/ux-strings');
const { refuseTapIfTerminal, updateIfNotTerminal } = require('../session-terminal');

/** The TAPPER's language — read from preferred_language, never user.language (Rule 20). */
async function tapperLanguage(userId, fallback) {
  if (!userId) return clampLanguage(fallback);
  const { data } = await supabase
    .from('users')
    .select('preferred_language')
    .eq('id', userId)
    .maybeSingle();
  return clampLanguage((data && data.preferred_language) || fallback);
}

/**
 * `photo_yes_<sessionId>` — "Yes, I'll send a photo".
 *
 * @param {{ sessionId: string, from: string, tapperUserId: string|null }} args
 * @returns {Promise<boolean>} true when the session was moved onto the photo step
 */
async function advanceToClassroomPhotoStep({ sessionId, from, tapperUserId }) {
  const WhatsAppService = require('../../whatsapp.service');
  if (!sessionId) return false;

  const lang = await tapperLanguage(tapperUserId);

  // A gate sent before the cancel is still tappable. Say what happened rather
  // than going silent: the tap came from a message that still looks live.
  if (await refuseTapIfTerminal({ sessionId, from, language: lang, tap: 'photo step' })) return false;

  const { data: session } = await supabase
    .from('coaching_sessions')
    .select('conversation_state')
    .eq('id', sessionId)
    .maybeSingle();

  // bd-3ipd2: MERGE conversation_state (don't clobber existing fields).
  // The predicate closes the window the read above cannot: a cancel that lands
  // between them must not be overwritten by this tap.
  const { applied } = await updateIfNotTerminal(sessionId, {
    conversation_state: {
      ...((session && session.conversation_state) || {}),
      current_state: 'AWAITING_CLASSROOM_PHOTO',
    },
    status: 'awaiting_classroom_photo',
  });
  if (!applied) {
    await WhatsAppService.sendMessage(from, resolveUx('coachingSessionCancelled', { language: lang }));
    logToFile('🚫 photo step refused — the observation went over mid-tap', { sessionId });
    return false;
  }

  // R165: the tap names the observation — remember it so the photo that follows
  // binds HERE, not to the coach's newest session.
  try {
    await require('../media-target.service').setTarget(tapperUserId, sessionId, 'photo');
  } catch (targetErr) {
    logToFile('⚠️ media-target: could not record photo target (non-fatal)', { sessionId, error: targetErr.message });
  }

  logToFile('📸 User will send classroom photo', { sessionId, from });
  // bd-8s2xb — board first; the scorer reads what is written on it (catalog string, Rule 20).
  await WhatsAppService.sendMessage(from, resolveUx('coachingPhotoSendNow', { language: lang }));
  return true;
}

module.exports = { advanceToClassroomPhotoStep };
