/**
 * Reading-assessment voice feedback speaks through the voice gateway (red first).
 *
 * Executes the real generateVoiceFeedback() and the real gateway with the
 * network mocked at its edge (axios); the script writer is stubbed, since what
 * is under test is who speaks the script.
 */

const fs = require('fs');
const path = require('path');

const UR_OGG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tts', 'soniox-ishita-ur-a.ogg'));
const EN_OGG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tts', 'soniox-grace-en-a.ogg'));

jest.mock('axios');
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const axios = require('axios');
const VoiceFeedbackService = require('../../bot/shared/services/reading/voice-feedback.service');

const ENV_KEYS = ['TTS_PROVIDER', 'TTS_PROVIDER_READING', 'SONIOX_API_KEY', 'ELEVENLABS_API_KEY', 'E2E_CASSETTE'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SONIOX_API_KEY = 'sk-test';
  process.env.ELEVENLABS_API_KEY = 'el-test';
  axios.post.mockReset();
  axios.post.mockImplementation(async (url, body) => {
    if (url.startsWith('https://tts-rt.soniox.com/')) return { status: 200, data: body.language === 'ur' ? UR_OGG : EN_OGG };
    if (url.startsWith('https://api.elevenlabs.io/')) return { status: 200, data: EN_OGG };
    throw new Error(`unexpected POST ${url}`);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const assessment = { id: 'ra1', student_identifier: 'Student', wcpm: 42, accuracy_percentage: 88 };

test('TTS_PROVIDER=soniox: the feedback is spoken by Soniox in the passage language', async () => {
  process.env.TTS_PROVIDER = 'soniox';
  jest.spyOn(VoiceFeedbackService, 'generateFeedbackScript').mockResolvedValue('Your student read 42 words a minute. Well done.');

  const audio = await VoiceFeedbackService.generateVoiceFeedback(assessment, 'Teacher', 'en');

  const soniox = axios.post.mock.calls.filter((c) => c[0].startsWith('https://tts-rt.soniox.com/'));
  expect(soniox).toHaveLength(1);
  expect(soniox[0][1]).toMatchObject({ voice: 'Grace', language: 'en' });
  expect(Buffer.from(audio).equals(EN_OGG)).toBe(true);
});

test('the reading use case can be moved on its own (TTS_PROVIDER_READING)', async () => {
  process.env.TTS_PROVIDER_READING = 'soniox';
  jest.spyOn(VoiceFeedbackService, 'generateFeedbackScript').mockResolvedValue('آپ کے طالب علم نے اچھا پڑھا۔');

  await VoiceFeedbackService.generateVoiceFeedback(assessment, 'Teacher', 'ur');

  expect(axios.post.mock.calls[0][0]).toBe('https://tts-rt.soniox.com/tts');
  expect(axios.post.mock.calls[0][1]).toMatchObject({ voice: 'Ishita', language: 'ur' });
});
