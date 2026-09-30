/**
 * The Soniox voice provider (red first).
 *
 * Only the network is mocked: the text pipeline and the Ogg checks are the real
 * modules, fed real Soniox audio (tests/fixtures/tts). What a stream looks like
 * when Soniox cuts it mid-body is a real cut fixture, not a guess.
 */

const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

const { createSonioxProvider } = require('../../bot/shared/services/tts/providers/soniox.provider');
const { parseOggOpus, durationSec } = require('../../bot/shared/services/tts/ogg-opus');

const FIX = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tts', name));
const UR_A = FIX('soniox-ishita-ur-a.ogg');
const UR_B = FIX('soniox-ishita-ur-b.ogg');
const UR_CUT = FIX('soniox-ishita-ur-a.cut.ogg');
const EN_A = FIX('soniox-grace-en-a.ogg');

const httpError = (status, body = { error_type: 'x', message: 'y' }) => Object.assign(new Error(`HTTP ${status}`), {
  response: { status, data: Buffer.from(JSON.stringify(body)) },
});

// A Soniox response body as a real Node stream: `bytes` in `chunks` pieces, then the end — unless
// `end: false`, which is what Soniox did on 30 Sep: every byte of the clip, then silence, never a close.
function sonioxStream(bytes, { chunks = 4, end = true, delayMs = 0, onClose } = {}) {
  const s = new PassThrough();
  const size = Math.ceil(bytes.length / chunks);
  let i = 0;
  const next = () => {
    if (s.destroyed) return;
    if (i >= bytes.length) { if (end) s.end(); return; }
    s.write(bytes.subarray(i, i + size));
    i += size;
    if (delayMs) setTimeout(next, delayMs); else setImmediate(next);
  };
  if (onClose) s.on('close', onClose);
  setImmediate(next);
  return s;
}

// The fixtures are ~1.6 s clips; the per-character sanity floor is off here unless a test sets it.
function provider({ post, env = { SONIOX_API_KEY: 'sk-test' }, limits = {} } = {}) {
  return createSonioxProvider({
    http: { post },
    env,
    sleep: () => Promise.resolve(),
    limits: { minSecPerChar: 0, ...limits },
  });
}

describe('soniox provider — configuration', () => {
  it('is configured only with a key', () => {
    expect(provider({ env: {} }).isConfigured()).toBe(false);
    expect(provider({ env: { SONIOX_API_KEY: 'k' } }).isConfigured()).toBe(true);
    expect(provider({ env: { SONIOX_TTS_API_KEY: 'k' } }).isConfigured()).toBe(true);
  });

  it('speaks Urdu as Ishita and English as Grace by default; env can change either', () => {
    expect(provider().voiceFor('ur')).toBe('Ishita');
    expect(provider().voiceFor('ur-PK')).toBe('Ishita');
    expect(provider().voiceFor('en')).toBe('Grace');
    const p = provider({ env: { SONIOX_API_KEY: 'k', SONIOX_TTS_VOICE_UR: 'Nisha', SONIOX_TTS_VOICE_EN: 'Maya' } });
    expect(p.voiceFor('ur')).toBe('Nisha');
    expect(p.voiceFor('en')).toBe('Maya');
  });

  it('does not claim languages it has no voice for (Pashto, Sindhi, Punjabi)', () => {
    const p = provider();
    expect(p.supports('ur')).toBe(true);
    expect(p.supports('en')).toBe(true);
    for (const lang of ['ps-PK', 'sd-PK', 'pa-PK', 'fr', undefined, '']) expect(p.supports(lang)).toBe(false);
  });
});

