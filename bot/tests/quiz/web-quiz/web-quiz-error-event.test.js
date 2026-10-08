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

  test("a browser's own message arrives as a lower-cased slug: each run of unsafe characters is one '_'", async () => {
    await post([page("Cannot read properties of null (reading 'x')")]);
    expect(logged('web_quiz.error')[0].err).toBe('cannot read properties of null _reading _x');
  });

  test("a message that STARTS with '[', a quote or '<' keeps its reason (it used to log blank)", async () => {
    await post([
      page('[object Event] x'),
      page('"undefined" is not valid JSON'),
      page("<anonymous>: Unexpected token '<'"),
      page('[object Object]'),
    ]);
    expect(logged('web_quiz.error').map((p) => p.err)).toEqual([
      'object event_ x', 'undefined_ is not valid json', 'anonymous_: unexpected token', 'object object',
    ]);
  });

  test("a message in another script still says so: 'unreadable', never blank, never the text", async () => {
    await post([page('خطا: صفحہ نہیں ملا'), page('[]'), page('   ')]);
    expect(logged('web_quiz.error').map((p) => p.err)).toEqual(['unreadable', 'unreadable', undefined]);
  });

  test("a child-name-shaped string inside a message is no more readable than before (it was cut there)", async () => {
    await post([
      page("Cannot read properties of undefined (reading 'Sara Ali')"),
      page('[Sara Ali] not found'),
      page('"Ayesha" is not valid JSON'),
      page("Cannot read properties of undefined (reading 'length')"),
      page('[object HTMLMediaElement] NotAllowedError'),
    ]);
    const errs = logged('web_quiz.error').map((p) => p.err);
    for (const e of errs.slice(0, 3)) expect(e).not.toMatch(/\b(sara|ali|ayesha)\b/);
    expect(errs[0]).toBe('cannot read properties of undefined _reading');
    expect(errs[3]).toBe('cannot read properties of undefined _reading _length');
    expect(errs[4]).toBe('object htmlmediaelement_ notallowederror');
  });

  test('a token or id word in the MIDDLE is removed, the reason after it kept', async () => {
    await post([page('[x] bad id ab12cd34ef56gh78ij90kl12 at load')]);
    expect(logged('web_quiz.error')[0].err).toBe('x_ bad id at load');
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

  test('src, line, col and the script file name reach the log; a URL or path as file never does', async () => {
    await post([
      { ...page('x'), src: 'win', line: 740, col: 12, file: 'wq.js' },
      { ...page('x'), src: 'rej', file: 'other' },
      { ...page('x'), src: 'h', file: 'https://x/wq.js', line: 'abc' },
      { ...page('x'), file: '../../etc/passwd' },
    ]);
    const [a, b, c, d] = logged('web_quiz.error');
    expect(a).toMatchObject({ src: 'win', line: 740, col: 12, file: 'wq.js' });
    expect(b).toMatchObject({ src: 'rej', file: 'other' });
    expect(c).toMatchObject({ src: 'h' });
    expect(c).not.toHaveProperty('file');
    expect(c).not.toHaveProperty('line');
    expect(d).not.toHaveProperty('file');
  });

  test("src 'rej': a capitalised word is '_' across the WHOLE message, a browser's own words kept", async () => {
    await post([
      { ...page('Ayesha Khan not found'), src: 'rej' },
      { ...page('[object Event]'), src: 'rej' },
      { ...page('NotAllowedError: play() failed'), src: 'rej' },
      { ...page('Ayesha Khan not found'), src: 'win' },
    ]);
    const errs = logged('web_quiz.error').map((p) => p.err);
    expect(errs[0]).toBe('not found');
    expect(errs[1]).toBe('object event');
    expect(errs[2]).toBe('notallowederror: play_ failed');
    expect(errs[3]).toBe('ayesha khan not found'); // a window error's text up to its first unsafe character: as before
  });

  test('any OTHER event keeps the strict err shape: free text is still dropped there', async () => {
    await post([{ n: 'audio_fallback', err: 'Some free text' }, { n: 'audio_fallback', err: 'net_fail' }]);
    expect(logged('web_quiz.audio_fallback')).toEqual([{}, { err: 'net_fail' }]);
  });
});

describe('POST /e — the Home button and the step-back carry their props through the allow-list', () => {
  test('home_tap {src, how} and back {src, step} arrive with every prop', async () => {
    await post([
      { n: 'home_tap', t: 1, code: 'QX6T2L', lang: 'en', src: 'm6', how: 'door' },
      { n: 'home_tap', t: 2, code: 'QX6T2L', lang: 'ur', src: 'm6_review', how: 'stay' },
      { n: 'back', t: 3, code: 'QX6T2L', lang: 'en', src: 'm6', step: 'review' },
      { n: 'home_tap', t: 4, code: 'QX6T2L', lang: 'en', src: 'm10', how: 'Not A Slug!' },
    ]);
    expect(logged('web_quiz.home_tap')).toEqual([
      { code: 'QX6T2L', lang: 'en', t: 1, src: 'm6', how: 'door' },
      { code: 'QX6T2L', lang: 'ur', t: 2, src: 'm6_review', how: 'stay' },
      { code: 'QX6T2L', lang: 'en', t: 4, src: 'm10' },
    ]);
    expect(logged('web_quiz.back')).toEqual([{ code: 'QX6T2L', lang: 'en', t: 3, src: 'm6', step: 'review' }]);
  });
});
