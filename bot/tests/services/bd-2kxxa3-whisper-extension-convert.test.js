/**
 * bd-2kxxa.3 (T4b) — the Whisper last-resort path converts an unsupported
 * container to mp3 before upload.
 *
 * One of the stuck prod debriefs was AAC sent as a WhatsApp document. The
 * download was written as `.ogg` whatever the real container, and Whisper
 * (which sniffs the extension) answered 400 invalid format. With the real
 * extension now preserved upstream (.aac), Whisper STILL rejects it — .aac is
 * not in its accepted list (flac m4a mp3 mp4 mpeg mpga oga ogg wav webm) — so
 * the fallback must transcode first.
 *
 * Shared-service note: only _whisperSingleFile with an UNSUPPORTED extension
 * changes behaviour. A supported file goes straight to the upload, untouched.
 *
 * Mocks sit at the process/network boundary (fluent-ffmpeg binary, OpenAI
 * client). The module under test — AudioService — is real.
 */

const fs = require('fs');
const path = require('path');

// fluent-ffmpeg: a chainable builder whose run() "produces" the output file so
// the real fs.createReadStream / statSync in the code under test have a file.
const mockFfmpegCalls = [];
jest.mock('fluent-ffmpeg', () => {
  const realFs = require('fs');
  const ffmpeg = jest.fn((input) => {
    const ctx = { input, output: null, handlers: {} };
    const b = {};
    for (const m of ['audioCodec', 'format', 'audioBitrate', 'audioChannels', 'audioFrequency',
      'setStartTime', 'setDuration', 'toFormat', 'outputOptions', 'noVideo']) {
      b[m] = () => b;
    }
    b.output = (p) => { ctx.output = p; return b; };
    b.on = (ev, fn) => { ctx.handlers[ev] = fn; return b; };
    b.run = () => {
      mockFfmpegCalls.push(ctx);
      realFs.writeFileSync(ctx.output, 'converted-mp3-bytes');
      setImmediate(() => ctx.handlers.end && ctx.handlers.end());
    };
    b.save = (p) => { ctx.output = p; b.run(); };
    return b;
  });
  ffmpeg.setFfmpegPath = jest.fn();
  ffmpeg.setFfprobePath = jest.fn();
  ffmpeg.ffprobe = jest.fn((p, cb) => cb(null, { format: { duration: 60 } }));
  return ffmpeg;
});

const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { transcriptions: { create: (...a) => mockCreate(...a) } },
})));

const AudioService = require('../../shared/services/audio.service');
const { TEMP_DIR } = require('../../shared/utils/constants');

const made = [];
function tempFile(ext) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const p = path.join(TEMP_DIR, `bd2kxxa3_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
  fs.writeFileSync(p, 'fake-audio-bytes');
  made.push(p);
  return p;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFfmpegCalls.length = 0;
  // Like the real SDK, the upload CONSUMES the stream before resolving — so the
  // file must exist at read time (the code under test unlinks a transcode
  // artefact in its finally; a stream nobody read would race that unlink).
  mockCreate.mockImplementation(async ({ file }) => {
    // eslint-disable-next-line no-unused-vars
    for await (const _chunk of file) { /* drain */ }
    return { text: 'hello there', language: 'english', duration: 3, segments: [] };
  });
});
afterAll(() => {
  for (const p of made) { try { fs.unlinkSync(p); } catch (_) { /* gone */ } }
});

const uploadedPath = () => {
  const arg = mockCreate.mock.calls[0][0];
  return arg.file && arg.file.path ? String(arg.file.path) : '';
};

describe('T4b · Whisper fallback transcodes unsupported containers', () => {
  test('.aac → ffmpeg to mp3 first, Whisper receives the .mp3, converted temp file is cleaned up', async () => {
    const aac = tempFile('.aac');
    const res = await AudioService._whisperSingleFile(aac);

    expect(mockFfmpegCalls).toHaveLength(1);
    expect(mockFfmpegCalls[0].input).toBe(aac);
    expect(mockFfmpegCalls[0].output).toMatch(/\.mp3$/);
    expect(uploadedPath()).toMatch(/\.mp3$/);
    expect(uploadedPath()).not.toBe(aac);
    expect(res.text).toBe('hello there');
    expect(res.language).toBe('en');
    // the transcode artefact does not accumulate in TEMP_DIR
    expect(fs.existsSync(mockFfmpegCalls[0].output)).toBe(false);
    // the caller's original file is untouched (the caller owns its lifecycle)
    expect(fs.existsSync(aac)).toBe(true);
  });

  test('.amr (another phone-recorder container) is also transcoded', async () => {
    const amr = tempFile('.amr');
    await AudioService._whisperSingleFile(amr);
    expect(mockFfmpegCalls).toHaveLength(1);
    expect(uploadedPath()).toMatch(/\.mp3$/);
  });

  test.each(['.ogg', '.mp3', '.m4a', '.wav', '.webm', '.oga', '.mp4', '.flac', '.mpeg', '.mpga'])(
    'supported %s → NO transcode, uploaded as-is (behaviour unchanged for every existing caller)',
    async (ext) => {
      const p = tempFile(ext);
      await AudioService._whisperSingleFile(p);
      expect(mockFfmpegCalls).toHaveLength(0);
      expect(uploadedPath()).toBe(p);
    });

  test('extension check is case-insensitive (.AAC is still transcoded, .OGG is not)', async () => {
    await AudioService._whisperSingleFile(tempFile('.AAC'));
    expect(mockFfmpegCalls).toHaveLength(1);
    mockFfmpegCalls.length = 0; mockCreate.mockClear();
    await AudioService._whisperSingleFile(tempFile('.OGG'));
    expect(mockFfmpegCalls).toHaveLength(0);
  });
});
