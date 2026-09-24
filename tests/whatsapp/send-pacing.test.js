/**
 * Per-recipient send pacing and rate-limit retry for every WhatsApp send.
 *
 * THE BUG. Meta allows a business roughly one message every 6 seconds to ONE phone (bursts
 * tolerated) and answers anything faster with error 131056, "(Business Account, Consumer Account)
 * pair rate limit hit". Nothing in whatsapp.service paced sends per phone, and every sender caught
 * the refusal, logged it at info and returned false — the message was simply lost. Production, 30
 * days: 11,711 sends refused with 131056 (training answers, LP bundles, child quizzes; 2,015 of them
 * the reaction we put on every tap), while the business-wide limits (130429, 131048) never fired.
 *
 * THE FIX, exercised here through the REAL WhatsAppService (only the network is faked: `fetch`,
 * the axios stub, and the Redis client boundary):
 *   1. a 131056 / 130429 / 131048 refusal is retried with backoff, a bounded number of times;
 *   2. nothing else is ever retried — a message Meta did not explicitly refuse may have been
 *      delivered, and a retry would send it twice;
 *   3. every send reserves a slot in its phone's schedule first, so a burst to one phone is spaced
 *      out instead of refused, while a reply to a quiet phone goes out with no wait at all;
 *   4. a reaction is best-effort — sent only when the phone has room, never waited for or retried;
 *   5. every refusal is a structured `whatsapp.rate_limited` event (warn while retrying, error when
 *      giving up), carrying the Meta code, the attempt, the delay and the call site.
 *
 * The Redis boundary is a fake that keeps the same per-phone schedule the Lua script keeps (see
 * FakePairStore). The Lua script itself is exercised against a real Redis in
 * send-pacing.redis.test.js.
 */

jest.mock('../../bot/shared/utils/constants', () => ({
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(),
  downloadMedia: jest.fn(),
  extractKeyFromUrl: jest.fn(),
}));

// The Redis boundary: same arithmetic as the Lua script (see helpers/fake-pair-store.js).
const { FakePairStore } = require('./helpers/fake-pair-store');
const mockStore = new FakePairStore();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => mockStore.isAvailable(),
  evalScript: (...a) => mockStore.evalScript(...a),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
}));

const axios = require('axios'); // mapped stub — axios.post is a jest.fn
const { logToFile } = require('../../bot/shared/utils/logger');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const PHONE_A = '923001110001';
const PHONE_B = '923001110002';

const ok = (id = 'wamid.OK') => ({ ok: true, status: 200, json: async () => ({ messages: [{ id }] }) });
const refused = (code) => ({
  ok: false,
  status: 400,
  json: async () => ({ error: { message: `(#${code}) refused`, code, type: 'OAuthException', fbtrace_id: 'X' } }),
});
const axiosRefusal = (code) => Object.assign(new Error('Request failed with status code 400'), {
  response: { status: 400, data: { error: { message: `(#${code}) refused`, code, fbtrace_id: 'X' } } },
});

const eventsNamed = (name) => logToFile.mock.calls.filter((c) => c[0] === name);
const messagesPosts = () => axios.post.mock.calls.filter((c) => /\/messages$/.test(c[0]));

beforeEach(() => {
  jest.useRealTimers();
  mockStore.tat.clear();
  mockStore.calls = [];
  mockStore.available = true;
  logToFile.mockClear();
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.AX' }] }, status: 200 });
  global.fetch = jest.fn().mockResolvedValue(ok());
  // Short, deterministic delays: the retry and pacing arithmetic is the same at any scale.
  process.env.WA_RATE_LIMIT_RETRY_BASE_MS = '20';
  process.env.WA_PAIR_INTERVAL_MS = '6000';
  process.env.WA_PAIR_BURST = '8';
  delete process.env.WA_PAIR_MAX_WAIT_MS;
  delete process.env.WA_RATE_LIMIT_MAX_ATTEMPTS;
  delete process.env.WA_PAIR_PACING;
});

