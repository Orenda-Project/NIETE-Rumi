'use strict';

/**
 * Child test check Flow — the "Check" message L4 sends when a child's marks are back:
 * a Flow message with the child, the three headline numbers, and «جانچ کریں». It opens in
 * data_exchange mode (a flow token, no screen), so Meta calls the endpoint's INIT for screen 1.
 */

const WhatsAppService = require('../../whatsapp.service');
const { logError } = require('../../../utils/logger');
const { logEvent } = require('../../../utils/structured-logger');
const { loadSession, whoOf } = require('./context');
const { buildToken, enabled } = require('./token');

const clip = (s, n) => [...String(s)].slice(0, n).join('');
const marksOf = (row) => (row ? row.coach_marks || row.ai_marks || null : null);

function headline(S, blocks) {
  const reading = (row) => {
    const m = marksOf(row);
    if (m && m.story && m.story.words_correct != null) return S.words_line(m.story.words_correct);
    if (m && m.fallback && m.fallback.letters) return S.letters_line(m.fallback.letters.correct);
    return S.not_marked;
  };
  const m = marksOf(blocks.maths);
  const qs = m && m.maths && m.maths.quick_sums;
  return {
    urdu: reading(blocks.urdu),
    english: reading(blocks.english),
    maths: qs && qs.correct != null ? S.sums_line(qs.correct) : S.not_marked,
  };
}

/**
 * @param {string} sessionId
 * @param {{displayName?: string}} [opts] the child's name as the coach knows it — shown to the coach
 *   in the header only, never logged
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
async function sendCheck(sessionId, { displayName } = {}) {
  if (!enabled()) return { ok: false, reason: 'disabled' };
  const flowId = process.env.CHILD_TEST_CHECK_FLOW_ID;
  if (!flowId) {
    logError('[child_test] check not sent: CHILD_TEST_CHECK_FLOW_ID is not set', { sessionId });
    return { ok: false, reason: 'flow_not_configured' };
  }
  const ctx = await loadSession(sessionId);
  if (!ctx) return { ok: false, reason: 'no_session' };
  if (!ctx.coach || !ctx.coach.phone_number) {
    logError('[child_test] check not sent: the coach has no phone number', { sessionId });
    return { ok: false, reason: 'no_coach' };
  }
  const { S } = ctx;
  const who = whoOf(S, ctx.roll, displayName);
  const sent = await WhatsAppService.sendFlow(ctx.coach.phone_number, {
    flowId,
    header: clip(S.check_header(who), 60),
    body: clip(S.check_body({ who, ...headline(S, ctx.blocks) }), 1024),
    buttonText: S.check_cta,
    flowToken: buildToken(ctx.session.coach_user_id, ctx.session.id),
  });
  if (!sent) {
    logError('[child_test] check not sent: WhatsApp refused the Flow message', { sessionId });
    return { ok: false, reason: 'send_failed' };
  }
  logEvent('child_test.check_sent', { sessionId });
  return { ok: true };
}

module.exports = { sendCheck, headline };
