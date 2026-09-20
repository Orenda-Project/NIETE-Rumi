// test_tenant_cjs_workspace.js — tenant.cjs in WORKSPACE mode (tenant layer above the bot clone). Self-contained.
//   node .claude/qa/engine/bin/test_tenant_cjs_workspace.js
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync } = require('child_process');
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
const layer = path.join(ws, '.claude', 'qa', 'tenants', 'niete');
fs.mkdirSync(path.join(layer, 'config'), { recursive: true }); fs.mkdirSync(path.join(layer, 'agents'), { recursive: true });
fs.writeFileSync(path.join(layer, 'config', 'tenants.yaml'), 'version: 1\nrepo: NIETE-Rumi\ncommand: /niete-e2e\nspec_suite: niete\nruntime_scope:\n  - bot/**\ntenants:\n  niete:\n    region_code: default\n    driver: "923000000001"\n');
const clone = path.join(ws, 'NIETE-Rumi'); fs.mkdirSync(path.join(clone, 'tests'), { recursive: true });
execFileSync('git', ['-C', clone, 'init', '-q']);
execFileSync('git', ['-C', clone, 'remote', 'add', 'origin', 'https://github.com/Orenda-Project/NIETE-Rumi.git']);
execFileSync('git', ['-C', clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
delete process.env.CLAUDE_PROJECT_DIR;
const { load, findRoot } = require(path.join(__dirname, 'tenant.cjs'));
assert.strictEqual(findRoot(path.join(clone, 'tests')), clone, 'findRoot from inside the clone is the clone');
const T = load(path.join(clone, 'tests'));
assert.strictEqual(T.root, clone); assert.strictEqual(T.workspaceMode, true); assert.strictEqual(T.layerDir, layer);
assert.strictEqual(T.agentsAbs, path.join(layer, 'agents')); assert.strictEqual(T.configAbs, path.join(layer, 'config'));
assert.strictEqual(T.specAbs, path.join(clone, 'tests', 'features', 'whatsapp', 'niete'));
assert.strictEqual(T.pendingAbs, path.join(clone, '.claude', '.e2e-pending'));
assert.strictEqual(T.command, '/niete-e2e'); assert.strictEqual(T.defaultTenant().driver, '923000000001');
process.env.CLAUDE_PROJECT_DIR = clone;
assert.strictEqual(findRoot(ws), clone, 'from the workspace root with CLAUDE_PROJECT_DIR=clone');
// the vendored engine's tests run with cwd INSIDE a guarded bot repo — the session's clone must still win
const other = path.join(ws, 'other'); fs.mkdirSync(path.join(other, '.claude', 'qa', 'config'), { recursive: true }); fs.mkdirSync(path.join(other, 'sub'));
fs.copyFileSync(path.join(layer, 'config', 'tenants.yaml'), path.join(other, '.claude', 'qa', 'config', 'tenants.yaml'));
const cwd0 = process.cwd(); process.chdir(path.join(other, 'sub'));
assert.strictEqual(findRoot(), clone, 'CLAUDE_PROJECT_DIR=clone beats a guarded cwd');
assert.strictEqual(load().layerDir, layer, '…and the layer follows it');
process.chdir(cwd0);
fs.rmSync(ws, { recursive: true, force: true });
console.log('test_tenant_cjs_workspace: all ok');
