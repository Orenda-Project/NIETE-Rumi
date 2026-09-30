/**
 * The voice gateway: one call for every voice note, whoever speaks it (red first).
 *
 * The real providers run; the network is mocked at its edge — axios for Soniox
 * and ElevenLabs, the OpenAI SDK for the OpenAI voice — and every provider
 * answers with real Ogg Opus bytes from tests/fixtures/tts.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'test-dummy';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-dummy';

jest.mock('axios');
const mockSpeechCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ audio: { speech: { create: mockSpeechCreate } } })));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => 'corr-test-1' }));

const axios = require('axios');
const { logError } = require('../../bot/shared/utils/logger');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const tts = require('../../bot/shared/services/tts');

const FIX = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tts', name));
const SONIOX_UR = FIX('soniox-ishita-ur-a.ogg');
const SONIOX_EN = FIX('soniox-grace-en-a.ogg');
const OTHER_OGG = FIX('libopus-sine-1s.ogg');
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data: Buffer.from('{"message":"x"}') } });

const ENV_KEYS = ['TTS_PROVIDER', 'TTS_PROVIDER_COACHING', 'TTS_FALLBACK', 'SONIOX_API_KEY', 'SONIOX_TTS_API_KEY',
  'E2E_CASSETTE', 'E2E_CASSETTE_DIR', 'SUPABASE_URL'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  axios.post.mockReset();
  mockSpeechCreate.mockReset();
  logError.mockClear();
  logEvent.mockClear();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const routeAxios = ({ soniox, elevenlabs }) => axios.post.mockImplementation(async (url, body) => {
  if (url.startsWith('https://tts-rt.soniox.com/')) return soniox(body);
  if (url.startsWith('https://api.elevenlabs.io/')) return elevenlabs(body);
  throw new Error(`unexpected POST ${url}`);
});

describe('tts.synthesize — who speaks', () => {
  it('with nothing set, ElevenLabs speaks exactly as before (and Soniox is never called)', async () => {
    routeAxios({ soniox: () => { throw new Error('soniox must not be called'); }, elevenlabs: () => ({ status: 200, data: OTHER_OGG }) });
    const out = await tts.synthesize({ text: 'آپ کا اسکور 31.3 فیصد رہا۔', language: 'ur', useCase: 'coaching', site: 'report_voicenote' });

    expect(out).toMatchObject({ provider: 'elevenlabs', mimeType: 'audio/ogg', extension: 'ogg', fallbackFrom: null });
    expect(out.audio.equals(OTHER_OGG)).toBe(true);
    expect(out.durationSec).toBeCloseTo(1.0, 3); // playable length: ffprobe's 1.0065 s less the 6.5 ms decoder warm-up
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('output_format=opus_48000_64');
    expect(body.text).toBe('آپ کا اسکور thirty-one point three فیصد رہا۔'); // today's Urdu clean-up, decimal fixed
  });

  it('TTS_PROVIDER=soniox: Ishita speaks Urdu, Grace speaks English', async () => {
    process.env.TTS_PROVIDER = 'soniox';
    process.env.SONIOX_API_KEY = 'sk-test';
    routeAxios({ soniox: (body) => ({ status: 200, data: body.language === 'ur' ? SONIOX_UR : SONIOX_EN }),
      elevenlabs: () => { throw new Error('elevenlabs must not be called'); } });

    const ur = await tts.synthesize({ text: 'یہ آواز کی جانچ ہے۔', language: 'ur', useCase: 'conversation', site: 'voice_reply' });
    const en = await tts.synthesize({ text: 'This is a short voice check.', language: 'en', useCase: 'conversation', site: 'voice_reply' });

    expect(ur).toMatchObject({ provider: 'soniox', voice: 'Ishita', mimeType: 'audio/ogg', fallbackFrom: null });
    expect(en).toMatchObject({ provider: 'soniox', voice: 'Grace' });
    expect(ur.durationSec).toBeCloseTo(1.72, 3);
    expect(logEvent).toHaveBeenCalledWith('tts.synthesize.ok', expect.objectContaining({
      provider: 'soniox', voice: 'Ishita', useCase: 'conversation', site: 'voice_reply', language: 'ur', job: 'tts.conversation.voice_reply',
    }));
    expect(logError).not.toHaveBeenCalled();
  });

  it('a use case can be moved alone: coaching on Soniox, conversation still ElevenLabs', async () => {
    process.env.TTS_PROVIDER_COACHING = 'soniox';
    process.env.SONIOX_API_KEY = 'sk-test';
    routeAxios({ soniox: () => ({ status: 200, data: SONIOX_UR }), elevenlabs: () => ({ status: 200, data: OTHER_OGG }) });

    expect((await tts.synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'coaching', site: 'question' })).provider).toBe('soniox');
    expect((await tts.synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'conversation', site: 'voice_reply' })).provider).toBe('elevenlabs');
  });
});

describe('tts.synthesize — when the chosen voice fails, the next one speaks, loudly', () => {
  it('Soniox refuses (402) → ElevenLabs speaks, and the fallback is logged at error', async () => {
    process.env.TTS_PROVIDER = 'soniox';
    process.env.SONIOX_API_KEY = 'sk-test';
    routeAxios({ soniox: () => { throw httpError(402); }, elevenlabs: () => ({ status: 200, data: OTHER_OGG }) });

    const out = await tts.synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'coaching', site: 'closer' });
    expect(out).toMatchObject({ provider: 'elevenlabs', fallbackFrom: 'soniox' });
    expect(logError).toHaveBeenCalledWith('tts.synthesize.fallback', expect.objectContaining({
      event: 'tts.synthesize.fallback', useCase: 'coaching', site: 'closer', spokeWith: 'elevenlabs',
      failures: [expect.objectContaining({ provider: 'soniox', status: 402 })],
    }));
  });

  it('Soniox chosen but its key is missing → ElevenLabs speaks, and that misconfiguration is an error', async () => {
    process.env.TTS_PROVIDER = 'soniox';
    routeAxios({ soniox: () => { throw new Error('no key: must not be called'); }, elevenlabs: () => ({ status: 200, data: OTHER_OGG }) });
    const out = await tts.synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'conversation', site: 'voice_reply' });
    expect(out.provider).toBe('elevenlabs');
    expect(logError).toHaveBeenCalledWith('tts.synthesize.fallback', expect.objectContaining({
      failures: [expect.objectContaining({ provider: 'soniox', reason: 'not_configured' })],
    }));
  });

  it('a language Soniox has no voice for (Pashto) goes to the next provider without an error', async () => {
    process.env.TTS_PROVIDER = 'soniox';
    process.env.SONIOX_API_KEY = 'sk-test';
    routeAxios({ soniox: () => { throw new Error('must not be called'); }, elevenlabs: () => ({ status: 200, data: OTHER_OGG }) });
    const out = await tts.synthesize({ text: 'test', language: 'ps-PK', useCase: 'video', site: 'narration' });
    expect(out).toMatchObject({ provider: 'elevenlabs', fallbackFrom: null });
    expect(logError).not.toHaveBeenCalled();
  });

  it('audio that is not Ogg Opus is never delivered: the next provider speaks', async () => {
    routeAxios({ soniox: () => ({}), elevenlabs: () => ({ status: 200, data: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 1)]) }) });
    mockSpeechCreate.mockResolvedValue({ arrayBuffer: async () => OTHER_OGG });
    const out = await tts.synthesize({ text: 'hello', language: 'en', useCase: 'conversation', site: 'voice_reply' });
    expect(out).toMatchObject({ provider: 'openai', fallbackFrom: 'elevenlabs' });
  });

  it('when every provider fails it throws, names each failure, and logs it at error', async () => {
    routeAxios({ soniox: () => ({}), elevenlabs: () => { throw httpError(500); } });
    mockSpeechCreate.mockRejectedValue(new Error('openai down'));
    await expect(tts.synthesize({ text: 'hello', language: 'en', useCase: 'reading', site: 'feedback' }))
      .rejects.toMatchObject({ name: 'TtsUnavailableError', failures: [
        expect.objectContaining({ provider: 'elevenlabs' }), expect.objectContaining({ provider: 'openai' }),
      ] });
    expect(logError).toHaveBeenCalledWith('tts.synthesize.failed', expect.objectContaining({ useCase: 'reading' }));
  });
});

describe('tts.synthesize — bracketed text Soniox would read aloud', () => {
  const { logWarn } = require('../../bot/shared/utils/logger');
  beforeEach(() => {
    process.env.TTS_PROVIDER = 'soniox';
    process.env.SONIOX_API_KEY = 'sk-test';
    routeAxios({ soniox: () => ({ status: 200, data: SONIOX_UR }), elevenlabs: () => ({ status: 200, data: OTHER_OGG }) });
    logWarn.mockClear();
  });

  it('a template placeholder left in the text is an error: someone was meant to fill it', async () => {
    await tts.synthesize({ text: 'السلام علیکم [استاد کا نام]، آج کا سبق اچھا تھا۔', language: 'ur', useCase: 'coaching', site: 'report_voicenote' });
    expect(logError).toHaveBeenCalledWith('tts.text.dropped', expect.objectContaining({ dropped: ['[استاد کا نام]'] }));
  });

  it('an unknown stage direction is only a warning: it is dropped and nothing is missing', async () => {
    await tts.synthesize({ text: '[enthusiastic teacher voice] Light travels in straight lines.', language: 'en', useCase: 'video', site: 'narration' });
    expect(logError).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith('tts.text.dropped', expect.objectContaining({ dropped: ['[enthusiastic teacher voice]'] }));
  });
});

describe('tts.synthesize — a caller that cannot wait', () => {
  it('past its deadline the gateway gives up, says so, and the caller can send text', async () => {
    process.env.TTS_PROVIDER = 'soniox';
    process.env.SONIOX_API_KEY = 'sk-test';
    routeAxios({
      soniox: () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, data: SONIOX_UR }), 300)),
      elevenlabs: () => ({ status: 200, data: OTHER_OGG }),
    });
    await expect(tts.synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'coaching', site: 'closer', deadlineMs: 30 }))
      .rejects.toMatchObject({ name: 'TtsUnavailableError', failures: [expect.objectContaining({ reason: 'deadline' })] });
    expect(logError).toHaveBeenCalledWith('tts.synthesize.failed', expect.objectContaining({ site: 'closer' }));
  });

  it('without a deadline a slow voice is waited for', async () => {
    process.env.TTS_PROVIDER = 'soniox';
    process.env.SONIOX_API_KEY = 'sk-test';
    routeAxios({
      soniox: () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, data: SONIOX_UR }), 50)),
      elevenlabs: () => ({ status: 200, data: OTHER_OGG }),
    });
    const out = await tts.synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'coaching', site: 'report_voicenote' });
    expect(out.provider).toBe('soniox');
  });
});

describe('tts.synthesize — inputs', () => {
  it('refuses a missing use case or empty text (a caller bug, not a voice note)', async () => {
    await expect(tts.synthesize({ text: 'hello', language: 'en' })).rejects.toThrow(/use case/i);
    await expect(tts.synthesize({ text: '   ', language: 'en', useCase: 'conversation' })).rejects.toThrow(/text/i);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('tts.synthesize — the E2E cassette sits at the gateway', () => {
  const cassette = require('../../bot/shared/services/e2e-cassette');
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-cassette-')); process.env.E2E_CASSETTE_DIR = dir; });

  const store = (keyParts, buf) => {
    const key = cassette.keyFor('tts', keyParts);
    fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({ kind: 'tts', key, recordedAt: 'x', b64: buf.toString('base64') }));
  };

  it('ElevenLabs primary replays the recordings made before the gateway (same key)', async () => {
    process.env.E2E_CASSETTE = 'replay-strict';
    store({ fn: 'generateSpeechForLanguage', text: 'جانچ۔', languageCode: 'ur' }, OTHER_OGG);
    const out = await tts.synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'coaching', site: 'question' });
    expect(out.audio.equals(OTHER_OGG)).toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('Soniox primary never replays an ElevenLabs recording: its key names the provider and voice', async () => {
    process.env.E2E_CASSETTE = 'replay-strict';
    process.env.TTS_PROVIDER = 'soniox';
    process.env.SONIOX_API_KEY = 'sk-test';
    store({ fn: 'generateSpeechForLanguage', text: 'جانچ۔', languageCode: 'ur' }, OTHER_OGG);
    await expect(tts.synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'coaching', site: 'question' }))
      .rejects.toMatchObject({ code: 'E2E_CASSETTE_MISS' });

    store({ fn: 'tts.synthesize', provider: 'soniox', voice: 'Ishita', text: 'جانچ۔', language: 'ur' }, SONIOX_UR);
    const out = await tts.synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'coaching', site: 'question' });
    expect(out).toMatchObject({ provider: 'soniox', voice: 'Ishita', cassette: 'replay' });
    expect(out.audio.equals(SONIOX_UR)).toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('tts.synthesize — a vendor quirk the teacher no longer feels still shows in the logs', () => {
  const { PassThrough } = require('stream');
  const sonioxBody = ({ close }) => () => {
    const s = new PassThrough();
    if (close) s.end(SONIOX_UR); else s.write(SONIOX_UR); // the whole clip; closed, or left open as Soniox sometimes does
    return { status: 200, data: s };
  };

  it('the ok event counts the parts whose Soniox response never closed', async () => {
    process.env.TTS_PROVIDER = 'soniox';
    process.env.SONIOX_API_KEY = 'sk-test';
    routeAxios({ soniox: sonioxBody({ close: false }), elevenlabs: () => { throw new Error('elevenlabs must not be called'); } });
    const out = await tts.synthesize({ text: 'یہ آواز کی جانچ ہے۔', language: 'ur', useCase: 'conversation', site: 'voice_reply' });
    expect(out.provider).toBe('soniox');
    expect(logEvent).toHaveBeenCalledWith('tts.synthesize.ok', expect.objectContaining({ provider: 'soniox', unclosed: 1 }));
  });

  it('a response that closes counts none', async () => {
    process.env.TTS_PROVIDER = 'soniox';
    process.env.SONIOX_API_KEY = 'sk-test';
    routeAxios({ soniox: sonioxBody({ close: true }), elevenlabs: () => { throw new Error('elevenlabs must not be called'); } });
    await tts.synthesize({ text: 'یہ آواز کی جانچ ہے۔', language: 'ur', useCase: 'conversation', site: 'voice_reply' });
    expect(logEvent).toHaveBeenCalledWith('tts.synthesize.ok', expect.objectContaining({ provider: 'soniox', unclosed: 0 }));
  });
});
