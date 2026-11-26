'use strict';
/**
 * The letter-sound picker says each sound three times (the same recorded sound, copied: no letter gets a clue), and the
 * served prompt is exactly the file the content owner passed by ear: each one's bytes hash to the sha256 heard (written
 * in base64 here, so no hex digest reads as a phone number to the fixture rule), so a
 * re-levelled or re-encoded file under the same key fails here. prompt_timings.json carries where each of the three
 * sounds starts and ends: speech_start_ms is the first one's start, speech_end_ms the third one's end.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DASH = path.join(__dirname, '..');
const PASSED = [
  ['sa/v5/en/11e4b6281fd2.mp3', 'sqXWWBMCNAFQcm4en50ixsQyNcz4G71BtiXweYtIWmI='],
  ['sa/v5/en/27935baf8897.mp3', 'O39YY+hNaD/lcaHMIQQWIgdmveOjVO4XGtVL2WzOiKE='],
  ['sa/v5/en/7f1a59d218ac.mp3', 'f+e4/N6iP9FdBggzcZ8U1jFVaZfVvs13AFWA3KKTyYY='],
  ['sa/v5/en/c1a26ae596e8.mp3', 'tB3GYTeoCUe/+omsGKPhiWm4ryY1gYapp7qe4ar2CX0='],
  ['sa/v5/en/d24717892746.mp3', 'aMkPB06G9WiK4oqLc9AzFX6pKVxRf/Kr4mRCG8HDyOA='],
  ['sa/v5/en/e7745a4e7e63.mp3', 'BiMEU6OE1E3JXcJdbldDvu/K5cPju+9UVuFc/W6HLBY='],
  ['sa/v5/ur/1e44932e4988.mp3', 'wqbxuOXJFw4oPvx7slEa16UEPDautGmSgeut/TFtQ74='],
  ['sa/v5/ur/251ed2ae0d9a.mp3', '1uc/u78E2XC1G104MSFbNDzJ0cT9ijatKJEVZAcbAAY='],
  ['sa/v5/ur/5ce2f6497740.mp3', 'HN7f81GQE5sz1MQSXc2MNcqMWUXLk7USZJxf9HJHsc8='],
  ['sa/v5/ur/779c963e7c67.mp3', 'nkqZBaA2YdTA0rmOk27H1bPpiMnN9cUZDO35k0ARqv8='],
  ['sa/v5/ur/7bdf15eab074.mp3', 'WqT24dHBkbDwqYfKIZazlazxYlwhP2+jZYyj6jtb+f0='],
  ['sa/v5/ur/a9d258188036.mp3', '7UnDuuRyONKEuFiuL+MbpzMVHwTGuD109P9KNrKWOH8='],
  ['sa/v5/ur/ba9f9a10b1b5.mp3', 'wFtqRAHbG+7L5KKmbOmfd/P/rEtACkpgp9UEoylG21E='],
  ['sa/v5/ur/c29476e64ba4.mp3', 'xtSuHa+zw78HXqyJmtD5tBxGBT04CUJDYr8p7jSaUO0='],
  ['sa/v5/ur/cdfab322cbde.mp3', 'bnjtOWZbjwoKMfd9MxDjDJt5mayVDIbtYOdLohoZyic='],
  ['sa/v5/ur/dabd63291f3b.mp3', 'msCbzXHrISBRKuzyddt4DWriKLiGGCsMl30wZ/ei0Cs='],
];
// The content owner's 26 Nov swaps (Urdu ا ت; English g w q x and practice k): the take staged under each new key for her
// check, three times like the rest. When she picks another take its bytes replace these under the same key, and the line
// moves to PASSED with the picked file's sha256.
const STAGED = [
  ['sa/v5/ur/025b34d4fe2f.mp3', '5BjmMq+7wKMHvKjBtUvlldFdL0FWcae5lwhks/B/LdA='], // alif
  ['sa/v5/ur/6cbe48d95dc1.mp3', 'Wy9KZyGHT7mIvyqJGsA/opy8p8s/u0x8sn/qQJvv7vo='], // te
  ['sa/v5/en/fa6a577d1290.mp3', '/m1KccDkg1tPgcude8by15B0P0QWO+Kcu9NyeOK8sNo='], // k
  ['sa/v5/en/6cc5c36d85b2.mp3', 'gVMNqNKQMbEG60QKL4jUljz23p/pSRHkdsidKz31kA0='], // g
  ['sa/v5/en/2f988087bd31.mp3', 'mbcXrKSgurbCy7GZO0QHflyC4e7eh3bFivU9GXNOUQk='], // w
  ['sa/v5/en/360e801b2da2.mp3', '648LzrJCzPEEHgpQ3cbb+F94M5SI7CeXJ4HR+PgAp84='], // q
  ['sa/v5/en/902fc6e315f9.mp3', 'nfLqWMYkNeOBv+rVcvCY9k/sMtYf5G+1VJAv+vH5ux4='], // x
];
const T = JSON.parse(fs.readFileSync(path.join(DASH, 'sa', 'v5', 'prompt_timings.json'), 'utf8'));

describe('letter-sound prompts: the passed three-times clips', () => {
  test('no retired prompt (the swapped-out ف ٹ and l z r n, practice t m) is still in the timings', () => {
    for (const k of ['sa/v5/ur/be762a415596.mp3', 'sa/v5/ur/42a27591c742.mp3', 'sa/v5/en/91b3047b486c.mp3', 'sa/v5/en/420a8389562d.mp3',
      'sa/v5/en/4697c4da849a.mp3', 'sa/v5/en/aa98ed74844b.mp3', 'sa/v5/en/d8be0cdacead.mp3', 'sa/v5/en/a321bfba35ba.mp3']) expect([k, T[k]]).toEqual([k, undefined]);
  });

  test.each(PASSED)('%s is the file passed by ear (sha256, base64)', (key, sha256) => {
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(DASH, key))).digest('base64')).toBe(sha256);
  });

  test.each(PASSED)('%s: three spans of one length, the first starting the clock and the third ending it', (key) => {
    const t = T[key];
    expect(t.speech_spans_ms).toHaveLength(3);
    const len = t.speech_spans_ms.map(([s, e]) => e - s);
    expect(Math.max(...len) - Math.min(...len)).toBeLessThanOrEqual(5);
    expect(t.speech_start_ms).toBe(t.speech_spans_ms[0][0]);
    expect(t.first_end_ms).toBe(t.speech_spans_ms[0][1]);
    expect(t.speech_end_ms).toBe(t.speech_spans_ms[2][1]);
    expect(t.dur_ms).toBeLessThanOrEqual(3000);
  });
});

describe('letter-sound prompts: the three-times clips staged for the content owner (26 Nov swaps)', () => {
  test.each(STAGED)('%s is the staged take (sha256, base64)', (key, sha256) => {
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(DASH, key))).digest('base64')).toBe(sha256);
  });

  test.each(STAGED)('%s: three spans of one length, the first starting the clock and the third ending it', (key) => {
    const t = T[key];
    expect(t.speech_spans_ms).toHaveLength(3);
    const len = t.speech_spans_ms.map(([s, e]) => e - s);
    expect(Math.max(...len) - Math.min(...len)).toBeLessThanOrEqual(5);
    expect(t.speech_start_ms).toBe(t.speech_spans_ms[0][0]);
    expect(t.first_end_ms).toBe(t.speech_spans_ms[0][1]);
    expect(t.speech_end_ms).toBe(t.speech_spans_ms[2][1]);
    expect(t.dur_ms).toBeLessThanOrEqual(3000);
  });
});
