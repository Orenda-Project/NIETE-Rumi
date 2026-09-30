'use strict';
/**
 * The coaching report voice note speaks through the voice gateway, and its stored
 * duration is the audio's own length (red first).
 *
 * Before: the note came from a vendor-specific call and its duration was written
 * as `bytes / 16000` — a 128 kbps assumption. Voice notes are 64 kbps Ogg Opus,
 * so the dashboard showed about half the real length (and a Soniox note, whose
 * byte rate differs again, would be wrong a different way). The duration now
 * comes from the Ogg stream itself.
 *
 * Executes the real generateAndSendVoiceDebrief() and the real gateway; the
 * network is mocked at its edge (axios for the voice, the model client, R2 and
 * the WhatsApp send).
 */

const fs = require('fs');
const path = require('path');

const UR_OGG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tts', 'soniox-ishita-ur-a.ogg')); // 1.72 s, 17,605 bytes

jest.mock('axios');
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendAudioFromUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.mp3'),
  uploadReportImage: jest.fn(),
  uploadReportPDF: jest.fn(),
}));
jest.mock('../../bot/shared/services/coaching/coaching-helpers.service', () => ({
  determineOutputLanguage: jest.fn().mockResolvedValue('ur'),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {
    update: jest.fn((patch) => { global.__UPDATES.push(patch); return chain; }),
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    single: jest.fn(() => Promise.resolve({ data: { analysis_data: {} }, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => chain) };
});

const axios = require('axios');
const { uploadVoiceDebrief } = require('../../bot/shared/storage/r2');
const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const ReportGenerator = require('../../bot/shared/services/coaching/report-generator.service');

const SCRIPT = 'السلام علیکم۔ آج آپ نے سبق کا آغاز بہت واضح انداز میں کیا۔';
const session = {
  user_id: 'u1', session_id: 's1', transcript_language: 'ur',
  conversation_state: {}, users: { preferred_language: 'ur' },
};

const ENV_KEYS = ['TTS_PROVIDER', 'SONIOX_API_KEY', 'ELEVENLABS_API_KEY', 'E2E_CASSETTE'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.SONIOX_API_KEY = 'sk-test';
  process.env.ELEVENLABS_API_KEY = 'el-test';
  delete process.env.E2E_CASSETTE;
  global.__UPDATES = [];
  axios.post.mockReset();
  uploadVoiceDebrief.mockClear();
  jest.spyOn(GPT5MiniService, 'summarizeForVoiceDebrief').mockResolvedValue(SCRIPT);
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const durationWritten = () => (global.__UPDATES.find((u) => 'voice_debrief_duration_seconds' in u) || {}).voice_debrief_duration_seconds;

test('TTS_PROVIDER=soniox: Ishita speaks the report voice note, and its bytes are what is stored', async () => {
  process.env.TTS_PROVIDER = 'soniox';
  axios.post.mockImplementation(async (url) => {
    if (url.startsWith('https://tts-rt.soniox.com/')) return { status: 200, data: UR_OGG };
    throw new Error(`unexpected POST ${url}`);
  });

  await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', { framework: 'fico' });

  const soniox = axios.post.mock.calls.filter((c) => c[0].startsWith('https://tts-rt.soniox.com/'));
  expect(soniox).toHaveLength(1);
  expect(soniox[0][1]).toMatchObject({ voice: 'Ishita', language: 'ur' });
  expect(Buffer.from(uploadVoiceDebrief.mock.calls[0][0]).equals(UR_OGG)).toBe(true);
});

test('the stored duration is the audio length (1.72 s → 2), not bytes / 16000 (→ 1)', async () => {
  process.env.TTS_PROVIDER = 'soniox';
  axios.post.mockResolvedValue({ status: 200, data: UR_OGG });

  await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', { framework: 'fico' });

  expect(durationWritten()).toBe(2);
});

test('with nothing set, ElevenLabs still speaks it — and the duration is still the true one', async () => {
  delete process.env.TTS_PROVIDER;
  axios.post.mockImplementation(async (url) => {
    if (url.startsWith('https://api.elevenlabs.io/')) return { status: 200, data: UR_OGG };
    throw new Error(`unexpected POST ${url}`);
  });

  await ReportGenerator.generateAndSendVoiceDebrief(session, '923000000000', 'cs1', { framework: 'fico' });

  expect(axios.post.mock.calls[0][0]).toContain('api.elevenlabs.io');
  expect(durationWritten()).toBe(2);
});
