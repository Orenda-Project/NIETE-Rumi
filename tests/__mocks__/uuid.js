/**
 * uuid stub for the ROOT test suite — bd-4lnru.
 *
 * WHY: `uuid` is a bot-only dependency (`bot/package.json`, ^9.0.1) and CI runs the root
 * `npm test` BEFORE `bot/ npm ci`. Three modules require it at module scope —
 * `feature-registration.service.js:15`, `portal-invite.service.js:14` and
 * `flow-response.handler.js:557` — so any root suite whose chain reaches them died at LOAD
 * with `Cannot find module 'uuid'` rather than on its own assertions. That is exactly the
 * case CLAUDE.md's "bot-only dependencies must be stubbed" rule covers, and uuid was the
 * last unmapped package on the `sqs-worker.js -> lesson-plan-generation.worker.js` chain
 * that the bd-oak77.11 drain suites load.
 *
 * WHY IT RETURNS A REAL v4 AND NOT A FIXED STRING: ids from this module become row keys and
 * flow tokens. A constant would make two "different" registrations collide inside one test
 * and quietly turn an id-uniqueness assertion green for the wrong reason. `crypto.randomUUID`
 * is the same RFC 4122 v4 shape the real package emits, so code that parses or pattern-checks
 * an id behaves identically. A suite that needs a PREDICTABLE id still declares its own
 * `jest.mock('uuid', () => ({ v4: () => 'test-uuid' }))` — an explicit mock takes precedence
 * over moduleNameMapper, and several registration suites already rely on that.
 *
 * Only the surface this repo actually imports is provided (`v4`, plus `validate`/`NIL` for
 * free). Add to it when a caller needs more; do not reach for the real package here.
 */

const crypto = require('crypto');

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const v4 = () => crypto.randomUUID();
const validate = (s) => typeof s === 'string' && V4_RE.test(s);
const NIL = '00000000-0000-0000-0000-000000000000';

module.exports = { v4, validate, NIL };
module.exports.default = module.exports;
