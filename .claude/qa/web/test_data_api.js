#!/usr/bin/env node
/* test_data_api.js — the web lane's data E2E reads (bd-5b3u70.16).
 *
 * Run: node .claude/qa/web/test_data_api.js
 *
 * A portal scenario checks what was saved by reading the run's OWN database, the one dev-portal.sh cloned for this
 * run and wrote to <run>/db/db.env, through the engine's db-read.cjs: the same rows / snapshot / dataRules the bot's
 * mock lane drivers get. Anywhere else (no run database, a non-local URL, an engine without data checks) every call
 * answers { ok:false, notChecked }, so the driver records the data step NOT CHECKED, never PASS. A stand-in PostgREST
 * on a local port plays the database; nothing here reaches a real one.
 *
 * Red-first: fails before data-api.cjs exists.
 */
'use strict';
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dataApi } = require(path.join(__dirname, 'data-api.cjs'));

const ENGINE_BIN = path.resolve(__dirname, '..', 'engine', 'bin');
const db = { class_enrollments: [] };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const table = u.pathname.replace(/^\/rest\/v1\//, '');
  res.setHeader('content-type', 'application/json');
  if (!db[table]) { res.statusCode = 404; return res.end('{"code":"PGRST205"}'); }
  let rows = db[table];
  for (const [k, v] of u.searchParams) if (k !== 'select' && v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3));
  res.end(JSON.stringify(rows));
});

function runDirWith(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-data-api-'));
  if (lines) { fs.mkdirSync(path.join(dir, 'db')); fs.writeFileSync(path.join(dir, 'db', 'db.env'), lines.join('\n') + '\n'); }
  return dir;
}
function repoWith(keys) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-data-repo-'));
  fs.mkdirSync(path.join(dir, '.claude', 'qa', 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'qa', 'config', 'data-keys.json'), JSON.stringify(keys));
  return dir;
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const own = runDirWith([`SUPABASE_URL=${url}`, 'SUPABASE_SERVICE_ROLE_KEY=k', 'LOCAL_DB_NAME=run_1']);
  const watch = { class_enrollments: { owner: 'class_id', same: ['class_id', 'student_id'] } };
  const repo = repoWith(watch);
  const fast = { settleMs: 5 };
  let failed = 0;
  const tests = {
    async 'rows() reads the run\'s own database, named in <run>/db/db.env'() {
      db.class_enrollments = [{ id: 'e1', class_id: 'c1', student_id: 's1' }, { id: 'e2', class_id: 'c2', student_id: 's2' }];
      const r = await dataApi({ runDir: own, repo }).rows('class_enrollments', { class_id: 'c1' });
      assert.deepStrictEqual(r, { ok: true, rows: [{ id: 'e1', class_id: 'c1', student_id: 's1' }] });
    },
    async 'dataRules() flags a write to a class outside the scenario\'s cast'() {
      db.class_enrollments = [{ id: 'e1', class_id: 'c1', student_id: 's1' }];
      const api = dataApi({ runDir: own, repo, opts: fast });
      const before = await api.snapshot(watch);
      assert.ok(before.ok, JSON.stringify(before));
      db.class_enrollments = [...db.class_enrollments, { id: 'e2', class_id: 'mine', student_id: 's2' }, { id: 'e3', class_id: 'c9', student_id: 's3' }];
      const r = await api.dataRules(watch, ['mine'], before.snap);
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.deepStrictEqual(r.owner.map((v) => v.key), ['e3']);
      assert.deepStrictEqual(r.changes.class_enrollments.added.sort(), ['e2', 'e3']);
    },
    async 'dataKeys() reads the repo\'s data-keys.json'() {
      assert.deepStrictEqual(dataApi({ runDir: own, repo }).dataKeys(), { ok: true, watch });
    },
    async 'no run database: every read is NOT CHECKED, never a pass'() {
      const api = dataApi({ runDir: runDirWith(null), repo });
      for (const r of [await api.rows('class_enrollments'), await api.snapshot(watch), await api.dataRules(watch, [], {})]) {
        assert.strictEqual(r.ok, false); assert.ok(r.notChecked, JSON.stringify(r));
      }
    },
    async 'a db.env that names a non-local database is NOT CHECKED'() {
      const api = dataApi({ runDir: runDirWith(['SUPABASE_URL=https://abc.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY=k']), repo });
      const r = await api.rows('class_enrollments');
      assert.strictEqual(r.ok, false); assert.ok(r.notChecked, JSON.stringify(r));
    },
    async 'an engine without data checks: NOT CHECKED, and the driver can still run'() {
      const api = dataApi({ runDir: own, repo, engineBin: fs.mkdtempSync(path.join(os.tmpdir(), 'old-engine-')) });
      for (const r of [await api.rows('class_enrollments'), await api.snapshot(watch), await api.dataRules(watch, [], {}), api.dataKeys()]) {
        assert.strictEqual(r.ok, false); assert.ok(/engine/.test(r.notChecked || ''), JSON.stringify(r));
      }
    },
    async 'web-runner hands every scenario these reads on ctx, from WEB_RUN_DIR'() {
      const { dataCtx } = require(path.join(__dirname, 'web-runner.cjs'));
      db.class_enrollments = [{ id: 'e1', class_id: 'c1', student_id: 's1' }];
      const ctx = dataCtx({ WEB_RUN_DIR: own });
      for (const k of ['rows', 'snapshot', 'dataRules', 'dataKeys']) assert.strictEqual(typeof ctx[k], 'function', k);
      assert.deepStrictEqual((await ctx.rows('class_enrollments')).rows.map((r) => r.id), ['e1']);
      assert.ok(ctx.dataKeys().ok, 'the repo\'s own data-keys.json');
    },
    async 'a FAILED scenario keeps the evidence its driver attached to the error (its data part)'() {
      const { failEvidence } = require(path.join(__dirname, 'web-runner.cjs'));
      const e = Object.assign(new Error('the saved data is wrong'), { evidence: { data: { ok: false, data: 'checked' } } });
      assert.deepStrictEqual(failEvidence(e), { data: { ok: false, data: 'checked' } });
      assert.strictEqual(failEvidence(new Error('plain')), null);
    },
    async 'the default engine is the repo\'s linked one'() {
      assert.ok(fs.existsSync(path.join(ENGINE_BIN, 'db-read.cjs')), 'engine not linked at ' + ENGINE_BIN);
      const r = await dataApi({ runDir: own, repo }).rows('class_enrollments');
      assert.strictEqual(r.ok, true, JSON.stringify(r));
    },
  };
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('  ok    ' + name); } catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
  }
  server.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
}
main();
