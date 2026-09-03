/**
 * The router is actually CALLED by the handler, and its verdict is actually OBEYED.
 *
 * This file exists because the repo's own TDD rule says a source-text grep does not count: a
 * grep-green call site can still be a runtime ReferenceError, and the sibling suite for this same
 * handler (`tests/handlers/text-message-lp-keyword.test.js`) scrapes source text precisely
 * because executing this 2,800-line function is awkward. So this one executes it.
 *
 * Two things are proven, and they are different:
 *
 *   1. THE LINE RUNS. `maybeHandleLp612Reply` is reached with her message, her user and her
 *      resolved language. A require that resolved to `undefined`, a typo'd export, or a call
 *      placed after an early return would all fail here and none of them would fail a grep.
 *   2. `TRUE` MEANS STOP. When the router handles the message the handler must RETURN — not fall
 *      through and additionally hand her to the general conversation path. Getting an honest
 *      "I cannot change a lesson yet" AND a generic model reply is worse than either alone, and
 *      it is the exact failure a misplaced `if` without a return would produce.
 *
 * Everything below the handler is stubbed at the module boundary; the handler itself is real.
 */

/**
 * BOT-ONLY DEPENDENCIES, MOCKED VIRTUALLY.
 *
 * CI runs the root suite BEFORE `bot/ npm ci`, so every package that lives only in
 * `bot/node_modules` is genuinely absent when this file runs there — and a module-scope require
 * of one kills the whole suite FILE, not just a test. Loading the real text handler reaches 254
 * files, and this is the complete set of bare packages in that graph that the root install does
 * not provide and `tests/jest.config.js` does not already stub.
 *
 * `{ virtual: true }` is the point: it mocks a module that does not exist on disk at all, which
 * a normal `jest.mock` cannot do. Kept LOCAL to this file rather than added to the shared
 * moduleNameMapper, because only a suite that loads the whole handler needs them — the global
 * config should not grow six entries to serve one test.
 *
 * My machine could not have caught this. This worktree borrows another worktree's root
 * node_modules, which carries these packages even though the root package.json never declares
 * them, so every local run was green while CI failed twice.
 */
jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });
jest.mock('p-limit', () => () => ((fn) => fn()), { virtual: true });
jest.mock('sharp', () => () => ({}), { virtual: true });
jest.mock('bullmq', () => ({ Queue: class {}, Worker: class {}, QueueEvents: class {} }), { virtual: true });
jest.mock('chartjs-node-canvas', () => ({ ChartJSNodeCanvas: class {} }), { virtual: true });
jest.mock('microsoft-cognitiveservices-speech-sdk', () => ({}), { virtual: true });

const mockMaybeHandle = jest.fn();
const mockDetectIntent = jest.fn().mockResolvedValue({ type: 'general' });
const mockSendMessage = jest.fn().mockResolvedValue(undefined);

jest.mock('../../bot/shared/services/lp612-edit-router.service', () => ({
  maybeHandleLp612Reply: (...a) => mockMaybeHandle(...a),
}));
jest.mock('../../bot/shared/services/openai.service', () => ({
  detectIntent: (...a) => mockDetectIntent(...a),
  generateResponse: jest.fn().mockResolvedValue('ok'),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendTypingIndicator: jest.fn(),
  markAsRead: jest.fn(),
  // The handler starts this on entry and calls `.stop()` on every exit path, including the
  // intercept's own. A double without it dies before reaching anything worth asserting.
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const USER = { id: 'u1', phone_number: '923001234567', first_name: 'Ayesha', preferred_language: 'en' };

let handler;
beforeEach(() => {
  jest.resetModules();
  mockMaybeHandle.mockReset().mockResolvedValue(false);
  mockDetectIntent.mockClear();
  mockSendMessage.mockClear();
  handler = require('../../bot/shared/handlers/text-message.handler');
});

/**
 * Drive the real handler far enough to reach the intercept.
 *
 * It is called inside a try/catch because the branches AFTER the intercept reach services this
 * test deliberately does not stub — and that is fine: everything asserted here happens at or
 * before the intercept, so a later throw is noise, not a result. What matters is that execution
 * REACHED the line, which the assertions below verify directly.
 */
// The real signature is (message, from, messageBody, user) — `message` is the raw WhatsApp
// payload, needed for its id. Getting this wrong is how the first version of this test failed
// with "(messageBody || '').trim is not a function" at line 404, which is itself a small
// vindication of executing the handler rather than grepping it.
async function run(messageBody) {
  try {
    await handler.handleTextMessage({ id: 'wamid.test' }, USER.phone_number, messageBody, USER);
  } catch (_) { /* downstream of the intercept — see above */ }
}

describe('the 6-12 follow-up router is wired into the real handler', () => {
  test('it is called with her message, her user and her language', async () => {
    await run('make the homework shorter');

    expect(mockMaybeHandle).toHaveBeenCalled();
    const arg = mockMaybeHandle.mock.calls[0][0];
    expect(arg.messageBody).toBe('make the homework shorter');
    expect(arg.user).toMatchObject({ id: 'u1' });
    expect(arg.from).toBe('923001234567');
    expect(typeof arg.language).toBe('string');
  });

  test('when the router handles it, intent detection never runs — the handler RETURNS', async () => {
    mockMaybeHandle.mockResolvedValue(true);
    await run('write me an exam paper for this chapter');

    expect(mockMaybeHandle).toHaveBeenCalledTimes(1);
    // The whole point of `true`. Falling through would give her the honest reply AND a generic
    // one — the double-answer bug a missing `return` produces.
    expect(mockDetectIntent).not.toHaveBeenCalled();
  });

  test('when the router declines, the handler carries on exactly as before', async () => {
    mockMaybeHandle.mockResolvedValue(false);
    await run('what does the activity mean?');

    expect(mockMaybeHandle).toHaveBeenCalledTimes(1);
    expect(mockDetectIntent).toHaveBeenCalledTimes(1);
  });

  test('a router that throws does not cost her the message', async () => {
    mockMaybeHandle.mockRejectedValue(new Error('redis exploded'));
    await run('make the homework shorter');

    // Swallowed, and the normal path still runs — the intercept is an addition, never a gate.
    expect(mockDetectIntent).toHaveBeenCalledTimes(1);
  });
});
