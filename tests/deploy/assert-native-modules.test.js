'use strict';
/**
 * bd-vq0mfv (a): a missing optional `canvas` must fail the bot install (Railway then keeps the previous deployment),
 * not pass the build and crash the sqs-worker at boot as on 27 Oct 2026. The script runs in a child process, the way
 * npm's postinstall runs it. A preload decides what `require('canvas')` finds (a stub, nothing, or a stub whose native
 * binding throws), so the result never depends on whether this machine installed canvas: CI runs the tests before
 * `cd bot && npm ci`, so there it is absent (PR #3840 CI, 27 Oct).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BOT = path.join(__dirname, '../../bot');
const SCRIPT = path.join(BOT, 'scripts/assert-native-modules.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vq0mfv-'));
const STUB_OK = path.join(TMP, 'canvas-ok.js');
const STUB_BROKEN = path.join(TMP, 'canvas-broken.js');
fs.writeFileSync(STUB_OK, 'module.exports = { createCanvas() {} };\n');
fs.writeFileSync(STUB_BROKEN, "throw new Error('canvas.node: invalid ELF header');\n");

// mode: 'ok' -> canvas resolves to a loadable stub; 'broken' -> it resolves but its binding throws; 'dropped' -> it
// does not resolve at all (npm skipped the failed optional install).
function preload(mode) {
  const file = path.join(TMP, `preload-${mode}.js`);
  const target = { ok: STUB_OK, broken: STUB_BROKEN }[mode];
  fs.writeFileSync(file, `
const Module = require('module');
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'canvas') {
    ${target ? `return ${JSON.stringify(target)};` : `const e = new Error("Cannot find module 'canvas'"); e.code = 'MODULE_NOT_FOUND'; throw e;`}
  }
  return orig.call(this, request, ...rest);
};
`);
  return file;
}
const PRELOAD = preload('dropped');

function run({ mode, allow }) {
  const env = { ...process.env, NODE_OPTIONS: '' };
  delete env.ALLOW_MISSING_CANVAS;
  if (allow) env.ALLOW_MISSING_CANVAS = '1';
  return spawnSync(process.execPath, ['-r', preload(mode), SCRIPT], { cwd: BOT, env, encoding: 'utf8' });
}

describe('bot/scripts/assert-native-modules.js', () => {
  test('canvas dropped by the install: exits 1 and names canvas and the load error in the build log', () => {
    const r = run({ mode: 'dropped' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/canvas failed to load: Cannot find module 'canvas'/);
  });

  test('canvas installed: exits 0', () => {
    const r = run({ mode: 'ok' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  test('canvas resolves but its native binding fails to load: exits 1 with the load error', () => {
    const r = run({ mode: 'broken' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/canvas failed to load: canvas\.node: invalid ELF header/);
  });

  test('ALLOW_MISSING_CANVAS=1 (local machines only): exits 0 with a warning', () => {
    const r = run({ mode: 'dropped', allow: true });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/ALLOW_MISSING_CANVAS=1/);
  });
});

describe('bot/package.json postinstall (run through npm, the way the Railway build runs it)', () => {
  function npmPostinstall(env) {
    const e = { ...process.env, SKIP_PLAYWRIGHT_INSTALL: '1', NODE_OPTIONS: `--require=${PRELOAD}`, ...env };
    delete e.ALLOW_MISSING_CANVAS;
    Object.assign(e, env);
    return spawnSync('npm', ['run', 'postinstall'], { cwd: BOT, env: e, encoding: 'utf8' });
  }

  test('canvas dropped: the postinstall fails, so the build fails', () => {
    const r = npmPostinstall({});
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/canvas failed to load/);
  });

  test('canvas dropped but ALLOW_MISSING_CANVAS=1: the postinstall passes', () => {
    const r = npmPostinstall({ ALLOW_MISSING_CANVAS: '1' });
    expect(r.status).toBe(0);
  });

  test('canvas stays an optional dependency (its install failure is caught by the check, not by npm)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(BOT, 'package.json'), 'utf8'));
    expect(pkg.optionalDependencies.canvas).toBeDefined();
  });
});
