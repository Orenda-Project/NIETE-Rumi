'use strict';

/**
 * Child test (EGRA/EGMA five-minute test) — the router entry points (bd-s1oo0.4).
 *
 * Each returns true when the message was the child test's and has been handled, false to let the
 * router carry on exactly as before. Inert unless CHILD_TEST_ENABLED=true, the user is a coach /
 * school leader and in ICT (services/child-test/conversation/gate.js). Voice and images are
 * claimed ONLY in the child test's own Redis state: a voice note while a block waits, an image
 * while a maths strip is pending. Never throws into the router.
 *
 *   handleText(from, body, user)        /egra, /childtest, «بچوں کا ٹیسٹ»; /cancel, /menu while open
 *   handleButton(user, from, buttonId)  ctst_* reply buttons
 *   handleList(user, from, listId)      ctst_* list rows
 *   handleVoice(message, from, user)    one voice note per block
 *   handleImage(message, from, user)    the maths strip photo
 *   sendOffer({ coachUserId, kind, id }) the "Test 5 children now?" offer (conversation/offer.js;
 *                                        observe code requires that module directly, not this one)
 *   recordTiming(sessionId, key, at)     for the check endpoint (check opened / submitted)
 */

const M = require('../services/child-test/conversation/machine');
const { sendOffer } = require('../services/child-test/conversation/offer');
const { logError } = require('../utils/logger');

function guarded(name, fn, onError) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      logError(`child_test.${name}_crashed`, { error: err.message, stack: err.stack });
      return typeof onError === 'function' ? onError(...args) : onError;
    }
  };
}

const ours = (id) => String(id || '').startsWith('ctst_');

module.exports = {
  handleText: guarded('text', M.handleText, false),
  handleButton: guarded('button', M.handleButton, (user, from, id) => ours(id)),
  handleList: guarded('list', M.handleList, (user, from, id) => ours(id)),
  handleVoice: guarded('voice', M.handleVoice, false),
  handleImage: guarded('image', M.handleImage, false),
  sendOffer,
  recordTiming: guarded('timing', M.recordTiming, undefined),
  __drain: M.drain,
};
