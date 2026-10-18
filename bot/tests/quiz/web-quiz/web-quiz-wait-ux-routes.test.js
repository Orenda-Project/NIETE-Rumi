'use strict';
/**
 * The designed wait's switch on the routes (app_settings web_quiz_wait_ux, web-quiz-wait-ux.js). On: the hub answer
 * (GET and POST) carries `wait_ux: true` for the page's progress bar; no other answer changes and the switch writes no
 * header. Off (no row, a non-true value, a failed read): every answer byte for byte the page module's own answer.
 * The switch never reads on its own: a route the hub never touches makes no settings read for it, on or off.
 * Supabase and the loggers are the boundaries; the page modules' answers are stood in so the bytes compared are exactly
 * what the route adds.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const KEY = 'web_quiz_wait_ux';
let rows = [];
let fail = false;
let settingsReads = 0;
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from(t) {
      if (t === 'app_settings') settingsReads += 1;
      const st = { key: null };
      const b = {
        select() { return b; },
        eq(c, v) { if (c === 'key') st.key = v; return b; },
        in() { return b; },
        async maybeSingle() {
          if (fail) return { data: null, error: { message: 'down' } };
          return { data: rows.find((r) => r.key === st.key) || null, error: null };
        },
        // the hub's one switch read (web-quiz-hub-flags.js) is an .in() list; a failed read fails it too
        then(res, rej) { return Promise.resolve(fail && t === 'app_settings' ? { data: null, error: { message: 'down' } } : { data: t === 'app_settings' ? rows.filter((r) => !st.key || r.key === st.key) : [], error: null }).then(res, rej); },
      };
      return b;
    },
  });
}

let WaitUx;
beforeEach(() => {
  jest.resetModules();
  rows = []; fail = false; settingsReads = 0;
  seed();
  WaitUx = require('../../../shared/services/quiz/web-quiz-wait-ux');
});

const HUB = { lang: 'en', kids: [{ kid: '0123456789abcdef', name: 'Sana Testwala' }], rt: false };
const DOORS = { games: [{ kind: 'numbers', stop: 'bigger' }] };

async function serve(fn) {
  process.env.INTERNAL_API_KEY = 'route-key';
  const express = require('express');
  const Hub = require('../../../shared/services/quiz/web-quiz-hub');
  const Doors = require('../../../shared/services/quiz/web-quiz-hub-doors');
  const spies = [
    jest.spyOn(Hub, 'hub').mockImplementation(async () => JSON.parse(JSON.stringify(HUB))),
    jest.spyOn(Doors, 'door').mockImplementation(async () => JSON.parse(JSON.stringify(DOORS))),
  ];
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  const h = { 'x-api-key': 'route-key' };
  const one = async (url, init) => { const r = await fetch(url, init); return { st: r.headers.get('server-timing'), body: await r.text() }; };
  const ask = async () => ({
    hubGet: await one(`${base}/hub/abc.def`, { headers: h }),
    hubPost: await one(`${base}/hub/abc.def`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' }),
    doors: await one(`${base}/doors/h/abc.def?d=games`, { headers: h }),
  });
  try { return await fn(ask); } finally { spies.forEach((s) => s.mockRestore()); await new Promise((r) => server.close(r)); }
}
const GOLDEN = { hubGet: JSON.stringify(HUB), hubPost: JSON.stringify(HUB), doors: JSON.stringify(DOORS) };

describe('the routes', () => {
  test('on: the hub answers say wait_ux: true; nothing else changes and the switch writes no header', async () => {
    rows = [{ key: KEY, value: true }];
    await WaitUx.refresh();
    await serve(async (ask) => {
      const out = await ask();
      for (const k of Object.keys(GOLDEN)) expect(out[k].st).toBeNull();
      expect(JSON.parse(out.hubGet.body).wait_ux).toBe(true);
      expect(JSON.parse(out.hubPost.body).wait_ux).toBe(true);
      expect(out.hubGet.body.replace(/,"wait_ux":true/, '')).toBe(GOLDEN.hubGet);
      expect(out.hubPost.body.replace(/,"wait_ux":true/, '')).toBe(GOLDEN.hubPost);
      expect(out.doors.body).toBe(GOLDEN.doors);
    });
  });

  test.each([['the string true', 'true'], ['1', 1], ['an object', { on: true }], ['no row', undefined], ['a failed read', 'FAIL']])('%s: no header, every answer byte for byte the golden', async (_n, value) => {
    if (value === 'FAIL') { rows = [{ key: KEY, value: true }]; fail = true; } else if (value !== undefined) rows = [{ key: KEY, value }];
    await WaitUx.refresh();
    await serve(async (ask) => {
      const out = await ask();
      for (const k of Object.keys(GOLDEN)) { expect(out[k].st).toBeNull(); expect(out[k].body).toBe(GOLDEN[k]); }
    });
  });
});

describe('no settings read of its own', () => {
  test.each([['off', undefined], ['on', true]])('%s, a cold switch cache: a route the hub never touches makes 0 settings reads for it', async (_n, value) => {
    if (value !== undefined) rows = [{ key: KEY, value }];
    process.env.INTERNAL_API_KEY = 'route-key';
    const express = require('express');
    const Library = require('../../../shared/services/quiz/web-quiz-library');
    const spy = jest.spyOn(Library, 'libHub').mockImplementation(async () => ({ subjects: [] }));
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      settingsReads = 0;
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/wq/lib/h/abc.def`, { headers: { 'x-api-key': 'route-key' } });
      expect(r.status).toBe(200);
      expect(r.headers.get('server-timing')).toBeNull();
      await new Promise((res) => setImmediate(res));
      expect(settingsReads).toBe(0);
      expect(WaitUx.on()).toBe(false);
    } finally { spy.mockRestore(); await new Promise((r) => server.close(r)); }
  });
});
