/**
 * The routing decision: is this reply about the 6-12 lesson she just got, and if so, what do we
 * owe her?
 *
 * This is the piece that closes the hole the investigation found. Today a teacher who replies
 * "make the homework shorter" after a 6-12 lesson falls through ~35 branches of the text handler
 * into the general conversation path and is answered by a small model that has never seen her
 * lesson. The reply looks like an answer, which is why nobody reported it as a bug.
 *
 * The router sits in front of that fall-through and answers three questions in order:
 *
 *   1. IS THIS EVEN OURS? Only if she has a 6-12 lesson on the shelf. No entry, no interception —
 *      the handler behaves exactly as it does today for every other teacher. This is the whole
 *      blast-radius argument: the change is invisible to anyone who has not received a 6-12
 *      lesson in the last 24 hours.
 *   2. WHAT DID SHE MEAN? Delegated to the classifier.
 *   3. WHO SHOULD ANSWER? A question or a thank-you is NOT ours — it falls through to the normal
 *      conversation path, which is now grounded because the delivery is on the shelf. Only an
 *      edit request or an out-of-scope ask is answered here.
 *
 * The two returns are deliberately asymmetric: `false` means "carry on as before", so every
 * degraded path returns false and the teacher's experience is never WORSE than today's.
 */

const mockGetShelf = jest.fn();
const mockClassify = jest.fn();
const mockSendMessage = jest.fn();

jest.mock('../../bot/shared/services/lp-shelf.service', () => ({
  getShelf: (...a) => mockGetShelf(...a),
  getDeliveryType: () => 'segment',
}));
jest.mock('../../bot/shared/services/lp612-edit-intent.service', () => ({
  classifyEditIntent: (...a) => mockClassify(...a),
  EDIT_INTENT_KINDS: ['edit', 'question', 'out_of_scope', 'gratitude'],
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: mockSendMessage }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const LP612_ENTRY = {
  lane: 'lp612',
  segment_id: 'grade_8_mathematics.c05.p071-073',
  grade: 8,
  subject: 'Mathematics',
  chapter_number: 5,
  chapter_title: 'Sets',
  one_screen: 'Today the class turns a listed set into set-builder form.',
  lang: 'en',
  delivered_at: new Date().toISOString(),
};

const K5_ENTRY = {
  lesson_id: 'v8-1', grade: 3, subject: 'Science', chapter_number: 1,
  chapter_title: 'Plants', delivered_at: new Date().toISOString(),
};

let Router;
let saved;
beforeEach(() => {
  jest.resetModules();
  saved = { ...process.env };
  mockGetShelf.mockReset().mockResolvedValue([LP612_ENTRY]);
  mockClassify.mockReset().mockResolvedValue({ kind: 'question' });
  mockSendMessage.mockReset().mockResolvedValue(undefined);
  Router = require('../../bot/shared/services/lp612-edit-router.service');
});
afterEach(() => { process.env = saved; });

const call = (over = {}) => Router.maybeHandleLp612Reply({
  from: '923001234567',
  messageBody: 'make the homework shorter',
  user: { id: 'u1' },
  language: 'en',
  ...over,
});

describe('is this reply even ours?', () => {
  test('no shelf entry at all → not ours, nothing sent, nothing classified', async () => {
    mockGetShelf.mockResolvedValue([]);
    expect(await call()).toBe(false);
    expect(mockClassify).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('a K-5 lesson on the shelf is NOT ours — that lane has its own handling', async () => {
    mockGetShelf.mockResolvedValue([K5_ENTRY]);
    expect(await call()).toBe(false);
    expect(mockClassify).not.toHaveBeenCalled();
  });

  test('no user id → not ours, and never a crash', async () => {
    expect(await call({ user: null })).toBe(false);
    expect(mockClassify).not.toHaveBeenCalled();
  });

  test('a 6-12 entry makes it ours', async () => {
    mockClassify.mockResolvedValue({ kind: 'out_of_scope' });
    expect(await call()).toBe(true);
  });
});

describe('who should answer?', () => {
  test('a question falls through — the general path is grounded now', async () => {
    mockClassify.mockResolvedValue({ kind: 'question' });
    expect(await call({ messageBody: 'what does the activity mean?' })).toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('gratitude falls through — we do not answer "thanks" with a form letter', async () => {
    mockClassify.mockResolvedValue({ kind: 'gratitude' });
    expect(await call({ messageBody: 'thanks!' })).toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('an out-of-scope ask is answered HERE, and names what can be changed', async () => {
    mockClassify.mockResolvedValue({ kind: 'out_of_scope' });
    expect(await call({ messageBody: 'write me an exam paper' })).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [, text] = mockSendMessage.mock.calls[0];
    expect(text).toMatch(/shorten a section|add an\s+activity/i);
    expect(text).toMatch(/unchanged/i);
  });
});

describe('an edit request, before the edit machinery exists', () => {
  test('with the flag OFF she is told it is not ready — NOT that she is out of scope', async () => {
    delete process.env.LP_612_EDIT_ENABLED;
    mockClassify.mockResolvedValue({ kind: 'edit' });
    expect(await call()).toBe(true);
    const [, text] = mockSendMessage.mock.calls[0];
    expect(text).toMatch(/being built|not.*yet/i);
    // The distinction that matters: telling her an editable request is "out of scope" is a lie
    // she would reasonably repeat to a colleague.
    expect(text).not.toMatch(/different thing/i);
  });

  test('her lesson is described as unchanged either way', async () => {
    mockClassify.mockResolvedValue({ kind: 'edit' });
    await call();
    expect(mockSendMessage.mock.calls[0][1]).toMatch(/unchanged/i);
  });

  test('the Urdu teacher gets Urdu', async () => {
    mockClassify.mockResolvedValue({ kind: 'edit' });
    await call({ language: 'ur' });
    const [, text] = mockSendMessage.mock.calls[0];
    expect(/[؀-ۿ]/.test(text)).toBe(true);
  });
});

describe('degrading never makes it worse than today', () => {
  test('a classifier that throws falls through instead of guessing', async () => {
    mockClassify.mockRejectedValue(new Error('boom'));
    expect(await call()).toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('a shelf read that throws falls through', async () => {
    mockGetShelf.mockRejectedValue(new Error('redis down'));
    expect(await call()).toBe(false);
  });

  test('a send that fails still reports handled — she is not ALSO given a generic reply', async () => {
    mockClassify.mockResolvedValue({ kind: 'out_of_scope' });
    mockSendMessage.mockRejectedValue(new Error('meta 500'));
    expect(await call()).toBe(true);
  });
});
