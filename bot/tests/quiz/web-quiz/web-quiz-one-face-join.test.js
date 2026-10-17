'use strict';
/**
 * The join page's shell answer (GET /join/page/:token) and the one-face switch (app_settings web_quiz_one_face): on, an
 * ok or stale answer says `one_face: true`; off (anything but the JSON boolean true), the answer is byte for byte the
 * join module's own. The switch is never waited for, and adds no settings read when it is warm (the join page has no
 * settings read of its own beyond the join switch inside pageInfo, stood in here).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const KEY = 'web_quiz_one_face';
let rows = [];
let fail = false;
let settingsReads = 0;
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from(t) {
      const st = { key: null };
      const b = {
        select() { return b; },
        eq(c, v) { if (c === 'key') st.key = v; return b; },
        async maybeSingle() {
          if (t === 'app_settings') settingsReads += 1;
          if (fail) return { data: null, error: { message: 'down' } };
          return { data: rows.find((r) => r.key === st.key) || null, error: null };
        },
      };
      return b;
    },
  });
}
// The base's settings reads on this route with the switch off and warm: none of its own (the join module's switch is stood in).
const BASE_SETTINGS_READS_WARM = 0;

let OneFace;
beforeEach(() => { jest.resetModules(); rows = []; fail = false; settingsReads = 0; seed(); OneFace = require('../../../shared/services/quiz/web-quiz-one-face'); });

const OK = { ok: true, lang: 'ur', practice: false, bot: '920000000100' };
const STALE = { stale: true, lang: 'ur', bot: '920000000100' };
const OFF_VALUES = [['the string true', 'true'], ['a quoted string', '"true"'], ['yes', 'yes'], ['the number 1', 1], ['an object', { enabled: true }], ['false', false], ['null', null]];

async function serve(answer, fn) {
  process.env.INTERNAL_API_KEY = 'route-key';
  const express = require('express');
  const Join = require('../../../shared/services/quiz/web-quiz-student-join');
  const spy = jest.spyOn(Join, 'pageInfo').mockImplementation(async () => JSON.parse(JSON.stringify(answer)));
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const ask = async () => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/wq/join/page/tok`, { headers: { 'x-api-key': 'route-key' } }); return { status: r.status, text: await r.text() }; };
  try { return await fn(ask); } finally { spy.mockRestore(); await new Promise((r) => server.close(r)); }
}

describe('GET /join/page/:token', () => {
  test('on: the ok answer says one_face: true and nothing else changes', async () => {
    rows = [{ key: KEY, value: true }];
    await OneFace.flag();
    await serve(OK, async (ask) => {
      const out = await ask();
      expect(out.status).toBe(200);
      expect(JSON.parse(out.text).one_face).toBe(true);
      expect(out.text.replace(/,"one_face":true/, '')).toBe(JSON.stringify(OK));
    });
  });

  test('on: the stale answer says one_face: true too, and nothing else changes', async () => {
    rows = [{ key: KEY, value: true }];
    await OneFace.flag();
    await serve(STALE, async (ask) => {
      const out = await ask();
      expect(out.status).toBe(410);
      expect(JSON.parse(out.text)).toEqual({ error: 'stale', lang: 'ur', bot: OK.bot, one_face: true });
    });
  });

  test('on: the join switch off (404) stays the 404, with no field', async () => {
    rows = [{ key: KEY, value: true }];
    await OneFace.flag();
    await serve({ off: true }, async (ask) => {
      const out = await ask();
      expect(out.status).toBe(404);
      expect(out.text).toBe(JSON.stringify({ error: 'off' }));
    });
  });

  test.each([...OFF_VALUES, ['no row', undefined], ['a failed read', 'FAIL']])('%s: every answer is byte for byte the OFF golden', async (_n, value) => {
    if (value === 'FAIL') { rows = [{ key: KEY, value: true }]; fail = true; } else if (value !== undefined) rows = [{ key: KEY, value }];
    await OneFace.flag();
    await serve(OK, async (ask) => { expect((await ask()).text).toBe(JSON.stringify(OK)); });
    await serve(STALE, async (ask) => { expect((await ask()).text).toBe(JSON.stringify({ error: 'stale', lang: 'ur', bot: OK.bot })); });
  });

  test('a cold switch never holds the answer: the first answer is today\'s, the next (read behind it) says one_face', async () => {
    rows = [{ key: KEY, value: true }];
    await serve(OK, async (ask) => {
      expect((await ask()).text).toBe(JSON.stringify(OK));
      await new Promise((r) => setTimeout(r, 20));
      expect(JSON.parse((await ask()).text).one_face).toBe(true);
    });
    expect(settingsReads).toBe(1);
  });

  test('settings reads: warm, on = off = the base\'s number, and a cold start is one background read', async () => {
    const reads = async (value) => {
      settingsReads = 0; jest.resetModules(); seed(); rows = [{ key: KEY, value }];
      const O = require('../../../shared/services/quiz/web-quiz-one-face');
      await O.flag();
      settingsReads = 0;
      await serve(OK, async (ask) => { await ask(); await ask(); });
      return settingsReads;
    };
    const on = await reads(true);
    const off = await reads(false);
    expect(on).toBe(off);
    expect(off).toBeLessThanOrEqual(BASE_SETTINGS_READS_WARM);
  });
});
