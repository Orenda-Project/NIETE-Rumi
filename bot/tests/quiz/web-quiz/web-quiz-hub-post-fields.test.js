'use strict';
/**
 * Both hub answers carry every page field that is on. The page draws Home from the GET (the server-rendered first
 * page) and again from the POST (hub.js: a phone with no saved device, or a family with two or more children), so a
 * field only one of them carries is a Home that loses it on the other path. Pinned here for the designed wait
 * (`wait_ux`, app_settings web_quiz_wait_ux) and the one face (`one_face`, web_quiz_one_face), each on alone and both
 * on, with the step timings on as well (a header on the GET only; the fields unchanged). Off: neither field on either.
 * Supabase and the loggers are the boundaries; the hub's own answer is stood in, so what is compared is what the route adds.
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
let OneFace;
beforeEach(() => {
  jest.resetModules();
  rows = []; fail = false; settingsReads = 0;
  seed();
  WaitUx = require('../../../shared/services/quiz/web-quiz-wait-ux');
  OneFace = require('../../../shared/services/quiz/web-quiz-one-face');
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

const parsed = (out) => ({ get: JSON.parse(out.hubGet.body), post: JSON.parse(out.hubPost.body) });
async function settle(given) {
  rows = given;
  await WaitUx.refresh();
  await OneFace.flag();
}

describe('GET and POST /hub/:token carry the same page fields', () => {
  test.each([
    ['wait_ux on', [{ key: KEY, value: true }], { wait_ux: true }],
    ['one_face on', [{ key: 'web_quiz_one_face', value: true }], { one_face: true }],
    ['both on', [{ key: KEY, value: true }, { key: 'web_quiz_one_face', value: true }], { wait_ux: true, one_face: true }],
    ['both on, step timings on', [{ key: KEY, value: true }, { key: 'web_quiz_one_face', value: true }, { key: 'web_quiz_server_timing', value: true }], { wait_ux: true, one_face: true }],
  ])('%s: the POST answer is the GET answer, field for field', async (_n, given, fields) => {
    await settle(given);
    await serve(async (ask) => {
      const out = await ask();
      const { get, post } = parsed(out);
      expect(get).toMatchObject(fields);
      expect(post).toMatchObject(fields);
      expect(post).toEqual(get);
      expect(out.hubPost.st).toBeNull(); // the POST never says step timings
      expect(out.doors.body).toBe(JSON.stringify(DOORS));
    });
  });
  test('both off: neither field on either answer, both the hub\'s own answer', async () => {
    await settle([]);
    await serve(async (ask) => {
      const out = await ask();
      expect(out.hubGet.body).toBe(JSON.stringify(HUB));
      expect(out.hubPost.body).toBe(JSON.stringify(HUB));
    });
  });
});
