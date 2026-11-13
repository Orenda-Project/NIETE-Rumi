'use strict';
/**
 * bd-snkn32.42 — the 6-12 universal criteria fitted to a grades 1-5 own plan (hook / iDo / weDo / youDo / wrap).
 * A check the G1-5 script cannot show is null (left out of the score), never scored low: 2I (the script carries no
 * picture) and 1D (no book text is given to the reviewer). The model is told which part of the script is which part.
 */
const { reviewMessages, applyBand, NOT_ASSESSABLE_K5, gateV2 } = require('../../bot/shared/services/lp612-own-review');

test('grades 1-5: 2I and 1D are not assessable, the rest unchanged', () => {
  expect(NOT_ASSESSABLE_K5).toEqual(['1D', '2I']);
  const items = { '1D': 2, '2I': 1, '7B': 3, '5D': 4 };
  expect(applyBand(items, 'k5')).toEqual({ '1D': null, '2I': null, '7B': 3, '5D': 4 });
  expect(items['2I']).toBe(1);
});

test('grades 6-12 keep 2I as rated; 1D is null in both bands since bd-snkn32.46 (no book text is given)', () => {
  const items = { '1D': 2, '2I': 1, '7B': 3 };
  expect(applyBand(items, 'g612')).toEqual({ ...items, '1D': null });
  expect(applyBand(items)).toEqual({ ...items, '1D': null });
});

test('a G1-5 plan the model rated 1 on 2I no longer fails for a picture the script cannot carry', () => {
  const all = Object.fromEntries(require('../../bot/shared/services/lp612-own-review').CHECKS.map((c) => [c.id, 4]));
  expect(gateV2({ ...all, '2I': 1 }).pass).toBe(false);
  expect(gateV2(applyBand({ ...all, '2I': 1 }, 'k5')).pass).toBe(true);
});

test('the G1-5 prompt maps the script parts to the rubric parts and names the not-assessable checks', () => {
  const sys = reviewMessages({ plan: '{}', lang: 'en', band: 'k5' })[0].content;
  expect(sys).toMatch(/grades 1-5/i);
  expect(sys).toMatch(/hook.*0B/i);
  expect(sys).toMatch(/iDo.*0C/);
  expect(sys).toMatch(/weDo.*youDo.*0D/);
  expect(sys).toMatch(/wrap.*0E/);
  expect(sys).toMatch(/1D.*2I.*null|null.*1D.*2I/s);
});

test('the 6-12 prompt is unchanged by the band', () => {
  expect(reviewMessages({ plan: '{}', lang: 'en', band: 'g612' })).toEqual(reviewMessages({ plan: '{}', lang: 'en' }));
  expect(reviewMessages({ plan: '{}', band: 'g612' })[0].content).not.toMatch(/iDo/);
});
