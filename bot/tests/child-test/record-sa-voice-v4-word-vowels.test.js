'use strict';

/**
 * record-sa-voice.js --set v4: an Urdu word the voice says with the wrong vowel is given its vowel mark. Urdu writes no
 * short vowels, and the v4 voice read «جھنڈا» (flag, "jhanda") as "jhunda" — the vowel of «جھنڈ» (a flock) — in the
 * vocabulary picture «بچہ جھنڈا لہرا رہا ہے». The voice is given «جَھنڈا»; the screen keeps «جھنڈا» and the clip keeps
 * its key. Items carry no tashdeed (sa/ur-tashdeed.js voices narrations only), so this applies to every role.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../scripts/child-test/record-sa-voice');
const P = require('../../scripts/child-test/sa-voice-providers');

async function record(argv) {
  const sent = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4vowel-'));
  await run([...argv, '--apply', '--max-usd', '100'], {
    outDir: dir, out: () => {},
    synth: async (job) => { sent.push(job); return { audio: Buffer.alloc(2000, 1) }; },
    level: async (b) => Buffer.concat([b, Buffer.alloc(4000)]),
  });
  return sent;
}

test('withWordVowels: «جھنڈا» is voiced as «جَھنڈا», alone and inside a line; nothing else changes', () => {
  expect(P.withWordVowels('جھنڈا', 'ur')).toBe('جَھنڈا');
  expect(P.withWordVowels('بچہ جھنڈا لہرا رہا ہے', 'ur')).toBe('بچہ جَھنڈا لہرا رہا ہے');
  expect(P.withWordVowels('بچہ خوشی سے جھنڈا لہرا رہا ہے۔', 'ur')).toBe('بچہ خوشی سے جَھنڈا لہرا رہا ہے۔');
  expect(P.withWordVowels('جھنڈ', 'ur')).toBe('جھنڈ');
  expect(P.withWordVowels('جھنڈے', 'ur')).toBe('جھنڈے');
  expect(P.withWordVowels('جَھنڈا', 'ur')).toBe('جَھنڈا');
  expect(P.withWordVowels('جھنڈا', 'en')).toBe('جھنڈا');
});

test('v4: the flag picture is sent to the voice with «جَھنڈا», and no line is sent with a bare «جھنڈا»', async () => {
  const sent = await record(['--set', 'v4', '--lang', 'ur']);
  const said = sent.map((j) => j.text);
  expect(said).toContain('بچہ جَھنڈا لہرا رہا ہے');
  expect(said.filter((t) => /(^|[^َ])جھنڈا/.test(t) && !t.includes('جَھنڈا'))).toEqual([]);
});
