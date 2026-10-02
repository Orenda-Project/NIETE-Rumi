'use strict';

/**
 * Child test check Flow — the Flow's completion (nfm_reply). The endpoint saved every
 * block as its screen was submitted, so this only confirms in one line; when the session did NOT end
 * up checked (a block without checked_at), the coach is told so (and it is logged as an error) rather than left believing it saved.
 */

const WhatsAppService = require('../../whatsapp.service');
const { logError, logToFile } = require('../../../utils/logger');
const { loadSession, whoOf } = require('./context');
const { parseToken } = require('./token');
const { checkStrings } = require('./strings');

async function handleCheckCompletion(responseJson = {}, from, user) {
  const t = parseToken(responseJson.flow_token);
  if (!t || !user || user.id !== t.userId) {
    logToFile('[child_test] check completion with a token that is not this coach\'s', {}, 'warn');
    return { ok: false };
  }
  const ctx = await loadSession(t.sessionId, t.userId);
  if (!ctx) {
    logToFile('[child_test] check completion for a session this coach does not have', { sessionId: t.sessionId }, 'warn');
    return { ok: false };
  }
  // The webhook's user row is the freshest read of the coach's language.
  const S = user.preferred_language ? checkStrings(user.preferred_language) : ctx.S;
  const who = whoOf(S, ctx.roll);
  // Checked = every block's coach marks are stored (checked_at), whatever the session's status says.
  const checked = ['urdu', 'english', 'maths'].every((b) => ctx.blocks[b] && ctx.blocks[b].checked_at);
  if (!checked) logError('[child_test] check completed but not every block is saved', { sessionId: t.sessionId });
  await WhatsAppService.sendMessage(from, checked ? S.completion_saved(who) : S.completion_not_saved(who));
  return { ok: true, sessionId: t.sessionId, checked };
}

module.exports = { handleCheckCompletion };
