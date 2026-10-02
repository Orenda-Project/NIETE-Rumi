'use strict';

/**
 * Child test — the one reader and writer of child_test_draws, child_test_sessions and
 * child_test_blocks (migration V1.5.9). STUB: signatures fixed (see lanes/L3/STORE_API.md);
 * implementation follows on this branch.
 */

const notYet = async () => ({ ok: false, error: 'not_implemented' });

module.exports = {
  createSession: notYet,
  getSession: notYet,
  getSessionByDraw: notYet,
  listSessionsForVisit: notYet,
  setSessionStatus: notYet,
  recordTiming: notYet,
  attachBlockMedia: notYet,
  getBlock: notYet,
  listBlocks: notYet,
  setAiStatus: notYet,
  saveAiMarks: notYet,
  saveCoachMarks: notYet,
};
