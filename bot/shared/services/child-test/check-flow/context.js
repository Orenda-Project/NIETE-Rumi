'use strict';

/**
 * Child test check Flow — everything one request needs about a session, re-read every
 * time and only for the coach whose token it is.
 */

const Store = require('./check-store');
const { formItems } = require('./items');
const { checkStrings } = require('./strings');
const { parseToken, enabled } = require('./token');
const { childLabel } = require('../conversation/identity');

/** The coach's language for a child label: NIETE offers exactly en and ur. */
const labelLang = (lang) => (lang === 'en' ? 'en' : 'ur');

/**
 * How the coach sees the child (CONTRACT §18): full name first, the roll as a hint, null-safe.
 * @param {{child?: object, lang?: string}} ctx  a loaded session
 * @param {string} [lang] overrides ctx.lang (the completion reads the webhook's fresher language)
 */
function whoOf(ctx, lang) {
  return childLabel(labelLang(lang || (ctx && ctx.lang)), (ctx && ctx.child) || {});
}

/** The block's AI state as the screen should name it (CONTRACT §3 ai_status, or no row at all). */
function aiStatusOf(row) {
  if (!row) return 'missing';
  if (row.ai_status) return row.ai_status;
  return row.ai_marks ? 'scored' : 'pending';
}

/**
 * @returns {Promise<null|{session, coach, blocks, items, lang, child, roll, S}>} null when the check is off,
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
  const [coach, blocks, child] = await Promise.all([
    Store.getCoach(session.coach_user_id),
    Store.getBlocks(session.id),
    Store.getChild(session),
  ]);
  const lang = (coach && coach.preferred_language) || 'ur';
  return {
    session,
    coach,
    blocks: blocks.ok ? blocks.blocks : {},
    blocksOk: blocks.ok,
    items: formItems(session.grade, session.form),
    lang,
    child,
    roll: child.rollNumber,
    S: checkStrings(lang),
  };
}

module.exports = { loadForToken, loadSession, whoOf, aiStatusOf };
