/**
 * The reflection's language is the TEACHER's decision, never the transcriber's
 * guess.
 *
 * A code-switched Urdu answer — extremely common, teachers keep pedagogical
 * terms in English — used to come back from the recogniser labelled 'en', and
 * that label was written straight onto the session as `conversation_language`,
 * which then chose the language of every later question AND its TTS voice.
 *
 * After this change the stored value is anchored to her preference and the
 * per-turn detection survives only as telemetry on the answer itself.
 *
 * Executes handleReflectiveResponse() with Supabase and WhatsApp mocked at the
 * boundary.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__REFL_SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: global.__REFL_SESSION, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp', VOICE_MODELS: {} }));
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve('ur')),
  setUserLanguage: jest.fn(),
  DEFAULT_LANGUAGE: 'en',
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve()),
  sendAudio: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/elevenlabs.service', () => ({
  generateSpeechForLanguage: jest.fn(() => Promise.resolve(Buffer.from('a'))),
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  _generateReflectiveQuestionV12: jest.fn(() => Promise.resolve('q?')),
  generateReflectiveQuestion: jest.fn(() => Promise.resolve('q?')),
}));
const mockUpdateState = jest.fn(() => Promise.resolve());
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateConversationState: (...a) => mockUpdateState(...a),
  updateStatus: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/reflective-acknowledgement', () => ({
  generateAcknowledgement: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({
  getCoachingMessage: jest.fn(() => 'thanks'),
}));

const ReflectiveConversationService =
  require('../../bot/shared/services/coaching/reflective-conversation.service');

const SID = 'sess-reflection-anchor';
const FROM = '923001234567';

beforeEach(() => {
  jest.clearAllMocks();
  global.__REFL_SESSION = {
    id: SID,
    user_id: 'u1',
    conversation_state: {
      current_state: 'REFLECTIVE_QUESTION_1',
      conversation_language: 'ur',
      questions_answered: 0,
      questions: [{ question_number: 1, question: 'آپ نے کیا محسوس کیا؟', answer: null }],
    },
  };
});

describe('reflection language is anchored to the stored preference', () => {
  test('an answer the recogniser labels English does not flip the conversation', async () => {
    await ReflectiveConversationService.handleReflectiveResponse(
      SID, FROM, 'I paused more', 'voice', 'en',
    );

    expect(mockUpdateState).toHaveBeenCalled();
    const written = mockUpdateState.mock.calls[0][1];
    expect(written.conversation_language).toBe('ur');
  });

  test('the per-turn detection is still recorded on the answer', async () => {
    await ReflectiveConversationService.handleReflectiveResponse(
      SID, FROM, 'I paused more', 'voice', 'en',
    );

    const written = mockUpdateState.mock.calls[0][1];
    expect(written.questions[0].language).toBe('en');
  });

  test('a session that never stored one falls back to her preference, not the label', async () => {
    delete global.__REFL_SESSION.conversation_state.conversation_language;

    await ReflectiveConversationService.handleReflectiveResponse(
      SID, FROM, 'I paused more', 'voice', 'en',
    );

    const written = mockUpdateState.mock.calls[0][1];
    expect(written.conversation_language).toBe('ur');
  });

  test('an off-offer label is never stored as the conversation language', async () => {
    delete global.__REFL_SESSION.conversation_state.conversation_language;

    await ReflectiveConversationService.handleReflectiveResponse(
      SID, FROM, 'main ne socha', 'voice', 'hindi',
    );

    const written = mockUpdateState.mock.calls[0][1];
    expect(written.conversation_language).toBe('ur');
    expect(written.questions[0].language).toBe('hindi');
  });
});
