'use strict';

/** <coachUserId>:child-test-check:<sessionId> — set by sendCheck, read back by the endpoint and the completion. */
const MARKER = 'child-test-check';

const buildToken = (coachUserId, sessionId) => `${coachUserId}:${MARKER}:${sessionId}`;

function parseToken(flowToken) {
  const [userId, marker, sessionId, ...rest] = String(flowToken || '').split(':');
  if (!userId || marker !== MARKER || !sessionId || rest.length) return null;
  return { userId, sessionId };
}

/** CHILD_TEST_ENABLED=true; anything else leaves the check inert (CONTRACT §6). */
const enabled = () => String(process.env.CHILD_TEST_ENABLED || '').trim().toLowerCase() === 'true';

module.exports = { MARKER, buildToken, parseToken, enabled };
