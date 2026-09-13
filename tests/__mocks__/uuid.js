/**
 * uuid stub for the ROOT test suite.
 *
 * WHY A STUB AT ALL: `uuid` is declared in bot/package.json only, and CI runs the root
 * suite BEFORE `bot/ npm ci`. Three modules require it at MODULE SCOPE —
 * `portal-invite.service.js`, `feature-registration.service.js` and (lazily, inside a
 * handler) `flow-response.handler.js` — so every root suite whose chain reaches one of
 * them died on `Cannot find module 'uuid'` instead of on its own assertions. That took
 * out seven suites at once: the two bd-oak77.11 drain guards, both quiz suites, the
 * transcript-quiz router, send-image-from-url, and webhook-ack. It is the exact failure
 * mode every other mapping in tests/jest.config.js exists to prevent.
 *
 * WHY IT IS A REAL v4 RATHER THAN A FIXED STRING: callers use the value as a primary key
 * and as an idempotency token, and at least one suite puts two of them in the same map.
 * A constant would collide and would let a test claim uniqueness it never had. Node's
 * own `crypto.randomUUID()` is a conformant v4, so the stub is the real behaviour with
 * none of the dependency.
 *
 * WHAT IT SUPPORTS: `v4` only — the only export this repo imports (grep `require('uuid')`).
 * Reaching for v1/v3/v5 or `validate` should add them here in the same change, not work
 * around this file.
 */

const { randomUUID } = require('crypto');

function v4() {
  return randomUUID();
}

module.exports = { v4 };
