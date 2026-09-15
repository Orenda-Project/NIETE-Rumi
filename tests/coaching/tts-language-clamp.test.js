/**
 * Nothing may hand the speech synthesiser a language code this deployment does
 * not serve. The synthesiser's own behaviour for an unknown code is to read the
 * text in the ENGLISH voice — so an Urdu question would be read aloud by an
 * English voice, silently, with a warning nobody watches.
 *
 * The sibling reply path already clamps before it speaks. This one did not.
 *
 * Executes conductReflectiveConversation(); the synthesiser is spied at its
 * boundary.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__TTS_SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: global.__TTS_SESSION, error: null })),
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
const mockSpeak = jest.fn(() => Promise.resolve(Buffer.from('a')));
jest.mock('../../bot/shared/services/elevenlabs.service', () => ({
  generateSpeechForLanguage: (...a) => mockSpeak(...a),
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  _generateReflectiveQuestionV12: jest.fn(() => Promise.resolve('آپ نے کیا محسوس کیا؟')),
  generateReflectiveQuestion: jest.fn(() => Promise.resolve('آپ نے کیا محسوس کیا؟')),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateConversationState: jest.fn(() => Promise.resolve()),
  updateStatus: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({
  getCoachingMessage: jest.fn(() => 'thanks'),
}));

const ReflectiveConversationService =
  require('../../bot/shared/services/coaching/reflective-conversation.service');

const SID = 'sess-tts-clamp';
const FROM = '923001234567';

beforeEach(() => {
  jest.clearAllMocks();
  global.__TTS_SESSION = {
    id: SID,
    user_id: 'u1',
    transcript_text: 't',
    analysis_data: { reflective_corpus: { moments: [] } },
    conversation_state: {
      current_state: 'REFLECTIVE_QUESTION_2',
      conversation_language: 'es',
      questions_answered: 1,
      questions: [{ question_number: 1, question: 'q', answer: 'a' }],
    },
  };
});

describe('the reflective question is never spoken in an unoffered language', () => {
  test('a stored Spanish label is clamped before it reaches the synthesiser', async () => {
    await ReflectiveConversationService.conductReflectiveConversation(SID, FROM, 2);

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][1]).toBe('en');
  });

  test('an Urdu conversation still speaks Urdu', async () => {
    global.__TTS_SESSION.conversation_state.conversation_language = 'ur';

    await ReflectiveConversationService.conductReflectiveConversation(SID, FROM, 2);

    expect(mockSpeak.mock.calls[0][1]).toBe('ur');
  });

  test('a junk label degrades to the floor rather than reaching the synthesiser raw', async () => {
    global.__TTS_SESSION.conversation_state.conversation_language = 'hindi';

    await ReflectiveConversationService.conductReflectiveConversation(SID, FROM, 2);

    expect(mockSpeak.mock.calls[0][1]).toBe('en');
  });
});

describe('the synthesiser fallback is loud', () => {
  /**
   * Behavioural, not a source grep: the real service runs with an empty voice
   * registry so every code is unsupported, and the assertion is on the level the
   * log call actually opted into. A silent fallback is a regression mask — an
   * English voice reading Urdu is exactly the kind of failure that produces no
   * error row and so is certified healthy.
   */
  test('an unsupported code is logged at error level', async () => {
    const { logToFile } = require('../../bot/shared/utils/logger');
    const RealElevenLabs = jest.requireActual('../../bot/shared/services/elevenlabs.service');
    jest.spyOn(RealElevenLabs, 'generateSpeech').mockResolvedValue(Buffer.from('x'));

    await RealElevenLabs.generateSpeechForLanguage('some text', 'hindi');

    const call = logToFile.mock.calls.find((c) => String(c[0]).includes('Unsupported language code'));
    expect(call).toBeDefined();
    expect(call[2]).toBe('error');
  });
});
