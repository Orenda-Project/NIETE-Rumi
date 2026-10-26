'use strict';
/** Stage 11 wiring: source parsing, a 300 s presign, the cut through clips.cutAndUpload, the moment's status. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const cs = require('../../lib/insights/clip-stage');
const { MemoryStore } = require('../../lib/insights/store');

const SESSION = '00000000-0000-4000-8000-030000000001';

test('sourceOf: path-style and full URLs; junk is null', () => {
  expect(cs.sourceOf('/fictional-bucket/classroom_audio/a%20b.ogg')).toEqual({ bucket: 'fictional-bucket', key: 'classroom_audio/a b.ogg' });
  expect(cs.sourceOf('https://x.r2.dev/fictional-bucket/k.webm')).toEqual({ bucket: 'fictional-bucket', key: 'k.webm' });
  expect(cs.sourceOf('')).toBe(null);
  expect(cs.sourceOf('/onlybucket')).toBe(null);
});

function fakeSpawn(ok) {
  return jest.fn((bin, args) => {
    const proc = new EventEmitter();
    proc.stderr = new EventEmitter(); proc.stderr.resume = () => {};
    setImmediate(() => { if (ok) fs.writeFileSync(args[args.length - 1], 'mp3'); proc.emit('close', ok ? 0 : 1); });
    return proc;
  });
}

async function run(ok) {
  const store = new MemoryStore();
  const moment = { id: 'm-1', fact_id: 'f-1', session_id: SESSION, from_s: 600, to_s: 660, confidence: 'high', clip_status: 'pending' };
  store.rows('coachip_moments').push({ ...moment });
  const puts = [];
  const presign = jest.fn(async () => 'https://presigned.invalid/x');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-cs-'));
  const clipper = cs.createClipper({ envName: 'sandbox', bucket: 'rumi-sandbox', s3: { putObject: async (o) => puts.push(o) }, presign,
    tmpDir, spawn: fakeSpawn(ok), bin: 'ffmpeg' });
  const n = await clipper({ momentIds: ['m-1'], moments: [moment], facts: [{ id: 'f-1' }],
    audioOf: new Map([[SESSION, '/fictional-bucket/classroom_audio/1.ogg']]), store, log: () => {} });
  return { n, store, puts, presign, tmpDir };
}

test('a cut: presigned for 300 s, uploaded to the environment bucket under the CHECKed key, moment ready, temp dir empty', async () => {
  const { n, store, puts, presign, tmpDir } = await run(true);
  expect(n).toBe(1);
  expect(presign.mock.calls[0][2]).toBe(300);
  expect(puts[0]).toMatchObject({ Bucket: 'rumi-sandbox', Key: `coachip/clips/sandbox/${SESSION}/600-660.mp3`, ContentType: 'audio/mpeg' });
  expect(store.rows('coachip_moments')[0]).toMatchObject({ clip_status: 'ready', clip_r2_key: `coachip/clips/sandbox/${SESSION}/600-660.mp3` });
  expect(fs.readdirSync(tmpDir)).toEqual([]);
});

test('an ffmpeg failure: moment failed, no key, nothing uploaded, temp dir empty', async () => {
  const { n, store, puts, tmpDir } = await run(false);
  expect(n).toBe(0);
  expect(puts).toHaveLength(0);
  expect(store.rows('coachip_moments')[0]).toMatchObject({ clip_status: 'failed', clip_r2_key: null });
  expect(fs.readdirSync(tmpDir)).toEqual([]);
});
