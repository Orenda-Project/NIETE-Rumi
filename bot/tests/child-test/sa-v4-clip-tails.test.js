'use strict';

/**
 * Round 10 (the reviewers' 6 Nov list, audio 4: "the audio briefly cuts out just before we hear the correct answer"). Some v4 clips
 * ended in a burst of sound cut off at the file's last sample, after a silence: the child heard "...the answer is" [silence]
 * [a clipped blip] [the answer]. Each clip below must end in silence: no sound in its last 10 ms above -45 dBFS, and no burst
 * after a 150 ms silence that runs to the end of the file. The mic check also said «تین» only as a 60 ms blip, cut off.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ffmpegBin } = require('../../scripts/child-test/record-sa-voice');

const V4 = path.join(__dirname, '../../../dashboard/sa/v4');
const CLIPS = [
  // said straight before a practice answer
  'ur/dd44a405138a', 'ur/25c432705c7b', 'ur/1c437ac4041e',
  // the mic check («کہیں: ایک، دو، تین۔»)
  'ur/a00c8bfe1495',
  // a click at the very end
  'en/3ebd8b0ca40c', 'en/c185c8dea6a0', 'en/c45531b7c68d', 'ur/659c58369837', 'ur/6857ea48e36e', 'ur/7f1ac004f918',
  'ur/ae20c3d37b21', 'ur/e54dcf33874a', 'ur/ef40cbd478f9',
];

function envelope(file) {
  const raw = execFileSync(ffmpegBin(), ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-']);
  const s = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  const out = [];
  for (let i = 0; i + 160 <= s.length; i += 160) {
    let sum = 0;
    for (let j = i; j < i + 160; j += 1) sum += s[j] * s[j];
    out.push(20 * Math.log10(Math.max(1e-9, Math.sqrt(sum / 160)) / 32768));
  }
  return out;
}

test.each(CLIPS)('v4 %s ends in silence, with no cut-off burst after a pause', (clip) => {
  const env = envelope(path.join(V4, `${clip}.mp3`));
  expect(env.length).toBeGreaterThan(20);
  expect(env[env.length - 1]).toBeLessThan(-45);
  let i = env.length - 1;
  while (i >= 0 && env[i] > -60) i -= 1;
  let j = i;
  while (j >= 0 && env[j] <= -60) j -= 1;
  const burstAfterSilence = i < env.length - 1 && i - j >= 15 && j > 0;
  expect(burstAfterSilence).toBe(false);
});

test('each clip has its word-timing file, timed to the clip', () => {
  for (const clip of CLIPS) {
    const t = JSON.parse(fs.readFileSync(path.join(V4, `${clip}.json`), 'utf8'));
    expect(t.audio.url).toBe(`sa/v4/${clip}.mp3`);
    const last = t.words[t.words.length - 1];
    expect(last.e_ms).toBeLessThanOrEqual(t.audio.ms);
  }
});
