/**
 * The ElevenLabs provider sends exactly what the pre-gateway path sent (red first
 * for the video voice settings).
 *
 * Leaving TTS_PROVIDER unset must change nothing a teacher hears, so the request
 * body is pinned here: voice, model, voice settings, Ogg Opus, and the Urdu
 * clean-up. Video narration kept its own expressive settings when it called
 * ElevenLabs directly; through the gateway it must keep them.
 */

process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'test-dummy';

jest.mock('axios');
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const axios = require('axios');
const { createElevenLabsProvider } = require('../../bot/shared/services/tts/providers/elevenlabs.provider');

const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32, 1)]);

beforeEach(() => {
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: OGG });
});

const provider = () => createElevenLabsProvider({ env: { ELEVENLABS_API_KEY: 'k' } });

describe('elevenlabs provider', () => {
  it('Urdu: Sara, eleven_v3, the Urdu voice settings, Ogg Opus, the Urdu clean-up', async () => {
    await provider().synthesize({ text: 'اگلی بار 3 سوال پوچھیں۔', language: 'ur', useCase: 'conversation' });
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/9cI5mhBtM4WtQ9Fo6jWQ?output_format=opus_48000_64');
    expect(body).toEqual({
      text: 'اگلی بار three سوال پوچھیں۔',
      model_id: 'eleven_v3',
      voice_settings: { stability: 0.7, similarity_boost: 0.85, style: 0.0, use_speaker_boost: true },
    });
  });

  it('English: Jessica with the expressive settings; the text is untouched', async () => {
    await provider().synthesize({ text: '[warmly] Plan 3 activities.', language: 'en', useCase: 'coaching' });
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/cgSgspJ2msm6clMCkdW9?output_format=opus_48000_64');
    expect(body).toEqual({
      text: '[warmly] Plan 3 activities.',
      model_id: 'eleven_v3',
      voice_settings: { stability: 0.0, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    });
  });

  it('video narration keeps the settings it used when it called ElevenLabs directly', async () => {
    await provider().synthesize({ text: 'روشنی سیدھی چلتی ہے۔', language: 'ur', useCase: 'video' });
    expect(axios.post.mock.calls[0][1].voice_settings).toEqual({ stability: 0.0, similarity_boost: 0.75 });
  });

  it('speaks only languages whose voice is an ElevenLabs voice', () => {
    const p = provider();
    expect(p.supports('ur')).toBe(true);
    expect(p.supports('en')).toBe(true);
    expect(p.supports('sd-PK')).toBe(false); // an Uplift voice
    expect(p.supports('xx')).toBe(false);
  });
});
