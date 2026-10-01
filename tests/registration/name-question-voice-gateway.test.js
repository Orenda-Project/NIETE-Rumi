/**
 * The spoken name question goes through the voice gateway, and a voice failure
 * sends the question as text (red first).
 *
 * Before: a synthesis failure was rethrown, the registration trigger returned
 * false, and the teacher was never asked her name. Now the same question goes
 * as text.
 *
 * Executes the real sendNameQuestion() and the real gateway; the network is
 * mocked at its edge (axios, the OpenAI SDK) and the WhatsApp send is stubbed.
 */

const fs = require('fs');
const path = require('path');

const UR_OGG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tts', 'soniox-ishita-ur-a.ogg'));

jest.mock('axios');
const mockSpeechCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { speech: { create: mockSpeechCreate } },
  chat: { completions: { create: jest.fn() } },
})));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const mockSendMessage = jest.fn(() => Promise.resolve(true));
const mockSendAudio = jest.fn(() => Promise.resolve(true));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendAudio: (...a) => mockSendAudio(...a),
  sendFlow: jest.fn(),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {};
  for (const m of ['select', 'eq', 'update', 'insert', 'single', 'maybeSingle']) chain[m] = jest.fn(() => chain);
  chain.then = (resolve) => resolve({ data: null, error: null });
  return { from: jest.fn(() => chain) };
});

const axios = require('axios');
const FeatureRegistrationService = require('../../bot/shared/services/feature-registration.service');

const QUESTION_UR = 'ویسے، میں آپ کو کیا نام سے بلاؤں؟';
const ENV_KEYS = ['TTS_PROVIDER', 'SONIOX_API_KEY', 'ELEVENLABS_API_KEY', 'OPENAI_API_KEY', 'REGISTRATION_FLOW_ID', 'E2E_CASSETTE'];
let saved;
beforeEach(() => {
  jest.clearAllMocks();
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.TTS_PROVIDER = 'soniox';
  process.env.SONIOX_API_KEY = 'sk-test';
  process.env.ELEVENLABS_API_KEY = 'el-test';
  axios.post.mockReset();
  mockSpeechCreate.mockReset();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test('the voice question is spoken by the configured provider (Soniox, Ishita)', async () => {
  axios.post.mockResolvedValue({ status: 200, data: UR_OGG });

  await FeatureRegistrationService.sendNameQuestion('u1', '923001234567', 'ur', 'voice');

  expect(axios.post.mock.calls[0][0]).toBe('https://tts-rt.soniox.com/tts');
  expect(axios.post.mock.calls[0][1]).toMatchObject({ voice: 'Ishita', language: 'ur' });
  expect(Buffer.from(mockSendAudio.mock.calls[0][1]).equals(UR_OGG)).toBe(true);
  expect(mockSendMessage).not.toHaveBeenCalled();
});

test('when no voice can be made, the question goes as text and she is still asked', async () => {
  axios.post.mockRejectedValue(Object.assign(new Error('HTTP 500'), { response: { status: 500, data: Buffer.from('{}') } }));
  mockSpeechCreate.mockRejectedValue(new Error('openai down'));

  await expect(FeatureRegistrationService.sendNameQuestion('u1', '923001234567', 'ur', 'voice')).resolves.not.toThrow();

  expect(mockSendAudio).not.toHaveBeenCalled();
  expect(mockSendMessage).toHaveBeenCalledWith('923001234567', QUESTION_UR);
});
