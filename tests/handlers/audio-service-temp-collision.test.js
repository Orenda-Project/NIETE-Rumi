/**
 * AudioService temp files are private to each call. (bd-x74wv)
 *
 * Three AudioService helpers staged audio on disk under a name made from the clock alone:
 *   convertToWav        input_${Date.now()}.ogg           (every voice note on the way to Soniox)
 *   getAudioDuration    duration_check_${Date.now()}.m4a  (the "is this a classroom recording?" probe)
 *   _transcribeWithWhisper  whisper_chunk_${Date.now()}_${i}.mp3 (a long recording's last-resort fallback)
 * ffmpeg / ffprobe and the Whisper upload read those files some time after they were written,
 * so two calls in the same millisecond read each other's audio — or find it already deleted.
 *
 * The REAL AudioService runs with Date.now pinned. Only the process boundary (a fake ffmpeg /
 * ffprobe that open their input a little after they start, as the real binaries do) and the
 * network boundary (the OpenAI SDK's Whisper upload, which reads its stream after 100 ms) are faked.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/utils/constants', () => {
  const nodeOs = require('os');
  const nodeFs = require('fs');
  const nodePath = require('path');
  return {
    ...jest.requireActual('../../bot/shared/utils/constants'),
    TEMP_DIR: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'audio-temp-collision-')),
    OPENAI_API_KEY: 'sk-test',
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), LOGS_DIR: '/tmp',
}));

const HEAD = 64; // the fake transcoder reads only the head of a large file — enough to know whose it is
jest.mock('fluent-ffmpeg', () => {
  const nodeFs = require('fs');
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  const readHead = (p) => {
    const fd = nodeFs.openSync(p, 'r');
    try {
      const size = nodeFs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(size, size > 1024 * 1024 ? 64 : size));
      nodeFs.readSync(fd, buf, 0, buf.length, 0);
      return buf;
    } finally { nodeFs.closeSync(fd); }
  };
  function command(input) {
    const on = {};
    let out = null;
    let start = null;
    const c = {};
    for (const m of ['toFormat', 'audioFrequency', 'audioChannels', 'audioCodec', 'format',
      'setDuration', 'inputOptions', 'outputOptions', 'noVideo']) c[m] = () => c;
    c.setStartTime = (s) => { start = s; return c; };
    c.output = (p) => { out = p; return c; };
    c.on = (ev, fn) => { on[ev] = fn; return c; };
    const go = () => {
      (async () => {
        await later(40);
        try {
          const bytes = readHead(input);
          await later(10);
          const tag = start === null ? Buffer.from('RIFF') : Buffer.from(`SEG${start}:`);
          nodeFs.writeFileSync(out, Buffer.concat([tag, bytes]));
          if (on.end) on.end();
        } catch (e) {
          if (on.error) on.error(e);
        }
      })();
      return c;
    };
    c.save = (p) => { out = p; return go(); };
    c.run = () => go();
    return c;
  }
  const ffmpeg = jest.fn(command);
  ffmpeg.setFfmpegPath = jest.fn();
  ffmpeg.setFfprobePath = jest.fn();
  // ffprobe "measures" the file: here, its duration in seconds is its size in bytes.
  ffmpeg.ffprobe = jest.fn((p, cb) => setTimeout(() => {
    try { cb(null, { format: { duration: nodeFs.statSync(p).size } }); } catch (e) { cb(e); }
  }, 40));
  return ffmpeg;
});
const mockWhisperUploads = [];
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { transcriptions: { create: jest.fn(async ({ file }) => {
    await new Promise((r) => setTimeout(r, 100)); // connect before the body is streamed
    const chunks = [];
    for await (const chunk of file) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    mockWhisperUploads.push(bytes);
    const s = bytes.toString('latin1');
    const who = s.includes('recording-A') ? 'A' : s.includes('recording-B') ? 'B' : '?';
    const seg = (s.match(/^SEG(\d+):/) || [])[1];
    return { text: `${who}${seg}`, language: 'english', duration: 1 };
  }) } },
})));

const { TEMP_DIR } = require('../../bot/shared/utils/constants');
const AudioService = require('../../bot/shared/services/audio.service');

const sha12 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
const PINNED = Date.parse('2026-10-05T09:00:00.000Z');

function leftovers(dir = TEMP_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return fs.statSync(p).isDirectory() ? leftovers(p) : [path.relative(TEMP_DIR, p)];
  });
}

let scratch;
beforeEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-temp-out-'));
  mockWhisperUploads.length = 0;
  jest.spyOn(Date, 'now').mockReturnValue(PINNED); // every call lands in the same millisecond
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(scratch, { recursive: true, force: true });
});
afterAll(() => fs.rmSync(TEMP_DIR, { recursive: true, force: true }));

describe('convertToWav (input_${Date.now()}.ogg)', () => {
  it('two conversions in one millisecond each convert their own audio', async () => {
    const a = Buffer.concat([Buffer.from('OggS'), Buffer.from('-teacher-A-'.repeat(50))]);
    const b = Buffer.concat([Buffer.from('OggS'), Buffer.from('-teacher-B-'.repeat(50))]);
    const outA = path.join(scratch, 'a.wav');
    const outB = path.join(scratch, 'b.wav');

    await Promise.allSettled([AudioService.convertToWav(a, outA), AudioService.convertToWav(b, outB)]);

    expect(fs.existsSync(outA) && sha12(fs.readFileSync(outA))).toBe(sha12(Buffer.concat([Buffer.from('RIFF'), a])));
    expect(fs.existsSync(outB) && sha12(fs.readFileSync(outB))).toBe(sha12(Buffer.concat([Buffer.from('RIFF'), b])));
    expect(leftovers()).toEqual([]);
  });
});

describe('getAudioDuration (duration_check_${Date.now()}.m4a)', () => {
  it('two probes in one millisecond each measure their own audio', async () => {
    const short = Buffer.alloc(120, 1); // "120 s"
    const long = Buffer.alloc(1800, 2); // "1800 s" — a classroom recording

    const [a, b] = await Promise.allSettled([AudioService.getAudioDuration(short), AudioService.getAudioDuration(long)]);

    expect(a).toEqual({ status: 'fulfilled', value: 120 });
    expect(b).toEqual({ status: 'fulfilled', value: 1800 });
    expect(leftovers()).toEqual([]);
  });
});

describe('_transcribeWithWhisper over the 25 MB cap (whisper_chunk_${Date.now()}_${i}.mp3)', () => {
  const recording = (who) => {
    // A sparse 25 MB file — over the Whisper cap, so it is cut into chunks.
    const p = path.join(scratch, `recording-${who}.wav`);
    fs.writeFileSync(p, Buffer.from(`recording-${who}-`.padEnd(HEAD, '.')));
    fs.truncateSync(p, 25 * 1024 * 1024);
    return p;
  };

  it("two long recordings chunked in one millisecond are each transcribed from their own chunks", async () => {
    const [a, b] = await Promise.allSettled([
      AudioService._transcribeWithWhisper(recording('A')),
      AudioService._transcribeWithWhisper(recording('B')),
    ]);

    // Two chunks each (25 MB / 24 MB cap); every chunk must come from its own recording.
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    expect(a.value.text).toMatch(/^A0 A\d+$/);
    expect(b.value.text).toMatch(/^B0 B\d+$/);
    expect(leftovers()).toEqual([]);
  });
});
