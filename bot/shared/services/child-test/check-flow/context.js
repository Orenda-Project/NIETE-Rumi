'use strict';

/**
 * Child test check Flow — everything one request needs about a session, re-read every
 * time and only for the coach whose token it is.
 */

const Store = require('./check-store');
const { formItems } = require('./items');
const { checkStrings } = require('./strings');
const { parseToken, enabled } = require('./token');

/** How the coach sees the child: the roll number (a name only where L4 passes one, never stored here). */
function whoOf(S, roll, displayName) {
  if (displayName) return String(displayName);
  return S.roll(roll != null ? roll : '—');
}

/** The block's AI state as the screen should name it (CONTRACT §3 ai_status, or no row at all). */
function aiStatusOf(row) {
  if (!row) return 'missing';
  if (row.ai_status) return row.ai_status;
  return row.ai_marks ? 'scored' : 'pending';
}

/**
 * @returns {Promise<null|{session, coach, blocks, items, lang, roll, S}>} null when the check is off,
 *   the token is not one of ours, the session is gone, or it belongs to another coach.
 */
async function loadForToken(flowToken) {
  if (!enabled()) return null;
  const t = parseToken(flowToken);
  if (!t) return null;
  return loadSession(t.sessionId, t.userId);
}

async function loadSession(sessionId, coachUserId) {
  const got = await Store.getSession(sessionId);
  const session = got.ok ? got.session : null;
  if (!session || (coachUserId && session.coach_user_id !== coachUserId)) return null;
  const [coach, blocks, roll] = await Promise.all([
    Store.getCoach(session.coach_user_id),
    Store.getBlocks(session.id),
    Store.getRollNumber(session.draw_id),
  ]);
  const lang = (coach && coach.preferred_language) || 'ur';
  return {
    session,
    coach,
    blocks: blocks.ok ? blocks.blocks : {},
    blocksOk: blocks.ok,
    items: formItems(session.grade, session.form),
    lang,
    roll,
    S: checkStrings(lang),
  };
}

module.exports = { loadForToken, loadSession, whoOf, aiStatusOf };
