'use strict';
/**
 * bd-vq0mfv (a): a missing optional `canvas` must fail the bot install (Railway then keeps the previous deployment),
 * not pass the build and crash the sqs-worker at boot as on 27 Oct 2026. The script runs in a child process, the way
 * npm's postinstall runs it; a preload makes `canvas` unresolvable for the "dropped" case.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BOT = path.join(__dirname, '../../bot');
const SCRIPT = path.join(BOT, 'scripts/assert-native-modules.js');

const PRELOAD = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vq0mfv-')), 'no-canvas.js');
fs.writeFileSync(PRELOAD, `
const Module = require('module');
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'canvas') { const e = new Error("Cannot find module 'canvas'"); e.code = 'MODULE_NOT_FOUND'; throw e; }
  return orig.call(this, request, ...rest);
};
`);

function run({ dropCanvas, allow }) {
  const env = { ...process.env, NODE_OPTIONS: '' };
  delete env.ALLOW_MISSING_CANVAS;
  if (allow) env.ALLOW_MISSING_CANVAS = '1';
  const args = dropCanvas ? ['-r', PRELOAD, SCRIPT] : [SCRIPT];
  return spawnSync(process.execPath, args, { cwd: BOT, env, encoding: 'utf8' });
}

describe('bot/scripts/assert-native-modules.js', () => {
  test('canvas dropped by the install: exits 1 and names canvas and the load error in the build log', () => {
    const r = run({ dropCanvas: true });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/canvas failed to load: Cannot find module 'canvas'/);
  });

  test('canvas installed: exits 0', () => {
    const r = run({ dropCanvas: false });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  test('ALLOW_MISSING_CANVAS=1 (local machines only): exits 0 with a warning', () => {
    const r = run({ dropCanvas: true, allow: true });
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
