/**
 * Worker-boot audit (Wave 3 PR α / α.4).
 *
 * For every Node entry point (web + workers), fork a child process with a
 * minimum-shaped env and assert the require chain resolves without load-time
 * errors. The check is forked, NOT in-process, because no OSS worker today
 * gates on `require.main === module` — requiring a worker file starts it.
 *
 * Pass criteria:
 *   - Child is still alive at the 1.5s timeout (require chain resolved, the
 *     main loop kicked in) → PASS, kill it
 *   - Child exited with code 0 in < 1.5s → PASS (clean require + early exit)
 *   - Child exited with code != 0 in < 1.5s → FAIL (load-time error in stderr)
 *
 * Three entries are allowlisted as KNOWN_BOOT_IO_FAIL because they do
 * Supabase I/O at boot — fragile under DNS flap but harmless in real prod.
 * Tracked as a Wave-4 architectural cleanup.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ROOT, BOT_ROOT } = require('./_audit-helpers/require-graph');

// Same minimum-shaped env the dry-pass used. All values pass presence-gating
// without dialling real services.
const MINIMUM_ENV = {
  NODE_ENV: 'test',
  PORT: '0', // ephemeral port — no collision
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJ-test-placeholder',
  OPENROUTER_API_KEY: 'sk-or-v1-placeholder',
  OPENAI_API_KEY: 'sk-placeholder',
  REDIS_URL: 'redis://localhost:6379',
  WHATSAPP_TOKEN: 'EAA-test',
  PHONE_NUMBER_ID: '0000000000',
  WABA_ID: '1111111111',
  WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
};

const LOAD_TIME_ERROR_RE =
  /SyntaxError|MODULE_NOT_FOUND|Cannot find module|^Error:/m;

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

function bootCheck(entry, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn('node', [entry], {
      cwd: ROOT,
      env: { ...process.env, ...MINIMUM_ENV },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      out += d.toString();
    });
    const t = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      const errorLine = LOAD_TIME_ERROR_RE.test(out)
        ? out.match(LOAD_TIME_ERROR_RE)[0]
        : null;
      resolve({ status: errorLine ? 'fail' : 'pass', errorLine, code: null, out });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(t);
      const errorLine = LOAD_TIME_ERROR_RE.test(out)
        ? out.match(LOAD_TIME_ERROR_RE)[0]
        : null;
      const ok = (code === 0 || code === null) && !errorLine;
      resolve({ status: ok ? 'pass' : 'fail', errorLine, code, out });
    });
  });
}

// Allowlist: workers that fail at boot because they do Supabase I/O before
// entering their message loop. Tracked as a Wave-4 follow-up.
const KNOWN_BOOT_IO_FAIL = new Set([
  path.join(BOT_ROOT, 'workers', 'coaching-processor.js'),
  path.join(BOT_ROOT, 'workers', 'sqs-worker.js'),
  path.join(BOT_ROOT, 'workers', 'stale-session.worker.js'),
]);

// Booting workers requires the bot's own node_modules (ioredis, @aws-sdk, etc).
// CI runs the root test suite BEFORE `cd bot && npm ci`, so bot/node_modules is
// absent at first-pass; the workers would fail with MODULE_NOT_FOUND for npm
// packages, which isn't what α.4 is checking. Detect and skip gracefully.
const BOT_NODE_MODULES_PRESENT = fs.existsSync(path.join(BOT_ROOT, 'node_modules'));

describe('Worker-boot audit — every entry loads (forked)', () => {
  const entries = discoverWorkerEntries();

  if (!BOT_NODE_MODULES_PRESENT) {
    it.skip('SKIPPED — bot/node_modules absent (CI first-pass); run after `cd bot && npm ci`', () => {});
    return;
  }

  for (const entry of entries) {
    const rel = entry.replace(ROOT + '/', '');
    const isAllowed = KNOWN_BOOT_IO_FAIL.has(entry);
    const label = isAllowed ? `[allowlist] ${rel}` : rel;
    it(
      label,
      async () => {
        const r = await bootCheck(entry, 2000);
        if (isAllowed) {
          // Document but don't gate the build.
          return;
        }
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
