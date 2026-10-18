'use strict';
/**
 * The designed wait across a page hop (app_settings web_quiz_wait_hops, web-quiz-wait-hops.js): with the designed wait
 * on (web_quiz_wait_ux) the hub answers, GET and POST, also say `wait_hops: true`, and the page's bar then shows while
 * the page is being left (dashboard web-quiz-wait-ux.js). Only the JSON boolean true turns it on; its own cached read
 * never waits (the first answer after a start is off). Off, or without the designed wait: the answers are today's.
 * Supabase and the loggers are the boundaries; the page modules' answers are stood in.
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
let Hops;
beforeEach(() => {
  jest.resetModules();
  rows = []; fail = false; settingsReads = 0;
  seed();
  WaitUx = require('../../../shared/services/quiz/web-quiz-wait-ux');
  Hops = require('../../../shared/services/quiz/web-quiz-wait-hops');
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


const HOPS = 'web_quiz_wait_hops';
async function settle(given) { rows = given; await WaitUx.refresh(); await Hops.flag(); }

describe('the hub answers carry wait_hops only with the designed wait on', () => {
  test('wait_ux and wait_hops on: GET and POST say wait_hops: true; nothing else changes', async () => {
    await settle([{ key: KEY, value: true }, { key: HOPS, value: true }]);
    await serve(async (ask) => {
      const out = await ask();
      for (const k of ['hubGet', 'hubPost']) {
        expect(JSON.parse(out[k].body)).toMatchObject({ wait_ux: true, wait_hops: true });
        expect(out[k].body.replace(/,"wait_ux":true,"wait_hops":true/, '')).toBe(GOLDEN[k]);
      }
      expect(out.doors.body).toBe(GOLDEN.doors);
    });
  });
  test.each([['wait_ux off', [{ key: HOPS, value: true }]], ['the string true', [{ key: KEY, value: true }, { key: HOPS, value: 'true' }]], ['no row', [{ key: KEY, value: true }]]])('%s: no wait_hops', async (_n, given) => {
    await settle(given);
    await serve(async (ask) => {
      const out = await ask();
      for (const k of ['hubGet', 'hubPost']) expect(JSON.parse(out[k].body)).not.toHaveProperty('wait_hops');
    });
  });
  test('its switch never waits: the first answer after a start, before its read lands, has no wait_hops', async () => {
    rows = [{ key: KEY, value: true }, { key: HOPS, value: true }];
    await WaitUx.refresh();
    await serve(async (ask) => {
      const out = await ask();
      expect(JSON.parse(out.hubGet.body)).not.toHaveProperty('wait_hops');
    });
  });
});
