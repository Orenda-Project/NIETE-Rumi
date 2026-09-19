// test_tenant_cjs.js — tenant.cjs against a fixture (bd-9157r). No bot seams needed, so it runs anywhere.
//   E2E_FIXTURE=<dir> E2E_FIXTURE_SHAPE=niete|rumi node .claude/qa/engine/bin/test_tenant_cjs.js
const assert = require('assert');
const path = require('path');
const FIX = process.env.E2E_FIXTURE;
const SHAPE = process.env.E2E_FIXTURE_SHAPE;
if (!FIX || !SHAPE) { console.error('test_tenant_cjs: set E2E_FIXTURE and E2E_FIXTURE_SHAPE'); process.exit(2); }

process.env.CLAUDE_PROJECT_DIR = FIX;
const { load, findRoot } = require(path.join(__dirname, 'tenant.cjs'));
const T = load();

assert.strictEqual(T.root, FIX, 'root is the fixture (CLAUDE_PROJECT_DIR wins)');
assert.strictEqual(findRoot('/'), FIX, 'findRoot honours CLAUDE_PROJECT_DIR');
assert.strictEqual(T.driversDir, path.join('.claude', 'qa', 'shared', 'features'), 'drivers_dir default');
assert.strictEqual(T.agentsDir, path.join('.claude', 'qa', 'agents'), 'agents_dir default');
assert.strictEqual(T.tool('training_db'), null, 'unconfigured tool → null, never a path');
assert.throws(() => T.tenant('zz'), /unknown tenant zz/);
const e = T.dbEnv();
assert.ok(e.prefix.endsWith('_SUPABASE'), 'db prefix: ' + e.prefix);

if (SHAPE === 'niete') {
  assert.strictEqual(T.command, '/niete-e2e');
  assert.strictEqual(T.botRoot, 'bot', 'bot_root default');
  assert.strictEqual(T.e2eScripts, path.join('bot', 'scripts', 'e2e'), 'e2e_scripts default under bot_root');
  assert.deepStrictEqual(T.tenantIds(), ['niete']);
  assert.strictEqual(T.multi, false);
  assert.strictEqual(T.defaultTenant().id, 'niete');
  assert.strictEqual(T.defaultTenant().driver, '923000000001');
  assert.strictEqual(e.prefix, 'NIETE_SANDBOX_SUPABASE');
} else {
  assert.strictEqual(T.command, '/rumi-e2e');
  assert.strictEqual(T.botRoot, '.', 'main bot runtime is the repo root');
  assert.strictEqual(T.e2eScripts, path.join('scripts', 'e2e'));
  assert.deepStrictEqual(T.tenantIds(), ['pk', 'tz', 'ye', 'ps', 'ke']);
  assert.strictEqual(T.multi, true);
  assert.strictEqual(T.tenant('tz').phone_number_id, '1136440339547203');
  assert.strictEqual(T.tenant('ye').chrome, null);
  assert.deepStrictEqual(T.tenant('tz').copy, {}, 'no copy.yaml → {}');
  assert.strictEqual(T.defaultTenant().id, 'pk', 'first tenant when E2E_TENANT is unset');
  process.env.E2E_TENANT = 'ye';
  assert.strictEqual(T.defaultTenant().id, 'ye', 'E2E_TENANT wins');
  assert.strictEqual(e.prefix, 'RUMI_E2E_SUPABASE');
}
console.log('test_tenant_cjs[' + SHAPE + ']: all ok');
