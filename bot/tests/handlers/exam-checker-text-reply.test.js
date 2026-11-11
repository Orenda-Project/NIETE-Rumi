/**
 * bd-97daxo.8.12 — a text sent during the exam-checker flow got no reply.
 *
 * Root cause: the orchestrator answers most steps with a REPLY-BUTTON interactive
 * ({ text, interactive: { action: { buttons } } }), and the handler passed it to
 * WhatsAppService.sendInteractiveMessage, the LIST sender. That returns false
 * (no `sections`) and sends nothing, and `response.text` was never sent either.
 */
jest.mock('../../shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(false),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/exam-checker', () => ({
  ExamCheckerOrchestrator: {
    process: jest.fn(),
    getSessionState: jest.fn(),
    cancelSession: jest.fn().mockResolvedValue({ text: 'cancelled' }),
  },
  ExamSessionService: {},
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({
  runWithCorrelation: (_id, fn) => fn(),
  generateCorrelationId: () => 'c1',
}));
jest.mock('../../shared/storage/r2', () => ({ uploadImageWithRetry: jest.fn() }));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const { ExamCheckerOrchestrator } = require('../../shared/services/exam-checker');
const { handleExamText } = require('../../shared/handlers/exam-checker.handler');

const user = { id: 'u1' };
const msg = (body) => ({ id: 'm1', text: { body } });
const buttonResponse = {
  text: 'Send more exam images or tap "Process now" when ready.',
  interactive: {
    type: 'button',
    body: { text: 'You have 2 images.' },
    action: { buttons: [
      { type: 'reply', reply: { id: 'ech_add_more', title: 'Add more' } },
      { type: 'reply', reply: { id: 'ech_process_now', title: 'Process now' } },
    ] },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  ExamCheckerOrchestrator.getSessionState.mockResolvedValue({ active: true, state: 'collecting_images', sessionId: 's1' });
});

describe('exam checker text turns always get a reply', () => {
  test('a button-bearing step reply reaches the teacher (reply buttons, not the list sender)', async () => {
    ExamCheckerOrchestrator.process.mockResolvedValue(buttonResponse);
    const r = await handleExamText(msg('ok done'), '923000000000', user);
    expect(r).toEqual({ handled: true });
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledWith('923000000000', {
      body: 'You have 2 images.',
      buttons: [
        { id: 'ech_add_more', title: 'Add more' },
        { id: 'ech_process_now', title: 'Process now' },
      ],
    });
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923000000000', buttonResponse.text);
  });

  test('a plain-text step reply is still sent', async () => {
    ExamCheckerOrchestrator.process.mockResolvedValue({ text: 'Please confirm the student names in the form.' });
    await handleExamText(msg('hello'), '923000000000', user);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923000000000', 'Please confirm the student names in the form.');
  });

  test.each(['menu', 'Menu', 'cancel', 'stop', 'exit', 'مینو'])(
    'exit keyword "%s" ends the session and falls through to normal routing',
    async (word) => {
      const r = await handleExamText(msg(word), '923000000000', user);
      expect(r).toBeNull();
      expect(ExamCheckerOrchestrator.cancelSession).toHaveBeenCalledWith('s1');
      expect(ExamCheckerOrchestrator.process).not.toHaveBeenCalled();
    }
  );
});
