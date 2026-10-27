'use strict';
/**
 * Round 7b (sa_end_test_restart): the rows of a restarted child's ended attempt, set aside on the same session (one session
 * per drawn child). A set-aside row keeps a VALID block name (the live CHECK child_test_blocks_block_check wants
 * ^[a-z]{2}\.[a-z0-9_]{1,40}$) under a prefix no battery task has: zz.r<attempt>_<task id with . as _>. Every reader of a
 * session's tasks (Results / dashboard, the review page, the scorer's asked questions, the visit bar) leaves them out.
 */
const crypto = require('crypto');

const SET_ASIDE = /^zz\.r(\d+)_/;
const MAX = 40;

function setAsideName(attempt, block) {
  const id = String(block).replace(/\./g, '_');
  let tail = `r${attempt}_${id}`;
  if (tail.length > MAX) tail = `${tail.slice(0, MAX - 7)}_${crypto.createHash('sha1').update(String(block)).digest('hex').slice(0, 6)}`;
  return `zz.${tail}`;
}
const isSetAside = (block) => SET_ASIDE.test(String(block || ''));
const attemptOf = (block) => Number((SET_ASIDE.exec(String(block || '')) || [])[1] || 0);

module.exports = { SET_ASIDE, setAsideName, isSetAside, attemptOf };