describe('soniox provider — the request', () => {
  it('posts one Ogg Opus request with the tuned Urdu text and Ishita', async () => {
    const post = jest.fn().mockResolvedValue({ status: 200, data: UR_A });
    const out = await provider({ post }).synthesize({
      text: '[warmly] آپ کا اسکور 31.3 فیصد رہا۔', language: 'ur', useCase: 'coaching', site: 'report_voicenote',
      correlationId: 'wa-923001234567-abc123',
    });

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('https://tts-rt.soniox.com/tts');
    expect(body).toMatchObject({
      model: 'tts-rt-v2', language: 'ur', voice: 'Ishita', audio_format: 'opus', sample_rate: 48000, bitrate: 64000,
    });
    expect(body.text).toContain('thirty one point three');
    expect(body.text).toContain('[warm]');
    expect(body.text).not.toContain('[warmly]');
    // the usage-log reference must never carry a phone number
    expect(body.client_reference_id).not.toMatch(/\d{7,}/);
    expect(body.client_reference_id.length).toBeLessThanOrEqual(256);
    expect(config.headers.Authorization).toBe('Bearer sk-test');
    expect(config.headers['User-Agent']).toMatch(/\S/);
    // streamed, so a clip can be taken at its end page even when the response never closes
    expect(config.responseType).toBe('stream');
    expect(config.timeout).toBeGreaterThan(0);

    expect(out.audio.subarray(0, 4).toString('latin1')).toBe('OggS');
    expect(out).toMatchObject({ voice: 'Ishita', parts: 1, attempts: 1, model: 'tts-rt-v2' });
    expect(out.textSent).toBe(body.text);
  });

  it('English goes to Grace with the English clean-up', async () => {
    const post = jest.fn().mockResolvedValue({ status: 200, data: EN_A });
    await provider({ post }).synthesize({ text: 'Plan **one** activity 2-3 minutes long.', language: 'en', useCase: 'conversation' });
    const body = post.mock.calls[0][1];
    expect(body).toMatchObject({ language: 'en', voice: 'Grace' });
    expect(body.text).toBe('Plan one activity 2 to 3 minutes long.');
  });

  it('a long text is spoken in parts at the same time and returned as ONE Ogg stream', async () => {
    const sentence = 'یہ ایک لمبا جملہ ہے جو صرف جانچ کے لیے لکھا گیا ہے اور اس میں کوئی خاص بات نہیں۔ ';
    const text = sentence.repeat(12); // ~1,000 characters → several parts at the 300-character target
    let inFlight = 0; let maxInFlight = 0;
    const post = jest.fn().mockImplementation(async (url, body) => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight -= 1;
      return { status: 200, data: body.text.length % 2 ? UR_A : UR_B };
    });
    const out = await provider({ post }).synthesize({ text, language: 'ur', useCase: 'coaching' });

    expect(post.mock.calls.length).toBeGreaterThan(1);
    expect(maxInFlight).toBeGreaterThan(1);
    for (const [, body] of post.mock.calls) expect([...body.text].length).toBeLessThanOrEqual(900);
    expect(out.parts).toBe(post.mock.calls.length);
    const parsed = parseOggOpus(out.audio);
    expect(parsed.eos).toBe(true);
    expect(durationSec(out.audio)).toBeGreaterThan(1.5 * post.mock.calls.length);
  });

  it('a typical Urdu reply (~450 characters) is spoken as 3 parts, all at the same time', async () => {
    // Measured live 30 Sep: at 300-character parts a 423-character Urdu reply took 20 s
    // (2 parts); at 200 it took 12.6 s (3 parts); at 150 no faster. The longest part sets the wait.
    let inFlight = 0; let maxInFlight = 0;
    const post = jest.fn().mockImplementation(async () => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { status: 200, data: UR_A };
    });
    const sentence = 'آپ بچوں کو چھوٹے گروپوں میں تقسیم کریں اور ہر گروپ کو ایک سوال دیں۔ ';
    const text = sentence.repeat(6).trim(); // ~430 characters
    await createSonioxProvider({ http: { post }, env: { SONIOX_API_KEY: 'k' }, sleep: () => Promise.resolve(), limits: { minSecPerChar: 0 } })
      .synthesize({ text, language: 'ur', useCase: 'conversation' });
    expect(post).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(3);
  });

  it('never sends more parts at once than the per-process cap', async () => {
    let inFlight = 0; let maxInFlight = 0;
    const post = jest.fn().mockImplementation(async () => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { status: 200, data: UR_A };
    });
    const text = 'یہ جانچ کا جملہ ہے اور یہ کافی لمبا ہے تاکہ حصے بنیں۔ '.repeat(40);
    await provider({ post, env: { SONIOX_API_KEY: 'k', SONIOX_TTS_MAX_CONCURRENCY: '2' } })
      .synthesize({ text, language: 'ur', useCase: 'coaching' });
    expect(post.mock.calls.length).toBeGreaterThan(2);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe('soniox provider — a stream that is not whole is never delivered', () => {
  it('a stream cut mid-body is retried, and the whole one is returned', async () => {
    const post = jest.fn()
      .mockResolvedValueOnce({ status: 200, data: UR_CUT })
      .mockResolvedValueOnce({ status: 200, data: UR_A });
    const out = await provider({ post }).synthesize({ text: 'یہ آواز کی جانچ ہے۔', language: 'ur', useCase: 'conversation' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(out.attempts).toBe(2);
    expect(out.audio.equals(UR_A)).toBe(true);
  });

  it('a stream that dies AFTER its 200 header is retried (axios attaches the 200 response to that error)', async () => {
    // Seen live 30 Sep: the idle timeout fired mid-stream; axios rejected with
    // code ECONNABORTED and the 200 response attached, and a status-based rule
    // read "HTTP 200, not retryable" and gave up at once.
    const post = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED', response: { status: 200 } }))
      .mockRejectedValueOnce(Object.assign(new Error('stream has been aborted'), { code: 'ERR_BAD_RESPONSE', response: { status: 200 } }))
      .mockResolvedValueOnce({ status: 200, data: UR_A });
    const out = await provider({ post }).synthesize({ text: 'یہ آواز کی جانچ ہے۔', language: 'ur', useCase: 'conversation' });
    expect(post).toHaveBeenCalledTimes(3);
    expect(out.attempts).toBe(3);
  });

  it('when every attempt dies mid-stream, the error names what happened, not "HTTP 200"', async () => {
    const post = jest.fn().mockRejectedValue(Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED', response: { status: 200 } }));
    await expect(provider({ post }).synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'conversation' }))
      .rejects.toMatchObject({ code: 'network_error', message: expect.stringMatching(/ECONNABORTED|timeout/) });
  });

  it('every retried attempt is logged with its reason, so a flaky vendor shows up before it fails outright', async () => {
    const warn = jest.fn();
    const post = jest.fn()
      .mockResolvedValueOnce({ status: 200, data: UR_CUT })
      .mockRejectedValueOnce(Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED', response: { status: 200 } }))
      .mockResolvedValueOnce({ status: 200, data: UR_A });
    await createSonioxProvider({ http: { post }, env: { SONIOX_API_KEY: 'k' }, sleep: () => Promise.resolve(), limits: { minSecPerChar: 0 }, warn })
      .synthesize({ text: 'یہ آواز کی جانچ ہے۔', language: 'ur', useCase: 'conversation', site: 'voice_reply' });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(1, 'tts.soniox.retry', expect.objectContaining({ attempt: 1, part: 0, useCase: 'conversation', reason: expect.stringMatching(/truncated|eos/i) }));
    expect(warn).toHaveBeenNthCalledWith(2, 'tts.soniox.retry', expect.objectContaining({ attempt: 2, reason: expect.stringMatching(/ECONNABORTED|timeout/) }));
  });

  it('a network drop mid-stream is retried', async () => {
    const post = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce({ status: 200, data: UR_A });
    const out = await provider({ post }).synthesize({ text: 'یہ آواز کی جانچ ہے۔', language: 'ur', useCase: 'conversation' });
    expect(out.attempts).toBe(2);
  });

  it('429 and 5xx are retried; 400/401/402 fail at once (another try cannot fix them)', async () => {
    const retried = jest.fn()
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ status: 200, data: UR_A });
    await expect(provider({ post: retried }).synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'coaching' }))
      .resolves.toMatchObject({ attempts: 3 });

    for (const status of [400, 401, 402]) {
      const post = jest.fn().mockRejectedValue(httpError(status));
      await expect(provider({ post }).synthesize({ text: 'جانچ۔', language: 'ur', useCase: 'coaching' }))
        .rejects.toMatchObject({ status });
      expect(post).toHaveBeenCalledTimes(1);
    }
  });

  it('a stream that stalls is abandoned at its time cap and retried (seen live: a one-line clip hung 90 s)', async () => {
    const post = jest.fn()
      .mockImplementationOnce((url, body, config) => new Promise((resolve, reject) => {
        config.signal.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })));
      }))
      .mockResolvedValueOnce({ status: 200, data: UR_A });
    const out = await provider({ post, limits: { totalCapMs: () => 30 } })
      .synthesize({ text: 'یہ آواز کی جانچ ہے۔', language: 'ur', useCase: 'conversation' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(out.attempts).toBe(2);
  });

  it('a silent socket is given up after a few seconds, not a quarter-minute', async () => {
    // Measured 30 Sep on 110 healthy Soniox streams: first byte by 0.71 s at worst, never more than
    // 1.61 s between two chunks. A stream silent for 5 s is dead; waiting 15 s only made the teacher wait.
    const { DEFAULT_LIMITS } = require('../../bot/shared/services/tts/providers/soniox.provider');
    expect(DEFAULT_LIMITS.idleTimeoutMs).toBeLessThanOrEqual(5000);
    expect(DEFAULT_LIMITS.idleTimeoutMs).toBeGreaterThanOrEqual(3 * 1610);
    const post = jest.fn().mockResolvedValue({ status: 200, data: UR_A });
    await provider({ post }).synthesize({ text: 'یہ آواز کی جانچ ہے۔', language: 'ur', useCase: 'conversation' });
    // axios' `timeout` covers the wait for the first byte; the stream reader watches every gap after it
    expect(post.mock.calls[0][2].timeout).toBe(DEFAULT_LIMITS.idleTimeoutMs);
    expect(post.mock.calls[0][2].signal).toBeDefined();
  });

  it('gives up after the last attempt and says why', async () => {
    const post = jest.fn().mockResolvedValue({ status: 200, data: UR_CUT });
    await expect(provider({ post }).synthesize({ text: 'یہ آواز کی جانچ ہے۔', language: 'ur', useCase: 'coaching' }))
      .rejects.toMatchObject({ code: 'incomplete_audio' });
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('audio at the 2-minute ceiling is treated as cut short', async () => {
    const post = jest.fn().mockResolvedValue({ status: 200, data: UR_A });
    await expect(provider({ post, limits: { maxPartSec: 1.0 } })
      .synthesize({ text: 'یہ آواز کی جانچ ہے۔', language: 'ur', useCase: 'coaching' }))
      .rejects.toMatchObject({ code: 'incomplete_audio' });
  });

  it('audio far too short for its text is treated as cut short', async () => {
    const post = jest.fn().mockResolvedValue({ status: 200, data: UR_A }); // 1.7 s
    const text = 'یہ ایک لمبا جملہ ہے جو صرف جانچ کے لیے لکھا گیا ہے۔ '.repeat(4); // ~200 chars: ≥ 5 s at 40 chars/s
    await expect(provider({ post, limits: { minSecPerChar: 1 / 40 } })
      .synthesize({ text, language: 'ur', useCase: 'coaching' }))
      .rejects.toMatchObject({ code: 'incomplete_audio' });
  });

  it('refuses text that is empty once cleaned (nothing to say is a caller bug, not a voice note)', async () => {
    const post = jest.fn();
    await expect(provider({ post }).synthesize({ text: '[warmly] ', language: 'ur', useCase: 'coaching' }))
      .rejects.toMatchObject({ code: 'empty_text' });
    expect(post).not.toHaveBeenCalled();
  });

  it('reports bracketed text it had to drop', async () => {
    const post = jest.fn().mockResolvedValue({ status: 200, data: UR_A });
    const out = await provider({ post }).synthesize({ text: 'السلام علیکم [استاد کا نام]۔', language: 'ur', useCase: 'coaching' });
    expect(out.dropped).toEqual(['[استاد کا نام]']);
    expect(post.mock.calls[0][1].text).not.toContain('استاد کا نام');
  });
});

