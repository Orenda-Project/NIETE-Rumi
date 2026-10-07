'use strict';
/**
 * web_quiz.error keeps a SAFE `err`: the page's reason for an error has to reach
 * the logs, or a broken page on a real phone cannot be named.
 *
 * The page sends ev('error', {err}) with a fixed code ('session_401', 'more_net')
 * or a browser's own message ("Cannot read properties of null (reading 'x')").
 * The real route POST /api/internal/wq/e runs on an ephemeral port over the real
 * service; only the logger (whose calls are the log lines) and the network
 * boundaries are faked.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const express = require('express');

let server;
let base;
let logEvent;

beforeEach(async () => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  ({ logEvent } = require('../../../shared/utils/structured-logger'));
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterEach(async () => { await new Promise((r) => server.close(r)); });

const post = (events) => fetch(`${base}/e`, {
  method: 'POST', headers: { 'x-api-key': 'test-key', 'content-type': 'application/json' }, body: JSON.stringify({ events }),
});
const logged = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const page = (err) => ({ n: 'error', t: 1791347865363, code: 'QX6T2L', lang: 'en', err });

describe('POST /e — web_quiz.error carries a sanitised err', () => {
  test('a fixed code from the page arrives as is', async () => {
    expect((await post([page('session_401')])).status).toBe(204);
    expect(logged('web_quiz.error')).toEqual([{ code: 'QX6T2L', lang: 'en', t: 1791347865363, err: 'session_401' }]);
  });

  test("a browser's own message arrives lower-cased, cut at its first unsafe character", async () => {
    await post([page("Cannot read properties of null (reading 'x')")]);
    expect(logged('web_quiz.error')[0].err).toBe('cannot read properties of null');
  });

  test('a URL or token in the message never reaches the log: only the safe prefix before it', async () => {
    await post([
      page('load_failed https://x/r/eyJhbGciOiJIUzI1NiJ9.eyJ0IjoxfQ.sig'),
      page('https://x/r/eyJhbGciOiJIUzI1NiJ9'),
      page('bad token eyjhbgcioijiuzi1nij9eyj0ijoxfq'),
    ]);
    const errs = logged('web_quiz.error').map((p) => p.err);
    expect(errs[0]).toBe('load_failed');
    expect(errs[1]).toBeUndefined();
    expect(errs[2]).toBe('bad token');
    for (const e of errs.filter(Boolean)) expect(e).toMatch(/^[a-z0-9_ .:-]{1,80}$/);
  });

  test('capped at 80 characters', async () => {
    await post([page(`a${' word'.repeat(40)}`)]);
    const err = logged('web_quiz.error')[0].err;
    expect(err.length).toBeLessThanOrEqual(80);
    expect(err).toMatch(/^a( word)+$/);
  });

  test('any OTHER event keeps the strict err shape: free text is still dropped there', async () => {
    await post([{ n: 'audio_fallback', err: 'Some free text' }, { n: 'audio_fallback', err: 'net_fail' }]);
    expect(logged('web_quiz.audio_fallback')).toEqual([{}, { err: 'net_fail' }]);
  });
});
