'use strict';
/**
 * bd-snkn32.16 — gate v2 for a teacher's own plan (pure): judge % >= 85, no check rated 1, key checks (7B content
 * accuracy, 5D exit ticket) >= 3. Within 1.5 of the bar a second scoring is asked for and the mean decides.
 * The score decides ONLY shared-library eligibility; nothing here can block her plan.
 */
const { gateV2, judgePct, parseReview, reviewMessages, CHECKS, BAR } = require('../../bot/shared/services/lp612-own-review');

const allAt = (r) => Object.fromEntries(CHECKS.map((c) => [c.id, r]));

test('the bar is 85 and the rubric carries the two key checks', () => {
  expect(BAR).toBe(85);
  const ids = CHECKS.map((c) => c.id);
  expect(ids).toEqual(expect.arrayContaining(['7B', '5D']));
  expect(new Set(ids).size).toBe(ids.length);
});

test('judge % is points over four per assessed check; n/a shrinks the denominator', () => {
  expect(judgePct({ a: 4, b: 4 })).toBe(100);
  expect(judgePct({ a: 3, b: 3 })).toBe(75);
  expect(judgePct({ a: 4, b: 2, c: null })).toBe(75);
  expect(judgePct({})).toBe(0);
});

test('every check at 4 passes', () => {
  expect(gateV2(allAt(4))).toEqual({ pass: true, rescore: false, pct: 100, reasons: [] });
});

test('every check at 3 is 75 and fails on the bar alone', () => {
  const g = gateV2(allAt(3));
  expect(g.pass).toBe(false);
  expect(g.reasons).toEqual(['judge 75.0 < 85']);
});

test('one check rated 1 fails even at a high %', () => {
  const g = gateV2({ ...allAt(4), '2C': 1 });
  expect(g.pass).toBe(false);
  expect(g.reasons.join()).toMatch(/rated 1.*2C/);
});

test('a key check at 2 fails even at a high %', () => {
  const g = gateV2({ ...allAt(4), '7B': 2 });
  expect(g.pass).toBe(false);
  expect(g.reasons.join()).toMatch(/key check below 3: 7B/);
  expect(gateV2({ ...allAt(4), '5D': 2 }).reasons.join()).toMatch(/5D/);
});

test('a key check the judge did not rate fails closed', () => {
  const items = allAt(4);
  delete items['5D'];
  expect(gateV2(items).pass).toBe(false);
});

test('exactly 85 passes; near the bar asks for a second scoring and the mean decides', () => {
  // 20 checks, x of them at 4 and the rest at 3: (60 + x) / 80.
  const mk = (fours) => Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i < 2 ? ['7B', '5D'][i] : `c${i}`, i < fours ? 4 : 3]));
  expect(gateV2(mk(12)).rescore).toBe(false); // 90: not near
  expect(judgePct(mk(8))).toBe(85);
  const first = gateV2(mk(8));
  expect(first.rescore).toBe(true);
  expect(first.pass).toBe(true);
  const mean = gateV2(mk(8), mk(6)); // (85 + 82.5) / 2 = 83.75
  expect(mean.pass).toBe(false);
  expect(mean.rescore).toBe(false);
  expect(mean.pct).toBe(83.75);
  expect(mean.reasons.join()).toMatch(/mean of two/);
  expect(gateV2(mk(8), mk(10)).pass).toBe(true); // (85 + 87.5) / 2
});

test('parseReview reads ratings 1-4 or null, by check id, and nothing else', () => {
  const reply = JSON.stringify({ checks: [
    { id: '7B', rating: 4 }, { id: '5D', rating: '3' }, { id: '2C', rating: null }, { id: 'ZZ', rating: 4 }, { id: '0A', rating: 9 },
  ] });
  expect(parseReview(reply)).toEqual({ '7B': 4, '5D': 3, '2C': null });
  expect(parseReview('not json')).toBeNull();
  expect(parseReview(JSON.stringify({ checks: [] }))).toBeNull();
});

test('the messages carry every check id and the plan, and ask for JSON', () => {
  const m = reviewMessages({ plan: { sections: { warmup: 'Ask the class' } }, lang: 'en' });
  const text = m.map((x) => x.content).join('\n');
  for (const c of CHECKS) expect(text).toContain(c.id);
  expect(text).toContain('Ask the class');
  expect(text).toMatch(/JSON/);
});
