'use strict';
/**
 * The question's read-along timings come with its clip: the one voice's ElevenLabs call asks for the characters' times
 * in the same generation (/with-timestamps, no second call, no extra characters). Every other caller is unchanged.
 *
 * Drives the REAL gateway, the REAL ElevenLabs provider and service; the network is mocked at axios.
 */
process.env.ELEVENLABS_API_KEY = 'test-only';
delete process.env.ELEVENLABS_FALLBACK_API_KEY;
delete process.env.E2E_CASSETTE;

jest.mock('axios');
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const tts = require('../../../shared/services/tts');
const ElevenLabs = require('../../../shared/services/elevenlabs.service');
const Voice = require('../../../shared/services/quiz/web-quiz-voice');

const OGG = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'tts', 'libopus-sine-1s.ogg'));
const TEXT = 'Which month comes after January?';
// 40 ms a character, as the provider reports them
const align = (text) => ({
  characters: [...text], character_start_times_seconds: [...text].map((_, k) => k * 0.04),
  character_end_times_seconds: [...text].map((_, k) => (k + 1) * 0.04),
});
const JSON_REPLY = { data: { audio_base64: OGG.toString('base64'), alignment: align(TEXT) } };
const url = (i = 0) => axios.post.mock.calls[i][0];
const body = (i = 0) => axios.post.mock.calls[i][1];
const conf = (i = 0) => axios.post.mock.calls[i][2];

beforeEach(() => { axios.post.mockReset(); delete process.env.ELEVENLABS_FALLBACK_API_KEY; });

describe('elevenlabs.service generateSpeechWithTimestamps', () => {
  test('POSTs /with-timestamps as JSON with the pinned call\'s body; returns the audio bytes and the alignment', async () => {
    axios.post.mockResolvedValue(JSON_REPLY);
    const out = await ElevenLabs.generateSpeechWithTimestamps(TEXT, 'voice1', 'en', { stability: 0.5 }, { modelId: 'eleven_v4', languageCode: 'en', outputFormat: 'opus_48000_32' });
    expect(url()).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice1/with-timestamps?output_format=opus_48000_32');
    expect(body()).toEqual({ text: TEXT, model_id: 'eleven_v4', voice_settings: { stability: 0.5 }, language_code: 'en' });
    expect(conf().responseType).not.toBe('arraybuffer');
    expect(Buffer.isBuffer(out.audio)).toBe(true);
    expect(out.audio.equals(OGG)).toBe(true);
    expect(out.alignment).toEqual(align(TEXT));
  });

  test('a format outside the whitelist is 64 kb/s', async () => {
    axios.post.mockResolvedValue(JSON_REPLY);
    await ElevenLabs.generateSpeechWithTimestamps(TEXT, 'voice1', 'en', null, { modelId: 'eleven_v4', languageCode: 'en', outputFormat: 'mp3_44100' });
    expect(url()).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice1/with-timestamps?output_format=opus_48000_64');
  });

  test('the primary key out of characters: retried once on the fallback key (a JSON error body); a 500 is not', async () => {
    process.env.ELEVENLABS_FALLBACK_API_KEY = 'fallback-only';
    const quota = Object.assign(new Error('401'), { response: { status: 401, data: { detail: { status: 'quota_exceeded' } } } });
    axios.post.mockRejectedValueOnce(quota).mockResolvedValueOnce(JSON_REPLY);
    const out = await ElevenLabs.generateSpeechWithTimestamps(TEXT, 'voice1', 'en', null, { modelId: 'eleven_v4', languageCode: 'en' });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(conf(1).headers['xi-api-key']).toBe('fallback-only');
    expect(out.alignment.characters.length).toBe(TEXT.length);

    axios.post.mockReset();
    axios.post.mockRejectedValueOnce(Object.assign(new Error('500'), { response: { status: 500, data: {} } }));
    await expect(ElevenLabs.generateSpeechWithTimestamps(TEXT, 'voice1', 'en', null, { modelId: 'eleven_v4' })).rejects.toThrow('500');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

describe('the gateway: timestamps on a pinned call only', () => {
  const v = Voice.quizVoice('en', { oneVoice: true });
  const pinned = (extra) => tts.synthesize({
    text: TEXT, language: 'en', useCase: 'reading', site: 'web_quiz_read_aloud',
    provider: v.provider, voice: v.voice, model: v.model, voiceSettings: v.settings, ...extra,
  });

  test('pinned + timestamps: one /with-timestamps call; the result carries the alignment', async () => {
    axios.post.mockResolvedValue(JSON_REPLY);
    const out = await pinned({ timestamps: true, outputFormat: 'opus_48000_64' });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(url()).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}/with-timestamps?output_format=opus_48000_64`);
    expect(body()).toMatchObject({ model_id: 'eleven_v4', language_code: 'en' });
    expect(out.alignment).toEqual(align(TEXT));
    expect(out.durationSec).toBeGreaterThan(0);
  });

  test('pinned without timestamps: today\'s call and no alignment key', async () => {
    axios.post.mockResolvedValue({ data: OGG });
    const out = await pinned({});
    expect(url()).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}?output_format=opus_48000_64`);
    expect('alignment' in out).toBe(false);
  });

  test('not pinned: timestamps are not passed through; today\'s call and no alignment key', async () => {
    axios.post.mockResolvedValue({ data: OGG });
    const out = await tts.synthesize({ text: 'Hello teacher', language: 'en', useCase: 'coaching', site: 'question', timestamps: true });
    expect(url()).not.toContain('with-timestamps');
    expect(Object.keys(body()).sort()).toEqual(['model_id', 'text', 'voice_settings']);
    expect('alignment' in out).toBe(false);
  });
});
