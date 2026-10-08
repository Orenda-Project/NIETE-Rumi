#!/usr/bin/env node
/* test_no_direct_sandbox_db.js — the Node harness reaches the database ONLY through db-target.cjs (bd-z3ze4).
 *
 * Run: node .claude/qa/shared/test_no_direct_sandbox_db.js
 *
 * The mock lane runs on a per-run LOCAL database by default. A harness helper that reads
 * NIETE_SANDBOX_SUPABASE_* itself writes to the shared sandbox while the bot under test reads the local DB:
 * the scenario silently tests nothing and a sandbox row changes mid-run. It happened twice — setUser/setRoster
 * (fixed with db-target.cjs), then resetObserve + status STA08 arrived on sandbox afterwards. This scan makes
 * the next one fail here instead of in a run. Error-message strings that merely NAME the variables are fine.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SHARED = __dirname;
const files = [
  ...fs.readdirSync(SHARED).filter((f) => /\.(c?js)$/.test(f)).map((f) => path.join(SHARED, f)),
  ...fs.readdirSync(path.join(SHARED, 'features')).filter((f) => /\.c?js$/.test(f)).map((f) => path.join(SHARED, 'features', f)),
].filter((f) => !/(^|\/)(db-target\.cjs|test_[^/]*\.js)$/.test(f));

const READ = /(process\.env|\benv)\.NIETE_SANDBOX_SUPABASE_(URL|SERVICE_ROLE_KEY)\b/;
const offenders = [];
for (const f of files) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (READ.test(line)) offenders.push(`${path.relative(SHARED, f)}:${i + 1}: ${line.trim().slice(0, 110)}`);
  });
}
try {
  assert.deepStrictEqual(offenders, [], 'direct sandbox DB reads (use dbCreds() from db-target.cjs):\n  ' + offenders.join('\n  '));
  console.log(`  ok  ${files.length} harness files reach the DB only through db-target.cjs\n\nno-direct-sandbox-db: passed`);
} catch (e) { console.error('  FAIL ' + e.message); process.exit(1); }
