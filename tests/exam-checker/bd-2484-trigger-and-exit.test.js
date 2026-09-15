/**
 * bd-2484 — exam-checker must not hijack normal chat, and must always have an exit.
 *
 * Two faults, one report ("Can you grade exam papers for me?" bricked normal chat):
 *   1. TRIGGER TOO LOOSE — `.includes('grade exam')` matched the phrase buried in a
 *      question, starting a real grading session. Fix: anchored intent (the message
 *      IS / STARTS WITH a trigger phrase), not substring-anywhere.
 *   2. NO WAY OUT — no stop/cancel text exit; a slash command bypassed the checker
 *      but left the session active, so the next plain text was recaptured (the same
 *      trap fixed for coaching in bd-2508). Fix: an explicit exit word AND a slash
 *      command both END the active session.
 *
 * These lock the two seams in exam-checker.handler.js: shouldTriggerExamChecker
 * (detection) and the exit helpers (isExamExitText / endActiveExamSession).
 */

const mockCancelSession = jest.fn(async () => ({ text: 'cancelled' }));
const mockGetSessionState = jest.fn(async () => ({ active: false }));

jest.mock('../../bot/shared/services/exam-checker', () => ({
  ExamCheckerOrchestrator: {
    cancelSession: mockCancelSession,
    getSessionState: mockGetSessionState,
    process: jest.fn(),
  },
  ExamSessionService: {},
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
  sendMessage: jest.fn(async () => {}),
  sendInteractiveMessage: jest.fn(async () => {}),
  sendFlow: jest.fn(async () => {}),
  downloadMedia: jest.fn(async () => Buffer.from('')),
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadImageWithRetry: jest.fn(async () => 'url') }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  runWithCorrelation: (_id, fn) => fn(),
  generateCorrelationId: () => 'cid',
}));

const Handler = require('../../bot/shared/handlers/exam-checker.handler');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSessionState.mockResolvedValue({ active: false });
});

describe('shouldTriggerExamChecker — anchored intent, not substring-anywhere', () => {
  it('does NOT trigger on a casual mention buried in a question (the reported bug)', () => {
    expect(Handler.shouldTriggerExamChecker('Can you grade exam papers for me?')).toBe(false);
  });

  it('does NOT trigger on other natural-language questions about grading', () => {
    expect(Handler.shouldTriggerExamChecker('How do I grade exams for my class?')).toBe(false);
    expect(Handler.shouldTriggerExamChecker('what is the best way to check exams')).toBe(false);
    expect(Handler.shouldTriggerExamChecker('How do I keep grade 2 students focused?')).toBe(false);
  });

  it('DOES trigger when the message is (or starts with) a clear command phrase', () => {
    expect(Handler.shouldTriggerExamChecker('grade exams')).toBe(true);
    expect(Handler.shouldTriggerExamChecker('check exams')).toBe(true);
    expect(Handler.shouldTriggerExamChecker('grade exam papers')).toBe(true);
    expect(Handler.shouldTriggerExamChecker('check my papers')).toBe(true);
    expect(Handler.shouldTriggerExamChecker('Grade Exams')).toBe(true); // case-insensitive
  });

  it('is empty/nullish safe', () => {
    expect(Handler.shouldTriggerExamChecker('')).toBe(false);
    expect(Handler.shouldTriggerExamChecker(undefined)).toBe(false);
  });
});

describe('isExamExitText — explicit stop/cancel exit', () => {
  it('recognises stop/cancel/exit words (with trailing punctuation)', () => {
    expect(Handler.isExamExitText('stop')).toBe(true);
    expect(Handler.isExamExitText('cancel')).toBe(true);
    expect(Handler.isExamExitText('exit')).toBe(true);
    expect(Handler.isExamExitText('STOP!')).toBe(true);
  });

  it('does NOT treat a normal sentence that merely contains "stop" as an exit', () => {
    expect(Handler.isExamExitText('how do I stop my students talking')).toBe(false);
    expect(Handler.isExamExitText('grade exams')).toBe(false);
  });
});

describe('endActiveExamSession — the actual way out', () => {
  it('cancels the session when one is active and reports it ended', async () => {
    mockGetSessionState.mockResolvedValue({ active: true, sessionId: 'sess-1', state: 'collecting_images' });
    const ended = await Handler.endActiveExamSession('92300', { id: 'user-1' }, { notify: true });
    expect(ended).toBe(true);
    expect(mockCancelSession).toHaveBeenCalledWith('sess-1');
    expect(WhatsAppService.sendMessage).toHaveBeenCalled(); // teacher told it's cancelled
  });

  it('is a no-op (returns false, no cancel) when there is no active session', async () => {
    mockGetSessionState.mockResolvedValue({ active: false });
    const ended = await Handler.endActiveExamSession('92300', { id: 'user-1' }, { notify: true });
    expect(ended).toBe(false);
    expect(mockCancelSession).not.toHaveBeenCalled();
  });

  it('ends silently (no confirmation message) when notify is false — the slash-command path', async () => {
    mockGetSessionState.mockResolvedValue({ active: true, sessionId: 'sess-2', state: 'collecting_images' });
    const ended = await Handler.endActiveExamSession('92300', { id: 'user-1' }, { notify: false });
    expect(ended).toBe(true);
    expect(mockCancelSession).toHaveBeenCalledWith('sess-2');
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });
});
