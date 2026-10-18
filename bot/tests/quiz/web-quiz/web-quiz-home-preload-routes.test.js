'use strict';
/**
 * The child home's preload switch on the hub routes (app_settings web_quiz_home_preload). On: the hub answer, GET and
 * POST, carries `home_pre: true` whatever builds it (the hub module's own answer, or another path that builds the
 * same JSON, e.g. the reads-together path): the route wraps the answer, so no builder can drop the key. Off (no row, a
 * non-true value, a failed read): the answer is the hub module's own, byte for byte. The carry reads no setting of its own
 * once the hub's batched switch read is warm. Supabase and the loggers are the boundaries; the hub module's answer is
 * stood in (one WITHOUT the key, as any builder that forgets it) so the bytes compared are exactly what the route adds.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const KEY = 'web_quiz_home_preload';
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

let Flags;
beforeEach(() => {
  jest.resetModules();
  rows = []; fail = false; settingsReads = 0;
  seed();
  Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
});

// The answer a builder that never names `home_pre` gives (today's hub() before this change; a reads-together path).
const HUB = { lang: 'en', kids: [{ kid: '0123456789abcdef', name: 'Sana Testwala' }], rt: false, fast: true, home_v3: 1 };

async function serve(fn) {
  process.env.INTERNAL_API_KEY = 'route-key';
  const express = require('express');
  const Hub = require('../../../shared/services/quiz/web-quiz-hub');
  const spy = jest.spyOn(Hub, 'hub').mockImplementation(async () => JSON.parse(JSON.stringify(HUB)));
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  const h = { 'x-api-key': 'route-key' };
  const ask = async () => ({
    hubGet: await (await fetch(`${base}/hub/abc.def`, { headers: h })).text(),
    hubPost: await (await fetch(`${base}/hub/abc.def`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' })).text(),
  });
  try { return await fn(ask); } finally { spy.mockRestore(); await new Promise((r) => server.close(r)); }
}

describe('web_quiz_home_preload on the hub routes', () => {
  test('on: GET and POST /hub answers carry home_pre: true even when the builder left it out; nothing else changes', async () => {
    rows = [{ key: KEY, value: true }];
    await Flags.flags();
    await serve(async (ask) => {
      const a = await ask();
      for (const k of ['hubGet', 'hubPost']) expect([k, JSON.parse(a[k])]).toEqual([k, { ...HUB, home_pre: true }]);
    });
  });

  test('on with the reads-together switch on as well (web_quiz_hub_fanout): the key still rides the answer', async () => {
    rows = [{ key: KEY, value: true }, { key: 'web_quiz_hub_fanout', value: true }];
    await Flags.flags();
    await serve(async (ask) => {
      const a = await ask();
      expect(JSON.parse(a.hubGet).home_pre).toBe(true);
      expect(JSON.parse(a.hubPost).home_pre).toBe(true);
    });
  });

  test.each([[undefined], [false], ['true'], [1], [{ on: true }]])('off (%p): the hub module\'s own answer, byte for byte', async (v) => {
    rows = v === undefined ? [] : [{ key: KEY, value: v }];
    await Flags.flags();
    await serve(async (ask) => {
      const a = await ask();
      expect(a).toEqual({ hubGet: JSON.stringify(HUB), hubPost: JSON.stringify(HUB) });
    });
  });

  test('a failed switch read: off, the answer untouched', async () => {
    fail = true;
    await serve(async (ask) => { expect(JSON.parse((await ask()).hubGet)).toEqual(HUB); });
  });

  // OFF: the routes' own settings reads around a stood-in hub answer, recorded on sandbox 572290214 (another page switch's
  // own key, not this one). ON must equal it: the carry answers from the hub's warm batched read, never a read of its own.
  const OFF_READS = 1;
  test('reads: OFF == the recorded constant; ON == OFF (the carry adds no settings read while the hub\'s read is warm)', async () => {
    await Flags.flags();
    settingsReads = 0;
    await serve(async (ask) => { await ask(); });
    expect(settingsReads).toBe(OFF_READS);
    jest.resetModules(); seed(); Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    rows = [{ key: KEY, value: true }];
    await Flags.flags();
    settingsReads = 0;
    await serve(async (ask) => { expect(JSON.parse((await ask()).hubGet).home_pre).toBe(true); });
    expect(settingsReads).toBe(OFF_READS);
  });
});
