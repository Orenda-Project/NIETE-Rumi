'use strict';

/**
 * record-sa-voice.js --set v4: an English letter SOUND said on its own is given the spelling the voice says as that
 * sound. Given bare, the v4 voice hummed «hhh» ("hmm"), said «rrr» as "uh", «yuh» as a made-up word, «kwuh» as "huh" and
 * «kuh» as "koo" (machine transcripts of the clips; a person confirms the new ones by ear). Only a line that is the sound
 * alone changes: a sound inside a narration line, and the screen, keep their text; the clip keeps its key.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../scripts/child-test/record-sa-voice');
const P = require('../../scripts/child-test/sa-voice-providers');

async function record(argv) {
  const sent = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4alone-'));
  await run([...argv, '--apply', '--max-usd', '100'], {
    outDir: dir, out: () => {},
    synth: async (job) => { sent.push(job); return { audio: Buffer.alloc(2000, 1) }; },
    level: async (b) => Buffer.concat([b, Buffer.alloc(4000)]),
  });
  return sent;
}

test('withSounds: hhh, rrr, yuh, kwuh, kuh alone get their spoken spelling', () => {
  expect(P.withSounds('hhh', 'en')).toBe('[slowly] hhhh');
  expect(P.withSounds('rrr', 'en')).toBe('[slowly] rrrrr');
  expect(P.withSounds('yuh', 'en')).toBe('[slowly] yuh');
  expect(P.withSounds('kwuh', 'en')).toBe('[slowly] kwuh');
  expect(P.withSounds('kuh', 'en')).toBe('[slowly] kuh');
});

test('withSounds: the same sounds inside a line, and every other sound, are as before', () => {
  expect(P.withSounds('The sound of this letter is hhh.', 'en')).toBe('The sound of this letter is hhh.');
  expect(P.withSounds('kuh, ah, tuh', 'en')).toBe('kuh, ah, [slowly] tuh');
  expect(P.withSounds('mmm', 'en')).toBe('[slowly] mmmmm');
  expect(P.withSounds('buh', 'en')).toBe('buh');
  expect(P.withSounds('hhh', 'ur')).toBe('hhh');
});

test('v4: the five sounds alone are sent to the voice with their spoken spelling', async () => {
  const sent = await record(['--set', 'v4', '--lang', 'en']);
  const said = sent.map((j) => j.text);
  for (const t of ['[slowly] hhhh', '[slowly] rrrrr', '[slowly] yuh', '[slowly] kwuh', '[slowly] kuh']) expect(said).toContain(t);
  expect(said.filter((t) => ['hhh', 'rrr', 'yuh', 'kwuh', 'kuh'].includes(t))).toEqual([]);
});

// The content owner's pick (listening list, 16 Nov): x and j said alone, each with its own [slowly], the take they chose.
test('withSounds: ks and juh alone get [slowly] (the picked takes)', () => {
  expect(P.withSounds('ks', 'en')).toBe('[slowly] ks');
  expect(P.withSounds('juh', 'en')).toBe('[slowly] juh');
  expect(P.withSounds('mmm, ih, ss', 'en')).toBe(P.withSounds('mmm, ih, ss', 'en'));
});