afterAll(() => {
  delete process.env.WA_RATE_LIMIT_RETRY_BASE_MS;
  delete process.env.WA_PAIR_INTERVAL_MS;
  delete process.env.WA_PAIR_BURST;
});

describe('a Meta rate-limit refusal is retried, not dropped', () => {
  // After a 131056 the phone drops to its sustained spacing, so a second retry waits a full
  // interval; a 10 ms interval keeps these tests fast without changing the arithmetic.
  beforeEach(() => { process.env.WA_PAIR_INTERVAL_MS = '10'; });

  test('131056 on a text (fetch transport): the retry succeeds and the caller sees success', async () => {
    global.fetch.mockResolvedValueOnce(refused(131056)).mockResolvedValueOnce(ok('wamid.RETRIED'));

    const result = await WhatsAppService.sendMessage(PHONE_A, 'hello');

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const warn = eventsNamed('whatsapp.rate_limited');
    expect(warn).toHaveLength(1);
    expect(warn[0][2]).toBe('warn');
    expect(warn[0][1]).toMatchObject({ event: 'whatsapp.rate_limited', code: 131056, attempt: 1, kind: 'text' });
    expect(warn[0][1].delayMs).toBeGreaterThanOrEqual(20);
    // The call site is the caller of the WhatsApp service — here, this test file.
    expect(warn[0][1].callSite).toMatch(/send-pacing\.test\.js:\d+/);
    expect(warn[0][1].method).toMatch(/sendMessage/);
    // A hash, never the number.
    expect(JSON.stringify(warn[0][1])).not.toContain(PHONE_A);
  });

  test('131056 on interactive buttons (axios transport) is retried', async () => {
    axios.post.mockRejectedValueOnce(axiosRefusal(131056));

    const result = await WhatsAppService.sendInteractiveButtons(PHONE_A, {
      body: 'Pick one', buttons: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    });

    expect(result).toBeTruthy();
    expect(messagesPosts()).toHaveLength(2);
    expect(eventsNamed('whatsapp.rate_limited')[0][1]).toMatchObject({ code: 131056, attempt: 1 });
  });

  test('a retried document send uploads its media ONCE — only the /messages POST is repeated', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const file = path.join(os.tmpdir(), `pacing-test-${process.pid}.pdf`);
    fs.writeFileSync(file, '%PDF-1.4 test');
    axios.post.mockImplementation(async (url) => {
      if (/\/media$/.test(url)) return { data: { id: 'media-1' } };
      return { data: { messages: [{ id: 'wamid.DOC' }] } };
    });
    axios.post.mockImplementationOnce(async () => ({ data: { id: 'media-1' } })) // upload
      .mockImplementationOnce(async () => { throw axiosRefusal(131056); }); // first send

    const result = await WhatsAppService.sendDocument(PHONE_A, file, 'lesson.pdf', 'caption');

    fs.unlinkSync(file);
    expect(result).toBeTruthy();
    expect(axios.post.mock.calls.filter((c) => /\/media$/.test(c[0]))).toHaveLength(1);
    expect(messagesPosts()).toHaveLength(2);
  });

  test.each([130429, 131048])('%i (business-wide limits) is retried too', async (code) => {
    global.fetch.mockResolvedValueOnce(refused(code)).mockResolvedValueOnce(ok());

    await expect(WhatsAppService.sendMessage(PHONE_A, 'hi')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(eventsNamed('whatsapp.rate_limited')[0][1]).toMatchObject({ code });
  });

  test('the retry budget is bounded: three attempts, then an error-level give-up and false', async () => {
    global.fetch.mockResolvedValue(refused(131056));

    await expect(WhatsAppService.sendMessage(PHONE_A, 'hi')).resolves.toBe(false);

    expect(global.fetch).toHaveBeenCalledTimes(3);
    const events = eventsNamed('whatsapp.rate_limited');
    expect(events.map((e) => e[2])).toEqual(['warn', 'warn', 'error']);
    expect(events[2][1]).toMatchObject({ code: 131056, attempt: 3, gaveUp: true });
  });

  test('backoff grows between attempts', async () => {
    global.fetch.mockResolvedValue(refused(131056));
    await WhatsAppService.sendMessage(PHONE_A, 'hi');
    const [first, second] = eventsNamed('whatsapp.rate_limited').map((e) => e[1].delayMs);
    expect(second).toBeGreaterThan(first);
  });
});

