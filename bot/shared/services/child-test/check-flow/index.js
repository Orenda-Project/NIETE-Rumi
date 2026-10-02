'use strict';

/**
 * Child test check Flow — what other lanes call.
 *   sendCheck(sessionId, { displayName })        L4, when a child's marks are back
 *   handleCheckCompletion(responseJson, from, user)  the nfm_reply branch in whatsapp-bot.js
 *   isPrefilled(field, confidence), planBlock(block, { aiMarks, coachMarks, items }), formItems(grade, form),
 *   diffMarks(block, ai, coach), prefillMode()   the one prefill rule and the one coach_edits diff; the app
 *                                                channel uses these too, so the two channels cannot drift
 * The endpoint is bot/shared/routes/child-test-check-endpoint.js (POST /api/flows/child-test-check).
 */

const { sendCheck } = require('./send-check');
const { handleCheckCompletion } = require('./completion');
const { buildToken, parseToken, enabled } = require('./token');
const { planBlock, diffMarks } = require('./prefill');
const { confident: isPrefilled, prefillMode } = require('./bars');
const { formItems } = require('./items');

module.exports = {
  sendCheck, handleCheckCompletion, buildToken, parseToken, enabled, isPrefilled, prefillMode, planBlock, formItems, diffMarks,
};
