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
  ['sa/v5/en/420a8389562d.mp3', 'ekh4LbG8w5C7BubQAPrM8Yn1IY82TqejndVVaHXhMoQ='],
  ['sa/v5/en/4697c4da849a.mp3', 'SK93jz/oJHfAJImHEW6g4jP9QFUo+Dt2Y+C/v0JhXQA='],
  ['sa/v5/en/7f1a59d218ac.mp3', 'f+e4/N6iP9FdBggzcZ8U1jFVaZfVvs13AFWA3KKTyYY='],
  ['sa/v5/en/91b3047b486c.mp3', 'bv2Zy8gMKsTJ+lmTQ6yvFBl0SN8wYnWW6KBySGGsbz8='],
  ['sa/v5/en/a321bfba35ba.mp3', 'gqpukNbcsPQ8rFoYTEGXET7mXrgKeLkmF7NM1LGoK9A='],
  ['sa/v5/en/aa98ed74844b.mp3', 'Stkp+dbbMJG5zik3z69eJRM5SxV0DyzDjAiF2PZWYJc='],
  ['sa/v5/en/c1a26ae596e8.mp3', 'tB3GYTeoCUe/+omsGKPhiWm4ryY1gYapp7qe4ar2CX0='],
  ['sa/v5/en/d24717892746.mp3', 'aMkPB06G9WiK4oqLc9AzFX6pKVxRf/Kr4mRCG8HDyOA='],
  ['sa/v5/en/d8be0cdacead.mp3', 'kS2TNQolplck8HucwnZAIq3rL8p04WdwVYO/F8LnASs='],
  ['sa/v5/en/e7745a4e7e63.mp3', 'BiMEU6OE1E3JXcJdbldDvu/K5cPju+9UVuFc/W6HLBY='],
  ['sa/v5/ur/1e44932e4988.mp3', 'c1wRaPcCpJNqYYn3l4JG+/Dqzyls0fDyXoJS0pkGe7I='],
  ['sa/v5/ur/251ed2ae0d9a.mp3', 'ByzokvjySXbqPJbNwBhN2q2eGbjdbl3tw1bpM/0xeiY='],
  ['sa/v5/ur/42a27591c742.mp3', 'njApGYjiVh6bSEwoT2065DGOI2ZJNcZ2edqDKAVvK/c='],
  ['sa/v5/ur/5ce2f6497740.mp3', 'STBsu5OxIlmvqtBXEX7GQNKGSURIP/vOoE2OVaCQ60A='],
  ['sa/v5/ur/779c963e7c67.mp3', 'c1UMQQib8ikFSphMvoXZTEe+H91/Y1Q4zl91XOOzCdM='],
  ['sa/v5/ur/7bdf15eab074.mp3', 'eSVHo0/Zg/8NeLZ0+oYurJXGDMsCOjI0BLSKd4YW1/4='],
  ['sa/v5/ur/a9d258188036.mp3', 'ypPFapLAovOSnjHvYblwjq1VHJZEoQjPhMeYCEb7xWE='],
  ['sa/v5/ur/ba9f9a10b1b5.mp3', 'Qlypy0r7no0j5LMRpibiW2vJVQLzLAp8b57bbZnJR5E='],
  ['sa/v5/ur/be762a415596.mp3', 'ZEaqFswDAhqd7lLQoXn64Kc7FigNRJm/7Q0dmvKfBck='],
  ['sa/v5/ur/c29476e64ba4.mp3', 'MtnEvVZvHkd8MW6mSSKQInSVvPjuXOQpOJJP4P/3f2M='],
  ['sa/v5/ur/cdfab322cbde.mp3', 'ErNOu4qD0jJjrk1Surxv2NmpmRa9cTkpH8AQq0HwVIo='],
  ['sa/v5/ur/dabd63291f3b.mp3', 'msCbzXHrISBRKuzyddt4DWriKLiGGCsMl30wZ/ei0Cs='],
];
const T = JSON.parse(fs.readFileSync(path.join(DASH, 'sa', 'v5', 'prompt_timings.json'), 'utf8'));

describe('letter-sound prompts: the passed three-times clips', () => {
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
