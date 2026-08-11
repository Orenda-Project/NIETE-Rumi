/**
 * dotenv mock for OSS test suite.
 * dotenv is a runtime dependency in bot/node_modules but not the root, and the
 * root test job runs before bot deps install — so source files that require
 * 'dotenv' (bot/shared/config/supabase.js, every worker entry) can't resolve it.
 * This lightweight stub lets them load.
 *
 * Tests must never depend on a real .env being read: the suite sets whatever
 * env it needs in tests/setup.js or per-case. config() is therefore a no-op
 * that reports "nothing parsed" rather than touching the filesystem — which
 * also keeps a developer's local .env from leaking into test expectations.
 */

const config = jest.fn(() => ({ parsed: {} }));
const parse = jest.fn(() => ({}));

module.exports = { config, parse };
module.exports.default = module.exports;
