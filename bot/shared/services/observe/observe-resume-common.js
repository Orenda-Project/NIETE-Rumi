/**
 * bd-i3618q — helpers shared by observe-resume.service.js and observe-resume-retry.js,
 * moved verbatim out of observe-resume.service.js to keep it under 300 lines.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { observeLang } = require('./observe-strings');
const { resolveUx } = require('../../config/ux-strings');
const { logToFile } = require('../../utils/logger');

async function _loadOwn(sessionId, user) {
  const { data: s } = await supabase
    .from('coaching_sessions')
    .select('id, status, created_at, updated_at, user_id, observer_user_id, analysis_data, transcript_text, conversation_state, audio_id, framework')
    .eq('id', sessionId)
    .maybeSingle();
  if (!s || s.observer_user_id !== user.id) return null;
  return s;
}

/** One refusal for a tap that arrives after the observation is over. */
async function _refuseTerminal(s, from, user, tap) {
  await WhatsAppService.sendMessage(from, resolveUx('coachingSessionCancelled', { language: observeLang(user) }));
  logToFile('🚫 observe-resume: tap refused — the observation is over', { sessionId: s.id, status: s.status, tap });
}

async function _sendButtons(from, body, buttons) {
  return WhatsAppService.sendInteractiveButtons(from, { body, buttons: buttons.slice(0, 3) });
}

module.exports = { _loadOwn, _refuseTerminal, _sendButtons };
