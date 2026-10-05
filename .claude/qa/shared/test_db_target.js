#!/usr/bin/env node
/* test_db_target.js — which database does the Node harness write to? (bd-z3ze4)
 *
 * Run: node .claude/qa/shared/test_db_target.js
 *
 * The harness (mock-api setUser/setRoster/clearRoster, feature-runner's identity snapshot, child-test)
 * used to read NIETE_SANDBOX_SUPABASE_* directly. On a run with its own local database (E2E_LOCAL_DB=1 →
 * E2E_ENV=local) that wrote the driver's role to the SANDBOX while the bot read the local DB: menu
 * M14/M15/M17/M19 failed and the sandbox driver row was changed mid-run.
 *
 * Red-first: fails before db-target.cjs exists.
 */
const assert = require('assert');
const path = require('path');

const { dbCreds } = require(path.join(__dirname, 'db-target.cjs'));
const SBX = { NIETE_SANDBOX_SUPABASE_URL: 'https://olvritwoqujtjvwfulbh.supabase.co', NIETE_SANDBOX_SUPABASE_SERVICE_ROLE_KEY: 'sk' };
const LOC = { NIETE_LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321', NIETE_LOCAL_SUPABASE_SERVICE_ROLE_KEY: 'lk' };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

t('default (no E2E_ENV) is the sandbox, as before', () => {
  assert.deepStrictEqual(dbCreds({ ...SBX }), { url: SBX.NIETE_SANDBOX_SUPABASE_URL, key: 'sk', kind: 'sandbox' });
});
t('E2E_ENV=sandbox is the sandbox', () => {
  assert.strictEqual(dbCreds({ ...SBX, ...LOC, E2E_ENV: 'sandbox' }).kind, 'sandbox');
});
t('E2E_ENV=local is the run\'s local database', () => {
  assert.deepStrictEqual(dbCreds({ ...SBX, ...LOC, E2E_ENV: 'local' }), { url: 'http://127.0.0.1:54321', key: 'lk', kind: 'local' });
});
t('E2E_ENV=local NEVER falls back to the sandbox when the local creds are missing', () => {
  const c = dbCreds({ ...SBX, E2E_ENV: 'local' });
  assert.strictEqual(c.url, null); assert.strictEqual(c.key, null); assert.strictEqual(c.kind, 'local');
});
t('E2E_ENV=local refuses a non-localhost URL', () => {
  const c = dbCreds({ ...SBX, E2E_ENV: 'local', NIETE_LOCAL_SUPABASE_URL: 'https://olvritwoqujtjvwfulbh.supabase.co', NIETE_LOCAL_SUPABASE_SERVICE_ROLE_KEY: 'lk' });
  assert.strictEqual(c.url, null);
});
t('a trailing slash is trimmed', () => {
  assert.strictEqual(dbCreds({ ...LOC, NIETE_LOCAL_SUPABASE_URL: 'http://localhost:54321/', E2E_ENV: 'local' }).url, 'http://localhost:54321');
});
console.log(`\ndb-target: ${n} passed`);
