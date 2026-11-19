'use strict';
/**
 * The letter-sound picker says each sound three times (the same recorded sound, copied: no letter gets a clue), and the
 * served prompt is exactly the file the content owner passed by ear: each one's bytes hash to the sha256 heard, so a
 * re-levelled or re-encoded file under the same key fails here. prompt_timings.json carries where each of the three
 * sounds starts and ends: speech_start_ms is the first one's start, speech_end_ms the third one's end.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DASH = path.join(__dirname, '..');
const PASSED = [
  ['sa/v5/en/11e4b6281fd2.mp3', 'b2a5d6581302340150726e1e9f9d22c6c43235ccf81bbd41b625f0798b485a62'],
  ['sa/v5/en/27935baf8897.mp3', '3b7f5863e84d683fe571a1cc210416220766bde3a354ee171ad54bd96cce88a1'],
  ['sa/v5/en/420a8389562d.mp3', '7a48782db1bcc390bb06e6d000faccf189f5218f364ea7a39dd5556875e13284'],
  ['sa/v5/en/4697c4da849a.mp3', '48af778f3fe82477c0248987116ea0e233fd405528f83b7663e0bfbf42615d00'],
  ['sa/v5/en/7f1a59d218ac.mp3', '7fe7b8fcdea23fd15d060833719f14d631556997d5becd77005580dca293c986'],
  ['sa/v5/en/91b3047b486c.mp3', '6efd99cbc80c2ac4c9fa599343acaf14197448df30627596e8a0724861ac6f3f'],
  ['sa/v5/en/a321bfba35ba.mp3', '82aa6e90d6dcb0f43cac5a184c4197113ee65eb80a78b92617b34cd4b1a82bd0'],
  ['sa/v5/en/aa98ed74844b.mp3', '4ad929f9d6db3091b9ce2937cfaf5e2513394b15740f2cc38c0885d8f6566097'],
  ['sa/v5/en/c1a26ae596e8.mp3', 'b41dc66137a80947bffa89ac18a3e18969b8af26358186a9a7ba9ee1aaf6097d'],
  ['sa/v5/en/d24717892746.mp3', '68c90f074e86f5688ae28a8b73d033157ea9295c517ff2abe264421bc1c3c8e0'],
  ['sa/v5/en/d8be0cdacead.mp3', '912d93350a25a65724f07b9cc2764022adeb2fca74e167705583bf17c2e7012b'],
  ['sa/v5/en/e7745a4e7e63.mp3', '06230453a384d44dc95dc25d6e5743beefcae5c3e3bbef5456e15cfd6e872c16'],
  ['sa/v5/ur/1e44932e4988.mp3', '735c1168f702a4936a6189f7978246fbf0eacf296cd1f0f25e8252d299067bb2'],
  ['sa/v5/ur/251ed2ae0d9a.mp3', '072ce892f8f24976ea3c96cdc0184ddaad9e19b8dd6e5dedc356e933fd317a26'],
  ['sa/v5/ur/42a27591c742.mp3', '9e30291988e2561e9b484c284f6d3ae4318e23664935c67679da8328056f2bf7'],
  ['sa/v5/ur/5ce2f6497740.mp3', '49306cbb93b12259afaad057117ec640d2864944483ffbcea04d8e55a090eb40'],
  ['sa/v5/ur/779c963e7c67.mp3', '73550c41089bf229054a984cbe85d94c47be1fdd7f635438ce5f755ce3b309d3'],
  ['sa/v5/ur/7bdf15eab074.mp3', '792547a34fd983ff0d78b674fa862eac95c60ccb023a323404b48a778616d7fe'],
  ['sa/v5/ur/a9d258188036.mp3', 'ca93c56a92c0a2f3929e31ef61b9708ead551c9644a108cf84c7980846fbc561'],
  ['sa/v5/ur/ba9f9a10b1b5.mp3', '425ca9cb4afb9e8d23e4b311a626e25b6bc95502f32c0a7c6f9edb6d99c94791'],
  ['sa/v5/ur/be762a415596.mp3', '6446aa16cc03021a9dee52d0a179fae0a73b16280d4499bfed0d1d9af29f05c9'],
  ['sa/v5/ur/c29476e64ba4.mp3', '32d9c4bd566f1e477c316ea6492290227495bcf8ee5ce42938924fe0fff77f63'],
  ['sa/v5/ur/cdfab322cbde.mp3', '12b34ebb8a83d23263ae4d52babc6fd8d9a99916bd7139291fc010ab41f0548a'],
  ['sa/v5/ur/dabd63291f3b.mp3', '9ac09bcd71eb2120512aecf275db780d6ae228b886182b0c977d3067f7a2d02b'],
];
const T = JSON.parse(fs.readFileSync(path.join(DASH, 'sa', 'v5', 'prompt_timings.json'), 'utf8'));

describe('letter-sound prompts: the passed three-times clips', () => {
  test.each(PASSED)('%s is the file passed by ear', (key, sha256) => {
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(DASH, key))).digest('hex')).toBe(sha256);
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
