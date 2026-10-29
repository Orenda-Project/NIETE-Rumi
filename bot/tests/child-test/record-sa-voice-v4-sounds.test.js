'use strict';

/**
 * record-sa-voice.js --set v4: a letter SOUND is voiced as a sound, not a letter name (the content owner, round 8 items
 * 8, 10, 22). The held sounds are stretched (Urdu «لَ» is "lllll", «نَ» "nnnnn"; mmm, sss, fff, nnn), a stop is a short
 * "tuh"/"puh"/"duh", and each sound gets its own [slowly], as the voicenote phonics grammar does. The screen keeps its
 * text and the keys stay the same: v4 only. --sounds re-records just those lines over the clips already on disk.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, loadBank } = require('../../scripts/child-test/record-sa-voice');
const P = require('../../scripts/child-test/sa-voice-providers');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');

const manifest = voiceManifest(loadBank());

async function record(argv, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4snd-'))) {
  const sent = [];
  const res = await run([...argv, '--apply', '--max-usd', '100'], {
    outDir: dir, out: () => {},
    synth: async (job) => { sent.push(job); return { audio: Buffer.alloc(2000, 1) }; },
    level: async (b) => Buffer.concat([b, Buffer.alloc(4000)]),
  });
  return { dir, sent, res };
}

test('withSounds, Urdu: the practice sounds are held, a first-sound letter is its sound, other lines are left alone', () => {
  expect(P.withSounds('لَ', 'ur')).toBe('[slowly] lllll');
  expect(P.withSounds('نَ', 'ur')).toBe('[slowly] nnnnn');
  expect(P.withSounds('م', 'ur')).toBe('[slowly] mmmmm');
  expect(P.withSounds('لفظ "مدد" کی ابتدائی آواز م ہے۔', 'ur')).toBe('لفظ "مدد" کی ابتدائی آواز [slowly] mmmmm ہے۔');
  expect(P.withSounds('شاباش! لفظ "انار" کی ابتدائی آواز ا ہے۔', 'ur')).toBe('شاباش! لفظ "انار" کی ابتدائی آواز [slowly] اَ ہے۔');
  expect(P.withSounds('اب آپ کی باری! ہر حرف کی آواز تیز آواز بولیں۔', 'ur')).toBe('اب آپ کی باری! ہر حرف کی آواز تیز آواز بولیں۔');
  expect(P.withSounds('آم', 'ur')).toBe('آم');
});

test('withSounds, English: each sound its own [slowly]; held sounds stretched; words left alone', () => {
  expect(P.withSounds('tuh', 'en')).toBe('[slowly] tuh');
  expect(P.withSounds('For example, the sound of this letter is tuh.', 'en')).toBe('For example, the sound of this letter is [slowly] tuh.');
  expect(P.withSounds('fff, ah, nnn', 'en')).toBe('[slowly] fffff, [slowly] ah, [slowly] nnnnn');
  expect(P.withSounds('For example, the sounds in "miss" are mmm, ih, ss.', 'en'))
    .toBe('For example, the sounds in "miss" are [slowly] mmmmm, [slowly] ih, [slowly] sssss.');
  expect(P.withSounds('Yes! The sound of this letter is sss.', 'en')).toBe('Yes! The sound of this letter is [slowly] sssss.');
  expect(P.withSounds('Listen again: "day". The first sound in "day" is duh.', 'en')).toBe('Listen again: "day". The first sound in "day" is [slowly] duh.');
  expect(P.withSounds('What are the sounds in "fish"? "fish".', 'en')).toBe('What are the sounds in "fish"? "fish".');
  expect(P.withSounds('Ah, now it is your turn.', 'en')).toBe('Ah, now it is your turn.');
});

test('v4 Chutki: every sound line is sent with its sounds, each once; --sounds re-records only those, into the same keys', async () => {
  for (const lang of ['en', 'ur']) {
    const rows = manifest.filter((r) => r.lang === lang && P.withSounds(r.text, lang) !== r.text);
    expect(rows.length).toBeGreaterThan(lang === 'en' ? 15 : 4);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4snd-'));
    await record(['--set', 'v4', '--lang', lang], dir);
    const { sent, res } = await record(['--set', 'v4', '--lang', lang, '--sounds'], dir);
    expect(res.recorded).toBe(rows.length);
    expect(sent.every((j) => j.text.includes('[slowly]'))).toBe(true);
    for (const r of rows) expect(fs.existsSync(path.join(dir, r.key.replace('sa/v1/', 'sa/v4/')))).toBe(true);
  }
  const { sent } = await record(['--set', 'v4', '--lang', 'ur', '--sounds']);
  expect(sent.map((j) => j.text)).toEqual(expect.arrayContaining(['[slowly] lllll', '[slowly] nnnnn']));
});
