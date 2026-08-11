/**
 * Worker-boot audit.
 *
 * For every Node entry point (web + workers), fork a child process with a
 * minimum-shaped env and assert the require chain resolves without load-time
 * errors. The check is forked, not in-process, because some workers do not yet
 * gate on `require.main === module` — requiring them starts the loop.
 *
 * Pass criteria:
 *   - Child is still alive at the 2s timeout (require chain resolved, the
 *     main loop kicked in) → PASS, kill it
 *   - Child exited with code 0 in < 2s → PASS (clean require + early exit)
 *   - Child exited with code ≠ 0 in < 2s, no load-time error in stderr → PASS
 *     for a CRON_WORKER entry (cron workers correctly exit non-zero when their
 *     dependencies are unreachable; that's not a boot failure), FAIL otherwise
 *
 * Load-time errors are detected by patterns Node prints at column 0 when the
 * require chain itself fails. Runtime errors that the worker handles
 * gracefully (e.g. a TypeError from a Supabase fetch during the poll loop,
 * logged via pino as `"error": "TypeError: fetch failed"`) are NOT load-time
 * errors and do not fail the audit.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ROOT, BOT_ROOT } = require('./_audit-helpers/require-graph');

// Minimum-shaped env — placeholders that pass presence-gating without dialling
// real services.
const MINIMUM_ENV = {
  NODE_ENV: 'test',
  PORT: '0',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJ-test-placeholder',
  OPENROUTER_API_KEY: 'sk-or-v1-placeholder',
  OPENAI_API_KEY: 'sk-placeholder',
  REDIS_URL: 'redis://localhost:6379',
  WHATSAPP_TOKEN: 'EAA-test',
  PHONE_NUMBER_ID: '0000000000',
  WABA_ID: '1111111111',
  WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
  // This audit only asks "does the require chain load?" — it has no business
  // touching a real queue. Blanked here rather than in an npm script so the
  // guard travels with the only test that boots workers and cannot be bypassed
  // by running jest directly. The queue service disables itself when unset.
  SQS_QUEUE_URL: '',
  SQS_DLQ_URL: '',
  SQS_VIDEO_QUEUE_URL: '',
  SQS_QUIZ_QUEUE_URL: '',
};

// Only TRUE load-time failures count — patterns Node prints at column 0 when
// the require chain itself fails. Runtime errors logged via structured logger
// (which prepend whitespace and emit JSON) do not match.
const LOAD_TIME_ERROR_RE =
  /^(SyntaxError|TypeError|ReferenceError|Cannot find module|Error \[ERR_)/m;

// CRON-style workers: they're expected to exit. A non-zero exit is acceptable
// when their dependencies are unreachable (the cron scheduler will retry on
// the next tick — same shape as Railway / Kubernetes restart policies).
const CRON_WORKERS = new Set([
  path.join(BOT_ROOT, 'workers', 'stale-session.worker.js'),
]);

function discoverWorkerEntries() {
  const list = [];
  const web = path.join(BOT_ROOT, 'whatsapp-bot.js');
  if (fs.existsSync(web)) list.push(web);
  const workersDir = path.join(BOT_ROOT, 'workers');
  if (fs.existsSync(workersDir)) {
    for (const f of fs.readdirSync(workersDir)) {
      if (f.endsWith('.js')) list.push(path.join(workersDir, f));
    }
  }
  return list;
}

/**
 * Terminate a booted child and WAIT for it to actually die.
 *
 * SIGTERM is not enough. The lesson-plan and video workers pull in a dependency
 * that installs its own SIGTERM handler and never exits, so a plain
 * `child.kill('SIGTERM')` left the process running: orphaned to init, still
 * polling with whatever queue config the test run happened to carry, and
 * holding its stdio pipes open — which also stopped Jest from exiting, so this
 * file hung instead of finishing.
 *
 * So: ask nicely, then insist. Resolve only once the process is gone.
 */
