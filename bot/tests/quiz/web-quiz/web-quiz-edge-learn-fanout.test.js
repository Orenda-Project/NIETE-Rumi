'use strict';
/**
 * With the hub's reads-together switch on (app_settings web_quiz_hub_fanout: hub() answers from hubTogether()), the hub
 * answer still says `edge_learn: true` while web_quiz_edge_learn is on: the key is added by the route around hub(), not
 * inside the normal build, so the fanout answer cannot drop it. Supabase and the loggers are the boundaries; hub() is
 * stood in by a fanout-shaped answer (no edge_learn of its own).
 */
jest.mock('../../../shared/config/supabase', () => {
  const state = { rows: {} };
  const from = () => {
    let keys = null;
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      in: (_c, ks) => { keys = ks; return q; },
      then: (res, rej) => Promise.resolve({ data: (keys || []).filter((k) => k in state.rows).map((k) => ({ key: k, value: state.rows[k] })), error: null }).then(res, rej),
    };
    return q;
  };
  return { from, __state: state };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const express = require('express');
const supabase = require('../../../shared/config/supabase');

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const FANOUT_ANSWER = () => ({ lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Star Testwala' }], kid: '0123456789abcdef', brand: 'niete' });

describe('fanout ON: the hub answer still carries edge_learn', () => {
  let server; let base;
  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = 'route-key';
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  test('hub() takes the fanout path (hubTogether) inside itself, so the route\'s carry wraps that answer too', () => {
    const src = fs.readFileSync(require.resolve('../../../shared/services/quiz/web-quiz-hub'), 'utf8');
    expect(src).toMatch(/if \(Flags\.fanoutNow\(\)\) return hubTogether\(token, opts\);/);
  });

  test.each([['GET'], ['POST']])('%s /hub/:token with fanout and edge_learn on: edge_learn: true; edge_learn off: untouched', async (method) => {
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    const Hub = require('../../../shared/services/quiz/web-quiz-hub');
    const spy = jest.spyOn(Hub, 'hub').mockImplementation(async () => (Flags.fanoutNow() ? FANOUT_ANSWER() : { normal: true }));
    try {
      const ask = async () => {
        const r = await fetch(`${base}/hub/${TOKEN}`, { method, headers: { 'x-api-key': 'route-key', 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
        return r.json();
      };
      Flags._resetCache();
      Flags.prime([{ key: 'web_quiz_hub_fanout', value: true }, { key: 'web_quiz_edge_learn', value: true }], Date.now());
      const on = await ask();
      expect(on.normal).toBeUndefined(); // the fanout answer
      expect(on.edge_learn).toBe(true);
      Flags._resetCache();
      Flags.prime([{ key: 'web_quiz_hub_fanout', value: true }], Date.now());
      const off = await ask();
      expect(JSON.stringify(off)).toBe(JSON.stringify(FANOUT_ANSWER()));
    } finally {
      spy.mockRestore();
    }
  });
});
