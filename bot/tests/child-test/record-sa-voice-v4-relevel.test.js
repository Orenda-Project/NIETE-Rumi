'use strict';

/**
 * Round 9 item 2 (low volume on some phones; loudness spec from the audio lane): the v4 set is levelled to -16 LUFS
 * integrated, true peak at most -1.5 dBTP (was -21). New v4 clips are levelled there, and --relevel re-levels the v4
 * clips already on disk (gain only: same keys, same format, no voice call), skipping a clip already within 0.5 LU.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { run, loadBank, V4_LUFS, levelV4, measureMp3, ffmpegBin } = require('../../scripts/child-test/record-sa-voice');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');

const manifest = voiceManifest(loadBank());

function seed(dir, lang, n) {
  const rows = manifest.filter((r) => r.lang === lang).slice(0, n);
  for (const r of rows) {
    const f = path.join(dir, r.key.replace('sa/v1/', 'sa/v4/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.alloc(3000, 7));
  }
  return rows;
}

test('the v4 set is levelled to -16 LUFS', () => {
  expect(V4_LUFS).toBe(-16);
});

test('a new v4 clip is levelled to -16 LUFS', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4lv-'));
  const asked = [];
  await run(['--set', 'v4', '--lang', 'en', '--only', 'battery', '--apply', '--max-usd', '100'], {
    outDir: dir, out: () => {},
    synth: async () => ({ audio: Buffer.alloc(2000, 1) }),
    level: async (b, opts) => { asked.push(opts); return Buffer.concat([b, Buffer.alloc(4000)]); },
  });
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((o) => o.lufs === -16 && o.kbps === 32)).toBe(true);
});

test('--relevel: every v4 clip on disk is re-levelled in place, no voice call; one already on target is left alone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4lv-'));
  const rows = seed(dir, 'ur', 4);
  const onTarget = rows[0].key.replace('sa/v1/', 'sa/v4/');
  const levelled = [];
  const res = await run(['--set', 'v4', '--lang', 'ur', '--relevel', '--apply'], {
    outDir: dir, out: () => {},
    synth: async () => { throw new Error('no voice call in --relevel'); },
    measure: async (buf, key) => (key === onTarget ? { i: -16.2, tp: -3 } : { i: -21.3, tp: -7 }),
    level: async (b, opts) => { levelled.push(opts); return Buffer.alloc(3500, 9); },
  });
  expect(res.relevelled).toBe(3);
  expect(res.skipped).toBe(1);
  expect(levelled.every((o) => o.lufs === -16 && o.kbps === 32)).toBe(true);
  expect(fs.readFileSync(path.join(dir, onTarget))[0]).toBe(7);
  for (const r of rows.slice(1)) expect(fs.readFileSync(path.join(dir, r.key.replace('sa/v1/', 'sa/v4/')))[0]).toBe(9);
  expect(res.usd).toBe(0);
});

// The real leveller, on a made clip with sharp peaks (a quiet tone with clicks), long and short: a 32 kb/s re-encode
// overshoots the peak a plain gain aimed at, so levelV4 limits and checks what it wrote.
describe('levelV4 (real ffmpeg)', () => {
  const make = (sec) => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4lv-')), 'in.mp3');
    execFileSync(ffmpegBin(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
      `aevalsrc=0.03*sin(2*PI*220*t)+0.5*lt(mod(t\\,0.4)\\,0.003):s=44100:d=${sec}`, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k', out]);
    return fs.readFileSync(out);
  };
  for (const sec of [6, 1.5]) {
    test(`${sec} s: -16 LUFS within 0.5, true peak at most -1.5 dBTP, mono 32 kb/s`, async () => {
      const outBuf = await levelV4(make(sec), { lufs: V4_LUFS, kbps: 32 });
      const m = await measureMp3(outBuf);
      expect(Math.abs(m.i - V4_LUFS)).toBeLessThanOrEqual(0.5);
      expect(m.tp).toBeLessThanOrEqual(-1.5);
    }, 60000);
  }
});
