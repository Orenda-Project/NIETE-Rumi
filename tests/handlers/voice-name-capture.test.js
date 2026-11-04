/**
 * A teacher who answers "what should I call you?" with a voice note has her name saved (red first).
 *
 * Before: the waiting-for-name branch of the voice handler called `AudioService.transcribeAudio`,
 * which audio.service has never defined. The TypeError was caught as "Error checking pending name
 * status (voice)" and the note fell through into the ordinary voice flow, so her name was never
 * saved, she got no portal link, and she stayed flagged as waiting — the same thing on every voice
 * note after. Production logged it for 26 teachers between August and October 2026.
 *
 * It survived because every handler suite mocked audio.service WITH a `transcribeAudio` the real
 * class does not have. So this suite's mock is checked against the real class: every key it stubs
 * must be a real static method, and `transcribeAudio` is not one of them.
 *
 * Drives the REAL handleVoiceMessage, mocked at the same edges as voice-reply-tts-gateway.test.js.
 */

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('axios');
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { speech: { create: jest.fn(() => Promise.reject(new Error('no voice in tests'))) } },
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
jest.mock('../../bot/shared/services/openai.service', () => ({
  detectIntent: jest.fn(() => Promise.resolve({ type: 'general' })),
  getResponseWithFormat: jest.fn(() => Promise.resolve('ordinary answer')),
}));

// Only methods audio.service really has (checked below). No `transcribeAudio`.
jest.mock('../../bot/shared/services/audio.service', () => ({
  getAudioDuration: jest.fn(() => Promise.resolve(4)),
  convertToWav: jest.fn(() => Promise.resolve()),
  transcribeWithLanguagePreference: jest.fn(() => Promise.resolve({ text: 'Ayesha', language: 'ur', engine: 'soniox' })),
  getASREngine: jest.fn(() => 'soniox'),
}));

// The real temp helpers, watched: the wav must live in a private directory that is removed after.
jest.mock('../../bot/shared/utils/private-temp', () => {
  const actual = jest.requireActual('../../bot/shared/utils/private-temp');
  return { privateTempPath: jest.fn(actual.privateTempPath), removePrivateTemp: jest.fn(actual.removePrivateTemp) };
});

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

// Waiting for her name. handleNameResponse succeeds exactly when the REAL name extractor finds a name,
// so an empty transcript fails the way it does in production.
jest.mock('../../bot/shared/services/feature-registration.service', () => {
  const { extractFirstName } = jest.requireActual('../../bot/shared/services/feature-registration.service');
  return {
    isPendingName: jest.fn(() => Promise.resolve(true)),
    handleNameResponse: jest.fn(async (_userId, response) => {
      const firstName = extractFirstName(response);
      return firstName ? { success: true, firstName } : { success: false, error: 'Could not extract name' };
    }),
  };
});
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

const AudioService = require('../../bot/shared/services/audio.service');
const FeatureRegistrationService = require('../../bot/shared/services/feature-registration.service');
const OpenAIService = require('../../bot/shared/services/openai.service');
const { privateTempPath, removePrivateTemp } = require('../../bot/shared/utils/private-temp');
const { logToFile } = require('../../bot/shared/utils/logger');
const { handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler');

const FROM = '923001234567';
const TEACHER = { id: 'u1', role: 'teacher', preferred_language: 'ur' };
const voiceNote = () => ({ id: 'wamid.1', audio: { id: 'media-1', mime_type: 'audio/ogg' } });
const RETRY_UR = 'میں آپ کا نام سمجھ نہیں سکی۔ براہ کرم دوبارہ بتائیں؟';
const realExists = jest.requireActual('fs').existsSync;
// What the name branch's catch logged — before the fix, "AudioService.transcribeAudio is not a function".
const nameBranchErrors = () => logToFile.mock.calls
  .filter((c) => c[0] === '⚠️ Error checking pending name status (voice)')
  .map((c) => c[1] && c[1].error);

beforeEach(() => jest.clearAllMocks());

test('the audio.service mock stubs only methods the real class has', () => {
  const Real = jest.requireActual('../../bot/shared/services/audio.service');
  const phantom = Object.keys(AudioService).filter((k) => typeof Real[k] !== 'function');
  expect(phantom).toEqual([]);
  expect(typeof Real.transcribeAudio).toBe('undefined');
});

test('a voice note while waiting for her name is transcribed and saved as her name', async () => {
  await handleVoiceMessage(voiceNote(), FROM, TEACHER);

  expect(nameBranchErrors()).toEqual([]);
  expect(FeatureRegistrationService.handleNameResponse).toHaveBeenCalledTimes(1);
  expect(FeatureRegistrationService.handleNameResponse).toHaveBeenCalledWith('u1', 'Ayesha', FROM, 'ur', 'voice');
  expect(OpenAIService.getResponseWithFormat).not.toHaveBeenCalled();

  // Transcribed the way the main voice path does: her note converted to a wav, routed by her language.
  expect(AudioService.convertToWav).toHaveBeenCalledTimes(1);
  const [buffer, wavPath] = AudioService.convertToWav.mock.calls[0];
  expect(Buffer.isBuffer(buffer)).toBe(true);
  expect(AudioService.transcribeWithLanguagePreference).toHaveBeenCalledWith(wavPath, 'ur');

  // In a private directory of its own, and that directory is gone afterwards.
  const handle = privateTempPath.mock.results.map((r) => r.value).find((h) => h.filePath === wavPath);
  expect(handle).toBeDefined();
  expect(removePrivateTemp).toHaveBeenCalledWith(handle);
  expect(realExists(handle.dir)).toBe(false);
});

test('an empty transcript asks her again and does not start the ordinary voice flow', async () => {
  AudioService.transcribeWithLanguagePreference.mockResolvedValueOnce({ text: '', language: 'ur', engine: 'soniox' });

  await handleVoiceMessage(voiceNote(), FROM, TEACHER);

  expect(nameBranchErrors()).toEqual([]);
  expect(FeatureRegistrationService.handleNameResponse).toHaveBeenCalledTimes(1);
  expect(OpenAIService.getResponseWithFormat).not.toHaveBeenCalled();
  // The retry goes as a voice note when one can be made, else as the same words in text — and nothing else goes.
  const texts = mockSendMessage.mock.calls.map((c) => c[1]);
  expect(mockSendAudio.mock.calls.length + texts.filter((t) => t === RETRY_UR).length).toBe(1);
  expect(texts.filter((t) => t !== RETRY_UR)).toEqual([]);
});

test('when the name transcription itself fails, its wav is still removed', async () => {
  AudioService.transcribeWithLanguagePreference.mockRejectedValueOnce(new Error('asr down'));

  await handleVoiceMessage(voiceNote(), FROM, TEACHER);

  // The failure is the ASR's, raised inside the name branch (and caught there, as before) — not a missing method.
  expect(nameBranchErrors()).toEqual(['asr down']);
  expect(AudioService.convertToWav).toHaveBeenCalled();
  const wavPath = AudioService.convertToWav.mock.calls[0][1];
  const handle = privateTempPath.mock.results.map((r) => r.value).find((h) => h.filePath === wavPath);
  expect(handle).toBeDefined();
  expect(removePrivateTemp).toHaveBeenCalledWith(handle);
  expect(realExists(handle.dir)).toBe(false);
});
