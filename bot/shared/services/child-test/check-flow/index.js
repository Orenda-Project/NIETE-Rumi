'use strict';

/**
 * Child test check Flow (bd-s1oo0.6) — what other lanes call.
 *   sendCheck(sessionId, { displayName })        L4, when a child's marks are back
 *   handleCheckCompletion(responseJson, from, user)  the nfm_reply branch in whatsapp-bot.js
 * The endpoint is bot/shared/routes/child-test-check-endpoint.js (POST /api/flows/child-test-check).
 */

const { sendCheck } = require('./send-check');
const { handleCheckCompletion } = require('./completion');
const { buildToken, parseToken, enabled } = require('./token');

module.exports = { sendCheck, handleCheckCompletion, buildToken, parseToken, enabled };
