'use strict';
/**
 * One owner for "this observation is over."
 *
 * A cancelled observation was revived by any button that had already been sent
 * before the cancel: the photo gate's No / Done, the lesson-plan Yes / No, the
 * LP list, Continue, the retry tap, the debrief entry — and by the analysis job
 * and two sweeps. Each of those paths resolves its own session from the id
 * inside the button and wrote without ever reading `status`, so a coach who
 * cancelled an observation and then tapped a message from ten seconds earlier
 * was asked for a lesson plan for a session that no longer existed to her.
 *
 * The statuses themselves were already correct in three places and duplicated
 * in each (the Flow endpoint, the draft write, the cancel ack). They live here
 * now, with the PostgREST filter spelled once so a write predicate and an
 * in-process check can never drift apart.
 */

/** Statuses past which an observation must not be advanced or re-entered. */
const TERMINAL_STATUSES = ['cancelled', 'abandoned'];

/** The same set as a PostgREST `.not('status', 'in', …)` argument. */
const TERMINAL_IN_FILTER = `(${TERMINAL_STATUSES.join(',')})`;

/**
 * @param {string|null|undefined} status a coaching_sessions.status
 * @returns {boolean} true when the session is over and nothing may advance it
 */
function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(String(status || ''));
}

/**
 * Refuse a tap that arrives for an observation that is already over.
 *
 * Every late-tap path had its own copy of "read the status, send a sentence,
 * log, stop" — and the two that did NOT have a copy are exactly the two that
 * revived a cancelled observation (`photo_yes_`, `coaching_finish_`). One
 * owner now holds it, so a new tap handler gets the behaviour by calling this
 * rather than by remembering to re-implement it.
 *
 * Requires are lazy on purpose: this module is a leaf that the WhatsApp and
 * supabase graphs themselves reach, and a top-level require here would close a
 * cycle.
 *
 * @param {{ sessionId: string, from: string, language?: string, tap: string }} args
 * @returns {Promise<boolean>} true when the tap was refused and nothing was written
 */
async function refuseTapIfTerminal({ sessionId, from, language, tap }) {
  const supabase = require('../../config/supabase');
  const { data } = await supabase
    .from('coaching_sessions')
    .select('status')
    .eq('id', sessionId)
    .maybeSingle();
  if (!data || !isTerminalStatus(data.status)) return false;

  const WhatsAppService = require('../whatsapp.service');
  const { resolveUx, clampLanguage } = require('../../config/ux-strings');
  const { logToFile } = require('../../utils/logger');
  // clampLanguage is the catalog's own floor (Rule 20) — never an inline || 'en'.
  await WhatsAppService.sendMessage(from, resolveUx('coachingSessionCancelled', { language: clampLanguage(language) }));
  logToFile(`\u{1F6AB} ${tap} refused \u2014 the observation is over`, { sessionId, status: data.status });
  return true;
}

/**
 * Write to a session ONLY while it is not terminal, in one statement, so an
 * in-process check and the write cannot drift apart across an await.
 *
 * The refusal rule is #1008's, deliberately: refuse only on an explicit "no
 * rows matched". An error, or a client that does not hand back a list, counts
 * as applied — the caller's own read already catches the ordinary cancel, and a
 * coach must not lose her session to an ambiguous write result.
 *
 * @param {string} sessionId
 * @param {object} fields
 * @returns {Promise<{applied: boolean, ambiguous: boolean, error: string|null}>}
 */
async function updateIfNotTerminal(sessionId, fields) {
  const supabase = require('../../config/supabase');
  const { data, error } = await supabase
    .from('coaching_sessions')
    .update(fields)
    .eq('id', sessionId)
    .not('status', 'in', TERMINAL_IN_FILTER)
    .select('id');
  if (error) return { applied: true, ambiguous: true, error: error.message };
  if (Array.isArray(data) && data.length === 0) return { applied: false, ambiguous: false, error: null };
  return { applied: true, ambiguous: !Array.isArray(data), error: null };
}

module.exports = {
  TERMINAL_STATUSES,
  TERMINAL_IN_FILTER,
  isTerminalStatus,
  refuseTapIfTerminal,
  updateIfNotTerminal,
};
