'use strict';

/**
 * A letter-sound clip says the sound once. A continuant (s, f, h, l, m, n, r, v, z) is one held sound, "ssss" for about a
 * second, never the letter said three times ("s s s"). Checked on the served clips of every set (v1 + v2, and v3 where it
 * holds the key) by their sound bursts: ffmpeg's silencedetect splits a clip at each gap of 60 ms or more under -40 dB.
 * - a single sound ("sss", "buh"): one burst; a continuant's burst lasts 0.5 s or more;
 * - a list of sounds ("fff, ah, nnn"): no more bursts than sounds;
 * - a line that ends on a continuant ("The sound of this letter is sss."): its last burst lasts 0.4 s or more;
 * - a held hiss ("sss", "fff") has no vowel in it: under 900 Hz it is quieter than over 3.5 kHz ("ess", "eff" fail).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');
const { loadBank } = require('../../scripts/child-test/record-sa-voice');
const { EN_LETTER_SOUNDS } = require('../../shared/services/child-test/sa/scripts');

const ffmpeg = (() => { try { return require('@ffmpeg-installer/ffmpeg').path; } catch (_) { return 'ffmpeg'; } })();
const DASH = path.join(__dirname, '..', '..', '..', 'dashboard');
const SOUNDS = new Set(Object.values(EN_LETTER_SOUNDS));
const HELD = /^([fhlmnrsvz])\1+$/;
const words = (s) => String(s).toLowerCase().match(/[a-z]+/g) || [];

function bursts(file) {
  const out = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=n=-40dB:d=0.06', '-f', 'null', '-'],
    { encoding: 'utf8' }).stderr;
  const dur = Number((/Duration: (\d+):(\d+):([\d.]+)/.exec(out) || []).slice(1).reduce((a, x) => a * 60 + Number(x), 0));
  const starts = [...out.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...out.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const segs = [];
  let at = 0;
  starts.forEach((s, i) => { if (s - at > 0.05) segs.push(s - at); at = ends[i] == null ? dur : ends[i]; });
  if (dur - at > 0.05) segs.push(dur - at);
  return segs;
}

function bandDb(file, filter) {
  const out = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', `${filter},astats=metadata=0`, '-f', 'null', '-'],
    { encoding: 'utf8' }).stderr;
  return Number((/RMS level dB: (-?[\d.]+)/.exec(out) || [])[1] || -99);
}

const manifest = voiceManifest(loadBank());
const rows = manifest.filter((r) => r.lang === 'en' && words(r.text).some((w) => SOUNDS.has(w) || /^([a-z])\1+$/.test(w)))
  .map((r) => ({ ...r, kind: SOUNDS.has(r.text.trim()) ? 'one'
    : words(r.text).every((w) => SOUNDS.has(w) || /^([a-z])\1+$/.test(w)) ? 'list'
      : HELD.test(words(r.text).pop()) ? 'ends_held' : null }))
  .filter((r) => r.kind);
const clips = rows.flatMap((r) => ['v1', 'v2', 'v3'].map((v) => ({ ...r, v, file: path.join(DASH, r.key.replace('sa/v1/', `sa/${v}/`)) }))
  .filter((c) => fs.existsSync(c.file)));

function faultOf(c) {
  const segs = bursts(c.file);
  const n = words(c.text).length;
  if (c.kind === 'one' && segs.length !== 1) return `${segs.length} bursts`;
  if (c.kind === 'one' && HELD.test(c.text.trim()) && segs[0] < 0.5) return `held for ${segs[0].toFixed(2)} s`;
  if (c.kind === 'one' && /^(s|f)\1+$/.test(c.text.trim())) {
    const low = bandDb(c.file, 'lowpass=f=900');
    const high = bandDb(c.file, 'highpass=f=3500');
    if (low >= high) return `a vowel in the hiss (${low.toFixed(1)} dB under 900 Hz, ${high.toFixed(1)} dB over 3.5 kHz)`;
  }
  if (c.kind === 'list' && segs.length > n) return `${segs.length} bursts for ${n} sounds`;
  if (c.kind === 'ends_held' && segs[segs.length - 1] < 0.4) return `last burst ${segs[segs.length - 1].toFixed(2)} s`;
  return null;
}

describe('letter-sound clips say each sound once', () => {
  test('the audit covers every English letter sound, in both sets', () => {
    const sss = clips.filter((c) => c.text === EN_LETTER_SOUNDS.s).map((c) => c.v);
    expect(sss).toEqual(expect.arrayContaining(['v1', 'v2']));
    expect(new Set(clips.filter((c) => c.kind === 'one').map((c) => c.text)).size).toBeGreaterThanOrEqual(15);
  });

  test('no clip says a held sound as the letter again and again ("s s s")', () => {
    const faults = clips.map((c) => [c.v, c.text, path.basename(c.file), faultOf(c)]).filter((x) => x[3]);
    expect(faults).toEqual([]);
  });
});

describe('a phone that kept the old clips', () => {
  test('gets the new ones: the offline clip cache is a new one, so the worker drops the copy that says "s s s"', () => {
    const { SESSION } = require('../../../dashboard/sa/sw.js');
    expect(SESSION).not.toBe('sa-session-v2');
    expect(SESSION).toMatch(/^sa-session-v\d+$/);
  });
});
