/**
 * Coaching Card Response Service
 *
 * Handles teacher button responses to the coaching card.
 * Stores response in coaching_sessions.prioritized_action.
 *
 * Bead: (Phase 1C-C)
 */

const supabase = require('../../../config/supabase');
const WhatsAppService = require('../../whatsapp.service');
const { resolveUx } = require('../../../config/ux-strings');
const { logToFile } = require('../../../utils/logger');
const { reactInstead } = require('../ack-reaction');

// `card_<yes|later|no>_<session uuid>` — the ids report-generator sends with the
// commit prompt. Anchored: a foreign prefix or a non-uuid tail is not ours.
const BUTTON_RX = /^card_(yes|later|no)_([0-9a-fA-F-]{36})$/;
const ACK_KEY = { yes: 'coachingCardAckYes', later: 'coachingCardAckLater', no: 'coachingCardAckNo' };

/**
 * Handle a coaching card button response.
 *
 * @param {string} coachingSessionId - Session UUID
 * @param {string} response - Button response: 'yes' | 'later' | 'no'
 * @returns {Promise<{ teacher_response: string, responded_at: string }>}
 */
async function handleCoachingCardResponse(coachingSessionId, response) {
  const responseData = {
    teacher_response: response,
    responded_at: new Date().toISOString(),
  };

  try {
    // Merge response into existing prioritized_action JSONB
    const { data: session } = await supabase
      .from('coaching_sessions')
      .select('prioritized_action')
      .eq('id', coachingSessionId)
      .single();

    const existingAction = session?.prioritized_action || {};
    const updated = { ...existingAction, ...responseData };

    await supabase
      .from('coaching_sessions')
      .update({ prioritized_action: updated })
      .eq('id', coachingSessionId);

    logToFile('Coaching card response recorded', {
      coachingSessionId,
      response,
    });
  } catch (error) {
    logToFile('Error storing coaching card response', {
      error: error.message,
      coachingSessionId,
    });
  }

  return responseData;
}

/**
 * Router entry for a commitment-card button tap. Returns true when this service
 * owned the tap (recorded + acknowledged), false when the id is not ours so the
 * caller can keep dispatching. The buttons were sent after every self-serve
 * report and registered nowhere before this — every tap was silently lost.
 *
 * @param {string} buttonId - interactive button id
 * @param {string} phone - the teacher's WhatsApp number
 * @param {string} [language] - the teacher's preferred_language (catalog-clamped)
 * @param {string} [inboundMessageId] - the tap's wamid (Meta bill cut N2-C11)
 */
async function handleCardButton(buttonId, phone, language, inboundMessageId = null) {
  const m = BUTTON_RX.exec(typeof buttonId === 'string' ? buttonId : '');
  if (!m) return false;
  const [, response, coachingSessionId] = m;
  await handleCoachingCardResponse(coachingSessionId, response);
  // Meta bill cut (N2-C11): the answer is recorded above; the acknowledgement is a
  // free ✅ reaction on their tap instead of a billed text (~1,500 taps a week once
  // this handler reaches production). No wamid, or a reaction the pacer skipped →
  // the text ack, exactly as before.
  const reacted = await reactInstead({ to: phone, messageId: inboundMessageId, emoji: '✅' });
  if (!reacted) await WhatsAppService.sendMessage(phone, resolveUx(ACK_KEY[response], { language }));
  return true;
}

module.exports = { handleCoachingCardResponse, handleCardButton, BUTTON_RX };
