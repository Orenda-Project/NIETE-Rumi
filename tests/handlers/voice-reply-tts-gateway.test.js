/**
 * A voice reply is spoken through the voice gateway, and a voice failure never
 * costs the teacher her answer (red first).
 *
 * Before: the reply went to one vendor-specific call, and when every voice
 * failed the handler's outer catch sent a generic "error processing your voice
 * message" — the answer the model had already written was lost. Now the reply
 * is spoken by whichever provider the configuration names (Soniox here), and if
 * no voice can be made, or the voice note does not send, the same answer goes
 * as text.
 *
 * Drives the REAL handleVoiceMessage; the network is mocked at its edge (axios
 * for the voice vendors, the OpenAI SDK for its voice) and the WhatsApp,
 * transcription and model services are stubbed as in the neighbouring suites.
 */

const fs = require('fs');
const path = require('path');

const UR_OGG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tts', 'soniox-ishita-ur-a.ogg'));

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('axios');
const mockSpeechCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { speech: { create: mockSpeechCreate } },
  chat: { completions: { create: jest.fn() } },
})));

const mockSendMessage = jest.fn(() => Promise.resolve(true));
const mockSendAudio = jest.fn(() => Promise.resolve(true));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
  getMediaInfo: jest.fn(() => Promise.resolve({ mime_type: 'audio/ogg', file_size: 30_000 })),
  downloadMedia: jest.fn(() => Promise.resolve(Buffer.from('audio-bytes'))),
  sendMessage: (...a) => mockSendMessage(...a),
  sendAudio: (...a) => mockSendAudio(...a),
  sendSticker: jest.fn(() => Promise.resolve()),
}));

const ANSWER = 'آپ کی جماعت کے لیے ایک آسان سرگرمی یہ ہے۔';
jest.mock('../../bot/shared/services/openai.service', () => ({
  detectIntent: jest.fn(() => Promise.resolve({ type: 'general' })),
  getResponseWithFormat: jest.fn(() => Promise.resolve('آپ کی جماعت کے لیے ایک آسان سرگرمی یہ ہے۔')),
}));
jest.mock('../../bot/shared/services/audio.service', () => ({
  getAudioDuration: jest.fn(() => Promise.resolve(8)),
  convertToWav: jest.fn(() => Promise.resolve()),
  transcribeWithLanguagePreference: jest.fn(() => Promise.resolve({ text: 'میری جماعت کے لیے کوئی سرگرمی بتائیں', language: 'ur', engine: 'soniox' })),
  transcribeAudio: jest.fn(() => Promise.resolve('میری جماعت کے لیے کوئی سرگرمی بتائیں')),
  getASREngine: jest.fn(() => 'soniox'),
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(), unlinkSync: jest.fn(), existsSync: jest.fn(() => false),
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadAudio: jest.fn(() => Promise.resolve('https://r2.example/a.ogg')) }));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(() => Promise.resolve('sess-1')),
  updateSessionType: jest.fn(), storeConversation: jest.fn(), storeAudioSession: jest.fn(), storeLessonPlan: jest.fn(),
}));
jest.mock('../../bot/shared/services/observe/observe-audio-router', () => {
  const actual = jest.requireActual('../../bot/shared/services/observe/observe-audio-router');
  return { ...actual, routeLeaderAudio: jest.fn(() => Promise.resolve(false)) };
});
jest.mock('../../bot/shared/services/feature-registration.service', () => ({ isPendingName: jest.fn(() => Promise.resolve(false)) }));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({ getState: jest.fn(() => Promise.resolve(null)), clearState: jest.fn() }));
jest.mock('../../bot/shared/services/language-detector.service', () => ({ getConfirmedLanguage: jest.fn(() => Promise.resolve('ur')) }));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve('ur')), setUserLanguage: jest.fn(), DEFAULT_LANGUAGE: 'en',
}));
jest.mock('../../bot/shared/services/lp-context.service', () => ({ injectLpContext: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({
  handleReflectiveResponse: jest.fn(), initiateCoachingSession: jest.fn(),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'or', 'order', 'limit', 'update', 'insert', 'single']) chain[m] = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (resolve) => resolve({ data: null, error: null });
  return { from: jest.fn(() => chain) };
});

const axios = require('axios');
const { handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler');

const FROM = '923001234567';
const TEACHER = { id: 'u1', role: 'teacher', preferred_language: 'ur' };
const voiceNote = () => ({ id: 'wamid.1', audio: { id: 'media-1', mime_type: 'audio/ogg' } });
const GENERIC_ERROR = 'معذرت، آواز پیغام پر کارروائی کرتے وقت خرابی آ گئی۔';
const sentBodies = () => mockSendMessage.mock.calls.map((c) => c[1]);

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
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test('the reply is spoken by the configured provider (Soniox, Ishita) and sent as the voice note', async () => {
  axios.post.mockImplementation(async (url) => {
    if (url.startsWith('https://tts-rt.soniox.com/')) return { status: 200, data: UR_OGG };
    throw new Error(`unexpected POST ${url}`);
  });

  await handleVoiceMessage(voiceNote(), FROM, TEACHER);

  const sonioxCalls = axios.post.mock.calls.filter((c) => c[0].startsWith('https://tts-rt.soniox.com/'));
  expect(sonioxCalls).toHaveLength(1);
  expect(sonioxCalls[0][1]).toMatchObject({ voice: 'Ishita', language: 'ur', audio_format: 'opus' });
  expect(mockSendAudio).toHaveBeenCalledTimes(1);
  expect(Buffer.from(mockSendAudio.mock.calls[0][1]).equals(UR_OGG)).toBe(true);
  expect(sentBodies()).not.toContain(GENERIC_ERROR);
});

test('when no voice can be made, the teacher gets the answer as text — not an error', async () => {
  axios.post.mockRejectedValue(Object.assign(new Error('HTTP 500'), { response: { status: 500, data: Buffer.from('{}') } }));
  mockSpeechCreate.mockRejectedValue(new Error('openai down'));

  await handleVoiceMessage(voiceNote(), FROM, TEACHER);

  expect(mockSendAudio).not.toHaveBeenCalled();
  expect(sentBodies()).toContain(ANSWER);
  expect(sentBodies()).not.toContain(GENERIC_ERROR);
});

test('when the voice note does not send, the answer goes as text', async () => {
  axios.post.mockResolvedValue({ status: 200, data: UR_OGG });
  mockSendAudio.mockResolvedValueOnce(false);

  await handleVoiceMessage(voiceNote(), FROM, TEACHER);

  expect(mockSendAudio).toHaveBeenCalledTimes(1);
  expect(sentBodies()).toContain(ANSWER);
});
