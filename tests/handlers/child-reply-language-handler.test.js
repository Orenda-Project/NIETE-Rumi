'use strict';
/**
 * The child tutor's reply language, executed through the real reply path.
 *
 * handleGeneralConversation is the one function both child entry points reach
 * (the ordinary text path and student-ingress, which calls it directly), and
 * the real openai.service builds the prompt. Only the network boundary is
 * mocked: the LLM client, WhatsApp, and the conversations table.
 *
 * What must hold for a child:
 *   - the reply language is decided per turn from the child's message (see
 *     child-reply-language.test.js), not fixed to the last quiz's language;
 *   - the decided language chooses the tutor prompt's language;
 *   - a one-line REPLY LANGUAGE note sits immediately before the child's
 *     message, where it is not outweighed by the chat's earlier replies;
 *   - the drift check runs against the decided language and logs at warn,
 *     carrying the child's message script and the decided language.
 */

const mockCreate = jest.fn();
const mockDbHistory = jest.fn();
const mockLog = jest.fn();

jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  ...jest.requireActual('../../bot/shared/database/bot-helpers'),
  getConversationHistory: (...a) => mockDbHistory(...a),
  storeConversation: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => new Proxy({}, {
  get: () => jest.fn(async () => true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: (...a) => mockLog(...a),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

const OpenAIService = require('../../bot/shared/services/openai.service');
const { handleGeneralConversation } = require('../../bot/shared/handlers/text-message.handler');

const URDU_REPLY = 'ضرور! کسر ایک پورے کا حصہ ہوتی ہے۔ بتائیں 1/2 کیا ہے؟ a) آدھا b) پورا';
const ENGLISH_REPLY = 'Sure! A fraction is part of a whole. What is 1/2? a) half b) whole';

const child = (quizLanguage) => ({
  id: `child-${quizLanguage}`, phone_number: '920000000001', name: null, preferred_language: 'en',
  persona: 'student', personaLanguage: quizLanguage, personaClass: 'Class 5',
});

/** Run one child turn; return the messages array sent to the model. */
async function turn({ quizLanguage, message, history = [], modelReply = ENGLISH_REPLY }) {
  OpenAIService.conversationHistory.clear();
  mockCreate.mockReset();
  mockLog.mockReset();
  mockDbHistory.mockReset();
  mockDbHistory.mockResolvedValue(history);
  mockCreate.mockResolvedValue({ choices: [{ message: { content: modelReply } }] });
  await handleGeneralConversation('920000000001', message, child(quizLanguage), 'sess-1', quizLanguage, { stop() {} });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  return mockCreate.mock.calls[0][0].messages;
}

const URDU_TUTOR = /آپ NIETE کے study helper ہیں/;
const ENGLISH_TUTOR = /You are the NIETE study helper/;
const NOTE_EN = 'REPLY LANGUAGE: English';
const NOTE_UR = 'REPLY LANGUAGE: Urdu — Urdu script; English subject terms may stay in English letters';

describe('child reply language — through the real handler', () => {
  test('en-quiz child writes English -> English tutor prompt + English note before the message', async () => {
    const msgs = await turn({ quizLanguage: 'en', message: 'Can you explain what a fraction is', history: [
      { role: 'user', content: 'hi' }, { role: 'assistant', content: URDU_REPLY },
    ] });
    expect(msgs[0].content).toMatch(ENGLISH_TUTOR);
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'Can you explain what a fraction is' });
    expect(msgs[msgs.length - 2]).toEqual({ role: 'system', content: NOTE_EN });
  });

  test('en-quiz child writes Roman Urdu -> Urdu tutor prompt + Urdu note', async () => {
    const msgs = await turn({ quizLanguage: 'en', message: 'mujhe samajh nahi aya', modelReply: URDU_REPLY });
    expect(msgs[0].content).toMatch(URDU_TUTOR);
    expect(msgs[msgs.length - 2]).toEqual({ role: 'system', content: NOTE_UR });
  });

  test('en-quiz child answers "b" in a chat that is in Urdu -> stays Urdu', async () => {
    const msgs = await turn({ quizLanguage: 'en', message: 'b', modelReply: URDU_REPLY, history: [
      { role: 'user', content: 'fractions' }, { role: 'assistant', content: URDU_REPLY },
    ] });
    expect(msgs[0].content).toMatch(URDU_TUTOR);
    expect(msgs[msgs.length - 2]).toEqual({ role: 'system', content: NOTE_UR });
  });

  test('ur-quiz child writes English -> English tutor prompt + English note', async () => {
    const msgs = await turn({ quizLanguage: 'ur', message: 'What is the answer to this question', history: [
      { role: 'user', content: 'سوال' }, { role: 'assistant', content: URDU_REPLY },
    ] });
    expect(msgs[0].content).toMatch(ENGLISH_TUTOR);
    expect(msgs[msgs.length - 2]).toEqual({ role: 'system', content: NOTE_EN });
  });

  test('a first message with no signal starts in the quiz language', async () => {
    const msgs = await turn({ quizLanguage: 'ur', message: '7', modelReply: URDU_REPLY });
    expect(msgs[0].content).toMatch(URDU_TUTOR);
    expect(msgs[msgs.length - 2]).toEqual({ role: 'system', content: NOTE_UR });
  });

  test('a teacher gets no REPLY LANGUAGE note and the stored language, unchanged', async () => {
    OpenAIService.conversationHistory.clear();
    mockCreate.mockReset();
    mockDbHistory.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ choices: [{ message: { content: ENGLISH_REPLY } }] });
    const teacher = { id: 't-1', phone_number: '920000000002', name: 'Test', persona: null, preferred_language: 'en' };
    await handleGeneralConversation('920000000002', 'mujhe samajh nahi aya', teacher, 's-1', 'en', { stop() {} });
    const msgs = mockCreate.mock.calls[0][0].messages;
    expect(msgs.some((m) => m.role === 'system' && /^REPLY LANGUAGE:/.test(m.content))).toBe(false);
  });
});

describe('child language drift log', () => {
  const driftCalls = () => mockLog.mock.calls.filter(([msg]) => /language_drift: chat reply/.test(msg));

  test('a drifted reply is logged at warn with the message script and the decided language', async () => {
    await turn({ quizLanguage: 'en', message: 'Can you explain what a fraction is', modelReply: URDU_REPLY });
    const calls = driftCalls();
    expect(calls).toHaveLength(1);
    const [, data, level] = calls[0];
    expect(level).toBe('warn');
    expect(data).toMatchObject({
      surface: 'chat_text', persona: 'student', expected: 'en', detected: 'ur',
      messageScript: 'latin', decidedLanguage: 'en', languageSource: 'message', quizLanguage: 'en',
    });
  });

  test('an Urdu reply to an en-quiz child who wrote Roman Urdu is NOT drift', async () => {
    await turn({ quizLanguage: 'en', message: 'mujhe samajh nahi aya', modelReply: URDU_REPLY });
    expect(driftCalls()).toHaveLength(0);
  });

  test('an Urdu reply to an en-quiz child who wrote Urdu script is NOT drift', async () => {
    await turn({ quizLanguage: 'en', message: 'یہ سوال سمجھ نہیں آیا', modelReply: URDU_REPLY });
    expect(driftCalls()).toHaveLength(0);
  });
});
