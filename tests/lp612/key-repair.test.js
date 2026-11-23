'use strict';
/**
 * bd-znzjqi — a misspelled field name is repaired, not fatal.
 *
 * Live, 18 Nov 2026 06:16Z: grade_7_geography.c01.p009-009 came back with `page2.coaching_lookfer` in
 * every round; the schema refused it three times, the render refused it, and the teacher got no plan.
 */

const { repairNearMissKeys, distance } = require('../../bot/shared/services/lp612-key-repair');
const { validateDoc } = require('../../bot/vendor/lp-v9/lib/validate');
const BASE = require('./__fixtures__/v9_gate_base.lp.json');

const fresh = () => JSON.parse(JSON.stringify(BASE));
function misspell(doc, parent, from, to) {
  doc[parent][to] = doc[parent][from];
  delete doc[parent][from];
  return doc;
}

test('the fixture is valid to begin with', () => {
  expect(validateDoc(fresh()).ok).toBe(true);
});

test('the live case: page2.coaching_lookfer is renamed to coaching_lookfor and the document validates', () => {
  const doc = misspell(fresh(), 'page2', 'coaching_lookfor', 'coaching_lookfer');
  expect(validateDoc(doc).ok).toBe(false);
  const value = doc.page2.coaching_lookfer;

  const renamed = repairNearMissKeys(doc);

  expect(renamed).toEqual([{ path: '/page2', from: 'coaching_lookfer', to: 'coaching_lookfor' }]);
  expect(doc.page2.coaching_lookfor).toEqual(value);
  expect('coaching_lookfer' in doc.page2).toBe(false);
  expect(validateDoc(doc).ok).toBe(true);
});

test('a valid document is left exactly as it was', () => {
  const doc = fresh();
  expect(repairNearMissKeys(doc)).toEqual([]);
  expect(doc).toEqual(BASE);
});

test('an unknown key with no near-miss is left for the schema gate', () => {
  const doc = fresh();
  doc.page2.something_else_entirely = 'x';
  expect(repairNearMissKeys(doc)).toEqual([]);
  expect(doc.page2.something_else_entirely).toBe('x');
  expect(validateDoc(doc).ok).toBe(false);
});

test('a near-miss whose real key is ALSO present is not renamed (nothing is overwritten)', () => {
  const doc = fresh();
  doc.page2.coaching_lookfer = 'duplicate';
  expect(repairNearMissKeys(doc)).toEqual([]);
  expect(doc.page2.coaching_lookfor).toEqual(BASE.page2.coaching_lookfor);
});

test('distance is Levenshtein, capped', () => {
  expect(distance('coaching_lookfer', 'coaching_lookfor')).toBe(1);
  expect(distance('next_perod', 'next_period')).toBe(1);
  expect(distance('abc', 'xyzxyz')).toBe(3);
});
