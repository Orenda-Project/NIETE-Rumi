'use strict';

/**
 * record-sa-voice.js --set v4: a letter NAME the voice misreads is given a spelling it reads right. The v4 voice read
 * «ثے» (the name of ث, said "se") as a "t"/"th" sound, so a child heard a letter that was not on the screen. The voice is
 * given «سے», which it says as "se"; the screen keeps «ثے» and the clip keeps its key.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../scripts/child-test/record-sa-voice');
const P = require('../../scripts/child-test/sa-voice-providers');

async function record(argv) {
  const sent = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4name-'));
  await run([...argv, '--apply', '--max-usd', '100'], {
    outDir: dir, out: () => {},
    synth: async (job) => { sent.push(job); return { audio: Buffer.alloc(2000, 1) }; },
    level: async (b) => Buffer.concat([b, Buffer.alloc(4000)]),
  });
  return sent;
}

test('withLetterNames: «ثے» is voiced as «سے», alone and inside a line; nothing else changes', () => {
  expect(P.withLetterNames('ثے', 'ur')).toBe('سے۔');
  expect(P.withLetterNames('یہ حرف ثے ہے۔', 'ur')).toBe('یہ حرف سے ہے۔');
  expect(P.withLetterNames('شاباش! یہ حرف ثے ہے۔', 'ur')).toBe('شاباش! یہ حرف سے ہے۔');
  expect(P.withLetterNames('یہ حرف بے ہے۔', 'ur')).toBe('یہ حرف بے ہے۔');
  expect(P.withLetterNames('ثمر', 'ur')).toBe('ثمر');
  expect(P.withLetterNames('ثے', 'en')).toBe('ثے');
});

test('v4: the three «ثے» clips are sent to the voice as «سے», under their own keys', async () => {
  const sent = await record(['--set', 'v4', '--lang', 'ur']);
  const said = sent.map((j) => j.text);
  expect(said).toContain('سے۔');
  expect(said).toContain('یہ حرف سے ہے۔');
  expect(said.some((t) => t.endsWith('شاباش! یہ حرف سے ہے۔'))).toBe(true);
  expect(said.filter((t) => t.includes('ثے'))).toEqual([]);
});
