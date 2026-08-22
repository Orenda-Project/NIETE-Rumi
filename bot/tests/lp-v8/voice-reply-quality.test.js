/**
 * bd-z5olm — staging feedback on the first LP-Q&A conversations (TDD, red first).
 *
 * Two defects the operator heard on +92 322 2482222:
 *
 * 1. FILLER WORDS. Sara opens sentences with «دیکھو» / «بس» / «ہاں» and staples
 *    tag-questions («…، نا؟»). Root cause is not the TTS — the words are in the
 *    model's own stored text, because LANGUAGE_PROMPTS.ur MANDATED them:
 *    "REQUIRED DISCOURSE MARKERS (use 2-3 per response): اچھا 30% · ہاں 25% ·
 *    دیکھو 20% · نا 20% (tag questions) · بس 15%". Its examples also model MALE
 *    first-person («بالکل! میں ابھی بناتا ہوں», «سمجھ گیا») — the source of a
 *    live «مدد کروں گا» slip — and chummy tum-register leaks («کر لو، دو»).
 *    The rewrite keeps natural code-mixing and warmth, and pins: آپ-register
 *    imperatives, feminine first-person, no filler openers, no tag-questions.
 *
 * 2. VOICE REPLIES ARE MP3. Every conversational voice reply uploads as
 *    audio/mpeg, so WhatsApp renders a music-player bubble — no waveform, no
 *    1x/1.5x/2x speed control. The LP voicenotes are Ogg Opus and get the real
 *    voice bubble. Probed live (2026-08-21): eleven_v3 + Sara with
 *    output_format=opus_48000_64 returns genuine Ogg Opus (OggS magic).
 *    TTS now asks for opus end-to-end and sendAudio sniffs the container so
 *    any straggler MP3 producer (Uplift tiers) still sends correctly.
 */

/* eslint-disable global-require */

process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'test-dummy';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-dummy';
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'test-dummy';
process.env.PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1234567890';

// ─── 1. the ur conversation style contract ──────────────────────────────────

const { buildLanguagePrompt } = require('../../shared/config/language-prompts');

describe('ur conversation prompt — respectful register, no mandated fillers', () => {
  const prompt = () => buildLanguagePrompt('ur', 'Ayesha');

  test('the discourse-marker quota block is GONE', () => {
    expect(prompt()).not.toMatch(/REQUIRED DISCOURSE MARKERS/i);
    expect(prompt()).not.toMatch(/use 2-3 per response/i);
  });

  test('no male first-person anywhere in the examples', () => {
    expect(prompt()).not.toContain('بناتا ہوں');
    expect(prompt()).not.toContain('سمجھ گیا');
    expect(prompt()).not.toContain('کروں گا');
  });

  test('feminine first-person is modelled instead', () => {
    expect(prompt()).toContain('بناتی ہوں');
    expect(prompt()).toMatch(/کروں گی|سکتی ہوں/);
  });

  test('آپ-register imperatives are required, tum-forms banned', () => {
    expect(prompt()).toMatch(/RESPECT REGISTER/i);
    expect(prompt()).toContain('کریں، دیکھیں');
    expect(prompt()).toMatch(/NEVER tum-forms/i);
  });

  test('filler openers and tag-questions are banned', () => {
    expect(prompt()).toMatch(/NO FILLER/i);
    expect(prompt()).toMatch(/tag-question/i);
    expect(prompt()).toMatch(/نا\؟|ناں\؟/);      // the ban names the exact tic
  });

  test('genuine code-mixing survives (this is style repair, not formalisation)', () => {
    expect(prompt()).toMatch(/lesson plan/);
    expect(prompt()).toMatch(/Sound like a real teacher/i);
  });
});

// ─── 2. opus end-to-end ─────────────────────────────────────────────────────

jest.mock('axios');
const axios = require('axios');
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const OGG_BUFFER = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64, 1)]);
const MP3_BUFFER = Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(64, 1)]);

describe('ElevenLabs asks for Ogg Opus', () => {
  beforeEach(() => {
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: OGG_BUFFER });
  });

  test('generateSpeechWithVoice requests opus_48000_64', async () => {
    const ElevenLabs = require('../../shared/services/elevenlabs.service');
    await ElevenLabs.generateSpeechWithVoice('السلام علیکم', '9cI5mhBtM4WtQ9Fo6jWQ', 'ur');
    const url = axios.post.mock.calls[0][0];
    expect(url).toContain('output_format=opus_48000_64');
  });

  test('generateSpeech (en/Jessica path) requests opus_48000_64', async () => {
    const ElevenLabs = require('../../shared/services/elevenlabs.service');
    await ElevenLabs.generateSpeech('Hello there!');
    const url = axios.post.mock.calls[0][0];
    expect(url).toContain('output_format=opus_48000_64');
  });
});

describe('sendAudio sends a real voice message', () => {
  const os = require('os');
  const TEMP = os.tmpdir();
  let appended;

  // jest.resetModules() gives whatsapp.service a FRESH axios mock instance, so
  // the mock must be configured on the re-required module, not the top const.
  function freshWhatsApp() {
    appended.length = 0;
    jest.resetModules();
    jest.doMock('form-data', () => class MockFormData {
      append(name, value, opts) { appended.push({ name, opts }); }
      getHeaders() { return { 'content-type': 'multipart/form-data; boundary=x' }; }
    });
    // No real file IO: an unconsumed lazy fs.ReadStream would race the
    // unlink after the mocked upload resolves and crash the run with an
    // uncaught ENOENT. Stub exactly the members sendAudio touches.
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      writeFileSync: jest.fn(),
      unlinkSync: jest.fn(),
      createReadStream: jest.fn(() => ({ destroy: () => {}, on: () => {}, pipe: () => {} })),
    }));
    // eslint-disable-next-line global-require
    const axiosFresh = require('axios');
    axiosFresh.post.mockReset();
    axiosFresh.post
      .mockResolvedValueOnce({ data: { id: 'media-1' } })     // upload
      .mockResolvedValueOnce({ data: { messages: [{}] } });   // send
    // eslint-disable-next-line global-require
    return require('../../shared/services/whatsapp.service');
  }

  beforeEach(() => { appended = []; });

  test('an Ogg Opus buffer uploads as audio/ogg with an .ogg name (the voice bubble)', async () => {
    const WhatsApp = freshWhatsApp();
    const ok = await WhatsApp.sendAudio('923001234567', OGG_BUFFER, TEMP);
    expect(ok).toBe(true);
    const filePart = appended.find((a) => a.name === 'file');
    expect(filePart.opts.contentType).toBe('audio/ogg');
    expect(filePart.opts.filename).toMatch(/\.ogg$/);
  });

  test('an MP3 buffer still uploads as audio/mpeg (Uplift tiers unbroken)', async () => {
    const WhatsApp = freshWhatsApp();
    const ok = await WhatsApp.sendAudio('923001234567', MP3_BUFFER, TEMP);
    expect(ok).toBe(true);
    const filePart = appended.find((a) => a.name === 'file');
    expect(filePart.opts.contentType).toBe('audio/mpeg');
    expect(filePart.opts.filename).toMatch(/\.mp3$/);
  });
});
