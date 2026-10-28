/**
 * A request for a NEW lesson plan, sent while a 6-12 lesson sits on the shelf, is not an edit the
 * router should answer (bd-1r3k2h).
 *
 * Mock run 20261026-2335-par, L11: with Lesson Plans switched to the app, "make me a lesson plan on
 * fractions for grade 4" was answered "I can change parts of a lesson I have already sent you … What you
 * asked for is a different thing" — the edit classifier filed it under out_of_scope (b) "a different
 * lesson, grade, subject or chapter" and the router answered with the out-of-scope sentence. The teacher
 * never reached intent detection, so neither the app redirect nor the lesson-plan menu could open. The
 * same swallow happens with the redirect off.
 *
 * The classifier now has a fifth label, new_request, for exactly that case, and the router falls through
 * on it the way it does for a question: intent detection owns a new lesson request.
 *
 * Red-first: fails on the branch — new_request is not in the closed set (coerced to question by
 * parseKind, so the classifier never returns it) and the prompt still files it under out_of_scope.
 * The router test runs the real router with the real string catalog; only the shelf (Redis), the LLM
 * client and the WhatsApp send are mocked.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }) }));

const mockSendMessage = jest.fn(async () => true);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: (...a) => mockSendMessage(...a) }));

const mockGetShelf = jest.fn(async () => [{ lane: 'lp612', segment_id: 'g6-math-ch1-s1', lang: 'en' }]);
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ getShelf: (...a) => mockGetShelf(...a) }));

const intent = require('../../bot/shared/services/lp612-edit-intent.service');
const { maybeHandleLp612Reply } = require('../../bot/shared/services/lp612-edit-router.service');

const reply = (content) => ({ choices: [{ message: { content } }] });
const ARGS = { from: '923000000001', messageBody: 'make me a lesson plan on fractions for grade 4', user: { id: 'u-1' }, language: 'en' };

beforeEach(() => { mockCreate.mockReset(); mockSendMessage.mockClear(); });

describe('the classifier', () => {
  test('new_request is in the closed set', () => {
    expect(intent.EDIT_INTENT_KINDS).toContain('new_request');
    expect(intent.__parseKind('{"kind": "new_request"}')).toBe('new_request');
  });
  test('the prompt defines new_request and no longer files a different lesson under out_of_scope', async () => {
    mockCreate.mockResolvedValueOnce(reply('{"kind":"new_request"}'));
    const v = await intent.classifyEditIntent({ text: ARGS.messageBody, language: 'en' });
    expect(v.kind).toBe('new_request');
    const system = mockCreate.mock.calls[0][0].messages[0].content;
    expect(system).toMatch(/"new_request"/);
    const outOfScope = system.slice(system.indexOf('"out_of_scope"'), system.indexOf('"gratitude"'));
    expect(outOfScope).not.toMatch(/different lesson, grade, subject or chapter/);
  });
});

describe('the router', () => {
  test('falls through on new_request and sends nothing', async () => {
    mockCreate.mockResolvedValueOnce(reply('{"kind":"new_request"}'));
    await expect(maybeHandleLp612Reply(ARGS)).resolves.toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
  test('still answers an out-of-scope artefact request itself', async () => {
    mockCreate.mockResolvedValueOnce(reply('{"kind":"out_of_scope"}'));
    await expect(maybeHandleLp612Reply({ ...ARGS, messageBody: 'make me an exam paper from this' })).resolves.toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toMatch(/I can change parts of a lesson/);
  });
});
