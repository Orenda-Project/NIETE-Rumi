'use strict';
/**
 * The teacher home's mount line in the bot (bot/whatsapp-bot.js): it is there, live (not commented out), and before
 * app.listen; and what it calls mounts the router at /api/internal/th (switch off → 404 {off:true}), while a router
 * that throws at load costs only this mount.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const fs = require('fs');
const path = require('path');
const express = require('express');
const supabase = require('../../shared/config/supabase');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const { mountTeacherHome, MOUNT_PATH } = require('../../shared/services/first-touch/teacher-home.mount');

/** The file's code lines only: whole-line // comments removed first (one may hold a path like /api/x/*), then block comments. */
function codeOf(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('bot/whatsapp-bot.js mounts the teacher home, live, before the app listens', () => {
  const code = codeOf(path.join(__dirname, '../../whatsapp-bot.js'));
  const at = code.indexOf("require('./shared/services/first-touch/teacher-home.mount').mountTeacherHome(app)");
  expect(at).toBeGreaterThan(-1);
  expect(at).toBeLessThan(code.indexOf('app.listen('));
  expect(at).toBeGreaterThan(code.indexOf('const app = express()'));
});

test('what the line calls mounts /api/internal/th: switch off → 404 {off:true}; a router that throws → not mounted, the app still serves', async () => {
  supabase.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) });
  Flags.reset();
  expect(MOUNT_PATH).toBe('/api/internal/th');
  const app = express();
  expect(mountTeacherHome(app, () => { throw new Error('broken at load'); })).toBe(false);
  expect(mountTeacherHome(app)).toBe(true);
  app.get('/other', (req, res) => res.send('today'));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const off = await fetch(`${base}/api/internal/th/api/th/home?t=x`, { headers: { 'x-api-key': process.env.INTERNAL_API_KEY } });
    expect(off.status).toBe(404);
    expect(await off.json()).toEqual({ off: true });
    expect(await (await fetch(`${base}/other`)).text()).toBe('today');
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
