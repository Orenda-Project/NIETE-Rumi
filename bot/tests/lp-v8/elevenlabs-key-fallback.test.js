/**
 * bd-errbx — ElevenLabs key-level fallback (TDD, red first).
 *
 * The NIETE ElevenLabs workspace (Pro, 1.08M chars/mo) hit 95% eight days
 * into its cycle. When the primary key runs dry (or is throttled), voice
 * must degrade to the SAME Sara/Jessica voices on the global Rumi workspace
 * key — not to the OpenAI-TTS voice swap — and ONLY when the key has RUN OUT
 * (operator, 2026-08-23: "use fallback only if main NIETE key runs out"):
 *
 *   - 401 with detail.status quota_exceeded  → fallback key
 *   - 429 (throttle / concurrency blip)      → NO fallback — that is load,
 *     not exhaustion; shifting spikes onto the shared global key silently is
 *     exactly what the operator scoped out
 *   - bare/unparseable 401 (bad key etc.)    → NO fallback
 *   - any other error (500, bad request)     → throw as before (the existing
 *     OpenAI TTS fallback in the callers handles true outages)
 *   - fallback key unset                     → original behaviour exactly
 *
 * Voice-ID compatibility across workspaces is proven in production: Sara
 * (9cI5…) and Jessica (cgSg…) resolve on BOTH keys (the corpus fleet rendered
 * on the global key; runtime renders on the NIETE key — same IDs).
 */

/* eslint-disable global-require */

process.env.ELEVENLABS_API_KEY = 'primary-key-test';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-dummy';

jest.mock('axios');
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

// jest.resetModules() hands the re-required service a FRESH axios mock
// instance, so each test must configure the instance the service actually
// holds — re-required in beforeEach — never a top-level const.
let axios;

const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32, 1)]);

function quotaError(status, detailStatus) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = {
    status,
    // responseType is arraybuffer in the service, so real error bodies arrive
    // as bytes — the parser must cope with that shape.
    data: Buffer.from(JSON.stringify({ detail: { status: detailStatus, message: 'x' } })),
  };
  return err;
}

const keyOf = (call) => call[2].headers['xi-api-key'];

describe('ElevenLabs key fallback', () => {
  let ElevenLabs;

  beforeEach(() => {
    jest.resetModules();
    process.env.ELEVENLABS_FALLBACK_API_KEY = 'fallback-key-test';
    axios = require('axios');
    axios.post.mockReset();
    ElevenLabs = require('../../shared/services/elevenlabs.service');
  });

  test('primary succeeds → one call, primary key only', async () => {
    axios.post.mockResolvedValueOnce({ data: OGG });
    const buf = await ElevenLabs.generateSpeechWithVoice('سلام', '9cI5mhBtM4WtQ9Fo6jWQ', 'ur');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(keyOf(axios.post.mock.calls[0])).toBe('primary-key-test');
  });

  test('primary quota_exceeded (401) → retried once on the fallback key, same URL and body', async () => {
    axios.post
      .mockRejectedValueOnce(quotaError(401, 'quota_exceeded'))
      .mockResolvedValueOnce({ data: OGG });
    const buf = await ElevenLabs.generateSpeechWithVoice('سلام', '9cI5mhBtM4WtQ9Fo6jWQ', 'ur');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(keyOf(axios.post.mock.calls[0])).toBe('primary-key-test');
    expect(keyOf(axios.post.mock.calls[1])).toBe('fallback-key-test');
    expect(axios.post.mock.calls[1][0]).toBe(axios.post.mock.calls[0][0]);   // same URL (voice + opus format)
    expect(axios.post.mock.calls[1][1]).toEqual(axios.post.mock.calls[0][1]); // same body
  });

  test('primary 429 (throttle) → NO fallback: load is not exhaustion', async () => {
    axios.post.mockRejectedValueOnce(quotaError(429, 'too_many_concurrent_requests'));
    await expect(ElevenLabs.generateSpeech('Hello!')).rejects.toThrow();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('bare/unparseable 401 (bad key) → NO fallback', async () => {
    const err = new Error('Request failed with status code 401');
    err.response = { status: 401, data: Buffer.from('nope') };
    axios.post.mockRejectedValueOnce(err);
    await expect(ElevenLabs.generateSpeech('Hello!')).rejects.toThrow();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('non-quota error (500) → throws, fallback key NEVER burned', async () => {
    axios.post.mockRejectedValueOnce(quotaError(500, 'internal'));
    await expect(ElevenLabs.generateSpeechWithVoice('x', 'v', 'ur')).rejects.toThrow();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('fallback key unset → original error propagates after one call', async () => {
    delete process.env.ELEVENLABS_FALLBACK_API_KEY;
    jest.resetModules();
    axios = require('axios');
    axios.post.mockReset();
    const Fresh = require('../../shared/services/elevenlabs.service');
    axios.post.mockRejectedValueOnce(quotaError(401, 'quota_exceeded'));
    await expect(Fresh.generateSpeechWithVoice('x', 'v', 'ur')).rejects.toThrow();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('fallback itself failing → the error still surfaces (OpenAI TTS remains the outer net)', async () => {
    axios.post
      .mockRejectedValueOnce(quotaError(401, 'quota_exceeded'))
      .mockRejectedValueOnce(quotaError(401, 'quota_exceeded'));
    await expect(ElevenLabs.generateSpeech('Hello!')).rejects.toThrow();
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
