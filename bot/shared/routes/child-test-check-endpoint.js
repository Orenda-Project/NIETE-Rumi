'use strict';

/**
 * Child test — the check's endpoint (POST /api/flows/child-test-check), bd-s1oo0.6.
 *
 * Token: <coachUserId>:child-test-check:<sessionId>. Every request re-reads the session and checks it
 * belongs to the coach in the token; with CHILD_TEST_ENABLED off nothing is read at all.
 *
 *   INIT                 URDU, pre-filled from the urdu block's ai_marks (or the coach's own saved
 *                        marks, when the check is reopened)
 *   URDU → ENGLISH → MATHS   each footer saves that block's coach_marks + coach_edits at once, so
 *                        closing the Flow halfway loses nothing; a count that does not add up comes
 *                        back on the same screen with a message and nothing is written
 *   MATHS → DONE         the check's end is recorded on the session (timing check.done)
 *
 * Coach marks are written ONCE per block (L3's store and a DB trigger). A block submitted again after
 * its save — the Flow's back button, or a reopened check — goes on when nothing changed, and comes back
 * with the saved marks and a line saying so when something did; it is never silently dropped.
 * ai_marks are never written here (check-store.js has no write for them). A save that fails ends on a
 * "Not saved" screen and an error log, never a silent success.
 */

const FlowEncryptionService = require('../services/flow-encryption.service');
const { renderScreen, readScreen, diffMarks, SCREEN_OF } = require('../services/child-test/check-flow/prefill');
const Store = require('../services/child-test/check-flow/check-store');
const { loadForToken, whoOf, aiStatusOf } = require('../services/child-test/check-flow/context');
const { checkStrings } = require('../services/child-test/check-flow/strings');
const { parseToken } = require('../services/child-test/check-flow/token');
const { logToFile, logError } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');

const BLOCKS = ['urdu', 'english', 'maths'];
const BLOCK_OF = Object.fromEntries(Object.entries(SCREEN_OF).map(([b, s]) => [s, b]));
// Nobody's check: Urdu, the default this deployment offers.
const NOBODY_LANG = 'ur';

function screenFor(ctx, block, extra = {}) {
  const row = ctx.blocks[block] || null;
  return renderScreen(block, {
    aiMarks: (row && row.ai_marks) || null,
    coachMarks: (row && row.coach_marks) || null,
    items: ctx.items,
    lang: ctx.lang,
    child: { label: ctx.S.child_line(whoOf(ctx.S, ctx.roll), ctx.session.grade) },
    aiStatus: aiStatusOf(row),
    ...extra,
  });
}

function doneScreen(S, lines, sessionId = '') {
  return { screen: 'DONE', data: { ...lines, done_button: S.done_button, session_id: String(sessionId || '') } };
}
const notAvailable = (S) => doneScreen(S, { done_line: S.not_available_title, next_line: S.status_unavailable });
const notSaved = (S, sessionId) => doneScreen(S, { done_line: S.not_saved_title, next_line: S.not_saved_next }, sessionId);

async function handleChildTestCheckInit(flowToken) {
  const ctx = await loadForToken(flowToken);
  if (!ctx) {
    logToFile('[child_test] check opened with a token that matches no session of this coach', { known: Boolean(parseToken(flowToken)) }, 'warn');
    // INIT may only answer with the entry screen: an empty one the coach can close.
    return renderScreen('urdu', { unavailable: true, lang: NOBODY_LANG });
  }
  logEvent('child_test.check_opened', { sessionId: ctx.session.id });
  return screenFor(ctx, 'urdu');
}

async function handleChildTestCheckDataExchange(flowToken, screen, screenData = {}) {
  const step = (screenData && screenData.screen) || screen;
  const ctx = await loadForToken(flowToken);
  if (!ctx) return notAvailable(checkStrings(NOBODY_LANG));
  const block = BLOCK_OF[step];
  if (!block) {
    logToFile('[child_test] unknown screen in the check', { screen: step, sessionId: ctx.session.id }, 'warn');
    return screenFor(ctx, 'urdu');
  }
  if (!ctx.blocksOk) return notSaved(ctx.S, ctx.session.id);

  const row = ctx.blocks[block] || null;
  const read = readScreen(block, screenData, {
    aiMarks: (row && row.ai_marks) || null,
    coachMarks: (row && row.coach_marks) || null,
    items: ctx.items,
    lang: ctx.lang,
  });
  if (!read.ok) return screenFor(ctx, block, { posted: screenData, errors: read.errors });

  const saved = await Store.saveCoachBlock(ctx.session.id, block, { coachMarks: read.coachMarks, coachEdits: read.edits, rowExists: Boolean(row) });
  if (!saved.ok && saved.alreadyChecked) {
    const kept = (saved.block && saved.block.coach_marks) || (row && row.coach_marks) || null;
    if (kept && diffMarks(block, kept, read.coachMarks).length) {
      logEvent('child_test.check_block_locked', { sessionId: ctx.session.id, block });
      ctx.blocks[block] = { ...(row || {}), ...(saved.block || {}), coach_marks: kept };
      return screenFor(ctx, block, { status: 'status_locked' });
    }
  } else if (!saved.ok) {
    logError('[child_test] check: a block was not saved', { sessionId: ctx.session.id, block });
    return notSaved(ctx.S, ctx.session.id);
  } else {
    logEvent('child_test.check_block_saved', {
      sessionId: ctx.session.id, block, edits: read.edits.length, shownEmpty: read.coachMarks.meta.shown_empty.length,
    });
  }

  const next = BLOCKS[BLOCKS.indexOf(block) + 1];
  if (next) return screenFor(ctx, next);

  const checked = await Store.markCheckDone(ctx.session.id);
  if (!checked.ok) {
    logError('[child_test] check: blocks saved but the end of the check was not recorded', { sessionId: ctx.session.id });
    return notSaved(ctx.S, ctx.session.id);
  }
  logEvent('child_test.check_done', { sessionId: ctx.session.id });
  return doneScreen(ctx.S, { done_line: ctx.S.done_saved, next_line: ctx.S.done_next(whoOf(ctx.S, ctx.roll)) }, ctx.session.id);
}

/** The decrypted request → the screen to send back (the route encrypts it). */
async function handleChildTestCheckFlow(data) {
  const { action, flow_token: flowToken, screen, data: screenData } = data || {};
  if (action === 'ping') return FlowEncryptionService.handlePing();
  if (action === 'INIT' || action === 'init') return handleChildTestCheckInit(flowToken);
  if (action === 'data_exchange') return handleChildTestCheckDataExchange(flowToken, screen, screenData || {});
  logToFile('Unknown child-test-check flow action', { action }, 'warn');
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

module.exports = {
  handleChildTestCheckInit,
  handleChildTestCheckDataExchange,
  handleChildTestCheckFlow,
};