describe('soniox provider — a streamed response', () => {
  const TEXT = 'یہ آواز کی جانچ ہے۔';

  it('takes the clip the moment its end-of-stream page is in, even when Soniox never closes the response', async () => {
    // Seen 30 Sep: 6 of 100 Urdu requests sent every byte of the clip and then went silent without
    // ever ending the response. Waiting for the close cost 15 s and a retry; the clip was already whole.
    let closed = false;
    const post = jest.fn().mockImplementation(async () => ({ status: 200, data: sonioxStream(UR_A, { end: false, onClose: () => { closed = true; } }) }));
    const t0 = Date.now();
    const out = await provider({ post, limits: { idleTimeoutMs: 60000 } }).synthesize({ text: TEXT, language: 'ur', useCase: 'conversation' });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(out.attempts).toBe(1);
    expect(out.audio.equals(UR_A)).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(closed).toBe(true); // the hanging response is let go, so its socket does not leak
  });

  it('reads a healthy stream to its end and returns the clip whole', async () => {
    const post = jest.fn().mockImplementation(async () => ({ status: 200, data: sonioxStream(UR_A, { chunks: 9 }) }));
    const out = await provider({ post }).synthesize({ text: TEXT, language: 'ur', useCase: 'conversation' });
    expect(out.attempts).toBe(1);
    expect(out.audio.equals(UR_A)).toBe(true);
  });

  it('a stream that goes silent BEFORE its end page is given up after the idle window, and the retry is logged', async () => {
    const warn = jest.fn();
    let firstClosed = false;
    const post = jest.fn()
      .mockImplementationOnce(async () => ({ status: 200, data: sonioxStream(UR_CUT, { end: false, onClose: () => { firstClosed = true; } }) }))
      .mockImplementationOnce(async () => ({ status: 200, data: sonioxStream(UR_A) }));
    const out = await createSonioxProvider({ http: { post }, env: { SONIOX_API_KEY: 'k' }, sleep: () => Promise.resolve(),
      limits: { minSecPerChar: 0, idleTimeoutMs: 40 }, warn })
      .synthesize({ text: TEXT, language: 'ur', useCase: 'conversation', site: 'voice_reply' });
    expect(out.attempts).toBe(2);
    expect(out.audio.equals(UR_A)).toBe(true);
    expect(firstClosed).toBe(true);
    expect(warn).toHaveBeenCalledWith('tts.soniox.retry', expect.objectContaining({ attempt: 1, reason: expect.stringMatching(/silent/i) }));
  });

  it('a stream that ends early without its end page is retried, never delivered', async () => {
    const post = jest.fn()
      .mockImplementationOnce(async () => ({ status: 200, data: sonioxStream(UR_CUT) }))
      .mockImplementationOnce(async () => ({ status: 200, data: sonioxStream(UR_A) }));
    const out = await provider({ post }).synthesize({ text: TEXT, language: 'ur', useCase: 'conversation' });
    expect(out.attempts).toBe(2);
    expect(out.audio.equals(UR_A)).toBe(true);
  });

  it('keeps a part\'s concurrency slot until its body is read, not just until the headers arrive', async () => {
    let open = 0; let maxOpen = 0;
    const post = jest.fn().mockImplementation(async () => {
      open += 1; maxOpen = Math.max(maxOpen, open);
      return { status: 200, data: sonioxStream(UR_A, { chunks: 5, delayMs: 3, onClose: () => { open -= 1; } }) };
    });
    const text = 'یہ جانچ کا جملہ ہے اور یہ کافی لمبا ہے تاکہ حصے بنیں۔ '.repeat(30);
    const out = await provider({ post, env: { SONIOX_API_KEY: 'k', SONIOX_TTS_MAX_CONCURRENCY: '2' } })
      .synthesize({ text, language: 'ur', useCase: 'coaching' });
    expect(post.mock.calls.length).toBeGreaterThan(2);
    expect(out.parts).toBe(post.mock.calls.length);
    expect(maxOpen).toBeLessThanOrEqual(2);
  });

  it('a refused request still names Soniox\'s reason when the error body arrives as a stream', async () => {
    const body = new PassThrough();
    body.end(JSON.stringify({ error_type: 'invalid_request', message: 'voice not found' }));
    const post = jest.fn().mockRejectedValue(Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: body } }));
    await expect(provider({ post }).synthesize({ text: TEXT, language: 'ur', useCase: 'conversation' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('voice not found') });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
