'use strict';

/**
 * The letter-sound picker's four intros (one per task language × battery language) are spliced: part 1, the example sound,
 * part 2. Each one started its voice 15 ms into the file, so a phone that wakes its speaker late drops the start of "Now" /
 * «اب»; and the build's trim cut the last 128 ms of the Urdu-battery English-task intro, so its last word «کریں» stopped
 * mid-sound. Each intro must start with at least 30 ms before the voice (no 5 ms window at -40 dBFS or louder), and end with
 * at least 100 ms under -50 dBFS after its last voiced 20 ms frame. A timing file moves with its clip.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ffmpegBin } = require('../../scripts/child-test/record-sa-voice');

const V5 = path.join(__dirname, '../../../dashboard/sa/v5');
const INTROS = ['ur/095986edd89a', 'ur/8c9f5bc160d6', 'en/8669cb4e1bb4', 'en/9274cd14bca9'];

function envelope(file, n) {
  const raw = execFileSync(ffmpegBin(), ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-']);
  const s = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  const out = [];
  for (let i = 0; i + n <= s.length; i += n) {
    let sum = 0;
    for (let j = i; j < i + n; j += 1) sum += s[j] * s[j];
    out.push(20 * Math.log10(Math.max(1e-9, Math.sqrt(sum / n)) / 32768));
  }
  return out;
}

test.each(INTROS)('picker intro %s starts at least 30 ms before its voice', (clip) => {
  const env = envelope(path.join(V5, `${clip}.mp3`), 80);
  const onset = env.findIndex((db) => db >= -40);
  expect(onset * 5).toBeGreaterThanOrEqual(30);
});

test.each(INTROS)('picker intro %s ends with at least 100 ms under -50 dBFS', (clip) => {
  const env = envelope(path.join(V5, `${clip}.mp3`), 320);
  let last = env.length - 1;
  while (last >= 0 && env[last] < -50) last -= 1;
  expect((env.length - 1 - last) * 20).toBeGreaterThanOrEqual(100);
});

test('a picker intro with a timing file is timed to the clip', () => {
  for (const clip of INTROS) {
    const f = path.join(V5, `${clip}.json`);
    if (!fs.existsSync(f)) continue;
    const t = JSON.parse(fs.readFileSync(f, 'utf8'));
    expect(t.words[0].s_ms).toBeGreaterThanOrEqual(30);
    expect(t.words[t.words.length - 1].e_ms).toBeLessThanOrEqual(t.audio.ms);
    if (t.example_span_ms) expect(t.example_span_ms[1]).toBeLessThan(t.audio.ms);
  }
});
