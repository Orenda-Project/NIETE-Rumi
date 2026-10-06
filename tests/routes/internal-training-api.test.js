/**
 * bd-2479 — the bot exposes its training DECISION layer over the internal API.
 *
 * WHY THIS EXISTS
 * ---------------
 * The portal reimplements the bot's training rules in its own process, and the
 * copies have rotted. Found live on 2026-08-02, with the portal's own comments
 * claiming parity that does not exist ("mirror the WhatsApp endpoint's rule
 * exactly", "Same rule as the WhatsApp Flow"):
 *
 *   | Rule                    | Bot                     | Portal                    |
 *   |-------------------------|-------------------------|---------------------------|
 *   | counts as a level pass  | ['grand','capstone']    | 'grand' only              |
 *   | "ready for exam"        | every module (bd-2447)  | >=1 module per course     |
 *   | missing vendor row      | not chain-locked        | chain-locked              |
 *   | module order gate       | checkModuleUnlocked     | ABSENT ENTIRELY (bd-2448) |
 *
 * Two of those contradict fixes announced as shipped. The capstone one means
 * the first Beacon House certificate ever issued is invisible to the portal.
 *
 * WHY HTTP RATHER THAN A SHARED IMPORT
 * ------------------------------------
 * Already settled by bd-2461: the dashboard requiring bot code throws
 * (aws-sdk v2 vs v3, separate node_modules, separate Railway services) and the
 * throw was swallowed. A gate that can silently vanish is not a gate. The
 * decision stays in the bot's process and the portal asks over HTTP — the same
 * pattern as /queue-lesson-plan and /send-password-reset.
 *
 * THE CONTRACT
 * ------------
 *   1. Every route is key-authed, and refuses everyone when INTERNAL_API_KEY
 *      is unset (else `undefined === undefined` is a valid credential).
 *   2. Each route DELEGATES to the bot's exported domain function. No route may
 *      re-derive a rule — that is the bug this whole migration removes.
 *   3. The bot's answer is passed through verbatim, so the portal cannot
 *      reinterpret it. A capstone pass stays a pass; a locked level stays
 *      locked, with the bot's own message.
 *   4. Payloads are validated before any work.
 *   5. A failure is reported as a failure. Never a silent success — that is
 *      exactly how bd-2461 hid for two days.
 */

let router;
let training;

function findRoute(r, method, path) {
  for (const layer of r.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map(s => s.handle);
    }
  }
  return null;
}

