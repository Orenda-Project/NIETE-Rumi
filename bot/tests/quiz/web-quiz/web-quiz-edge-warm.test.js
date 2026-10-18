'use strict';
/**
 * The portal's retry and warm touch (app_settings web_quiz_edge_warm, web-quiz-edge-warm.js), riding the one learner's
 * answer (GET /api/internal/wq/edge, web-quiz-edge-learn.js; app_settings web_quiz_edge_learn). With both on, the
 * answer adds `edge_warm: true` (the portal's streamed page then asks again on a failed answer) and each ask touches the
 * hub's one switch read, so those switches stay warm on the bot. Edge warm off, or a non-true value, or a failed read:
 * no field and no hub read. Edge learn off: `{learn: false}` and edge warm is not even read.
 * Supabase and the loggers are the boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const KEY = 'web_quiz_edge_warm';
const LEARN = 'web_quiz_edge_learn';
let rows = [];
let fail = false;
let reads = [];
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from(t) {
      const st = { key: null, keys: null };
      if (t === 'app_settings') reads.push(st);
      const b = {
        select() { return b; },
        eq(c, v) { if (c === 'key') st.key = v; return b; },
        in(c, v) { st.keys = v; return b; },
        async maybeSingle() {
          if (fail && st.key === KEY) return { data: null, error: { message: 'down' } };
          return { data: rows.find((r) => r.key === st.key) || null, error: null };
        },
        then(res, rej) { return Promise.resolve({ data: t === 'app_settings' ? rows.filter((r) => (st.keys ? st.keys.includes(r.key) : r.key === st.key)) : [], error: null }).then(res, rej); },
      };
      return b;
    },
  });
}

let Learn;
beforeEach(() => {
  jest.resetModules();
  rows = []; fail = false; reads = [];
  seed();
  Learn = require('../../../shared/services/quiz/web-quiz-edge-learn');
});
const hubReads = () => reads.filter((r) => Array.isArray(r.keys) && r.keys.includes('web_quiz_hub')).length;
const keyReads = (k) => reads.filter((r) => r.key === k).length;

describe('the learner\'s answer with edge warm', () => {
  test('both on: edge_warm: true, and the hub\'s one switch read is touched', async () => {
    rows = [{ key: LEARN, value: true }, { key: KEY, value: true }];
    const out = await Learn.answer();
    expect(out).toMatchObject({ learn: true, edge_warm: true });
    expect(hubReads()).toBe(1);
  });
  test.each([['no row', undefined], ['the string true', 'true'], ['1', 1], ['false', false]])('edge warm %s: no field, no hub read', async (_n, value) => {
    rows = [{ key: LEARN, value: true }, ...(value === undefined ? [] : [{ key: KEY, value }])];
    const out = await Learn.answer();
    expect(out.learn).toBe(true);
    expect(out).not.toHaveProperty('edge_warm');
    expect(hubReads()).toBe(0);
  });
  test('edge warm\'s read fails: no field, no hub read', async () => {
    rows = [{ key: LEARN, value: true }, { key: KEY, value: true }]; fail = true;
    const out = await Learn.answer();
    expect(out).not.toHaveProperty('edge_warm');
    expect(hubReads()).toBe(0);
  });
  test('edge learn off: {learn: false}, and edge warm is not read at all', async () => {
    rows = [{ key: KEY, value: true }];
    expect(await Learn.answer()).toEqual({ learn: false });
    expect(keyReads(KEY)).toBe(0);
    expect(hubReads()).toBe(0);
  });
  test('its own switch is read once per cache window', async () => {
    rows = [{ key: LEARN, value: true }, { key: KEY, value: true }];
    await Learn.answer();
    await Learn.answer();
    expect(keyReads(KEY)).toBe(1);
  });
});