function reap(child, graceMs = 1500) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      // Drop our end of the pipes so no handle keeps the runner alive.
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve();
    };

    child.once('exit', finish);
    try { child.kill('SIGTERM'); } catch { return finish(); }

    setTimeout(() => {
      if (settled) return;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      // SIGKILL cannot be trapped; give the OS a moment to reap, then move on
      // rather than hanging the suite if the exit event is somehow missed.
      setTimeout(finish, 300);
    }, graceMs);
  });
}

function bootCheck(entry, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn('node', [entry], {
      cwd: ROOT,
      env: { ...process.env, ...MINIMUM_ENV },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    const t = setTimeout(async () => {
      await reap(child);
      const errorLine = LOAD_TIME_ERROR_RE.test(out) ? out.match(LOAD_TIME_ERROR_RE)[0] : null;
      resolve({ status: errorLine ? 'fail' : 'pass', errorLine, code: null, out, pid: child.pid });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(t);
      const errorLine = LOAD_TIME_ERROR_RE.test(out) ? out.match(LOAD_TIME_ERROR_RE)[0] : null;
      // CRON workers may legitimately exit non-zero on missing deps; only
      // load-time errors fail them.
      const isCron = CRON_WORKERS.has(entry);
      const ok = isCron
        ? !errorLine
        : (code === 0 || code === null) && !errorLine;
      resolve({ status: ok ? 'pass' : 'fail', errorLine, code, out, pid: child.pid });
    });
  });
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Booting workers requires the bot's own node_modules. CI runs the root test
// suite BEFORE `cd bot && npm ci`, so on first-pass we skip the test
// gracefully — it runs after bot deps are installed.
const BOT_NODE_MODULES_PRESENT = fs.existsSync(path.join(BOT_ROOT, 'node_modules'));

describe('Worker-boot audit — every entry loads (forked)', () => {
  const entries = discoverWorkerEntries();

  if (!BOT_NODE_MODULES_PRESENT) {
    it.skip('SKIPPED — bot/node_modules absent (CI first-pass); run after `cd bot && npm ci`', () => {});
    return;
  }

  for (const entry of entries) {
    const rel = entry.replace(ROOT + '/', '');
    it(
      rel,
      async () => {
        const r = await bootCheck(entry, 2000);
        if (r.status !== 'pass') {
          throw new Error(
            `${rel} failed boot:\n  ${r.errorLine || 'exit code ' + r.code}\n  ` +
              `stderr/stdout tail:\n${r.out.split('\n').slice(-5).join('\n')}`
          );
        }
      },
      5000
    );
  }
});

/**
 * Process-leak guard.
 *
 * The audit above boots each entry as a real child process, so it is also
 * responsible for reaping them. SIGTERM alone is not sufficient: the
 * lesson-plan and video workers pull in a dependency that installs its own
 * SIGTERM handler and does not exit, so the child outlived the run, was
 * orphaned to init, and kept polling with whatever queue config the run had.
 *
 * That went unnoticed because CI runs the root suite BEFORE `cd bot && npm ci`,
 * which skips this whole file — the leak only reproduced on a developer machine
 * with bot deps installed.
 */
describe('Worker-boot audit — leaves no orphaned child (process-leak guard)', () => {
  if (!BOT_NODE_MODULES_PRESENT) {
    it.skip('SKIPPED — bot/node_modules absent (CI first-pass)', () => {});
    return;
  }

  // The two entries that ignore SIGTERM. Guarding these covers the mechanism;
  // any future entry that behaves the same way is caught by the same escalation.
  const STUBBORN = [
    path.join(BOT_ROOT, 'workers', 'lesson-plan-generation.worker.js'),
    path.join(BOT_ROOT, 'workers', 'video-generation.worker.js'),
  ].filter((p) => fs.existsSync(p));

  for (const entry of STUBBORN) {
    const rel = entry.replace(ROOT + '/', '');
    it(
      `reaps ${rel} even though it ignores SIGTERM`,
      async () => {
        const r = await bootCheck(entry, 2000);
        expect(typeof r.pid).toBe('number');
        expect(isAlive(r.pid)).toBe(false);
      },
      15000
    );
  }
});
