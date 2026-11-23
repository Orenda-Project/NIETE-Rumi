'use strict';
/**
 * bd-hronni (queue #237) — "is .opus not recognized as an audio format to attach?" (operator, 23 Nov).
 *
 * Ogg Opus is what WhatsApp voice notes and many Android recorders save. Server side, a file NAMED .opus was signed and
 * analysed already; what was refused:
 *   - .oga (Ogg audio by its other name) was in no upload list — the portal could not sign it, a WhatsApp document
 *     named .oga was not kept for the app;
 *   - a WhatsApp document whose only clue is its type application/ogg or audio/x-opus+ogg (the router lets it through
 *     on "ogg") was not kept for the app either: the link went without her recording.
 *
 * And the pipeline must handle the bytes: ffprobe reads the length of a real Ogg Opus file (the WhatsApp file door
 * decides "a lesson or a voice note?" on it). Soniox takes Ogg as it is; the Whisper fallback takes .ogg/.oga and
 * converts .opus (not in its list) to mp3 first.
 *
 * The bytes are a REAL Ogg Opus recording: tests/fixtures/audio/lesson-hello.opus (4 s of speech, 16 kbps, 7.7 KB).
 */

const fs = require('fs');
const path = require('path');

const OPUS = fs.readFileSync(path.join(__dirname, '../fixtures/audio/lesson-hello.opus'));
const PORTAL = '../../bot/shared/services/coaching/portal-coaching.service';
const RECORDING = '../../bot/shared/services/coaching/whatsapp-recording.service';
const ROUTER = '../../bot/shared/handlers/audio-document-router';

const ME = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const NOW = new Date('2026-11-23T14:15:00Z');

const fixedDeps = (r2 = {}) => ({
  now: () => NOW,
  newId: () => 'b2c3d4e5-0000-4000-8000-000000000001',
  r2: { getPresignedUploadUrl: jest.fn(async (key, type) => `https://r2.example/put/${key}?ct=${type}`), ...r2 },
});

beforeEach(() => { jest.resetModules(); });

describe('the portal signs Ogg audio by every name it goes by', () => {
  test.each([
    ['lesson.opus', '.opus'],
    ['lesson.ogg', '.ogg'],
    ['lesson.oga', '.oga'],
    ['LESSON.OGA', '.oga'],
  ])('a classroom recording named %s is signed as audio/ogg', async (filename, ext) => {
    const { presignUpload } = require(PORTAL);
    const out = await presignUpload({ userId: ME, filename, sizeBytes: OPUS.length, kind: 'audio' }, fixedDeps());
    expect(out.status).toBe('ok');
    expect(out.contentType).toBe('audio/ogg');
    expect(out.key).toBe(`classroom_audio/${ME}/2026-11/portal_b2c3d4e5-0000-4000-8000-000000000001${ext}`);
  });

  test('the key it signed is one she may start a session with', async () => {
    const { presignUpload, isOwnPortalKey } = require(PORTAL);
    const out = await presignUpload({ userId: ME, filename: 'lesson.oga', kind: 'audio' }, fixedDeps());
    expect(isOwnPortalKey(ME, out.key, 'audio')).toBe(true);
  });

  test.each(['reflection_audio'])('a %s answer in .oga is signed too', async (kind) => {
    const { presignUpload } = require(PORTAL);
    const out = await presignUpload({ userId: ME, filename: 'answer.oga', kind }, fixedDeps());
    expect(out.status).toBe('ok');
    expect(out.contentType).toBe('audio/ogg');
  });
});

describe('a WhatsApp document of Ogg Opus reaches the audio door and is kept for the app', () => {
  test.each([
    [{ mimeType: 'application/octet-stream', filename: 'PTT-20261123-WA0005.opus' }],
    [{ mimeType: 'audio/ogg; codecs=opus', filename: undefined }],
    [{ mimeType: 'application/ogg', filename: 'Voice 014' }],
    [{ mimeType: 'application/octet-stream', filename: 'lesson.oga' }],
  ])('the router sends %o to the audio pipeline', ({ mimeType, filename }) => {
    const { classifyAudioDocument } = require(ROUTER);
    expect(classifyAudioDocument({ mimeType, filename, fileSize: OPUS.length }).decision).toBe('route_to_audio_pipeline');
  });

  const fakeDeps = () => {
    const store = {};
    const q = { select: () => q, eq: () => q, in: () => q, is: () => q, not: () => q, neq: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: null, error: null }), then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej) };
    return {
      store,
      supabase: { from: () => q },
      r2: {
        uploadBuffer: jest.fn(async (buffer, key, contentType) => { store[key] = contentType; return `https://r2.example/${key}`; }),
        listObjects: jest.fn(async () => []),
        headObject: jest.fn(async () => ({ exists: false })),
      },
      now: () => NOW,
      newId: () => 'b2c3d4e5-0000-4000-8000-000000000001',
      log: jest.fn(),
      tk: (id) => `tk-${id}`,
    };
  };

  test.each([
    ['application/ogg', null, '.ogg'],
    ['audio/x-opus+ogg', 'Voice 014', '.opus'],
    ['application/octet-stream', 'lesson.oga', '.oga'],
    ['application/octet-stream', 'PTT-20261123-WA0005.opus', '.opus'],
    ['audio/ogg; codecs=opus', null, '.ogg'],
  ])('typed %s, named %s: saved as %s, stored as audio/ogg', async (mimeType, filename, ext) => {
    const { __internals: { keepRecording } } = require(RECORDING);
    const d = fakeDeps();
    const out = await keepRecording({ userId: ME, buffer: OPUS, mimeType, filename, seconds: 4, door: 'document' }, d);
    expect(out.status).toBe('saved');
    expect(out.key.endsWith(ext)).toBe(true);
    expect(d.store[out.key]).toBe('audio/ogg');
    expect(require(PORTAL).isOwnPortalKey(ME, out.key, 'audio')).toBe(true);
  });
});

// The real ffprobe on these bytes is bot/tests/services/bd-hronni-opus-ffprobe.test.js: this root suite maps fluent-ffmpeg
// to a stub on purpose (a unit suite never shells out to a transcoder).
describe('the pipeline takes Ogg Opus', () => {
  test('the Whisper fallback converts .opus (not in its list) and takes .ogg/.oga as they are', () => {
    const AudioService = require('../../bot/shared/services/audio.service');
    const takes = (name) => AudioService._whisperAcceptsExtension(name);
    expect(takes('x.ogg')).toBe(true);
    expect(takes('x.oga')).toBe(true);
    expect(takes('x.opus')).toBe(false);
  });
});
