'use strict';
/**
 * What GET /api/wq/bind/status really answers for each state of a "Keep my place" code, switch web_quiz_bind_way_back
 * off and on. One source for both sides: the bot test (bind-way-back.test.js) proves `status()` gives exactly these for
 * the matching code row, and the page test (dashboard/tests/web-quiz-bind-way-back.service.test.js) feeds them to the
 * page — so the page is never tested against an answer the server cannot send.
 * Keys are the row the binder left: its `outcome` (child-bind-codes.repo OUTCOMES), or `ran_out` (unused, past
 * expires_at), `no_row` (the code is not in the table) and `not_a_code` (fails the JUGNU- pattern).
 */
const OFF = Object.freeze({
  pending: { state: 'pending' },
  bound: { state: 'bound' },
  code_expired: { state: 'expired' },
  ran_out: { state: 'expired' },
  no_row: { state: 'refused', reason: 'code_unknown' },
  not_a_code: { state: 'refused', reason: 'code_unknown' },
  code_used: { state: 'refused', reason: 'code_used' },
  child_unknown: { state: 'refused', reason: 'child_unknown' },
  teacher_phone: { state: 'refused', reason: 'teacher_phone' },
  max_phones: { state: 'refused', reason: 'max_phones' },
  max_kids: { state: 'refused', reason: 'max_kids' },
});
// on: every answer the page can come back from carries `wb`; a live code and a saved place have nothing to come back from
const ON = Object.freeze(Object.fromEntries(Object.entries(OFF).map(([k, v]) => [k, v.state === 'pending' || v.state === 'bound' ? v : { ...v, wb: true }])));

module.exports = { OFF, ON };