describe('nothing else is retried — a retry must never send a message twice', () => {
  test.each([
    ['131047 (24 h window closed)', 131047],
    ['100 (invalid parameter)', 100],
    ['131000 (something went wrong — Meta may have taken it)', 131000],
    ['2 (service temporarily unavailable)', 2],
  ])('%s: exactly one attempt', async (_label, code) => {
    global.fetch.mockResolvedValue(refused(code));
    await expect(WhatsAppService.sendMessage(PHONE_A, 'hi')).resolves.toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(eventsNamed('whatsapp.rate_limited')).toHaveLength(0);
  });

  test('a network error (the request may have reached Meta) is not retried', async () => {
    global.fetch.mockRejectedValue(new TypeError('fetch failed'));
    await expect(WhatsAppService.sendMessage(PHONE_A, 'hi')).resolves.toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('an axios ECONNRESET is not retried', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
    await WhatsAppService.sendInteractiveButtons(PHONE_A, {
      body: 'Pick one', buttons: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    });
    expect(messagesPosts()).toHaveLength(1);
  });

  test('a successful send is sent exactly once', async () => {
    await expect(WhatsAppService.sendMessage(PHONE_A, 'hi')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a reaction refused with 131056 is not retried (it is best-effort)', async () => {
    global.fetch.mockResolvedValue(refused(131056));
    await expect(WhatsAppService.sendReaction(PHONE_A, 'wamid.IN', '👍')).resolves.toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('sends to one phone are paced across the burst; other phones are not affected', () => {
  test('a reply to a quiet phone goes out with no wait at all', async () => {
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    const p = WhatsAppService.sendMessage(PHONE_A, 'hi');
    // No timer advance: if the send waited on anything but I/O, fetch would not have run yet.
    await jest.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await expect(p).resolves.toBe(true);
    expect(eventsNamed('whatsapp.paced')).toHaveLength(0);
  });

  test('the 9th back-to-back send to one phone waits one interval; another phone does not wait', async () => {
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await WhatsAppService.sendMessage(PHONE_A, `m${i}`);
    }
    expect(global.fetch).toHaveBeenCalledTimes(8);

    const ninth = WhatsAppService.sendMessage(PHONE_A, 'm8');
    const other = WhatsAppService.sendMessage(PHONE_B, 'hello B');
    await jest.advanceTimersByTimeAsync(0);
    const toOf = (call) => JSON.parse(call[1].body).to;
    expect(global.fetch.mock.calls.map(toOf).filter((t) => t === PHONE_B)).toHaveLength(1);
    expect(global.fetch.mock.calls.map(toOf).filter((t) => t === PHONE_A)).toHaveLength(8);

    await jest.advanceTimersByTimeAsync(5999);
    expect(global.fetch.mock.calls.map(toOf).filter((t) => t === PHONE_A)).toHaveLength(8);
    await jest.advanceTimersByTimeAsync(1);
    expect(global.fetch.mock.calls.map(toOf).filter((t) => t === PHONE_A)).toHaveLength(9);
    await expect(ninth).resolves.toBe(true);
    await expect(other).resolves.toBe(true);

    const paced = eventsNamed('whatsapp.paced');
    expect(paced).toHaveLength(1);
    expect(paced[0][1]).toMatchObject({ event: 'whatsapp.paced', outcome: 'waited', delayMs: 6000, kind: 'text' });
  });

  test('a reaction to a phone with no room is skipped — not queued, not sent', async () => {
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await WhatsAppService.sendMessage(PHONE_A, `m${i}`);
    }
    const reacted = await WhatsAppService.sendReaction(PHONE_A, 'wamid.IN', '👍');

    expect(reacted).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(8);
    expect(eventsNamed('whatsapp.paced').map((e) => e[1].outcome)).toEqual(['skipped']);
  });

  test('a reaction to a phone with room goes out immediately', async () => {
    await expect(WhatsAppService.sendReaction(PHONE_A, 'wamid.IN', '👍')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a 131056 pushes the whole phone back, so the next send to it waits too', async () => {
    global.fetch.mockResolvedValueOnce(refused(131056));
    await WhatsAppService.sendMessage(PHONE_A, 'refused then retried');
    expect(mockStore.calls.some((c) => c.args[3] === 'penalize')).toBe(true);

    jest.useFakeTimers({ now: Date.now() });
    const next = WhatsAppService.sendMessage(PHONE_A, 'next');
    await jest.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(2); // the refused one + its retry; `next` is waiting
    await jest.advanceTimersByTimeAsync(6000);
    await expect(next).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('a phone whose queue is already too deep is shed with an error, not queued for minutes', async () => {
    process.env.WA_PAIR_MAX_WAIT_MS = '15000';
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await WhatsAppService.sendMessage(PHONE_A, `m${i}`);
    }
    // q1 waits 6 s and q2 12 s — both within 15 s; q3 would wait 18 s.
    const queued = [WhatsAppService.sendMessage(PHONE_A, 'q1'), WhatsAppService.sendMessage(PHONE_A, 'q2')];
    const shed = await WhatsAppService.sendMessage(PHONE_A, 'q3');

    expect(shed).toBe(false);
    const errors = eventsNamed('whatsapp.rate_limited').filter((e) => e[2] === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0][1]).toMatchObject({ code: 'local_max_wait', outcome: 'shed' });
    await jest.advanceTimersByTimeAsync(12000);
    await Promise.all(queued);
    expect(global.fetch).toHaveBeenCalledTimes(10);
  });

  test('the typing indicator (a read receipt, not a message) is never paced', async () => {
    await WhatsAppService.showTypingIndicator(PHONE_A, 'wamid.IN');
    expect(mockStore.calls).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('fail-open: no Redis, or pacing switched off, behaves exactly as before', () => {
  test('Redis unavailable: twenty back-to-back sends to one phone all go immediately', async () => {
    mockStore.available = false;
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    const sends = Array.from({ length: 20 }, (_, i) => WhatsAppService.sendMessage(PHONE_A, `m${i}`));
    await jest.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(20);
    await Promise.all(sends);
  });

  test('WA_PAIR_PACING=off: no reservation is made', async () => {
    process.env.WA_PAIR_PACING = 'off';
    await WhatsAppService.sendMessage(PHONE_A, 'hi');
    expect(mockStore.calls).toHaveLength(0);
  });

  test('a Redis that hangs does not hold the reply: past 750 ms the send goes unpaced', async () => {
    jest.useFakeTimers({ now: 1_800_000_000_000 });
    const hang = jest.spyOn(mockStore, 'evalScript').mockImplementation(() => new Promise(() => {}));
    const p = WhatsAppService.sendMessage(PHONE_A, 'hi');
    await jest.advanceTimersByTimeAsync(749);
    expect(global.fetch).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await expect(p).resolves.toBe(true);
    hang.mockRestore();
  });

  test('a POST with no recipient (the typing indicator) is never retried', async () => {
    global.fetch.mockResolvedValue(refused(131056));
    await WhatsAppService.showTypingIndicator(PHONE_A, 'wamid.IN');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('an env var copied empty from .env.template means the default, not zero', () => {
    const pacer = require('../../bot/shared/services/whatsapp-send-pacer');
    process.env.WA_PAIR_MAX_WAIT_MS = '';
    process.env.WA_PAIR_INTERVAL_MS = '';
    process.env.WA_PAIR_BURST = '';
    expect(pacer.config()).toMatchObject({ intervalMs: 6000, burst: 8, maxWaitMs: 120000, maxAttempts: 3 });
  });

  test('a rate-limit retry still works without Redis', async () => {
    mockStore.available = false;
    global.fetch.mockResolvedValueOnce(refused(131056)).mockResolvedValueOnce(ok());
    await expect(WhatsAppService.sendMessage(PHONE_A, 'hi')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
