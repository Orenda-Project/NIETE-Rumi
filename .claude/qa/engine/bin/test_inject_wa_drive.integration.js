#!/usr/bin/env node
/* test_inject_wa_drive.integration.js — inject-wa-drive against a REAL Chrome over REAL CDP.
 *
 * Run: node .claude/qa/shared/test_inject_wa_drive.integration.js
 * Skips (exit 0) if Chrome is not installed — CI without a desktop Chrome is not a failure.
 *
 * WHY A SEPARATE INTEGRATION TEST (bd-44105). The unit tests prove the DECISIONS are right
 * (which target, did it take). They cannot prove the thing that actually has to work: that
 * Node's built-in WebSocket really speaks CDP to a real browser and that wa-drive.js really
 * evaluates as an expression in a page. That is the whole mechanism, and mocking it would
 * test the mock. So this launches headless Chrome on a scratch profile and injects for real.
 *
 * It cannot use web.whatsapp.com (that needs a linked session), so it matches about:blank and
 * asserts what is portable: wa-drive returns its ready string, and window.__wa exists after.
 */
const assert = require('assert');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const inj = require(path.join(__dirname, 'inject-wa-drive.js'));

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;

if (!fs.existsSync(CHROME)) {
  console.log('SKIP — no desktop Chrome at ' + CHROME);
  process.exit(0);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-inject-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore', detached: true });

const cleanup = () => {
  try { process.kill(-chrome.pid, 'SIGKILL'); } catch (_) {}
  try { chrome.kill('SIGKILL'); } catch (_) {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
};
process.on('exit', cleanup);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let passed = 0;
  const it = async (name, fn) => {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
  };

  // wait for the endpoint
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
    } catch (_) { await sleep(250); }
  }
  if (!targets) { console.error('  FAIL Chrome never exposed a DevTools endpoint'); process.exit(1); }

  console.log('real Chrome, real CDP');

  const blank = /about:blank/;
  let target;
  await it('pickTarget finds a real page target among Chrome\'s real target list', () => {
    target = inj.pickTarget(targets, blank);
    assert.ok(target, 'no about:blank page target among ' + targets.length +
                      ' targets: ' + targets.map(t => t.type).join(','));
    assert.strictEqual(target.type, 'page');
    assert.ok(target.webSocketDebuggerUrl.startsWith('ws://'));
  });

  await it('pickTarget still refuses a non-page target from that same real list', () => {
    // Chrome really does serve browser_ui / background_page here; injecting into one
    // succeeds silently and leaves the intended tab without wa.*.
    const nonPage = targets.filter(t => t.type !== 'page');
    if (!nonPage.length) return;                       // nothing to prove on this build
    assert.strictEqual(inj.pickTarget(nonPage, /./), null);
  });

  await it('the CLI injects wa-drive into a real page and exits 0', () => {
    const out = execFileSync('node', [
      path.join(__dirname, 'inject-wa-drive.js'),
      '--port', String(PORT), '--match', 'about:blank',
    ], { encoding: 'utf8' });
    assert.ok(/wa-drive ready:/.test(out), out);
    assert.ok(/send/.test(out) && /waitForNew/.test(out), 'ready string should list the helpers: ' + out);
  });

  await it('window.__wa really exists in the page afterwards — the point of the exercise', async () => {
    const frame = await (async () => {
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      return await new Promise((resolve) => {
        ws.onopen = () => ws.send(JSON.stringify({ id: 9, method: 'Runtime.evaluate',
          params: { expression: 'typeof window.__wa + "|" + typeof window.__wa.sendAndWait', returnByValue: true } }));
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 9) { ws.close(); resolve(m); } };
      });
    })();
    assert.strictEqual(frame.result.result.value, 'object|function', JSON.stringify(frame.result));
  });

  await it('a run-dir gets wa_drive_loaded recorded from first-hand knowledge', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-run-'));
    fs.writeFileSync(path.join(d, 'run.json'),
      JSON.stringify({ run: 'itest', driver: '92300', wa_drive_loaded: false }));
    execFileSync('node', [path.join(__dirname, 'inject-wa-drive.js'),
      '--port', String(PORT), '--match', 'about:blank', '--run-dir', d, '--quiet'], { encoding: 'utf8' });
    const meta = JSON.parse(fs.readFileSync(path.join(d, 'run.json'), 'utf8'));
    assert.strictEqual(meta.wa_drive_loaded, true);
    assert.strictEqual(meta.driver, '92300', 'must not clobber the rest of run.json');
    assert.ok(/wa-drive ready/.test(meta.wa_drive_detail || ''));
  });

  await it('a miss exits 1 and records FALSE — a silent miss is what returns us to 4h runs', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-run-'));
    let code = 0;
    try {
      execFileSync('node', [path.join(__dirname, 'inject-wa-drive.js'),
        '--port', String(PORT), '--match', 'no-such-tab-anywhere', '--run-dir', d],
        { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) { code = e.status; }
    assert.strictEqual(code, 1, 'must exit non-zero when the tab is absent');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, 'run.json'), 'utf8')).wa_drive_loaded, false);
  });

  await it('no DevTools endpoint at all also exits 1, not a hang', () => {
    let code = 0;
    try {
      execFileSync('node', [path.join(__dirname, 'inject-wa-drive.js'), '--port', '9999'],
        { encoding: 'utf8', stdio: 'pipe', timeout: 15000 });
    } catch (e) { code = e.status; }
    assert.strictEqual(code, 1);
  });

  console.log('\n' + passed + ' integration assertions passed');
  cleanup();
})();
