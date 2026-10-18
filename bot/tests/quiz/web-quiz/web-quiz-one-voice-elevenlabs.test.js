'use strict';
/**
 * One voice per quiz, the voice itself: a caller that pins an ElevenLabs voice (the web quiz with
 * app_settings web_quiz_one_voice on: web-quiz-voice.js ONE_VOICE) gets exactly that voice, model and
 * settings, with the language named to the model. Every other caller sends what it sent before.
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
const Voice = require('../../../shared/services/quiz/web-quiz-voice');

const OGG = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'tts', 'libopus-sine-1s.ogg'));
const body = (i = 0) => axios.post.mock.calls[i][1];
const url = (i = 0) => axios.post.mock.calls[i][0];

beforeEach(() => { axios.post.mockReset(); axios.post.mockResolvedValue({ data: OGG }); });

test.each(['en', 'ur'])('%s: the pinned one voice is spoken by that voice, model and settings, the language named', async (lang) => {
  const v = Voice.quizVoice(lang, { oneVoice: true });
  const out = await tts.synthesize({
    text: lang === 'ur' ? 'یہ کس کی آواز ہے؟' : 'Which month comes after January?', language: lang, useCase: 'reading',
    site: 'web_quiz_read_aloud', provider: v.provider, voice: v.voice, model: v.model, voiceSettings: v.settings,
  });
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(url()).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}?output_format=opus_48000_64`);
  expect(body()).toMatchObject({ model_id: 'eleven_v4', language_code: lang, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } });
  expect(out).toMatchObject({ provider: 'elevenlabs', voice: v.voice });
});

test('a caller that pins nothing sends exactly what it sent before (no model, language or settings change)', async () => {
  await tts.synthesize({ text: 'Hello teacher', language: 'en', useCase: 'coaching', site: 'question' });
  expect(Object.keys(body()).sort()).toEqual(['model_id', 'text', 'voice_settings']);
  expect(body().model_id).toBe('eleven_v3');
  expect(url()).not.toContain('hpp4J3VqNfWAUOO0d1Us');
});

test('a pinned voice may ask the provider for its own smaller format (one generation, no second encode); anything else is 64 kb/s', async () => {
  const v = Voice.quizVoice('en', { oneVoice: true });
  const call = (outputFormat) => tts.synthesize({
    text: 'Which month comes after January?', language: 'en', useCase: 'reading', site: 'web_quiz_read_aloud',
    provider: v.provider, voice: v.voice, model: v.model, voiceSettings: v.settings, outputFormat,
  });
  await call('opus_48000_32');
  await call('wav_99');
  expect(url(0)).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}?output_format=opus_48000_32`);
  expect(url(1)).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}?output_format=opus_48000_64`);
});
