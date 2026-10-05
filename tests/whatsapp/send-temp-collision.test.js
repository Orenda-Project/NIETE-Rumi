/**
 * Two sends in the same millisecond each upload their OWN bytes. (bd-c00np)
 *
 * Every media sender below wrote its bytes to a temp file named only by the clock —
 * `audio_${Date.now()}.ogg`, `img_${Date.now()}.png`, `temp_${Date.now()}_${filename}` —
 * and handed that path to fs.createReadStream, which is read when the upload body is
 * streamed, not when it is opened. Two sends to two people that land in the same
 * millisecond share the path: the second write overwrites the first, and the first
 * person is sent the second person's voice note, picture, video or document.
 *
 * Same shape as the attendance-register swap (tests/attendance/register-delivery-temp-race):
 * the REAL WhatsAppService runs, Date.now is pinned so the two sends collide on the clock,
 * and only the network is faked — the media upload waits 200 ms before it reads the
 * stream it was given. Each recipient must receive exactly the bytes meant for them.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/utils/constants', () => ({
  ...jest.requireActual('../../bot/shared/utils/constants'),
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(),
  downloadMedia: jest.fn(),
  extractKeyFromUrl: jest.fn((u) => String(u).replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '')),
}));
// The media-id cache is a convenience; a miss sends every image through the upload.
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => true),
}));
jest.mock('form-data', () => class RecordingFormData {
  constructor() { this.parts = []; }
  append(name, value, options) { this.parts.push({ name, value, options }); }
  getHeaders() { return { 'content-type': 'multipart/form-data; boundary=x' }; }
});

const axios = require('axios'); // mapped stub — the network boundary
const { downloadFromR2, downloadMedia } = require('../../bot/shared/storage/r2');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const sha12 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TEACHER_A = '923000000101';
const TEACHER_B = '923000000102';
// Ogg magic so the audio senders take the voice-note branch; distinct tails per teacher.
const bytesFor = (who) => Buffer.concat([Buffer.from('OggS'), Buffer.from(`-payload-for-${who}-`.repeat(64))]);
const BYTES = { [TEACHER_A]: bytesFor('A'), [TEACHER_B]: bytesFor('B') };
const SOURCE = { [TEACHER_A]: 'https://acct.r2.cloudflarestorage.com/bucket/a.bin', [TEACHER_B]: 'https://acct.r2.cloudflarestorage.com/bucket/b.bin' };
const bySource = (src) => (String(src).includes('a.bin') ? BYTES[TEACHER_A] : BYTES[TEACHER_B]);

let uploads;
let sends;
let baseDir;

function mediaIdOf(body) {
  if (!body) return null;
  const media = body.audio || body.document || body.image || body.video
    || (body.interactive && body.interactive.header
      && (body.interactive.header.image || body.interactive.header.video));
  return media && media.id;
}

beforeEach(() => {
  uploads = new Map();
  sends = [];
  let n = 0;
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-collision-'));
  downloadMedia.mockImplementation(async (src) => bySource(src));
  downloadFromR2.mockImplementation(async (key) => bySource(key));
  axios.post.mockReset();
  axios.post.mockImplementation(async (url, body) => {
    if (/\/media$/.test(url)) {
      const id = `media-${++n}`;
      await sleep(200); // connect to graph.facebook.com before the body is streamed
      const file = body.parts.find((p) => p.name === 'file').value;
      const chunks = [];
      for await (const chunk of file) chunks.push(chunk);
      uploads.set(id, Buffer.concat(chunks));
      return { status: 200, data: { id } };
    }
    if (/\/messages$/.test(url)) {
      sends.push({ to: body.to, mediaId: mediaIdOf(body) });
      return { status: 200, data: { messages: [{ id: `wamid.${sends.length}` }] } };
    }
    return { status: 200, data: {} };
  });
  // Both sends land in the same millisecond — the only thing the old names were unique to.
  jest.spyOn(Date, 'now').mockReturnValue(1790000000000);
});

afterEach(() => {
  jest.restoreAllMocks();
  try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

const SITES = [
  ['sendAudio (whatsapp.service.js audio_${Date.now()})', (to) => WhatsAppService.sendAudio(to, BYTES[to], baseDir)],
  ['sendAudioFromUrl → sendAudio', (to) => WhatsAppService.sendAudioFromUrl(to, SOURCE[to])],
  ['sendAudioFromUrlReturningId (qaudio_${Date.now()})', (to) => WhatsAppService.sendAudioFromUrlReturningId(to, SOURCE[to])],
  ['sendVoicenoteFromR2Key (voice_${Date.now()})', (to) => WhatsAppService.sendVoicenoteFromR2Key(to, SOURCE[to])],
  ['sendDocumentFromUrl (temp_${Date.now()}_${filename})', (to) => WhatsAppService.sendDocumentFromUrl(to, SOURCE[to], 'Report.pdf', 'cap')],
  ['sendImageFromUrl (img_${Date.now()})', (to) => WhatsAppService.sendImageFromUrl(to, SOURCE[to], 'cap')],
  ['sendVideo (video_${Date.now()})', (to) => WhatsAppService.sendVideo(to, BYTES[to], baseDir, 'cap')],
  ['sendImageWithButtons (vocab_${Date.now()})', (to) => WhatsAppService.sendImageWithButtons(to, SOURCE[to], 'body', [{ id: 'b1', title: 'OK' }])],
  ['sendVideoWithButtons (hdr_${Date.now()})', (to) => WhatsAppService.sendVideoWithButtons(to, SOURCE[to], 'body', [{ id: 'b1', title: 'OK' }])],
];

describe.each(SITES)('%s', (_name, send) => {
  it('two concurrent sends in one millisecond each deliver their own bytes', async () => {
    const results = await Promise.all([send(TEACHER_A), send(TEACHER_B)]);
    expect(results.every(Boolean)).toBe(true);

    expect(sends).toHaveLength(2);
    const received = Object.fromEntries(sends.map((s) => [s.to, uploads.get(s.mediaId)]));
    expect(sha12(received[TEACHER_A])).toBe(sha12(BYTES[TEACHER_A]));
    expect(sha12(received[TEACHER_B])).toBe(sha12(BYTES[TEACHER_B]));
  });
});

describe('temp files are cleaned up', () => {
  it('sendAudio and sendVideo leave nothing behind in the directory they were given', async () => {
    await Promise.all([
      WhatsAppService.sendAudio(TEACHER_A, BYTES[TEACHER_A], baseDir),
      WhatsAppService.sendVideo(TEACHER_B, BYTES[TEACHER_B], baseDir, 'cap'),
    ]);
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  it('a failed upload still removes what it wrote', async () => {
    axios.post.mockImplementation(async () => { throw new Error('network down'); });
    expect(await WhatsAppService.sendAudio(TEACHER_A, BYTES[TEACHER_A], baseDir)).toBe(false);
    expect(await WhatsAppService.sendVideo(TEACHER_B, BYTES[TEACHER_B], baseDir, 'cap')).toBe(false);
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });
});
