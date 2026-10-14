#!/usr/bin/env node
// web-runner — drive one web feature's scenarios in headless Chromium (bd-hnhlgn.5).
// Started by scripts/qa/e2e-web.sh once the local stack is up; reads everything from the environment:
//   WEB_FEATURE   feature module under .claude/qa/web/features/<name>.cjs
//   WEB_BASE_URL  the run's portal, e.g. http://localhost:4105
//   WEB_EVIDENCE  directory for results.json + one PNG per failed scenario
//   WEB_PSQL / WEB_PG_PORT / WEB_DB_NAME   this run's OWN local database, for scenario set-up (ctx.sql)
//   WEB_ONLY      optional comma list of scenario ids
//   WEB_HEADED=1 / WEB_SLOWMO=<ms>   watch it: a visible browser, every action slowed down
//   WEB_MOCK_URL  this run's mock WhatsApp (Graph API stand-in): POST /inject, GET /outbox — WhatsApp → portal scenarios
// Exit 0 when every scenario passed, 1 otherwise; results.json is written either way.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function loadChromium() {
  for (const dir of [path.join(ROOT, 'portal'), ROOT]) {
    try { return require(require.resolve('playwright-core', { paths: [dir] })).chromium; } catch (_) { /* next */ }
  }
  throw new Error('playwright-core not found — run: npm ci --prefix portal');
}

async function main() {
  const env = process.env;
  const feature = env.WEB_FEATURE;
  const evidence = env.WEB_EVIDENCE;
  const mod = require(path.join(__dirname, 'features', feature + '.cjs'));
  const only = (env.WEB_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
  const picked = mod.scenarios.filter((s) => !only.length || only.includes(s.id));
  fs.mkdirSync(evidence, { recursive: true });

  const sql = async (text) => {
    if (!env.WEB_DB_NAME) throw new Error('no run database (WEB_DB_NAME) — set-up SQL refused');
    // Parallel stacks share one local Postgres; while they start up its connection table can be full for a moment
    // ("sorry, too many clients already"). That is retried — any other SQL error fails the scenario at once.
    for (let attempt = 1; ; attempt++) {
      try {
        execFileSync(env.WEB_PSQL || 'psql', ['-h', '127.0.0.1', '-p', env.WEB_PG_PORT, '-U', 'postgres',
          '-d', env.WEB_DB_NAME, '-v', 'ON_ERROR_STOP=1', '-qAtc', text], { stdio: ['ignore', 'pipe', 'pipe'] });
        return;
      } catch (e) {
        // keep Postgres's own words — "Command failed" alone says nothing about why
        const why = String((e.stderr && e.stderr.toString()) || e.message).trim().split('\n').slice(-2).join(' | ');
        if (/too many clients/i.test(why) && attempt < 4) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
        throw new Error('set-up SQL failed on the run database: ' + why);
      }
    }
  };
  const ctx = { baseUrl: env.WEB_BASE_URL.replace(/\/$/, ''), sql,
    mockUrl: (env.WEB_MOCK_URL || '').replace(/\/$/, ''), headed: env.WEB_HEADED === '1' };

  const started = Date.now();
  const results = [];
  // --headed (e2e-web.sh) → a visible window, each action slowed by WEB_SLOWMO ms so a person can follow it.
  const browser = await loadChromium().launch({ headless: env.WEB_HEADED !== '1', slowMo: Number(env.WEB_SLOWMO || 0) });
  try {
    for (const s of picked) {
      const t0 = Date.now();
      const context = await browser.newContext({ viewport: { width: 412, height: 915 } }); // a phone, like the teachers'
      const page = await context.newPage();
      const row = { id: s.id, title: s.title };
      try {
        row.evidence = await s.run(page, ctx);
        row.status = 'PASS';
      } catch (e) {
        row.status = 'FAIL';
        row.error = String((e && e.message) || e).split('\n')[0];
        row.url = page.url();
        const shot = path.join(evidence, s.id + '.png');
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        row.screenshot = path.basename(shot);
      }
      row.duration_ms = Date.now() - t0;
      await context.close();
      results.push(row);
      console.log((row.status === 'PASS' ? '  ok   ' : '  FAIL ') + s.id + '  ' + s.title + (row.error ? '\n       ' + row.error : ''));
    }
  } finally {
    await browser.close();
  }
  const out = { feature, duration_ms: Date.now() - started, results };
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(out, null, 2));
  process.exit(results.every((r) => r.status === 'PASS') ? 0 : 1);
}

main().catch((e) => { console.error('web-runner: ' + ((e && e.stack) || e)); process.exit(2); });
