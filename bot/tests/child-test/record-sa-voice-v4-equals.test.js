'use strict';

/**
 * record-sa-voice.js --set v4: a sum ends on "equals" («برابر»), so Jugnu reads "18 plus 7 equals" and the child hears a
 * blank to fill, not a sum to repeat. v4 only, same keys: with sa_voice_v4 OFF the served clips are unchanged.
 * --sums re-records just the sums over the clips already on disk.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, loadBank } = require('../../scripts/child-test/record-sa-voice');
const P = require('../../scripts/child-test/sa-voice-providers');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');

const manifest = voiceManifest(loadBank());
const v4 = (r) => r.key.replace('sa/v1/', 'sa/v4/');

async function record(argv, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4eq-'))) {
  const sent = [];
  const res = await run([...argv, '--apply', '--max-usd', '100'], {
    outDir: dir, out: () => {},
    synth: async (job) => { sent.push(job); return { audio: Buffer.alloc(2000, 1) }; },
    level: async (b) => Buffer.concat([b, Buffer.alloc(4000)]),
  });
  return { dir, sent, res };
}

test('withEquals: a bare sum gains the spoken equals; anything else is left alone', () => {
  expect(P.withEquals('18 plus 7', 'en')).toBe('18 plus 7 equals');
  expect(P.withEquals('۱۵ منفی ۷', 'ur')).toBe('۱۵ منفی ۷ برابر');
  expect(P.withEquals('6 times 3', 'en')).toBe('6 times 3 equals');
  expect(P.withEquals('What number is this? 1,000 + 300 + 80 + 3', 'en')).toBe('What number is this? 1,000 + 300 + 80 + 3');
  expect(P.withEquals('Now it is your turn to solve each addition problem.', 'en')).toBe('Now it is your turn to solve each addition problem.');
  expect(P.withEquals('18 plus 7 equals', 'en')).toBe('18 plus 7 equals');
});

test('v4 Chutki: every sum item is sent ending on equals, every other line as before', async () => {
  for (const [lang, word] of [['en', 'equals'], ['ur', 'برابر']]) {
    const { sent } = await record(['--set', 'v4', '--lang', lang]);
    const sums = manifest.filter((r) => r.lang === lang && r.role === 'item' && P.withEquals(r.text, lang) !== r.text);
    expect(sums.length).toBeGreaterThan(80);
    const ends = sent.filter((j) => j.text.endsWith(` ${word}`));
    expect(ends.length).toBe(sums.length);
    expect(sent.some((j) => j.text === `${P.spellEnglishNumbers(sums[0].text)} ${word}`)).toBe(true);
  }
});

test('--sums re-records only the sums, over the clips already there, into the same v4 keys', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4eq-'));
  await record(['--set', 'v4', '--lang', 'en'], dir);
  const sums = manifest.filter((r) => r.lang === 'en' && r.role === 'item' && P.withEquals(r.text, 'en') !== r.text);
  const { sent, res } = await record(['--set', 'v4', '--lang', 'en', '--sums'], dir);
  expect(res.recorded).toBe(sums.length);
  expect(sent.length).toBe(sums.length);
  expect(sent.every((j) => j.text.endsWith(' equals'))).toBe(true);
  for (const r of sums) expect(fs.existsSync(path.join(dir, v4(r)))).toBe(true);
});
