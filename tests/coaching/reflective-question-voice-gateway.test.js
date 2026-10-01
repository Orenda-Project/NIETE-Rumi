/**
 * The coaching reflective question is spoken through the voice gateway, and a
 * voice failure sends the question as text instead of failing the session
 * (red first).
 *
 * Before: the question was synthesised with no guard, so a synthesis failure
 * escaped into the analysis job — the session was marked failed at "analysis",
 * the teacher was told her classroom could not be analysed, and the job was
 * re-queued — although the analysis itself had succeeded. Now a question that
 * cannot be voiced goes out as text, exactly like one whose voice note does not
 * send.
 *
 * Executes the real conductReflectiveConversation() and the real gateway; the
 * network is mocked at its edge (axios, the OpenAI SDK).
 */

const fs = require('fs');
const path = require('path');

const UR_OGG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tts', 'soniox-ishita-ur-a.ogg'));

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__Q_SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: global.__Q_SESSION, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('axios');
const mockSpeechCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { speech: { create: mockSpeechCreate } },
  chat: { completions: { create: jest.fn() } },
})));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve('ur')),
  setUserLanguage: jest.fn(),
  DEFAULT_LANGUAGE: 'en',
}));
const mockSendMessage = jest.fn(() => Promise.resolve(true));
const mockSendAudio = jest.fn(() => Promise.resolve(true));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendAudio: (...a) => mockSendAudio(...a),
}));
const QUESTION = 'آپ نے آج کی کلاس میں بچوں سے کون سا سوال پوچھا؟';
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  _generateReflectiveQuestionV12: jest.fn(() => Promise.resolve('آپ نے آج کی کلاس میں بچوں سے کون سا سوال پوچھا؟')),
  generateReflectiveQuestion: jest.fn(() => Promise.resolve('آپ نے آج کی کلاس میں بچوں سے کون سا سوال پوچھا؟')),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateConversationState: jest.fn(() => Promise.resolve()),
  updateStatus: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({ getCoachingMessage: jest.fn(() => 'thanks') }));

const axios = require('axios');
const CoachingSessionService = require('../../bot/shared/services/coaching/coaching-session.service');
const ReflectiveConversationService = require('../../bot/shared/services/coaching/reflective-conversation.service');

const SID = 'sess-q-voice';
const FROM = '923001234567';
const ENV_KEYS = ['TTS_PROVIDER', 'SONIOX_API_KEY', 'ELEVENLABS_API_KEY', 'OPENAI_API_KEY', 'E2E_CASSETTE'];
let saved;

beforeEach(() => {
  jest.clearAllMocks();
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.TTS_PROVIDER = 'soniox';
  process.env.SONIOX_API_KEY = 'sk-test';
  process.env.ELEVENLABS_API_KEY = 'el-test';
  process.env.OPENAI_API_KEY = 'oa-test';
  delete process.env.E2E_CASSETTE;
  axios.post.mockReset();
  mockSpeechCreate.mockReset();
  global.__Q_SESSION = {
    id: SID,
    user_id: 'u1',
    transcript_text: 't',
    analysis_data: { reflective_corpus: { moments: [] } },
    conversation_state: {
      current_state: 'REFLECTIVE_QUESTION_1',
      conversation_language: 'ur',
      questions_answered: 0,
      questions: [],
    },
  };
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test('the question is spoken by the configured provider (Soniox, Ishita)', async () => {
  axios.post.mockImplementation(async (url) => {
    if (url.startsWith('https://tts-rt.soniox.com/')) return { status: 200, data: UR_OGG };
    throw new Error(`unexpected POST ${url}`);
  });

  await ReflectiveConversationService.conductReflectiveConversation(SID, FROM, 1);

  const soniox = axios.post.mock.calls.filter((c) => c[0].startsWith('https://tts-rt.soniox.com/'));
  expect(soniox).toHaveLength(1);
  expect(soniox[0][1]).toMatchObject({ voice: 'Ishita', language: 'ur' });
  expect(Buffer.from(mockSendAudio.mock.calls[0][1]).equals(UR_OGG)).toBe(true);
  expect(mockSendMessage).not.toHaveBeenCalledWith(FROM, QUESTION);
});

test('when no voice can be made, the question goes as text and the session does not fail', async () => {
  axios.post.mockRejectedValue(Object.assign(new Error('HTTP 500'), { response: { status: 500, data: Buffer.from('{}') } }));
  mockSpeechCreate.mockRejectedValue(new Error('openai down'));

  await expect(ReflectiveConversationService.conductReflectiveConversation(SID, FROM, 1)).resolves.not.toThrow();

  expect(mockSendAudio).not.toHaveBeenCalled();
  expect(mockSendMessage).toHaveBeenCalledWith(FROM, QUESTION);
  // the question is still recorded as asked, so her answer is matched to it
  const stored = CoachingSessionService.updateConversationState.mock.calls.map((c) => c[1]);
  expect(JSON.stringify(stored)).toContain(QUESTION);
});
