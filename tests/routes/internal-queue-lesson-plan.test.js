/**
 * bd-2461 — the bot exposes the LP enqueue over its internal API.
 *
 * The portal's "Prepare this lesson plan" never produced anything. It called
 * the bot's queue service via require('../../bot/shared/services/
 * lesson-plan-queue.service'), which throws inside the dashboard process:
 * the queue driver does `require('aws-sdk')` (v2) and the dashboard only
 * carries the v3 `@aws-sdk/*` packages. The require was wrapped in
 * `catch (_) {}`, so it degraded to writing an orphan row — and the portal
 * still answered `queued: true`. 21 rows accumulated over two days, none ever
 * picked up.
 *
 * The fix is not to give the dashboard queue powers. It is to stop it needing
 * them: the enqueue stays in the bot's process, where aws-sdk and
 * SQS_QUEUE_URL already exist, and the portal asks over HTTP.
 *
 * This is an established pattern here, already carrying production traffic —
 * dashboard/services/password-reset.service.js calls
 * POST /api/internal/send-password-reset with the same x-api-key. MAIN_BOT_URL
 * and INTERNAL_API_KEY are already set on the portal service, and the keys on
 * both services match.
 *
 * Contract:
 *   1. Rejects any caller without the exact shared key. No key, wrong key,
 *      empty key — all 401.
 *   2. Never authenticates when INTERNAL_API_KEY is unset on the bot, which
 *      would otherwise make `undefined === undefined` a valid credential.
 *   3. Validates the payload before touching the queue.
 *   4. Delegates to the SAME createAndQueueGrounded the bot's own handlers
 *      use — one enqueue implementation, no second copy of the job envelope.
 *   5. A queue failure is reported as a failure. The silent-success that hid
 *      this bug for two days must not be reproduced at the new seam.
 */

let router;
let createAndQueueGrounded;

function findRoute(r, method, path) {
  for (const layer of r.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map(s => s.handle);
    }
  }
  return null;
}

async function invoke({ headers = {}, body = {} } = {}) {
  const stack = findRoute(router, 'post', '/queue-lesson-plan');
  if (!stack) throw new Error('route POST /queue-lesson-plan not found');
  const req = { headers, body, ip: '127.0.0.1', method: 'POST', path: '/queue-lesson-plan' };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

const KEY = 'shared-secret-key';
const VALID = {
  userId: 'user-uuid-1',
  phoneNumber: '923001234567',
  sourceLpUuid: 'lp-uuid-1',
  topic: 'Memory Lane Topic',
  chapterTitle: 'Chapter 1',
  language: 'en',
};

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  createAndQueueGrounded = jest.fn().mockResolvedValue('request-uuid-1');
  jest.doMock('../../bot/shared/services/lesson-plan-queue.service', () => ({
    createAndQueueGrounded,
  }));
  router = require('../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('bd-2461 — POST /api/internal/queue-lesson-plan auth', () => {
  it('rejects a call with no api key', async () => {
    const { statusCode } = await invoke({ body: VALID });
    expect(statusCode).toBe(401);
  });

  it('rejects a wrong api key', async () => {
    const { statusCode } = await invoke({ headers: { 'x-api-key': 'nope' }, body: VALID });
    expect(statusCode).toBe(401);
  });

  it('does not queue anything when unauthorised', async () => {
    await invoke({ headers: { 'x-api-key': 'nope' }, body: VALID });
    expect(createAndQueueGrounded).not.toHaveBeenCalled();
  });

  it('refuses every caller when the bot has no INTERNAL_API_KEY set', async () => {
    // Otherwise a missing key on both sides makes `undefined === undefined`
    // a valid credential and the endpoint is open to the internet.
    jest.resetModules();
    delete process.env.INTERNAL_API_KEY;
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/services/lesson-plan-queue.service', () => ({ createAndQueueGrounded }));
    router = require('../../bot/shared/routes/internal-api.routes');

    const { statusCode } = await invoke({ body: VALID });

    expect(statusCode).toBe(401);
    expect(createAndQueueGrounded).not.toHaveBeenCalled();
  });
});

describe('bd-2461 — POST /api/internal/queue-lesson-plan behaviour', () => {
  const auth = { 'x-api-key': KEY };

  it('queues through the bot\'s own service and returns the request id', async () => {
    const { statusCode, payload } = await invoke({ headers: auth, body: VALID });

    expect(statusCode).toBe(202);
    expect(payload).toMatchObject({ success: true, requestId: 'request-uuid-1' });
  });

  it('passes the payload through unchanged — one job envelope, defined in one place', async () => {
    await invoke({ headers: auth, body: VALID });

    expect(createAndQueueGrounded).toHaveBeenCalledWith(expect.objectContaining({
      userId: VALID.userId,
      phoneNumber: VALID.phoneNumber,
      sourceLpUuid: VALID.sourceLpUuid,
      topic: VALID.topic,
      chapterTitle: VALID.chapterTitle,
      language: 'en',
    }));
  });

  it('says the ask was made in the portal, so its lifecycle row (when switched on) reads channel portal', async () => {
    await invoke({ headers: auth, body: VALID });

    expect(createAndQueueGrounded).toHaveBeenCalledWith(expect.objectContaining({ channel: 'portal' }));
  });

  it('rejects a payload with no sourceLpUuid before touching the queue', async () => {
    const { statusCode } = await invoke({ headers: auth, body: { ...VALID, sourceLpUuid: undefined } });

    expect(statusCode).toBe(400);
    expect(createAndQueueGrounded).not.toHaveBeenCalled();
  });

  it('rejects a payload with no userId', async () => {
    const { statusCode } = await invoke({ headers: auth, body: { ...VALID, userId: undefined } });
    expect(statusCode).toBe(400);
  });

  it('defaults an unrecognised language to en rather than guessing', async () => {
    await invoke({ headers: auth, body: { ...VALID, language: 'fr' } });
    expect(createAndQueueGrounded).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
  });

  it('honours ur', async () => {
    await invoke({ headers: auth, body: { ...VALID, language: 'ur' } });
    expect(createAndQueueGrounded).toHaveBeenCalledWith(expect.objectContaining({ language: 'ur' }));
  });

  it('reports a queue failure as a failure — never a silent success', async () => {
    createAndQueueGrounded.mockRejectedValueOnce(new Error('SQS unreachable'));

    const { statusCode, payload } = await invoke({ headers: auth, body: VALID });

    expect(statusCode).toBeGreaterThanOrEqual(500);
    expect(payload.success).toBe(false);
  });
});
