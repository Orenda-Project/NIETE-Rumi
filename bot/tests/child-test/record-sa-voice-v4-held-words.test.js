'use strict';

/**
 * Round 10 (the reviewers' 6 Nov list, audio 2): in «ہر ایک کو اونچی آواز میں بولیں» the v4 voice runs «میں» into «بولیں»;
 * a listener hears «اونچی آواز بولیں» (the STT word timings put «میں» at 120 ms). The voice is given a pause after «آواز میں»
 * when a word follows, so the word is said in full; the screen text and the clip key stay.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../scripts/child-test/record-sa-voice');
const P = require('../../scripts/child-test/sa-voice-providers');

const LINE = 'ہر ایک کو اونچی آواز میں بولیں، پھر «آگے» کا بٹن دبائیں۔';

test('withHeldWords: a pause after «آواز میں» before the next word; nothing else changes', () => {
  expect(P.withHeldWords(LINE, 'ur')).toBe('ہر ایک کو اونچی آواز میں، بولیں، پھر «آگے» کا بٹن دبائیں۔');
  expect(P.withHeldWords('اپنا جواب اونچی آواز میں بتائیں۔', 'ur')).toBe('اپنا جواب اونچی آواز میں، بتائیں۔');
  // already followed by a pause or the end of the line: left alone
  expect(P.withHeldWords('اپنا جواب اونچی آواز میں، چاہے اردو یا انگریزی میں بتائیں۔', 'ur'))
    .toBe('اپنا جواب اونچی آواز میں، چاہے اردو یا انگریزی میں بتائیں۔');
  expect(P.withHeldWords('یہ لفظ اونچی آواز میں۔', 'ur')).toBe('یہ لفظ اونچی آواز میں۔');
  expect(P.withHeldWords('Say it out loud.', 'en')).toBe('Say it out loud.');
});

test('v4 Urdu, ElevenLabs: the line is sent with the pause; the clip keeps the key its screen words hash to', async () => {
  const sent = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4held-'));
  const extra = path.join(dir, 'extra.json');
  const key = 'sa/v1/ur/11eeb14f17b4.mp3';
  fs.writeFileSync(extra, JSON.stringify([{ key, lang: 'ur', text: LINE, role: 'battery' }]));
  await run(['--set', 'v4', '--lang', 'ur', '--extra', extra, '--apply', '--max-usd', '100'], {
    outDir: dir, out: () => {},
    synth: async (job) => { sent.push(job); return { audio: Buffer.alloc(2000, 1) }; },
    level: async (b) => Buffer.concat([b, Buffer.alloc(4000)]),
  });
  expect(sent.filter((j) => j.text.includes('اونچی آواز میں بولیں'))).toEqual([]);
  expect(sent.some((j) => j.text.endsWith('ہر ایک کو اونچی آواز میں، بولیں، پھر «آگے» کا بٹن دبائیں۔'))).toBe(true);
  expect(fs.existsSync(path.join(dir, 'sa/v4/ur/11eeb14f17b4.mp3'))).toBe(true);
});
