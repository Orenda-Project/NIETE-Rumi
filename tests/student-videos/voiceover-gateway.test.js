/**
 * Video narration speaks through the voice gateway (red first).
 *
 * It was the one voice path that bypassed everything: a raw fetch to ElevenLabs
 * with its own voice table, no fallback, no timeout and no retry. It now asks the
 * gateway (use case "video"), so TTS_PROVIDER decides who narrates and a failed
 * vendor falls back like every other voice. The gateway returns Ogg Opus; the
 * narration is converted to the MP3 the video assembler has always concatenated,
 * so nothing after this step changes.
 *
 * Executes the real generateVoiceover() and the real gateway with the network
 * mocked at its edge (axios); the two ffmpeg steps are spied, because a unit
 * suite never runs ffmpeg.
 */

const fs = require('fs');
const path = require('path');

const UR_OGG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tts', 'soniox-ishita-ur-a.ogg'));
const OTHER_OGG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tts', 'libopus-sine-1s.ogg'));

jest.mock('axios');
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const axios = require('axios');
const VideoScriptService = require('../../bot/shared/services/video/video-script.service');

const ENV_KEYS = ['TTS_PROVIDER', 'SONIOX_API_KEY', 'ELEVENLABS_API_KEY', 'E2E_CASSETTE'];
let saved;
let toMp3;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SONIOX_API_KEY = 'sk-test';
  process.env.ELEVENLABS_API_KEY = 'el-test';
  axios.post.mockReset();
  toMp3 = jest.spyOn(VideoScriptService, '_toMp3').mockImplementation(async (from, to) => { fs.writeFileSync(to, Buffer.from('ID3')); });
  jest.spyOn(VideoScriptService, 'getAudioDuration').mockResolvedValue(1.7);
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test('TTS_PROVIDER=soniox: Ishita narrates Urdu, and the assembler still gets an MP3 of that audio', async () => {
  process.env.TTS_PROVIDER = 'soniox';
  axios.post.mockImplementation(async (url) => {
    if (url.startsWith('https://tts-rt.soniox.com/')) return { status: 200, data: UR_OGG };
    throw new Error(`unexpected POST ${url}`);
  });

  const { audioUrl, duration } = await VideoScriptService.generateVoiceover('روشنی سیدھی لکیر میں چلتی ہے۔', 'vr-test-1', 1, 'ur');

  expect(axios.post.mock.calls[0][1]).toMatchObject({ voice: 'Ishita', language: 'ur' });
  const [oggPath, mp3Path] = toMp3.mock.calls[0];
  expect(fs.readFileSync(oggPath).equals(UR_OGG)).toBe(true);
  expect(audioUrl).toBe(mp3Path);
  expect(audioUrl).toMatch(/audio_1\.mp3$/);
  expect(duration).toBe(1.7);
});

test('with nothing set, ElevenLabs narrates with the Urdu voice and video settings, through the gateway', async () => {
  axios.post.mockResolvedValue({ status: 200, data: OTHER_OGG });

  await VideoScriptService.generateVoiceover('روشنی سیدھی لکیر میں چلتی ہے۔', 'vr-test-2', 2, 'ur');

  const [url, body] = axios.post.mock.calls[0];
  expect(url).toContain('api.elevenlabs.io/v1/text-to-speech/9cI5mhBtM4WtQ9Fo6jWQ'); // the Urdu voice, not Jessica
  expect(body.voice_settings).toEqual({ stability: 0.0, similarity_boost: 0.75 });
});

test('no raw vendor call is left in the video service', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'services', 'video', 'video-script.service.js'), 'utf8');
  expect(src).not.toMatch(/api\.elevenlabs\.io/);
});
