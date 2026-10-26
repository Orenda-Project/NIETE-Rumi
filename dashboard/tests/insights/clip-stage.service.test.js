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

describe('the whole-lesson MP3 (API.md §10 R8; m-player 26 Oct 16:34Z: a cue-less WebM never seeks)', () => {
  const SESSION_B = '00000000-0000-4000-8000-030000000002';
  async function runFull({ ok = true, exists = new Set() } = {}) {
    const store = new MemoryStore();
    const moments = [
      { id: 'm-1', fact_id: 'f-1', session_id: SESSION, from_s: 600, to_s: 660, confidence: 'high', clip_status: 'pending' },
      { id: 'm-2', fact_id: 'f-1', session_id: SESSION, from_s: 900, to_s: 960, confidence: 'high', clip_status: 'ready' },
      { id: 'm-3', fact_id: 'f-2', session_id: SESSION_B, from_s: 0, to_s: 60, confidence: 'none', clip_status: 'pending' },
    ];
    for (const m of moments) store.rows('coachip_moments').push({ ...m });
    const puts = [];
    const heads = [];
    const presign = jest.fn(async () => 'https://presigned.invalid/x');
    const spawn = fakeSpawn(ok);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-full-'));
    const lines = [];
    const s3 = { putObject: async (o) => puts.push(o),
      headObject: async (o) => { heads.push(o); if (!exists.has(o.Key)) { const e = new Error('NotFound'); e.name = 'NotFound'; throw e; } return {}; } };
    const clipper = cs.createClipper({ envName: 'sandbox', bucket: 'rumi-sandbox', s3, presign, tmpDir, spawn, bin: 'ffmpeg' });
    await clipper({ momentIds: ['m-1', 'm-2', 'm-3'], moments, facts: [{ id: 'f-1' }, { id: 'f-2' }],
      audioOf: new Map([[SESSION, '/fictional-bucket/classroom_audio/1.webm'], [SESSION_B, '/fictional-bucket/classroom_audio/2.ogg']]),
      store, log: (m) => lines.push(m) });
    return { puts, heads, presign, spawn, tmpDir, lines };
  }
  const fullKeyOf = (s) => `coachip/full/sandbox/${s}.mp3`;

  test('one whole-lesson MP3 per session with a shown moment, 32 kbps mono, no seek or length, presigned for 900 s', async () => {
    const { puts, spawn, presign, tmpDir, lines } = await runFull();
    const full = puts.filter((p) => p.Key.startsWith('coachip/full/'));
    expect(full.map((p) => p.Key).sort()).toEqual([fullKeyOf(SESSION), fullKeyOf(SESSION_B)].sort());
    for (const p of full) expect(p).toMatchObject({ Bucket: 'rumi-sandbox', ContentType: 'audio/mpeg' });
    const fullArgs = spawn.mock.calls.map((c) => c[1]).filter((a) => !a.includes('-ss'));
    expect(fullArgs).toHaveLength(2);
    for (const a of fullArgs) {
      expect(a).not.toContain('-t');
      expect(a.join(' ')).toContain('-vn -ac 1 -b:a 32k -f mp3');
    }
    expect(presign.mock.calls.filter((c) => c[2] === 900)).toHaveLength(2);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
    expect(lines.some((l) => /^full ready=2 skipped=0 failed=0$/.test(l))).toBe(true);
    expect(lines.join('\n')).not.toMatch(/presigned|classroom_audio|0000-4000/);
  });

  test('an object already there is not cut again (a second night uploads nothing)', async () => {
    const { puts, lines } = await runFull({ exists: new Set([fullKeyOf(SESSION), fullKeyOf(SESSION_B)]) });
    expect(puts.filter((p) => p.Key.startsWith('coachip/full/'))).toHaveLength(0);
    expect(lines).toContain('full ready=0 skipped=2 failed=0');
  });

  test('an ffmpeg failure is counted and never uploaded', async () => {
    const { puts, lines, tmpDir } = await runFull({ ok: false });
    expect(puts).toHaveLength(0);
    expect(lines).toContain('full ready=0 skipped=0 failed=2');
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });
});