async function invoke(path, { headers = {}, body = {} } = {}) {
  const stack = findRoute(router, 'post', path);
  if (!stack) throw new Error(`route POST ${path} not found`);
  const req = { headers, body, ip: '127.0.0.1', method: 'POST', path };
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
const auth = { 'x-api-key': KEY };
const USER = 'user-uuid-1';

// A capstone-certified level. The portal's own copy of this rule rejects it,
// which is the single sharpest reason this endpoint exists.
const LEVEL_STATES = [
  {
    id: 18, order_index: 2, name: 'English', state: 'certified',
    unlock_logic: 'all_modules', courses_total: 5, courses_completed: 5,
    pct_complete: 100, grand_quiz_id: 29,
  },
  {
    id: 19, order_index: 3, name: 'Maths', state: 'locked',
    unlock_logic: 'chain', courses_total: 4, courses_completed: 0,
    pct_complete: 0, grand_quiz_id: 30,
  },
];

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/services/lesson-plan-queue.service', () => ({
    createAndQueueGrounded: jest.fn().mockResolvedValue('req-1'),
  }));

  training = {
    loadVisibleLevelsWithProgress: jest.fn().mockResolvedValue(LEVEL_STATES),
    checkLevelUnlocked: jest.fn().mockResolvedValue({ ok: true }),
    checkModuleUnlocked: jest.fn().mockResolvedValue({ ok: true }),
    assertCanStartGrandQuiz: jest.fn().mockResolvedValue({ ok: true, quiz: { id: 29 } }),
    loadGrandQuizState: jest.fn().mockResolvedValue({ state: 'available', quiz_id: 29 }),
  };
  jest.doMock('../../bot/shared/routes/teacher-training-endpoint', () => training);

  router = require('../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

const ROUTES = [
  ['/training/level-states', { userId: USER }],
  ['/training/level-unlocked', { userId: USER, levelId: 18 }],
  ['/training/module-unlocked', { userId: USER, moduleId: 223 }],
  ['/training/exam-gate', { userId: USER, levelOrder: 2, vendorKey: 'beacon_house' }],
  ['/training/grand-quiz-state', { userId: USER, levelId: 18 }],
];

describe('bd-2479 — auth applies to the whole training surface', () => {
  it.each(ROUTES)('%s rejects a call with no api key', async (path, body) => {
    const { statusCode } = await invoke(path, { body });
    expect(statusCode).toBe(401);
  });

  it.each(ROUTES)('%s rejects a wrong api key', async (path, body) => {
    const { statusCode } = await invoke(path, { headers: { 'x-api-key': 'nope' }, body });
    expect(statusCode).toBe(401);
  });

  it('refuses every caller when the bot has no INTERNAL_API_KEY set', async () => {
    jest.resetModules();
    delete process.env.INTERNAL_API_KEY;
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/routes/teacher-training-endpoint', () => training);
    router = require('../../bot/shared/routes/internal-api.routes');

    const { statusCode } = await invoke('/training/level-states', { body: { userId: USER } });

    expect(statusCode).toBe(401);
    expect(training.loadVisibleLevelsWithProgress).not.toHaveBeenCalled();
  });

  it('does no work at all when unauthorised', async () => {
    await invoke('/training/module-unlocked', {
      headers: { 'x-api-key': 'nope' }, body: { userId: USER, moduleId: 223 },
    });
    expect(training.checkModuleUnlocked).not.toHaveBeenCalled();
  });
});

describe('bd-2479 — every route delegates, none re-derives', () => {
  it('level-states calls the bot\'s loadVisibleLevelsWithProgress', async () => {
    await invoke('/training/level-states', { headers: auth, body: { userId: USER } });
    expect(training.loadVisibleLevelsWithProgress).toHaveBeenCalledWith(USER);
  });

  it('level-unlocked calls the bot\'s checkLevelUnlocked', async () => {
    await invoke('/training/level-unlocked', { headers: auth, body: { userId: USER, levelId: 18 } });
    expect(training.checkLevelUnlocked).toHaveBeenCalledWith(USER, 18);
  });

  it('module-unlocked calls the bot\'s checkModuleUnlocked', async () => {
    await invoke('/training/module-unlocked', { headers: auth, body: { userId: USER, moduleId: 223 } });
    expect(training.checkModuleUnlocked).toHaveBeenCalledWith(USER, 223);
  });

  it('exam-gate calls the bot\'s assertCanStartGrandQuiz', async () => {
    await invoke('/training/exam-gate', {
      headers: auth, body: { userId: USER, levelOrder: 2, vendorKey: 'beacon_house' },
    });
    expect(training.assertCanStartGrandQuiz).toHaveBeenCalledWith(USER, 2, 'beacon_house');
  });

  it('grand-quiz-state calls the bot\'s loadGrandQuizState', async () => {
    await invoke('/training/grand-quiz-state', { headers: auth, body: { userId: USER, levelId: 18 } });
    expect(training.loadGrandQuizState).toHaveBeenCalledWith(USER, 18);
  });
});

describe('bd-2479 — the bot\'s answer survives the wire verbatim', () => {
  it('returns level states unaltered, capstone certification included', async () => {
    const { statusCode, payload } = await invoke('/training/level-states', {
      headers: auth, body: { userId: USER },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    // The portal's own isGrandPass rejects quiz_kind='capstone'. Reading state
    // from here is what makes that impossible to get wrong.
    expect(payload.levels).toEqual(LEVEL_STATES);
  });

  it('carries a refusal through with the bot\'s own message, not a portal rewrite', async () => {
    training.checkLevelUnlocked.mockResolvedValueOnce({
      ok: false, message: 'This level is locked. Pass Level 2\'s grand quiz first.', previous_level_order: 2,
    });

    const { payload } = await invoke('/training/level-unlocked', {
      headers: auth, body: { userId: USER, levelId: 19 },
    });

    expect(payload).toMatchObject({
      success: true,
      ok: false,
      message: 'This level is locked. Pass Level 2\'s grand quiz first.',
      previous_level_order: 2,
    });
  });

  it('a locked module comes back locked, with the bot\'s message', async () => {
    training.checkModuleUnlocked.mockResolvedValueOnce({
      ok: false, message: 'Finish the previous module first.',
    });

    const { payload } = await invoke('/training/module-unlocked', {
      headers: auth, body: { userId: USER, moduleId: 999 },
    });

    expect(payload).toMatchObject({ success: true, ok: false, message: 'Finish the previous module first.' });
  });

  it('an exam refusal keeps the bot\'s reason code', async () => {
    training.assertCanStartGrandQuiz.mockResolvedValueOnce({ ok: false, reason: 'incomplete', message: 'Finish every module first.' });

    const { payload } = await invoke('/training/exam-gate', {
      headers: auth, body: { userId: USER, levelOrder: 2, vendorKey: 'niete' },
    });

    expect(payload).toMatchObject({ success: true, ok: false, reason: 'incomplete' });
  });

  it('passes a null vendorKey through rather than substituting a default', async () => {
    // The chain-lock default on a missing vendor is one of the live
    // divergences. Whatever the bot does with null, it decides — not the wire.
    await invoke('/training/exam-gate', { headers: auth, body: { userId: USER, levelOrder: 2 } });
    expect(training.assertCanStartGrandQuiz).toHaveBeenCalledWith(USER, 2, null);
  });
});

describe('bd-2479 — validation and failure reporting', () => {
  it('rejects level-states with no userId before doing work', async () => {
    const { statusCode } = await invoke('/training/level-states', { headers: auth, body: {} });
    expect(statusCode).toBe(400);
    expect(training.loadVisibleLevelsWithProgress).not.toHaveBeenCalled();
  });

  it('rejects level-unlocked with no levelId', async () => {
    const { statusCode } = await invoke('/training/level-unlocked', { headers: auth, body: { userId: USER } });
    expect(statusCode).toBe(400);
    expect(training.checkLevelUnlocked).not.toHaveBeenCalled();
  });

  it('rejects module-unlocked with no moduleId', async () => {
    const { statusCode } = await invoke('/training/module-unlocked', { headers: auth, body: { userId: USER } });
    expect(statusCode).toBe(400);
  });

  it('rejects exam-gate with no levelOrder', async () => {
    const { statusCode } = await invoke('/training/exam-gate', { headers: auth, body: { userId: USER } });
    expect(statusCode).toBe(400);
  });

  it('reports a thrown domain error as a failure, never a silent success', async () => {
    training.loadVisibleLevelsWithProgress.mockRejectedValueOnce(new Error('supabase down'));

    const { statusCode, payload } = await invoke('/training/level-states', {
      headers: auth, body: { userId: USER },
    });

    expect(statusCode).toBeGreaterThanOrEqual(500);
    expect(payload.success).toBe(false);
    // The failure reaches the error monitor, not just the info log.
    const { logError } = require('../../bot/shared/utils/logger');
    expect(logError).toHaveBeenCalledWith('Internal training API failed', expect.objectContaining({ error: 'supabase down' }));
  });

  it('a gate that throws must NOT read as unlocked', async () => {
    // Fail closed. An open gate on an error is how a locked level becomes
    // startable — the exact class of bug bd-2452 fixed on the bot.
    training.checkModuleUnlocked.mockRejectedValueOnce(new Error('supabase down'));

    const { statusCode, payload } = await invoke('/training/module-unlocked', {
      headers: auth, body: { userId: USER, moduleId: 223 },
    });

    expect(statusCode).toBeGreaterThanOrEqual(500);
    expect(payload.ok).not.toBe(true);
    const { logError } = require('../../bot/shared/utils/logger');
    expect(logError).toHaveBeenCalledWith('Internal training API failed', expect.objectContaining({ error: 'supabase down' }));
  });
});
