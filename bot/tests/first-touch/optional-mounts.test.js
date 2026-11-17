'use strict';
/**
 * The two first-touch mounts that bot/whatsapp-bot.js reaches only by name through shared/services/first-touch/mounts.js
 * (sa-game.mount, teacher-home.portal.mount): each is on the list, mounts its router at its own path, and a router that
 * throws at load costs only that mount (false, logged), the app still serving. The router is a stub; the mounts are real.
 */
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const express = require('express');
const logger = require('../../shared/utils/logger');
const MOUNTS = require('../../shared/services/first-touch/mounts');
const { mountSaGame, MOUNT_PATH: SA_PATH } = require('../../shared/services/first-touch/sa-game.mount');
const { mountTeacherHomePortal, MOUNT_PATH: THP_PATH } = require('../../shared/services/first-touch/teacher-home.portal.mount');

async function get(app, url) {
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}${url}`);
    return { status: res.status, text: await res.text() };
  } finally { await new Promise((r) => srv.close(r)); }
}

describe.each([
  ['sa-game', 'sa-game.mount', 'mountSaGame', mountSaGame, SA_PATH, '/api/internal/sagame'],
  ['teacher-home-portal', 'teacher-home.portal.mount', 'mountTeacherHomePortal', mountTeacherHomePortal, THP_PATH, '/api/internal/thportal'],
])('%s mount', (name, file, fn, mount, path, want) => {
  test('is on the first-touch mount list under its own name', () => {
    expect(MOUNTS).toContainEqual([name, file, fn]);
    expect(path).toBe(want);
  });

  test('mounts its router at its path', async () => {
    const app = express();
    const router = express.Router();
    router.get('/ping', (req, res) => res.send(`${name} here`));
    expect(mount(app, () => router)).toBe(true);
    expect(await get(app, `${want}/ping`)).toEqual({ status: 200, text: `${name} here` });
  });

  test('a router that throws at load costs only this mount: false, logged once, the app still serves', async () => {
    logger.logToFile.mockClear();
    const app = express();
    expect(mount(app, () => { throw new Error('broken at load'); })).toBe(false);
    expect(logger.logToFile).toHaveBeenCalledTimes(1);
    app.get('/other', (req, res) => res.send('today'));
    expect(await get(app, '/other')).toEqual({ status: 200, text: 'today' });
  });
});
