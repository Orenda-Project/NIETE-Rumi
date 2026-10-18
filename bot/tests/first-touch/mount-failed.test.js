'use strict';
/**
 * A first-touch mount that does not happen is logged once at error level, with its module; a line whose own module
 * file is absent stays silent (a feature not in this build), as before. The bot's mount block (bot/whatsapp-bot.js,
 * from its "── first touch:" marker up to the general internal router) is run as mounts-golden.test.js runs it, on a
 * bare express app, with a stand-in list: a module that mounts, one that throws while loading, one whose own require
 * is missing, one without the named mount function, and one that is not there at all.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { logToFile } = require('../../shared/utils/logger');

const BOT = path.join(__dirname, '..', '..');
const FT = './shared/services/first-touch/';
const FROM = '// ── first touch:';
const TO = '\nconst internalApiRoutes';

function mountBlock() {
  const src = fs.readFileSync(path.join(BOT, 'whatsapp-bot.js'), 'utf8');
  const a = src.indexOf(FROM);
  const b = src.indexOf(TO, a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-mounts-'));
  fs.writeFileSync(path.join(dir, 'fine.mount.js'), "module.exports = { mountFine: (app) => { app.get('/fine', (q, r) => r.send('fine')); return true; } };\n");
  fs.writeFileSync(path.join(dir, 'throws.mount.js'), "throw new Error('broken while loading');\n");
  fs.writeFileSync(path.join(dir, 'needs.mount.js'), "require('./needs.routes');\nmodule.exports = { mountNeeds: () => true };\n");
  fs.writeFileSync(path.join(dir, 'named.mount.js'), 'module.exports = { mountSomethingElse: () => true };\n');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => logToFile.mockClear());

/** Runs the bot's block with `list` as mounts.js; with `standIn`, a line's module comes from the stand-in folder. */
function runBlock(list, standIn = true) {
  const app = express();
  const req = (p) => {
    if (p === `${FT}mounts`) return list;
    if (standIn && list.some(([, file]) => p === `${FT}${file}`)) return require(path.join(dir, p.slice(FT.length)));
    return require(p.startsWith('.') ? path.join(BOT, p) : p);
  };
  // eslint-disable-next-line no-new-func
  new Function('app', 'require', mountBlock())(app, req);
  return app;
}
const errorLines = () => logToFile.mock.calls.filter((c) => c[2] === 'error');

test('a mount that throws, misses a file it needs, or lacks its function: one error line each; an absent module: none; the rest still mount', async () => {
  const app = runBlock([
    ['absent', 'absent.mount', 'mountAbsent'],
    ['fine', 'fine.mount', 'mountFine'],
    ['named', 'named.mount', 'mountNamed'],
    ['needs', 'needs.mount', 'mountNeeds'],
    ['throws', 'throws.mount', 'mountThrows'],
  ]);
  const lines = errorLines();
  expect(lines).toHaveLength(3);
  expect(lines.map((c) => c[1].module)).toEqual(['named.mount', 'needs.mount', 'throws.mount']);
  lines.forEach((c) => expect(typeof c[1].error).toBe('string'));
  expect(lines[2][1].error).toBe('broken while loading');
  expect(lines[1][1].error).toMatch(/needs\.routes/);
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/fine`);
    expect(await res.text()).toBe('fine');
  } finally { await new Promise((r) => srv.close(r)); }
});

test('only an absent module: nothing logged, as today', () => {
  runBlock([['absent', 'absent.mount', 'mountAbsent']]);
  expect(logToFile).not.toHaveBeenCalled();
});

test('the real list: every line mounts, nothing logged at error level', () => {
  const real = require(path.join(BOT, FT, 'mounts'));
  expect(real.length).toBeGreaterThan(0);
  runBlock(real, false);
  expect(errorLines()).toEqual([]);
});

test('the reporter never throws, even when the logger does', () => {
  const report = require('../../shared/services/first-touch/mount-failed');
  logToFile.mockImplementationOnce(() => { throw new Error('disk full'); });
  expect(() => report('x.mount', new Error('boom'))).not.toThrow();
  expect(() => report('x.mount', null)).not.toThrow();
});
